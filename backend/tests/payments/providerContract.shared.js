// The payment provider CONTRACT suite (docs/plans/payment-provider-port-plan.md
// §6.4). Every adapter runs these exact cases against its provider's real
// test mode — an adapter is selectable only when it passes them. Not a test
// file itself (no .test.js): each adapter's own test file calls
// describeProviderContract(getAdapter, fixtures).
//
// fixtures:
//   successToken()            -> Promise<string>  a fresh browser-style token that saves and charges
//   declineAtAttachToken()    -> Promise<string>  a fresh token the provider rejects when saved
//   declineAtChargeCardId     string               a saved-card id the provider declines when charged
//   successCard               { brand, last4 }      what successToken() saves as
//   customerIdempotent        boolean              whether createCustomer twice for one userId returns the same id
//   signWebhook(object)       -> { rawBody: Buffer, headers }   a correctly signed delivery
//   webhookEvents             { succeeded, failed, ignored } provider-shaped event bodies
//   unsignedHeaders           headers with a well-formed but wrong signature

const crypto = require('crypto');

const CHARGE_AMOUNT = 12.34;

function uniqueId(prefix) {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

// A fresh 24-hex id, shaped like the Mongo ObjectIds the real callers pass.
function fakeObjectId() {
  return crypto.randomBytes(12).toString('hex');
}

// Polls `read` until `accept(value)` or the deadline — for a provider read
// that is documented as eventually consistent (Stripe's search index lags
// writes by up to about a minute). Never used for a read that is meant to be
// immediately consistent.
async function eventually(read, accept, { timeoutMs = 75000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();

  while (!accept(value) && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    // eslint-disable-next-line no-await-in-loop
    value = await read();
  }

  return value;
}

function describeProviderContract(getAdapter, fixtures) {
  describe('payment provider contract', () => {
    let adapter;
    let customerId;
    let cardId;
    let succeededChargeId;
    let reference;

    beforeAll(async () => {
      adapter = getAdapter();
      customerId = await adapter.createCustomer({
        email: `${uniqueId('contract-')}@example.com`,
        firstName: 'Contract',
        lastName: 'Suite',
        userId: fakeObjectId(),
      });
    }, 30000);

    it('declares the port shape', () => {
      expect(typeof adapter.name).toBe('string');
      expect(adapter.capabilities).toEqual({
        savedPaymentMethods: expect.any(Boolean),
        webhooks: expect.any(Boolean),
        findByReference: expect.any(Boolean),
      });
    });

    it('createCustomer returns a provider customer id, idempotently per user when the provider supports it', async () => {
      const userId = fakeObjectId();
      const input = { email: `${uniqueId('contract-')}@example.com`, firstName: 'Twice', lastName: 'Called', userId };

      const first = await adapter.createCustomer(input);
      const second = await adapter.createCustomer(input);

      expect(typeof first).toBe('string');
      expect(first.length).toBeGreaterThan(0);
      if (fixtures.customerIdempotent) {
        expect(second).toBe(first);
      } else {
        expect(typeof second).toBe('string');
      }
    }, 30000);

    it('attachPaymentMethod saves a card and returns its normalized details', async () => {
      const card = await adapter.attachPaymentMethod({ customerId, token: await fixtures.successToken() });

      expect(card).toEqual({
        id: expect.any(String),
        brand: fixtures.successCard.brand,
        last4: fixtures.successCard.last4,
        expMonth: expect.any(Number),
        expYear: expect.any(Number),
      });
      expect(card.expMonth).toBeGreaterThanOrEqual(1);
      expect(card.expMonth).toBeLessThanOrEqual(12);
      expect(card.expYear).toBeGreaterThanOrEqual(new Date().getUTCFullYear());
      cardId = card.id;
    }, 30000);

    it('attachPaymentMethod rejects a card declined at save time with a 402 and a message', async () => {
      const token = await fixtures.declineAtAttachToken();

      await expect(adapter.attachPaymentMethod({ customerId, token })).rejects.toMatchObject({
        status: 402,
        message: expect.stringMatching(/\S/),
      });
    }, 30000);

    it('charge succeeds against the saved card, in dollars', async () => {
      reference = fakeObjectId();
      const result = await adapter.charge({
        amount: CHARGE_AMOUNT,
        customerId,
        paymentMethodId: cardId,
        idempotencyKey: `payment_${reference}`,
        reference,
        metadata: { registrationId: reference },
      });

      expect(result).toMatchObject({ status: 'succeeded', id: expect.any(String), failureMessage: null });
      succeededChargeId = result.id;

      const found = await adapter.findPayment({ paymentId: succeededChargeId });
      expect(found).toMatchObject({ id: succeededChargeId, status: 'succeeded', amount: CHARGE_AMOUNT });
    }, 30000);

    it('charge replays the original payment for a repeated idempotency key — never a second charge', async () => {
      const replay = await adapter.charge({
        amount: CHARGE_AMOUNT,
        customerId,
        paymentMethodId: cardId,
        idempotencyKey: `payment_${reference}`,
        reference,
        metadata: { registrationId: reference },
      });

      expect(replay.status).toBe('succeeded');
      expect(replay.id).toBe(succeededChargeId);
    }, 30000);

    it('charge RESOLVES a card decline as status "failed" with a message — it never throws for one', async () => {
      const declineReference = fakeObjectId();
      const result = await adapter.charge({
        amount: CHARGE_AMOUNT,
        customerId,
        paymentMethodId: fixtures.declineAtChargeCardId,
        idempotencyKey: `payment_${declineReference}`,
        reference: declineReference,
        metadata: { registrationId: declineReference },
      });

      expect(result.status).toBe('failed');
      expect(result.failureMessage).toMatch(/\S/);
    }, 30000);

    it('findPayment returns null for an unknown payment id', async () => {
      expect(await adapter.findPayment({ paymentId: fixtures.unknownPaymentId })).toBeNull();
    }, 30000);

    it('findPayment by reference finds the succeeded charge when the provider can search, and is null otherwise', async () => {
      if (!adapter.capabilities.findByReference) {
        expect(await adapter.findPayment({ reference })).toBeNull();
        return;
      }

      const found = await eventually(
        () => adapter.findPayment({ reference }),
        (value) => value !== null
      );
      expect(found).toMatchObject({ id: succeededChargeId, status: 'succeeded' });
      expect(await adapter.findPayment({ reference: fakeObjectId() })).toBeNull();
    }, 90000);

    it('detachPaymentMethod makes the card unusable for a later charge', async () => {
      await adapter.detachPaymentMethod({ paymentMethodId: cardId });
      const afterReference = fakeObjectId();

      const attempt = adapter
        .charge({
          amount: CHARGE_AMOUNT,
          customerId,
          paymentMethodId: cardId,
          idempotencyKey: `payment_${afterReference}`,
          reference: afterReference,
          metadata: { registrationId: afterReference },
        })
        .then((result) => result.status, () => 'rejected');

      expect(await attempt).not.toBe('succeeded');
    }, 30000);

    describe('verifyWebhook', () => {
      it.each([
        ['succeeded', 'payment.succeeded'],
        ['failed', 'payment.failed'],
        ['ignored', 'ignored'],
      ])('normalizes a correctly signed %s event to %s', async (kind, expectedType) => {
        const { rawBody, headers } = fixtures.signWebhook(fixtures.webhookEvents[kind]);

        const event = await adapter.verifyWebhook({ rawBody, headers });

        expect(event.type).toBe(expectedType);
        expect(typeof event.eventId).toBe('string');
        expect(typeof event.providerEventType).toBe('string');
        if (kind !== 'ignored') {
          expect(typeof event.paymentId).toBe('string');
        }
      });

      it('rejects a body changed after signing with a 400', async () => {
        const { rawBody, headers } = fixtures.signWebhook(fixtures.webhookEvents.succeeded);
        const tampered = Buffer.from(rawBody.toString('utf8').replace('"', '" '));

        await expect(adapter.verifyWebhook({ rawBody: tampered, headers })).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/^Webhook signature verification failed: /),
        });
      });

      it('rejects a delivery with no or a wrong signature with a 400', async () => {
        const rawBody = Buffer.from(JSON.stringify(fixtures.webhookEvents.succeeded));

        await expect(adapter.verifyWebhook({ rawBody, headers: {} })).rejects.toMatchObject({ status: 400 });
        await expect(adapter.verifyWebhook({ rawBody, headers: fixtures.unsignedHeaders })).rejects.toMatchObject({
          status: 400,
        });
      });
    });
  });
}

module.exports = { describeProviderContract };
