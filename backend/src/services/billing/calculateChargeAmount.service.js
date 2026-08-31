const User = require('../../models/user.model');
const Subscription = require('../../models/subscription.model');
const GroupClassSchedule = require('../../models/groupClassSchedule.model');
const GroupClass = require('../../models/groupClass.model');
const Price = require('../../models/price.model');
const { todayAtMidnight } = require('../../utils/billingDates');

// Resolves a subscription's CURRENT fee live — schedule -> class -> level ->
// Price, every call. Never cached, never read from a stored field on the
// Subscription itself (lastChargeAmount is a record of what happened last
// time, not a source of truth). This is what makes the sibling discount
// "re-verified every time this function is called," including on every
// future renewal: a Price change after the sibling's last charge is picked
// up immediately.
async function resolveCurrentFee(subscription) {
  const schedule = await GroupClassSchedule.findById(subscription.scheduleId);

  if (!schedule) {
    return null;
  }

  const groupClass = await GroupClass.findById(schedule.classId);

  if (!groupClass) {
    return null;
  }

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    return null;
  }

  return price.monthlyFee;
}

// Round once, at the final dollar amount — never by first rounding a
// smaller figure and multiplying, which compounds rounding error (same
// discipline proration.service.js's computeProration already established).
function round2(value) {
  return Math.round(value * 100) / 100;
}

// Every counted sibling's { studentId, fee, createdAt } — shared by both
// modes below. A sibling counts only if they hold an active subscription
// (Guard A, docs/decisions/005-one-active-subscription-per-student.md,
// guarantees at most one, so this is deterministic — no more picking an
// arbitrary one of several). F3 (docs/decisions/006-sibling-discount-
// family-rule.md): a pending-cancel sibling whose paid period has already
// ended is excluded — they're only awaiting the renewal cron's
// finalization pass, not really "active" for discount purposes anymore.
async function gatherSiblingFees(student) {
  const siblings = await User.find({
    role: 'student',
    parentId: student.parentId,
    _id: { $ne: student._id },
  });

  const today = todayAtMidnight();
  const entries = [];

  for (const sibling of siblings) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, low
    // fan-out (a family's sibling count), no benefit to parallelizing here.
    const subscription = await Subscription.findOne({
      studentId: sibling._id,
      status: 'active',
    });

    if (!subscription) {
      continue;
    }

    if (subscription.cancelAtPeriodEnd === true && subscription.currentPeriodEnd <= today) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const fee = await resolveCurrentFee(subscription);

    if (fee === null) {
      continue;
    }

    entries.push({
      studentId: sibling._id,
      studentName: `${sibling.firstName} ${sibling.lastName}`,
      fee,
      createdAt: subscription.createdAt,
    });
  }

  return entries;
}

