const Subscription = require('../../src/models/subscription.model');
const { firstOfNextMonth } = require('../../src/utils/billingDates');

// One-time migration for docs/decisions/007-calendar-month-billing.md —
// before this plan, a subscription's period ended at anchorDate + 1 rolling
// month (an anniversary date); now every period must end on a calendar-
// month boundary (the 1st). Every ACTIVE subscription whose currentPeriodEnd
// isn't already a month boundary gets realigned to the next one.
//
// Direction is deliberate and non-negotiable (ADR 007, sign-off item 2):
// realignment always EXTENDS currentPeriodEnd forward to
// firstOfNextMonth(currentPeriodEnd) — never shortens it. A subscription
// currently due to renew on the 17th gets its paid-through date pushed to
// the following month's 1st, i.e. the family keeps access for a few extra
// free days, never fewer than what they already paid for. nextBillingDate
// is set to the same new value (it always mirrors currentPeriodEnd — see
// registration.service.js's create()/renewal.service.js's
// advanceSubscriptionPeriod, the same invariant this migration preserves).
//
// Cancelled subscriptions are never touched — their period is a historical
// record, not a live billing anchor.
//
// Dry-run by default: returns the report without writing anything. Pass
// `{ apply: true }` to actually persist the realignment.
async function realignBillingAnchors({ apply = false } = {}) {
  const activeSubscriptions = await Subscription.find(
    { status: 'active' },
    '_id currentPeriodEnd nextBillingDate'
  ).lean();

  const changes = [];

  for (const subscription of activeSubscriptions) {
    const oldPeriodEnd = subscription.currentPeriodEnd;

    // Already a month boundary (UTC date-only sentinel, day 1) — nothing to
    // realign. Matches the date-only-sentinel convention every
    // currentPeriodEnd in this codebase already uses (billingDates.js's own
    // docblock).
    if (oldPeriodEnd.getUTCDate() === 1) {
      continue;
    }

    const newPeriodEnd = firstOfNextMonth(oldPeriodEnd);

    changes.push({
      subscriptionId: subscription._id,
      oldPeriodEnd,
      newPeriodEnd,
      oldNextBillingDate: subscription.nextBillingDate,
      newNextBillingDate: newPeriodEnd,
    });
  }

  if (apply && changes.length > 0) {
    // Sequential by design, same reasoning as renewal.service.js's
    // runRenewals: a one-time migration over a small collection, not a hot
    // path, and each write is independent — no benefit to Promise.all here.
    for (const change of changes) {
      // eslint-disable-next-line no-await-in-loop -- see comment above.
      await Subscription.updateOne(
        { _id: change.subscriptionId, status: 'active' },
        {
          $set: {
            currentPeriodEnd: change.newPeriodEnd,
            nextBillingDate: change.newNextBillingDate,
          },
        }
      );
    }
  }

  return {
    scannedCount: activeSubscriptions.length,
    changes,
    applied: apply,
  };
}

module.exports = { realignBillingAnchors };
