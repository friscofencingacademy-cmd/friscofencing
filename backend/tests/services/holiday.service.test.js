const Holiday = require('../../src/models/holiday.model');
const holidayService = require('../../src/services/holiday.service');
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

describe('holiday.service — create', () => {
  it('normalizes a YYYY-MM-DD string into a UTC-midnight sentinel', async () => {
    const holiday = await holidayService.create({
      name: 'Winter Break',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });

    expect(holiday.startDate.toISOString()).toBe('2026-12-24T00:00:00.000Z');
    expect(holiday.endDate.toISOString()).toBe('2026-12-26T00:00:00.000Z');
  });

  it('accepts a single-day holiday (startDate === endDate)', async () => {
    const holiday = await holidayService.create({
      name: 'Thanksgiving',
      startDate: '2026-11-26',
      endDate: '2026-11-26',
    });

    expect(holiday.startDate.getTime()).toBe(holiday.endDate.getTime());
  });

  it('returns 400 for an unparseable date', async () => {
    await expect(
      holidayService.create({ name: 'Bad Date', startDate: 'not-a-date', endDate: '2026-11-26' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when endDate is before startDate', async () => {
    await expect(
      holidayService.create({ name: 'Backwards', startDate: '2026-12-26', endDate: '2026-12-24' })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/end date/i) });
  });

  it('returns 400 when the range exceeds 31 days', async () => {
    await expect(
      holidayService.create({ name: 'Too Long', startDate: '2026-01-01', endDate: '2026-02-02' })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/31 days/) });
  });

  it('allows a range of exactly 31 days (inclusive boundary)', async () => {
    const holiday = await holidayService.create({
      name: 'Exactly 31',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(holiday.name).toBe('Exactly 31');
  });

  it('returns 409 for a duplicate name', async () => {
    await holidayService.create({ name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' });

    await expect(
      holidayService.create({ name: 'Winter Break', startDate: '2027-12-24', endDate: '2027-12-26' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('returns 409 when the range overlaps an existing holiday', async () => {
    await holidayService.create({ name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' });

    await expect(
      holidayService.create({ name: 'Christmas', startDate: '2026-12-25', endDate: '2026-12-27' })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Winter Break') });
  });

  it('treats a shared boundary date as an overlap (inclusive ranges)', async () => {
    await holidayService.create({ name: 'First', startDate: '2026-12-20', endDate: '2026-12-24' });

    await expect(
      holidayService.create({ name: 'Second', startDate: '2026-12-24', endDate: '2026-12-28' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('does not overlap a holiday in a completely different range', async () => {
    await holidayService.create({ name: 'First', startDate: '2026-12-20', endDate: '2026-12-24' });

    const holiday = await holidayService.create({
      name: 'Second',
      startDate: '2027-01-01',
      endDate: '2027-01-03',
    });

    expect(holiday.name).toBe('Second');
  });
});

describe('holiday.service — list/getById/remove', () => {
  it('lists holidays sorted by startDate ascending', async () => {
    await holidayService.create({ name: 'Later', startDate: '2027-01-01', endDate: '2027-01-02' });
    await holidayService.create({ name: 'Earlier', startDate: '2026-12-24', endDate: '2026-12-26' });

    const holidays = await holidayService.list();

    expect(holidays.map((h) => h.name)).toEqual(['Earlier', 'Later']);
  });

  it('getById returns 404 for a missing id', async () => {
    const fakeId = new (require('mongoose').Types.ObjectId)();

    await expect(holidayService.getById(fakeId)).rejects.toMatchObject({ status: 404 });
  });

  it('remove hard-deletes the document', async () => {
    const holiday = await holidayService.create({
      name: 'Winter Break',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });

    await holidayService.remove(holiday._id);

    expect(await Holiday.findById(holiday._id)).toBeNull();
  });

  it('remove returns 404 for a missing id', async () => {
    const fakeId = new (require('mongoose').Types.ObjectId)();

    await expect(holidayService.remove(fakeId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('holiday.service — update', () => {
  it('updates fields and re-normalizes new dates', async () => {
    const holiday = await holidayService.create({
      name: 'Winter Break',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });

    const updated = await holidayService.update(holiday._id, {
      name: 'Winter Holidays',
      startDate: '2026-12-23',
      endDate: '2026-12-27',
    });

    expect(updated.name).toBe('Winter Holidays');
    expect(updated.startDate.toISOString()).toBe('2026-12-23T00:00:00.000Z');
    expect(updated.endDate.toISOString()).toBe('2026-12-27T00:00:00.000Z');
  });

  it('excludes itself from the overlap check', async () => {
    const holiday = await holidayService.create({
      name: 'Winter Break',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });

    // Shrinking its own range must not 409 against itself.
    const updated = await holidayService.update(holiday._id, { endDate: '2026-12-25' });

    expect(updated.endDate.toISOString()).toBe('2026-12-25T00:00:00.000Z');
  });

  it('still 409s against a DIFFERENT holiday when updated to overlap it', async () => {
    await holidayService.create({ name: 'First', startDate: '2026-01-01', endDate: '2026-01-05' });
    const second = await holidayService.create({
      name: 'Second',
      startDate: '2026-02-01',
      endDate: '2026-02-05',
    });

    await expect(
      holidayService.update(second._id, { startDate: '2026-01-04', endDate: '2026-01-06' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('returns 404 for a missing id', async () => {
    const fakeId = new (require('mongoose').Types.ObjectId)();

    await expect(holidayService.update(fakeId, { name: 'X' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('holiday.service — getHolidaysInRange / findHolidayForDate', () => {
  it('finds the covering holiday, inclusive at both boundaries', async () => {
    await holidayService.create({ name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' });

    const holidays = await holidayService.getHolidaysInRange(
      new Date('2026-12-01T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z')
    );

    expect(holidayService.findHolidayForDate(new Date('2026-12-24T00:00:00.000Z'), holidays)?.name).toBe(
      'Winter Break'
    );
    expect(holidayService.findHolidayForDate(new Date('2026-12-25T00:00:00.000Z'), holidays)?.name).toBe(
      'Winter Break'
    );
    expect(holidayService.findHolidayForDate(new Date('2026-12-26T00:00:00.000Z'), holidays)?.name).toBe(
      'Winter Break'
    );
  });

  it('returns null for a date outside every holiday', async () => {
    await holidayService.create({ name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' });

    const holidays = await holidayService.getHolidaysInRange(
      new Date('2026-12-01T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z')
    );

    expect(holidayService.findHolidayForDate(new Date('2026-12-27T00:00:00.000Z'), holidays)).toBeNull();
  });

  it('a deleted holiday no longer covers its dates (re-query reflects the deletion)', async () => {
    const holiday = await holidayService.create({
      name: 'Winter Break',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });
    await holidayService.remove(holiday._id);

    const holidays = await holidayService.getHolidaysInRange(
      new Date('2026-12-01T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z')
    );

    expect(holidayService.findHolidayForDate(new Date('2026-12-25T00:00:00.000Z'), holidays)).toBeNull();
  });
});
