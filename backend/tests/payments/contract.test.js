// The port's one piece of runtime behaviour: assertProviderContract. The
// typedefs in contract.js are documentation only.
const { assertProviderContract, REQUIRED_MEMBERS } = require('../../src/payments/contract');
const { makeFakePaymentProvider } = require('../testUtils/fakePaymentProvider');

describe('assertProviderContract', () => {
  it('lists exactly the members the codebase calls (plan D2)', () => {
    expect(REQUIRED_MEMBERS).toEqual([
      'name',
      'capabilities',
      'charge',
      'createCustomer',
      'attachPaymentMethod',
      'detachPaymentMethod',
      'findPayment',
      'verifyWebhook',
    ]);
  });

  it('accepts an adapter implementing every required member', () => {
    expect(() => assertProviderContract(makeFakePaymentProvider())).not.toThrow();
  });

  it.each(REQUIRED_MEMBERS)('names the missing member when %s is absent', (member) => {
    const adapter = makeFakePaymentProvider();
    delete adapter[member];

    expect(() => assertProviderContract(adapter)).toThrow(`missing required member(s): ${member}`);
  });

  it('names every missing member at once', () => {
    expect(() => assertProviderContract({})).toThrow(`missing required member(s): ${REQUIRED_MEMBERS.join(', ')}`);
  });

  it('treats null and undefined as missing everything, not as a TypeError', () => {
    expect(() => assertProviderContract(null)).toThrow(/missing required member/);
    expect(() => assertProviderContract(undefined)).toThrow(/missing required member/);
  });
});
