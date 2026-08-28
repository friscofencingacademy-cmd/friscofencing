const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const Subscription = require('../../../src/models/subscription.model');

const { realignBillingAnchors } = require('../../../scripts/lib/realignBillingAnchors');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
});

// Guard A (subscription.model.js) is unique per {studentId, scheduleId} for
// active docs — each fixture below uses its own ids so multiple active
// subscriptions can coexist in one test.
function makeSubscriptionDoc(overrides = {}) {
  return {
    studentId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('scripts/lib/realignBillingAnchors', () => {
  it('dry-run reports a rolling-anniversary subscription as needing realignment, without writing anything', async () => {
    const subscription = await Subscription.create(
      makeSubscriptionDoc({
        currentPeriodEnd: new Date('2026-09-17T00:00:00.000Z'),
        nextBillingDate: new Date('2026-09-17T00:00:00.000Z'),
      })
    );

    const report = await realignBillingAnchors({ apply: false });

    expect(report.applied).toBe(false);
    expect(report.scannedCount).toBe(1);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]).toEqual(
      expect.objectContaining({
        subscriptionId: subscription._id,
        oldPeriodEnd: new Date('2026-09-17T00:00:00.000Z'),
        newPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      })
    );

    const unchanged = await Subscription.findById(subscription._id);
    expect(unchanged.currentPeriodEnd.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(unchanged.nextBillingDate.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('--live extends currentPeriodEnd AND nextBillingDate to the next month boundary — never shortens (ADR 007 sign-off item 2)', async () => {
    const subscription = await Subscription.create(
      makeSubscriptionDoc({
        currentPeriodEnd: new Date('2026-09-17T00:00:00.000Z'),
        nextBillingDate: new Date('2026-09-17T00:00:00.000Z'),
      })
    );

    const report = await realignBillingAnchors({ apply: true });

    expect(report.applied).toBe(true);
    expect(report.changes).toHaveLength(1);

    const updated = await Subscription.findById(subscription._id);
    expect(updated.currentPeriodEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(updated.nextBillingDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    // The extension always moves the date LATER, never earlier — the
    // family never loses access they already paid for.
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(
      new Date('2026-09-17T00:00:00.000Z').getTime()
    );
  });

  it('leaves a subscription already on a month boundary untouched', async () => {
    await Subscription.create(
      makeSubscriptionDoc({
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
      })
    );

    const report = await realignBillingAnchors({ apply: true });

    expect(report.scannedCount).toBe(1);
    expect(report.changes).toHaveLength(0);
  });

  it('never touches a cancelled subscription, even one with a rolling-anniversary date', async () => {
    const cancelled = await Subscription.create(
      makeSubscriptionDoc({
        status: 'cancelled',
        currentPeriodEnd: new Date('2026-09-17T00:00:00.000Z'),
        nextBillingDate: new Date('2026-09-17T00:00:00.000Z'),
      })
    );

    const report = await realignBillingAnchors({ apply: true });

    expect(report.scannedCount).toBe(0);
    expect(report.changes).toHaveLength(0);

    const unchanged = await Subscription.findById(cancelled._id);
    expect(unchanged.currentPeriodEnd.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('handles multiple active subscriptions in one run, only realigning the ones that need it', async () => {
    await Subscription.create(
      makeSubscriptionDoc({
        currentPeriodEnd: new Date('2026-09-05T00:00:00.000Z'),
        nextBillingDate: new Date('2026-09-05T00:00:00.000Z'),
      })
    );
    await Subscription.create(
      makeSubscriptionDoc({
        currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-11-01T00:00:00.000Z'),
      })
    );

    const report = await realignBillingAnchors({ apply: true });

    expect(report.scannedCount).toBe(2);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].newPeriodEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
