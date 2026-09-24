const {
  httpError,
  badRequestError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  conflictError,
} = require('../../src/utils/errors');

describe('utils/errors', () => {
  it('httpError builds a plain Error carrying a numeric .status and the given message', () => {
    const error = httpError(402, 'Card declined');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(402);
    expect(error.message).toBe('Card declined');
  });

  it.each([
    ['badRequestError', badRequestError, 400],
    ['unauthorizedError', unauthorizedError, 401],
    ['forbiddenError', forbiddenError, 403],
    ['notFoundError', notFoundError, 404],
    ['conflictError', conflictError, 409],
  ])('%s produces an Error with status %i and the given message', (_name, factory, status) => {
    const error = factory('some message');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(status);
    expect(error.message).toBe('some message');
  });

  // Stripe SDK errors carry a `.statusCode`; this codebase's contract is
  // `.status` only. Guards against a factory ever being "improved" to set
  // both, which would let a Stripe-style error be mistaken for one of ours.
  it('sets only .status, never .statusCode', () => {
    expect(notFoundError('x').statusCode).toBeUndefined();
  });
});
