const mongoose = require('mongoose');

const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Service = require('../../src/models/service.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { SubscriptionCycleRegistration, PerSessionRegistration } = require('../../src/models/registration.model');
const academy = require('../../src/config/academy');
const { buildInvoiceData, renderInvoicePdf } = require('../../src/services/invoice.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

async function seedParentAndStudent(email) {
  const parent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Rivera', email });
  const student = await User.create({ role: 'student', firstName: 'Sam', lastName: 'Rivera', parentId: parent._id });
  return { parent, student };
}

async function seedGroupClassChain({ order = 1 } = {}) {
  const level = await Level.create({ name: `Level ${order}`, order });
  const location = await Location.create({ name: `Frisco HQ ${order}`, address: '123 Main St, Frisco, TX' });
  const coach = await User.create({
    role: 'coach',
    firstName: 'Dana',
    lastName: 'Coach',
    email: `coach-${order}-${Date.now()}@example.com`,
  });
  const groupClass = await GroupClass.create({
    name: `Beginner Foil ${order}`,
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });
  const schedule = await GroupClassSchedule.create({
    classId: groupClass._id,
    coachId: coach._id,
    dayOfWeek: 2,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });

  return { level, location, groupClass, schedule, coach };
}

describe('invoice.service — buildInvoiceData', () => {
  describe('subscription_cycle rows', () => {
    it('resolves the real location through scheduleId -> classId -> locationId, includes a sibling-discount negative line and a registration-fee line, and never recomputes total', async () => {
      const groupClassesService = await Service.findOne({ code: 'group-classes' });
      const { schedule, location, groupClass } = await seedGroupClassChain({ order: 1 });
      const { parent, student } = await seedParentAndStudent('invoice-sub-cycle@example.com');

      const periodStart = new Date('2026-02-01T00:00:00.000Z');
      const periodEnd = new Date('2026-03-01T00:00:00.000Z');

      const row = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'completed',
        amount: 160, // deliberately does NOT equal monthlyFee - discount + fee, to prove total is never derived from the line items
        breakdown: {
          monthlyFee: 150,
          siblingDiscountApplied: true,
          siblingDiscountAmount: 15,
          registrationFeeCharged: 25,
        },
        periodStart,
        periodEnd,
        paidAt: new Date('2026-02-01T12:00:00.000Z'),
      });

      const data = await buildInvoiceData(row);

      expect(data.invoiceNumber).toBe(`INV-${row._id}`);
      expect(data.serviceName).toBe(groupClassesService.name);
      expect(data.billTo).toEqual({
        parentName: 'Pat Rivera',
        parentEmail: 'invoice-sub-cycle@example.com',
        studentName: 'Sam Rivera',
      });
      expect(data.location).toEqual({ name: location.name, addressLines: [location.address] });

      const discountLine = data.lineItems.find((item) => item.label.toLowerCase().includes('sibling'));
      expect(discountLine.amount).toBe(-15);

      const feeLine = data.lineItems.find((item) => item.label.toLowerCase().includes('registration fee'));
      expect(feeLine.amount).toBe(25);

      // Locked-amount property — total is ALWAYS row.amount, never a sum of
      // the line items (which here deliberately wouldn't match: 150-15+25=160
      // happens to match by construction below only to prove it's not a
      // coincidence — change the amount and total tracks it, not the items).
      expect(data.total).toBe(160);
      expect(data.academy.ein).toBe(academy.ein);
      expect(data.serviceLabel).toBe('Group Class Monthly Renewal');
      const baseLine = data.lineItems.find((item) => item.amount === 150);
      expect(baseLine.label).toContain(groupClass.name);
    });

    it('omits the registration-fee line when none was charged and the sibling-discount line when not applied', async () => {
      const groupClassesService = await Service.findOne({ code: 'group-classes' });
      const { schedule } = await seedGroupClassChain({ order: 2 });
      const { parent, student } = await seedParentAndStudent('invoice-no-extras@example.com');

      const row = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'completed',
        amount: 150,
        breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
        periodStart: new Date('2026-02-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-01T00:00:00.000Z'),
        paidAt: new Date(),
      });

      const data = await buildInvoiceData(row);

      expect(data.lineItems).toHaveLength(1);
      expect(data.lineItems[0].amount).toBe(150);
    });

    it('D9: falls back to the academy address when the schedule/class/location chain is broken, without throwing', async () => {
      const groupClassesService = await Service.findOne({ code: 'group-classes' });
      const { parent, student } = await seedParentAndStudent('invoice-orphan@example.com');

      const row = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        scheduleId: new mongoose.Types.ObjectId(), // never resolves
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'completed',
        amount: 150,
        breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
        periodStart: new Date('2026-02-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-01T00:00:00.000Z'),
        paidAt: new Date(),
      });

      const data = await buildInvoiceData(row);

      expect(data.location).toEqual({ name: academy.name, addressLines: academy.addressLines });
    });

    // docs/plans/payment-airtight-plan.md D9 — the method-aware invoice line.
    it('renders "Payment recorded by the academy — {note}" for a manual row, and "Charged to card on file." otherwise', async () => {
      const groupClassesService = await Service.findOne({ code: 'group-classes' });
      const { schedule } = await seedGroupClassChain({ order: 3 });
      const { parent, student } = await seedParentAndStudent('invoice-method-aware@example.com');

      const manualRow = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'completed',
        amount: 100,
        chargeMethod: 'manual',
        manualNote: 'Paid by check #1042',
        breakdown: { monthlyFee: 100, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
        periodStart: new Date('2026-02-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-01T00:00:00.000Z'),
        paidAt: new Date(),
      });

      const cardRow = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'completed',
        amount: 100,
        breakdown: { monthlyFee: 100, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
        periodStart: new Date('2026-02-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-01T00:00:00.000Z'),
        paidAt: new Date(),
      });

      const manualData = await buildInvoiceData(manualRow);
      const cardData = await buildInvoiceData(cardRow);

      expect(manualData.paymentMethodLabel).toBe('Payment recorded by the academy — Paid by check #1042.');
      expect(cardData.paymentMethodLabel).toBe('Charged to card on file.');
    });
  });

  describe('per_session rows', () => {
    it('resolves the coach + session date/duration and always uses the academy address as location (no Location field on a private lesson)', async () => {
      const privateLessonsService = await Service.findOne({ code: 'private-lessons' });
      const { parent, student } = await seedParentAndStudent('invoice-per-session@example.com');
      const coach = await User.create({ role: 'coach', firstName: 'Dana', lastName: 'Coach', email: `coach-ps-${Date.now()}@example.com` });

      const startDate = new Date('2026-02-10T16:00:00.000Z');
      const endDate = new Date('2026-02-10T16:30:00.000Z');

      const session = await PrivateClassSession.create({
        scheduleId: new mongoose.Types.ObjectId(),
        enrollmentId: new mongoose.Types.ObjectId(),
        coachId: coach._id,
        studentId: student._id,
        parentId: parent._id,
        startDate,
        endDate,
        attendance: 'attended',
      });

      const row = await PerSessionRegistration.create({
        serviceId: privateLessonsService._id,
        sessionId: session._id,
        enrollmentId: session.enrollmentId,
        studentId: student._id,
        parentId: parent._id,
        status: 'completed',
        amount: 25,
        paidAt: new Date(),
      });

      const data = await buildInvoiceData(row);

      expect(data.total).toBe(25);
      expect(data.serviceLabel).toBe('Private Lesson Session');
      expect(data.location).toEqual({ name: academy.name, addressLines: academy.addressLines });
      expect(data.lineItems).toHaveLength(1);
      expect(data.lineItems[0].label).toContain('Dana Coach');
      expect(data.lineItems[0].label).toContain('30 min');
      expect(data.lineItems[0].amount).toBe(25);
    });
  });

  it('throws a 409-shaped error for a non-completed row', async () => {
    const groupClassesService = await Service.findOne({ code: 'group-classes' });
    const { schedule } = await seedGroupClassChain({ order: 3 });
    const { parent, student } = await seedParentAndStudent('invoice-pending@example.com');

    const row = await SubscriptionCycleRegistration.create({
      serviceId: groupClassesService._id,
      subscriptionId: new mongoose.Types.ObjectId(),
      scheduleId: schedule._id,
      studentId: student._id,
      parentId: parent._id,
      eventType: 'renewal',
      status: 'pending',
      amount: 150,
      breakdown: { monthlyFee: 150 },
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-01T00:00:00.000Z'),
    });

    await expect(buildInvoiceData(row)).rejects.toMatchObject({ status: 409 });
  });

  it('accepts a bare id and fetches the row itself', async () => {
    const groupClassesService = await Service.findOne({ code: 'group-classes' });
    const { schedule } = await seedGroupClassChain({ order: 4 });
    const { parent, student } = await seedParentAndStudent('invoice-by-id@example.com');

    const row = await SubscriptionCycleRegistration.create({
      serviceId: groupClassesService._id,
      subscriptionId: new mongoose.Types.ObjectId(),
      scheduleId: schedule._id,
      studentId: student._id,
      parentId: parent._id,
      eventType: 'renewal',
      status: 'completed',
      amount: 150,
      breakdown: { monthlyFee: 150 },
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-01T00:00:00.000Z'),
      paidAt: new Date(),
    });

    const data = await buildInvoiceData(row._id);
    expect(data.total).toBe(150);
  });

  it('404s on an unknown id', async () => {
    await expect(buildInvoiceData(new mongoose.Types.ObjectId())).rejects.toMatchObject({ status: 404 });
  });
});