// Single source of truth for the sibling discount (docs/decisions/006-
// sibling-discount-family-rule.md — supersedes the old "dynamic lower-payer,
// 2-child only" rule, ADR 001). Two modes, both required — every caller
// states its intent explicitly, there is no default:
//
//   'renewal' — pure top-payer-excluded rule. Among the family's active
//   children (this student + siblings), the one with the highest current
//   fee pays full price; everyone else gets 10% off their own fee. Ties at
//   the family maximum are broken by earliest-enrolled-pays-full (CKQ ADR
//   backend-002), falling back to the smaller studentId on an exact
//   createdAt tie. Requires `subscription` (this student's own, active
//   subscription — its createdAt feeds the tiebreak).
//
//   'registration' — the family discount always applies (ADR 006's bridge):
//   10% of min(this registration's fee, the family's current top fee)
//   comes off THIS bill, whenever at least one active sibling exists —
//   even when this newly-registering child is the new top payer. This is
//   deliberately NOT symmetric with 'renewal': it is what makes the family
//   discount start the moment the family qualifies, instead of waiting for
//   an existing sibling's next renewal (owner-decided, ADR 006).
async function calculateChargeAmount(student, feeNow, options) {
  if (!options || (options.mode !== 'registration' && options.mode !== 'renewal')) {
    throw new Error("calculateChargeAmount: options.mode must be 'registration' or 'renewal'");
  }

  const { mode, subscription } = options;

  if (mode === 'renewal' && !subscription) {
    throw new Error("calculateChargeAmount: mode 'renewal' requires the student's own active subscription");
  }

  const siblingEntries = await gatherSiblingFees(student);

  if (siblingEntries.length === 0) {
    return { amount: feeNow, siblingDiscountApplied: false, siblingDiscountAmount: 0, reason: null };
  }

  if (mode === 'registration') {
    const topSiblingFee = siblingEntries.reduce((max, entry) => Math.max(max, entry.fee), -Infinity);
    const base = Math.min(feeNow, topSiblingFee);
    const siblingDiscountAmount = round2(base * 0.1);
    const amount = round2(feeNow - siblingDiscountAmount);

    // Two distinguishable reasons — the "mark" that a family discount was
    // applied, and which rate it was based on, per the owner's ask.
    const reason =
      base === feeNow
        ? 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.'
        : "Your family's 10% sibling discount applies to this registration, based on your other child's lower-priced plan.";

    // Display-only breakdown for the register wizard's quote panel (docs/
    // plans/booking-flow-sequential-plan.md) — siblingComparison lists the
    // exact entries that drove this calculation (never re-queried), and
    // discountBase is the exact figure the 10% was taken from, so the
    // frontend can show "10% of $<discountBase>" without ever computing it
    // itself (Hard Rule 7). Additive only: unused by 'renewal' callers and
    // by any caller that ignores extra fields.
    const siblingComparison = siblingEntries.map((entry) => ({
      studentId: entry.studentId,
      studentName: entry.studentName,
      monthlyFee: entry.fee,
    }));

    return {
      amount,
      siblingDiscountApplied: true,
      siblingDiscountAmount,
      reason,
      siblingComparison,
      discountBase: base,
    };
  }

  // mode === 'renewal' — is THIS student the family's top payer?
  const familyMax = siblingEntries.reduce((max, entry) => Math.max(max, entry.fee), feeNow);
  let isTopPayer;

  if (feeNow < familyMax) {
    // Someone else in the family has a strictly higher fee — not the top
    // payer, no tiebreak needed.
    isTopPayer = false;
  } else {
    // feeNow === familyMax: this student is AT the family's highest fee,
    // possibly tied with one or more siblings there.
    const tiedAtMax = siblingEntries.filter((entry) => entry.fee === familyMax);

    if (tiedAtMax.length === 0) {
      // Uniquely the highest — no sibling reaches this fee.
      isTopPayer = true;
    } else {
      // Deterministic tiebreak (CKQ ADR backend-002): earliest-enrolled
      // among everyone tied at the max pays full. Exact createdAt tie
      // (should not happen in practice) falls back to the smaller
      // studentId, same discipline as the pre-existing exact-price-tie
      // guarantee this replaces.
      let winner = { studentId: student._id, createdAt: subscription.createdAt };

      for (const entry of tiedAtMax) {
        const entryIsEarlier = entry.createdAt.getTime() < winner.createdAt.getTime();
        const entryIsExactTieButSmallerId =
          entry.createdAt.getTime() === winner.createdAt.getTime() && String(entry.studentId) < String(winner.studentId);

        if (entryIsEarlier || entryIsExactTieButSmallerId) {
          winner = entry;
        }
      }

      isTopPayer = String(winner.studentId) === String(student._id);
    }
  }

  if (isTopPayer) {
    return {
      amount: feeNow,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
      reason: 'Your other child has the lower-priced plan, so the sibling discount applies to their plan instead.',
    };
  }

  const siblingDiscountAmount = round2(feeNow * 0.1);
  const amount = round2(feeNow - siblingDiscountAmount);

  return {
    amount,
    siblingDiscountApplied: true,
    siblingDiscountAmount,
    reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
  };
}

module.exports = { calculateChargeAmount, resolveCurrentFee };
