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

  describe('sendTrialConfirmationEmail', () => {
    it('sends to the parent email with a subject/body naming the student', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendTrialConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Sam' },
        session: { date: new Date('2030-01-01T00:00:00.000Z') },
      });

      expect(result).not.toBe(false);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
      expect(call.subject).toContain('Sam');
      expect(call.text).toContain('Sam');
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
    it('sends to the parent email with a subject/body naming the student', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendRegistrationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Robin' },
        schedule: {},
        chargeAmount: 150,
        siblingDiscountApplied: false,
      });

      expect(result).not.toBe(false);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
      expect(call.subject).toContain('Robin');
      expect(call.text).toContain('150');
    });

    it('mentions the sibling discount when siblingDiscountApplied is true', async () => {
      const mailService = loadMailService();

      await mailService.sendRegistrationConfirmationEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Robin' },
        schedule: {},
        chargeAmount: 135,
        siblingDiscountApplied: true,
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.text.toLowerCase()).toContain('sibling discount');
    });

    it('catches a sendMail rejection, logs it, and returns false without throwing', async () => {
      sendMail.mockRejectedValue(new Error('SMTP exploded'));
      const mailService = loadMailService();

      await expect(
        mailService.sendRegistrationConfirmationEmail({
          parent: { firstName: 'Pat', email: 'pat@example.com' },
          student: { firstName: 'Robin' },
          schedule: {},
          chargeAmount: 150,
          siblingDiscountApplied: false,
        })
      ).resolves.toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('sendRenewalReceiptEmail', () => {
    it('sends to the parent email with a subject/body naming the student', async () => {
      const mailService = loadMailService();

      const result = await mailService.sendRenewalReceiptEmail({
        parent: { firstName: 'Pat', email: 'pat@example.com' },
        student: { firstName: 'Jamie' },
        schedule: {},
        chargeAmount: 150,
        siblingDiscountApplied: false,
      });

      expect(result).not.toBe(false);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('pat@example.com');
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
          chargeAmount: 150,
          siblingDiscountApplied: false,
        })
      ).resolves.toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalled();
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
