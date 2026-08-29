const Subscription = require('../../models/subscription.model');
const settingService = require('../setting.service');
const { addMonths } = require('../../utils/billingDates');

// Isolated on purpose, same pattern as calculateChargeAmount.service.js —
// one pure(ish) billing function, reused verbatim by both the real charge
// (registration.service.js's create()) and the pre-commit preview
// (previewChargeAmount()), so the two can never structurally disagree.
//
// Read fresh every call, never cached — reads the live Setting doc and the
// student's live Subscription history, not a snapshot.
//
// `standardAmount` (added for the Family Scorecard checkout quote panel,
// docs/plans/wordpress-ui-alignment-plan.md, Phase 3) is the configured fee
// BEFORE any waiver — 0 when no fee is configured at all. It lets
// previewChargeAmount() surface "you're saving $X on the registration fee"
// without the frontend doing that subtraction itself (Hard Rule 7: backend
// is the source of truth for billing math) or needing its own read of the
// Setting doc. `amount` (the actually-charged amount) is unchanged.
//
// @param {string} studentId
// @returns {Promise<{ amount: number, waived: boolean, reason: string|null, standardAmount: number }>}
async function resolveRegistrationFee(studentId) {
  const { registrationFee, returningStudentGracePeriodMonths } = await settingService.getSettings();

  if (!registrationFee || registrationFee <= 0) {
    return { amount: 0, waived: false, reason: null, standardAmount: 0 };
  }

  // Most recent CANCELLED subscription for this student, if any — a prior
  // enrollment that has genuinely ended. currentPeriodEnd (not updatedAt or
  // cancelAtPeriodEnd's set-time) is "when they actually left," since
  // cancellation is two-stage (ADR 001): access continues through the
  // already-paid period, and status only flips to 'cancelled' once the
  // renewal job finalizes it at that period's end.
  const priorSubscription = await Subscription.findOne({ studentId, status: 'cancelled' }).sort({
    currentPeriodEnd: -1,
  });

  if (!priorSubscription) {
    // Brand-new student — no history to grant a "returning" waiver against.
    return { amount: registrationFee, waived: false, reason: null, standardAmount: registrationFee };
  }

  if (!returningStudentGracePeriodMonths || returningStudentGracePeriodMonths <= 0) {
    // No grace period configured — a prior enrollment never waives the fee.
    return { amount: registrationFee, waived: false, reason: null, standardAmount: registrationFee };
  }

  const graceDeadline = addMonths(priorSubscription.currentPeriodEnd, returningStudentGracePeriodMonths);

  if (new Date() <= graceDeadline) {
    return {
      amount: 0,
      waived: true,
      reason: `Registration fee waived — returning within ${returningStudentGracePeriodMonths} month${
        returningStudentGracePeriodMonths === 1 ? '' : 's'
      } of your last enrollment.`,
      standardAmount: registrationFee,
    };
  }

  return { amount: registrationFee, waived: false, reason: null, standardAmount: registrationFee };
}

module.exports = { resolveRegistrationFee };
