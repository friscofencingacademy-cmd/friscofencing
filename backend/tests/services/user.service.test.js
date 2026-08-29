const mongoose = require('mongoose');

const User = require('../../src/models/user.model');
const Subscription = require('../../src/models/subscription.model');
const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
const Service = require('../../src/models/service.model');
const userService = require('../../src/services/user.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');

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

async function createParent(overrides = {}) {
  return User.create({
    role: 'parent',
    firstName: 'Pat',
    lastName: 'Parent',
    email: `parent-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: 'irrelevant-hash',
    ...overrides,
  });
}

describe('user.service', () => {
  describe('create', () => {
    it('ignores a submitted password for a student and never sets a passwordHash', async () => {
      const parent = await createParent();

      const student = await userService.create(
        { role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id.toString(), password: 'ignored-password' },
        'admin'
      );

      const persisted = await User.findById(student._id);
      expect(persisted.passwordHash).toBeUndefined();
    });

    it('returns safe JSON with no passwordHash for a login-capable role', async () => {
      const user = await userService.create(
        { role: 'coach', firstName: 'Cody', lastName: 'Coach', email: 'cody@example.com', password: 'password123' },
        'admin'
      );

      expect(user.passwordHash).toBeUndefined();
    });

    it('rejects an invalid role with 400', async () => {
      await expect(
        userService.create({ role: 'wizard', firstName: 'A', lastName: 'B' }, 'superadmin')
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns 404 when a student parentId does not exist at all', async () => {
      await expect(
        userService.create(
          { role: 'student', firstName: 'Kid', lastName: 'One', parentId: new mongoose.Types.ObjectId().toString() },
          'admin'
        )
      ).rejects.toMatchObject({ status: 404 });
    });

    it('lets a superadmin requester create a superadmin', async () => {
      const user = await userService.create(
        { role: 'superadmin', firstName: 'Sue', lastName: 'Super', email: 'sue@example.com', password: 'password123' },
        'superadmin'
      );

      expect(user.role).toBe('superadmin');
    });

    // docs/plans/trial-registration-required-fields-plan.md §1.3/§1.5 —
    // admin's own student-creation dialog gets dateOfBirth too, not force-
    // required (unlike the parent-facing Add Child flow's own validation).
    it('accepts and stores dateOfBirth for a student, returning a computed age', async () => {
      const parent = await createParent();

      const student = await userService.create(
        {
          role: 'student',
          firstName: 'Kid',
          lastName: 'WithBirthday',
          parentId: parent._id.toString(),
          dateOfBirth: '2018-01-01',
        },
        'admin'
      );

      expect(typeof student.age).toBe('number');

      const persisted = await User.findById(student._id);
      expect(persisted.dateOfBirth.toISOString().slice(0, 10)).toBe('2018-01-01');
    });

    it('still succeeds without dateOfBirth — age comes back null, not 0 or a guess', async () => {
      const parent = await createParent();

      const student = await userService.create(
        { role: 'student', firstName: 'Kid', lastName: 'NoBirthday', parentId: parent._id.toString() },
        'admin'
      );

      expect(student.age).toBeNull();
    });

    // §1.2's hard-require is auth.service.js's register() only — an admin
    // creating a parent may not have the family's phone in hand yet.
    it('accepts an optional phone for a login-capable role, but does not require one', async () => {
      const user = await userService.create(
        { role: 'parent', firstName: 'No', lastName: 'Phone', email: 'no-phone-admin-created@example.com', password: 'password123' },
        'admin'
      );

      expect(user.phone).toBeUndefined();

      const withPhone = await userService.create(
        {
          role: 'parent',
          firstName: 'Has',
          lastName: 'Phone',
          email: 'has-phone-admin-created@example.com',
          password: 'password123',
          phone: '555-123-4567',
        },
        'admin'
      );

      expect(withPhone.phone).toBe('555-123-4567');
    });
  });

  describe('update', () => {
    it('drops role, password, and parentId from the payload even for a login-capable role', async () => {
      const parent = await createParent({ email: 'parent-update@example.com' });

      await userService.update(
        parent._id,
        { firstName: 'Changed', lastName: 'Parent', email: 'parent-update-new@example.com', role: 'superadmin', password: 'new-password', parentId: new mongoose.Types.ObjectId().toString() },
        'admin'
      );

      const persisted = await User.findById(parent._id);
      expect(persisted.role).toBe('parent');
      expect(persisted.passwordHash).toBe('irrelevant-hash');
      expect(persisted.email).toBe('parent-update-new@example.com');
    });

    it('does not change email for a student even if one is submitted', async () => {
      const parent = await createParent({ email: 'parent-for-student-update@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });

      await userService.update(student._id, { firstName: 'Kiddo', lastName: 'One', email: 'sneaky@example.com' }, 'admin');

      const persisted = await User.findById(student._id);
      expect(persisted.firstName).toBe('Kiddo');
      expect(persisted.email).toBeUndefined();
    });

    // docs/plans/trial-registration-required-fields-plan.md's noted stop-gap
    // for backfilling an existing account/child created before phone/
    // dateOfBirth existed — the ONLY self-service-adjacent path today is an
    // admin using this existing edit endpoint.
    it("lets an admin backfill an existing parent's missing phone via edit", async () => {
      const parent = await createParent({ email: 'parent-backfill-phone@example.com' });
      expect(parent.phone).toBeUndefined();

      await userService.update(
        parent._id,
        { firstName: parent.firstName, lastName: parent.lastName, email: parent.email, phone: '555-987-6543' },
        'admin'
      );

      const persisted = await User.findById(parent._id);
      expect(persisted.phone).toBe('555-987-6543');
    });

    it('does not erase an existing phone when the edit payload omits it entirely', async () => {
      const parent = await createParent({ email: 'parent-keep-phone@example.com', phone: '555-111-2222' });

      await userService.update(
        parent._id,
        { firstName: 'Renamed', lastName: parent.lastName, email: parent.email },
        'admin'
      );

      const persisted = await User.findById(parent._id);
      expect(persisted.phone).toBe('555-111-2222');
    });

    it("lets an admin backfill an existing student's missing dateOfBirth via edit", async () => {
      const parent = await createParent();
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      expect(student.dateOfBirth).toBeUndefined();

      const updated = await userService.update(
        student._id,
        { firstName: student.firstName, lastName: student.lastName, dateOfBirth: '2018-01-01' },
        'admin'
      );

      expect(typeof updated.age).toBe('number');

      const persisted = await User.findById(student._id);
      expect(persisted.dateOfBirth.toISOString().slice(0, 10)).toBe('2018-01-01');
    });

    it('returns 404 for a nonexistent user', async () => {
      await expect(
        userService.update(new mongoose.Types.ObjectId(), { firstName: 'A', lastName: 'B' }, 'admin')
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('remove', () => {
    it('includes the exact blocking count in the 409 message for a parent with two children', async () => {
      const parent = await createParent({ email: 'parent-two-kids@example.com' });
      await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      await User.create({ role: 'student', firstName: 'Kid', lastName: 'Two', parentId: parent._id });

      await expect(
        userService.remove(parent._id, 'admin', new mongoose.Types.ObjectId())
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('2 child account(s)') });
    });

    it('does not apply any entity guard when deleting an admin or superadmin', async () => {
      const admin = await User.create({ role: 'admin', firstName: 'A', lastName: 'B', email: 'plain-admin@example.com' });

      await userService.remove(admin._id, 'admin', new mongoose.Types.ObjectId());

      expect(await User.findById(admin._id)).toBeNull();
    });

    it('blocks self-delete even when the id and requesterId are passed as different types (string vs ObjectId)', async () => {
      const admin = await User.create({ role: 'admin', firstName: 'A', lastName: 'B', email: 'self-delete@example.com' });

      await expect(
        userService.remove(admin._id.toString(), 'admin', admin._id)
      ).rejects.toMatchObject({ status: 400 });
    });

    // Registration is a payment ledger now, not an enrollment record
    // (docs/plans/registration-ledger-plan.md D7) — Subscription is the sole
    // guard for a student's enrollment history. A Subscription is never
    // itself deleted, so this also covers "a student with ledger history"
    // for as long as every Registration row's subscriptionId still points
    // at a live Subscription.
    it('blocks deleting a student with a Subscription, with the exact count in the 409 message', async () => {
      const parent = await createParent({ email: 'parent-sub-guard@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });

      await Subscription.create({
        studentId: student._id,
        scheduleId: new mongoose.Types.ObjectId(),
        parentId: parent._id,
        status: 'cancelled',
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
      });

      await expect(
        userService.remove(student._id, 'admin', new mongoose.Types.ObjectId())
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('1 subscription(s)') });

      expect(await User.findById(student._id)).not.toBeNull();
    });

    it('does NOT block deleting a student whose only reference is a Registration ledger row with no matching Subscription (the old enrollment-based guard no longer applies)', async () => {
      const parent = await createParent({ email: 'parent-orphan-ledger@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      const scheduleId = new mongoose.Types.ObjectId();

      // An orphaned ledger row (its subscriptionId points at nothing real) —
      // exactly the kind of doc the old Registration-count check would have
      // blocked on, and the new Subscription-count check correctly ignores.
      await seedServices();
      const groupClassesService = await Service.findOne({ code: 'group-classes' });
      await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        studentId: student._id,
        scheduleId,
        parentId: parent._id,
        eventType: 'initial',
        status: 'completed',
        amount: 150,
        breakdown: { monthlyFee: 150 },
        periodStart: new Date('2026-01-01T00:00:00.000Z'),
        periodEnd: new Date('2026-02-01T00:00:00.000Z'),
      });

      await userService.remove(student._id, 'admin', new mongoose.Types.ObjectId());

      expect(await User.findById(student._id)).toBeNull();
    });
  });

  describe('list', () => {
    it('passes an explicit single-role filter through unchanged for a non-superadmin', async () => {
      await User.create({ role: 'coach', firstName: 'Cody', lastName: 'Coach', email: 'coach-list@example.com' });
      await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'parent-list@example.com' });

      const results = await userService.list({ role: 'coach' }, 'admin');

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('coach');
    });
  });
});
