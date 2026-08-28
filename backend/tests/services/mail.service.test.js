// Mocked at the module level — nodemailer is a third-party SDK we don't own
// and can't realistically drive in a test environment (no real SMTP/Ethereal
// network activity should ever happen in the suite). This is the same kind
// of boundary exception TESTING_STRATEGY.md carves out for Stripe/CardElement,
// applied to the one third-party transport call this service makes.
jest.mock('nodemailer');

describe('mail.service', () => {
  let nodemailer;
  let sendMail;
  let consoleErrorSpy;

  beforeEach(() => {
    // Reset the module registry FIRST, then re-require nodemailer, so every
    // test gets both a fresh automocked nodemailer instance AND a fresh
    // mail.service module whose own internal `require('nodemailer')`
    // resolves to that same fresh instance (not a stale one captured
    // before resetModules ran) — otherwise the mocks configured below never
    // reach the transporter mail.service.js actually builds, and the
    // module-level transporterPromise memoization would also leak across
    // tests/SMTP_HOST toggles.
    jest.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.APP_ENV;

    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');

    sendMail = jest.fn().mockResolvedValue({ messageId: 'fake-message-id' });
    nodemailer.createTransport.mockReturnValue({ sendMail });
    nodemailer.createTestAccount.mockResolvedValue({
      user: 'ethereal-user',
      pass: 'ethereal-pass',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
    });

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loadMailService() {
    // Required fresh per test, AFTER the nodemailer mocks above are wired
    // up and within the same post-resetModules registry epoch, so its
    // internal `require('nodemailer')` picks up the exact mocked instance
    // this test configured.
    // eslint-disable-next-line global-require
    return require('../../src/services/mail.service');
  }

  // NOTE: these three send-function tests were rewired for the Phase 2
  // signature change (docs/plans/ckq-parity-plan.md §3.2 — block-based
  // rendering via renderEmail, richer data, cc support). This is one of the
  // plan's explicitly-allowed pre-existing test updates, not a weakening —
  // the behavior itself deliberately changed.
  describe('sendTrialConfirmationEmail', () => {
    const coach = { firstName: 'Dana', lastName: 'Coach', email: 'coach@example.com' };

    it('sends to the parent, cc ADMIN_EMAIL + coach, with a subject/body naming the student', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam', lastName: 'Rivera' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
        schedule: { dayOfWeek: 1, startTime: '16:00', endTime: '17:00' },
        groupClass: { name: 'Beginner Foil' },
        level: { name: 'Beginner' },
        location: { name: 'Frisco HQ' },
        coach,
      });

      expect(result).not.toBe(false);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
      expect(call.cc).toEqual(['friscofencingacademy@gmail.com', 'coach@example.com']);
      expect(call.subject).toContain('Sam Rivera');
      expect(call.text).toContain('Sam Rivera');
    });

    it('filters a coach with no email out of cc without crashing', async () => {
      const mailService = loadMailService();

      await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.cc).toEqual(['friscofencingacademy@gmail.com']);
    });

    it('catches a sendMail rejection, logs it, and returns false without throwing', async () => {
      sendMail.mockRejectedValue(new Error('SMTP exploded'));
      const mailService = loadMailService();

      await expect(
        mailService.sendTrialConfirmationEmail({
          parent: { firstName: 'Pat', email: 'pat@example.com' },
          student: { firstName: 'Sam' },
          session: { date: new Date('2030-01-01T00:00:00.000Z') },
        })
      ).resolves.toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('sendRegistrationConfirmationEmail', () => {
    it('sends to the parent, cc ADMIN_EMAIL + coach, with a subject/body naming the student and charge', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendRegistrationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Robin' },
        schedule: { dayOfWeek: 2, startTime: '16:00', endTime: '17:00' },
        groupClass: { name: 'Beginner Foil' },
        level: { name: 'Beginner' },
        location: { name: 'Frisco HQ' },
        coach: { firstName: 'Dana', lastName: 'Coach', email: 'coach@example.com' },
        chargeAmount: 150,
        monthlyFee: 150,
        siblingDiscountAmount: 0,
      });

      expect(result).not.toBe(false);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
      expect(call.cc).toEqual(['friscofencingacademy@gmail.com', 'coach@example.com']);
      expect(call.subject).toContain('Robin');
      expect(call.text).toContain('150');
    });

    it('mentions the sibling discount when siblingDiscountAmount is > 0', async () => {
      const mailService = loadMailService();

      await mailService.sendRegistrationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Robin' },
        schedule: {},
        groupClass: {},
        chargeAmount: 135,
        monthlyFee: 150,
        siblingDiscountAmount: 15,
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.text.toLowerCase()).toContain('sibling discount');
    });

    it('omits the sibling discount line when siblingDiscountAmount is 0', async () => {
      const mailService = loadMailService();

      await mailService.sendRegistrationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Robin' },
        schedule: {},
        groupClass: {},
        chargeAmount: 150,
        monthlyFee: 150,
        siblingDiscountAmount: 0,
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.text.toLowerCase()).not.toContain('sibling discount');
    });

    it('catches a sendMail rejection, logs it, and returns false without throwing', async () => {
      sendMail.mockRejectedValue(new Error('SMTP exploded'));
      const mailService = loadMailService();

      await expect(
        mailService.sendRegistrationConfirmationEmail({
          parent: { firstName: 'Pat', email: 'pat@example.com' },
          student: { firstName: 'Robin' },
          schedule: {},
          groupClass: {},
          chargeAmount: 150,
          monthlyFee: 150,
          siblingDiscountAmount: 0,
        })
      ).resolves.toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('sendRenewalReceiptEmail', () => {
    it('sends to the parent (no cc) with a subject/body naming the student and charge', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendRenewalReceiptEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Jamie' },
        schedule: {},
        groupClass: {},
        monthLabel: 'September 2026',
        chargeAmount: 150,
        monthlyFee: 150,
        siblingDiscountAmount: 0,
      });

      expect(result).not.toBe(false);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
      expect(call.cc).toBeUndefined();
      expect(call.subject).toContain('Jamie');
      expect(call.text).toContain('150');
    });

    it('catches a sendMail rejection, logs it, and returns false without throwing', async () => {
      sendMail.mockRejectedValue(new Error('SMTP exploded'));
      const mailService = loadMailService();

      await expect(
        mailService.sendRenewalReceiptEmail({
          parent: { firstName: 'Pat', email: 'pat@example.com' },
          student: { firstName: 'Jamie' },
          schedule: {},
          groupClass: {},
          monthLabel: 'September 2026',
          chargeAmount: 150,
          monthlyFee: 150,
          siblingDiscountAmount: 0,
        })
      ).resolves.toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // docs/plans/registration-ledger-plan.md D4/D6 §6 PR 2 test row: renders
  // Day-0 / Day-N / final variants — recipient, amount, nextRetryDate
  // presence, final-copy differences.
  describe('sendPaymentFailureEmail', () => {
    it('Day 0 (attemptNumber 1, isFinal false): cc lists ADMIN_EMAIL only, subject says "Payment failed", body carries the amount and next retry date', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendPaymentFailureEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Jamie' },
        schedule: {},
        groupClass: { name: 'Beginner Foil' },
        amountDue: 150,
        attemptNumber: 1,
        isFinal: false,
        nextRetryDate: new Date('2026-08-29T12:00:00.000Z'),
      });

      expect(result).not.toBe(false);
      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
      expect(call.cc).toEqual(['friscofencingacademy@gmail.com']);
      expect(call.subject).toContain('Payment failed');
      expect(call.subject).toContain('Jamie');
      expect(call.text).toContain('150.00');
      expect(call.text).toContain('Aug 29, 2026'); // next retry date present
      // Day-0 copy never mentions cancellation.
      expect(call.text).not.toMatch(/cancelled/i);
    });

    it('Day N (attemptNumber 2, isFinal false): subject still "Payment failed", body notes the attempt count', async () => {
      const mailService = loadMailService();

      await mailService.sendPaymentFailureEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Jamie' },
        groupClass: { name: 'Beginner Foil' },
        amountDue: 150,
        attemptNumber: 2,
        isFinal: false,
        nextRetryDate: new Date('2026-08-30T12:00:00.000Z'),
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.subject).toContain('Payment failed');
      expect(call.text).toContain('attempt 2 of 3');
      expect(call.text).toContain('Aug 30, 2026');
    });

    it('Final (isFinal true): subject/body say the subscription was cancelled, no next-retry-date row, no attempt-count copy', async () => {
      const mailService = loadMailService();

      await mailService.sendPaymentFailureEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Jamie' },
        groupClass: { name: 'Beginner Foil' },
        amountDue: 150,
        attemptNumber: 3,
        isFinal: true,
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.subject).toContain('Subscription cancelled');
      expect(call.text).toMatch(/cancelled/i);
      expect(call.text).not.toContain('Next retry');
      expect(call.text).not.toContain('attempt 3 of 3');
    });

    it('catches a sendMail rejection, logs it, and returns false without throwing', async () => {
      sendMail.mockRejectedValue(new Error('SMTP exploded'));
      const mailService = loadMailService();

      await expect(
        mailService.sendPaymentFailureEmail({
          parent: { firstName: 'Pat', email: 'pat@example.com' },
          student: { firstName: 'Jamie' },
          amountDue: 150,
          attemptNumber: 1,
          isFinal: false,
        })
      ).resolves.toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('never throws when passed nothing at all', async () => {
      const mailService = loadMailService();

      await expect(mailService.sendPaymentFailureEmail({})).resolves.toBe(false);
    });
  });

  describe('new Phase 2 send functions never throw even when renderEmail-building data is missing', () => {
    it('sendCancellationConfirmationEmail cc lists only the coach (no admin) and never throws', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendCancellationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        groupClass: { name: 'Beginner Foil' },
        schedule: { dayOfWeek: 1, startTime: '16:00', endTime: '17:00' },
        coach: { firstName: 'Dana', lastName: 'Coach', email: 'coach@example.com' },
        endDate: new Date('2026-10-01T12:00:00.000Z'),
      });

      expect(result).not.toBe(false);
      const call = sendMail.mock.calls[0][0];
      expect(call.cc).toEqual(['coach@example.com']);
    });

    it('sendReactivationConfirmationEmail never throws and sends no cc', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendReactivationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        groupClass: {},
        schedule: {},
        nextBillingDate: new Date('2026-10-01T12:00:00.000Z'),
      });

      expect(result).not.toBe(false);
      expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
    });

    it('sendScheduleChangeConfirmationEmail cc lists the new coach', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendScheduleChangeConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        old: { groupClass: { name: 'A' }, schedule: {} },
        next: {
          groupClass: { name: 'B' },
          schedule: {},
          coach: { firstName: 'New', lastName: 'Coach', email: 'newcoach@example.com' },
        },
      });

      expect(result).not.toBe(false);
      expect(sendMail.mock.calls[0][0].cc).toEqual(['newcoach@example.com']);
    });

    it('sendPrivateClassConfirmationEmail cc lists ADMIN_EMAIL + coach', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendPrivateClassConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        coach: { firstName: 'Dana', lastName: 'Coach', email: 'coach@example.com' },
        slotLabel: 'Tuesday · 4:00 PM · 60 min',
        rateLabel: '$65/hr — $65 per session',
        firstSessionDate: new Date('2026-08-26T12:00:00.000Z'),
        sessionPriceLabel: '$65',
      });

      expect(result).not.toBe(false);
      expect(sendMail.mock.calls[0][0].cc).toEqual([
        'friscofencingacademy@gmail.com',
        'coach@example.com',
      ]);
    });

    it('sendPrivateClassSessionReceiptEmail cc lists ADMIN_EMAIL only', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendPrivateClassSessionReceiptEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        coach: { firstName: 'Dana', lastName: 'Coach' },
        sessionDate: new Date('2026-08-26T12:00:00.000Z'),
        durationMinutes: 60,
        amount: 65,
      });

      expect(result).not.toBe(false);
      expect(sendMail.mock.calls[0][0].cc).toEqual(['friscofencingacademy@gmail.com']);
      expect(sendMail.mock.calls[0][0].text).toContain('65.00');
    });

    it('sendPrivateClassPaymentFailedEmail cc lists ADMIN_EMAIL only and never throws', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendPrivateClassPaymentFailedEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        sessionDate: new Date('2026-08-26T12:00:00.000Z'),
        amount: 65,
        paymentMethodUrl: 'http://localhost:3000/parent/payment-method',
      });

      expect(result).not.toBe(false);
      expect(sendMail.mock.calls[0][0].cc).toEqual(['friscofencingacademy@gmail.com']);
    });

    it('sendPrivateClassCancellationEmail cc lists ADMIN_EMAIL + coach', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendPrivateClassCancellationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        coach: { firstName: 'Dana', lastName: 'Coach', email: 'coach@example.com' },
        slotLabel: 'Tuesday · 4:00 PM · 60 min',
      });

      expect(result).not.toBe(false);
      expect(sendMail.mock.calls[0][0].cc).toEqual([
        'friscofencingacademy@gmail.com',
        'coach@example.com',
      ]);
    });

    it('every new send function resolves false (never throws) when passed nothing at all', async () => {
      sendMail.mockRejectedValue(new Error('SMTP exploded'));
      const mailService = loadMailService();

      await expect(mailService.sendCancellationConfirmationEmail({})).resolves.toBe(false);
      await expect(mailService.sendReactivationConfirmationEmail({})).resolves.toBe(false);
      await expect(mailService.sendScheduleChangeConfirmationEmail({})).resolves.toBe(false);
      await expect(mailService.sendPrivateClassConfirmationEmail({})).resolves.toBe(false);
      await expect(mailService.sendPrivateClassSessionReceiptEmail({})).resolves.toBe(false);
      await expect(mailService.sendPrivateClassPaymentFailedEmail({})).resolves.toBe(false);
      await expect(mailService.sendPrivateClassCancellationEmail({})).resolves.toBe(false);
    });
  });

  describe('staging email gate', () => {
    it('blocks the send and returns { blocked: true } when SMTP_HOST is set and APP_ENV is unset', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      delete process.env.APP_ENV;

      const mailService = loadMailService();

      const result = await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      expect(result).toEqual({ blocked: true });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("blocks the send when SMTP_HOST is set and APP_ENV is 'staging'", async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.APP_ENV = 'staging';

      const mailService = loadMailService();

      const result = await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      expect(result).toEqual({ blocked: true });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("does NOT block, and calls sendMail, when SMTP_HOST is set and APP_ENV is 'production'", async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.APP_ENV = 'production';

      const mailService = loadMailService();

      const result = await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      expect(result).not.toEqual({ blocked: true });
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('does NOT block Ethereal (no SMTP_HOST) even when APP_ENV is unset — local dev is unaffected', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.APP_ENV;

      const mailService = loadMailService();

      const result = await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      expect(result).not.toEqual({ blocked: true });
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('blocks AFTER the message is rendered — the warn log carries the real subject', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      delete process.env.APP_ENV;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mailService = loadMailService();

      await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Sam'));
    });
  });

  describe('getTransporter', () => {
    it('builds a real transport from SMTP_HOST env vars when set, without calling createTestAccount', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '2525';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      const mailService = loadMailService();
      await mailService.getTransporter();

      expect(nodemailer.createTestAccount).not.toHaveBeenCalled();
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'smtp.example.com', port: 2525 })
      );
    });

    it('falls back to a memoized Ethereal test account when SMTP_HOST is unset', async () => {
      const mailService = loadMailService();

      await mailService.getTransporter();
      await mailService.getTransporter();

      // Memoized — only created once per process even across repeated calls.
      expect(nodemailer.createTestAccount).toHaveBeenCalledTimes(1);
    });
  });
});
