const mongoose = require('mongoose');

const { SubscriptionCycleRegistration, periodMonthOf } = require('../../src/models/registration.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

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

// A minimal, otherwise-valid subscription_cycle row — every test below
// overrides only the fields it cares about.
function baseRow(overrides = {}) {
  return {
    serviceId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    subscriptionId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    eventType: 'renewal',
    status: 'pending',
    amount: 100,
    breakdown: { monthlyFee: 100 },
    periodStart: new Date('2026-02-01T00:00:00.000Z'),
    periodEnd: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('periodMonthOf', () => {
  it('formats a UTC-midnight sentinel as YYYY-MM, zero-padded', () => {
    expect(periodMonthOf(new Date('2026-02-05T00:00:00.000Z'))).toBe('2026-02');
    expect(periodMonthOf(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12');
    expect(periodMonthOf(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
  });
});

describe('SubscriptionCycleRegistration — periodMonth derivation (docs/plans/payment-airtight-plan.md D7)', () => {
  it('derives periodMonth from periodStart automatically on save — never accepted from the caller', async () => {
    const row = await SubscriptionCycleRegistration.create(
      baseRow({ periodStart: new Date('2026-02-15T00:00:00.000Z'), periodMonth: 'garbage-should-be-overwritten' })
    );

    expect(row.periodMonth).toBe('2026-02');
  });

  it('two different periodStart days in the SAME month derive the SAME periodMonth', async () => {
    const rowA = await SubscriptionCycleRegistration.create(
      baseRow({ subscriptionId: new mongoose.Types.ObjectId(), periodStart: new Date('2026-02-01T00:00:00.000Z') })
    );
    const rowB = await SubscriptionCycleRegistration.create(
      baseRow({ subscriptionId: rowA.subscriptionId, status: 'failed', periodStart: new Date('2026-02-20T00:00:00.000Z') })
    );

    expect(rowA.periodMonth).toBe('2026-02');
    expect(rowB.periodMonth).toBe('2026-02');
  });
});

describe('Registration.manualNote validation (D5)', () => {
  it('rejects chargeMethod "manual" with no manualNote', async () => {
    await expect(SubscriptionCycleRegistration.create(baseRow({ chargeMethod: 'manual' }))).rejects.toThrow(
      /manualNote is required/
    );
  });

  it('rejects chargeMethod "manual" with a blank/whitespace-only manualNote', async () => {
    await expect(
      SubscriptionCycleRegistration.create(baseRow({ chargeMethod: 'manual', manualNote: '   ' }))
    ).rejects.toThrow(/manualNote is required/);
  });

  it('accepts chargeMethod "manual" with a real manualNote', async () => {
    const row = await SubscriptionCycleRegistration.create(
      baseRow({ chargeMethod: 'manual', manualNote: 'Paid by check #1042' })
    );

    expect(row.manualNote).toBe('Paid by check #1042');
  });

  it('never requires manualNote for chargeMethod "card" (the default) — including a row that predates this field', async () => {
    const row = await SubscriptionCycleRegistration.create(baseRow());

    expect(row.chargeMethod).toBe('card');
    expect(row.manualNote).toBeNull();
  });
});

describe('Guard B — unique (subscriptionId, periodMonth) over pending/completed rows (D7)', () => {
  it('rejects a second pending/completed row for the SAME subscription + SAME month, even anchored on a DIFFERENT day', async () => {
    const subscriptionId = new mongoose.Types.ObjectId();

    await SubscriptionCycleRegistration.create(
      baseRow({ subscriptionId, status: 'completed', periodStart: new Date('2026-02-01T00:00:00.000Z') })
    );

    // A "prorated from today" mid-month row for the SAME calendar month —
    // the exact case the OLD (subscriptionId, periodStart) index would NOT
    // have caught, since these two rows have different periodStart values.
    await expect(
      SubscriptionCycleRegistration.create(
        baseRow({ subscriptionId, status: 'pending', periodStart: new Date('2026-02-15T00:00:00.000Z') })
      )
    ).rejects.toThrow(/E11000|duplicate key/);
  });

  it('does NOT block a new row when the only existing row for that month is "failed"', async () => {
    const subscriptionId = new mongoose.Types.ObjectId();

    await SubscriptionCycleRegistration.create(
      baseRow({ subscriptionId, status: 'failed', periodStart: new Date('2026-02-01T00:00:00.000Z') })
    );

    const secondRow = await SubscriptionCycleRegistration.create(
      baseRow({ subscriptionId, status: 'pending', periodStart: new Date('2026-02-15T00:00:00.000Z') })
    );

    expect(secondRow.periodMonth).toBe('2026-02');
  });

  it('allows two rows for the SAME subscription in DIFFERENT months', async () => {
    const subscriptionId = new mongoose.Types.ObjectId();

    await SubscriptionCycleRegistration.create(
      baseRow({
        subscriptionId,
        status: 'completed',
        periodStart: new Date('2026-02-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-01T00:00:00.000Z'),
      })
    );

    const marchRow = await SubscriptionCycleRegistration.create(
      baseRow({
        subscriptionId,
        status: 'pending',
        periodStart: new Date('2026-03-01T00:00:00.000Z'),
        periodEnd: new Date('2026-04-01T00:00:00.000Z'),
      })
    );

    expect(marchRow.periodMonth).toBe('2026-03');
  });
});