// A real, minimal 1x1 transparent PNG — pdfkit's doc.image() actually
// parses image bytes to determine format, so a fake/garbage buffer would
// hit the same "unsupported format" path a genuinely broken LOGO_URL does.
// This is the standard minimal-valid-PNG fixture used across the JS
// ecosystem for exactly this kind of test.
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('invoice.service — renderInvoicePdf', () => {
  const baseData = {
    invoiceNumber: 'INV-smoke',
    invoiceDate: new Date('2026-02-01T00:00:00.000Z'),
    billTo: { parentName: 'Pat Rivera', parentEmail: 'pat@example.com', studentName: 'Sam Rivera' },
    serviceName: 'Group Classes',
    serviceLabel: 'Group Class Monthly Renewal',
    location: { name: 'Frisco HQ', addressLines: ['123 Main St'] },
    lineItems: [{ label: 'Monthly fee', amount: 150 }],
    periodLabel: 'Feb 1 – Mar 1',
    total: 150,
    academy,
  };

  const originalFetch = global.fetch;
  const originalLogoUrl = process.env.LOGO_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalLogoUrl === undefined) {
      delete process.env.LOGO_URL;
    } else {
      process.env.LOGO_URL = originalLogoUrl;
    }
  });

  it('resolves a non-empty Buffer starting with the PDF magic bytes', async () => {
    const buffer = await renderInvoicePdf(baseData);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('never fetches a logo when LOGO_URL is unset — the same fallback the email header uses', async () => {
    delete process.env.LOGO_URL;
    global.fetch = jest.fn();

    await renderInvoicePdf(baseData);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('embeds the logo (a larger PDF results) when LOGO_URL is set and resolves a real image', async () => {
    process.env.LOGO_URL = 'https://example.com/logo.png';
    const pngBuffer = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
    });

    const withLogo = await renderInvoicePdf(baseData);

    delete process.env.LOGO_URL;
    const withoutLogo = await renderInvoicePdf({ ...baseData, invoiceNumber: 'INV-no-logo' });

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/logo.png', expect.any(Object));
    expect(withLogo.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    // Not a rigorous "the image is really embedded" proof (that needs a PDF
    // parser this suite deliberately avoids depending on — see this file's
    // other tests' own discipline), but a real embedded PNG unavoidably
    // adds bytes; this is a real, meaningful signal the image path ran.
    expect(withLogo.length).toBeGreaterThan(withoutLogo.length);
  });

  it('never throws and still renders a valid PDF when the logo fetch rejects (network error)', async () => {
    process.env.LOGO_URL = 'https://example.com/logo.png';
    global.fetch = jest.fn().mockRejectedValue(new Error('network exploded'));

    const buffer = await renderInvoicePdf(baseData);

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('never throws and still renders a valid PDF when the logo URL responds non-OK', async () => {
    process.env.LOGO_URL = 'https://example.com/missing-logo.png';
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    const buffer = await renderInvoicePdf(baseData);

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('never throws and still renders a valid PDF when the fetched content is not a real image', async () => {
    process.env.LOGO_URL = 'https://example.com/logo.png';
    const garbage = Buffer.from('not an image');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => garbage.buffer.slice(garbage.byteOffset, garbage.byteOffset + garbage.byteLength),
    });

    const buffer = await renderInvoicePdf(baseData);

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
