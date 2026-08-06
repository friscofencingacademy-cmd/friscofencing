const User = require('../../models/user.model');
const Subscription = require('../../models/subscription.model');
const GroupClassSchedule = require('../../models/groupClassSchedule.model');
const GroupClass = require('../../models/groupClass.model');
const Price = require('../../models/price.model');

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

// Isolated on purpose: Phase 8 (this file) edits this function in place, and
// Phase 9 (renewal job) reuses it as-is.
//
// Sibling discount (10%, dynamic lower-payer rule): whichever of two
// siblings has the (currently) lower price gets 10% off their own price.
// With 3+ active siblings (not expected in practice yet), the comparison is
// against whichever one has the lowest current fee among them — a disclosed
// MVP simplification, not a crash.
//
// Known, accepted MVP limitation: if two siblings' very first registrations
// happen at the exact same instant, each one's read of "does my sibling have
// an active subscription yet" could both see "no" (neither document exists
// yet), so neither gets the discount one of them should get. Fully closing
// this needs a multi-document Mongo transaction — accepted as out of scope
// for MVP since real-world registration is always serial.
async function calculateChargeAmount(student, monthlyFee) {
  const siblings = await User.find({
    role: 'student',
    parentId: student.parentId,
    _id: { $ne: student._id },
  });

  const activeSiblingFees = [];

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

    // eslint-disable-next-line no-await-in-loop
    const currentFee = await resolveCurrentFee(subscription);

    if (currentFee === null) {
      continue;
    }

    activeSiblingFees.push({ studentId: sibling._id, fee: currentFee });
  }

  if (activeSiblingFees.length === 0) {
    return { amount: monthlyFee, siblingDiscountApplied: false, siblingDiscountAmount: 0 };
  }

  const comparisonSibling = activeSiblingFees.reduce((lowest, current) =>
    current.fee < lowest.fee ? current : lowest
  );

  let thisStudentWins;

  if (monthlyFee < comparisonSibling.fee) {
    thisStudentWins = true;
  } else if (monthlyFee > comparisonSibling.fee) {
    thisStudentWins = false;
  } else {
    // Exact tie: the sibling with the lexicographically smaller studentId
    // wins, deterministically, regardless of which sibling's perspective
    // this function is being called from. Without this, calling this same
    // function independently for both siblings' own charges would let both
    // conclude "my price is <= theirs" simultaneously and BOTH apply the
    // discount to themselves — a real double-discount bug.
    thisStudentWins = String(student._id) < String(comparisonSibling.studentId);
  }

  if (!thisStudentWins) {
    return { amount: monthlyFee, siblingDiscountApplied: false, siblingDiscountAmount: 0 };
  }

  return {
    amount: monthlyFee * 0.9,
    siblingDiscountApplied: true,
    siblingDiscountAmount: monthlyFee * 0.1,
  };
}

module.exports = { calculateChargeAmount };
