const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');

const errorHandler = require('../../src/middlewares/errorHandler');
const { notFoundError, conflictError } = require('../../src/utils/errors');

const GENERIC = errorHandler.GENERIC_SERVER_ERROR_MESSAGE;

// A tiny throwaway app — the real app.js (and its database) is not needed to
// exercise the middleware's own rules. The route hands `err` to next(), exactly
// as every controller's catch block does.
function appThrowing(err) {
  const app = express();
  app.use(express.json());
  app.all('/probe', (req, res, next) => next(err));
  app.use(errorHandler);
  return app;
}

let errorSpy;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('middlewares/errorHandler', () => {
  describe('errors carrying a 4xx .status expose their own message', () => {
    it('a shared-factory error -> its status and message', async () => {
      const res = await request(appThrowing(notFoundError('Level not found'))).get('/probe');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Level not found' });
    });

    // Legacy-shaped errors (built before the shared factories, e.g. the login
    // 401 and the 402 card message) carry a status but no "expose" flag of any
    // kind — the status alone decides, so their message must survive.
    it('a legacy-shaped Error with only .status = 401 keeps its own message', async () => {
      const legacy = Object.assign(new Error('Invalid email or password'), { status: 401 });

      const res = await request(appThrowing(legacy)).get('/probe');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Invalid email or password' });
    });

    it('a 4xx error is not logged (an expected client error, not a server fault)', async () => {
      await request(appThrowing(conflictError('already exists'))).get('/probe');

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('server errors never leak their message', () => {
    it('an error with no status -> 500 with the fixed generic message, not the raw text', async () => {
      const res = await request(appThrowing(new Error('db exploded: connection string mongodb://secret'))).get('/probe');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: GENERIC });
      expect(JSON.stringify(res.body)).not.toContain('db exploded');
    });

    it('an explicit 5xx .status keeps that status but masks the message', async () => {
      const res = await request(appThrowing(Object.assign(new Error('upstream detail'), { status: 503 }))).get('/probe');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ message: GENERIC });
    });

    // Stripe SDK errors carry `.statusCode` (401/402/429), not `.status`. The
    // middleware must never relay it — a Stripe 401 (bad API key) would
    // otherwise reach our client as a 401 and look like a failed login.
    it('an error with only .statusCode (Stripe-shaped) is treated as a 500, not relayed', async () => {
      const stripeShaped = Object.assign(new Error('Invalid API Key provided'), { statusCode: 401, type: 'StripeAuthenticationError' });

      const res = await request(appThrowing(stripeShaped)).get('/probe');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: GENERIC });
    });

    it.each([[200], [302], [99], ['404'], [NaN]])('an out-of-range or non-numeric .status (%p) falls back to 500', async (status) => {
      const res = await request(appThrowing(Object.assign(new Error('weird'), { status }))).get('/probe');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: GENERIC });
    });

    it('logs a 5xx once, with method, path, status and the real message + stack', async () => {
      await request(appThrowing(new Error('the real cause'))).get('/probe');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(logged).toMatchObject({ method: 'GET', path: '/probe', status: 500, message: 'the real cause' });
      expect(logged.stack).toContain('the real cause');
    });

    // The request body can hold a password or card data and the query string
    // can hold a token — neither may reach the logs.
    it('never logs the request body or the query string', async () => {
      await request(appThrowing(new Error('boom')))
        .post('/probe?token=abc123secret')
        .send({ password: 'hunter2-super-secret' });

      const loggedText = String(errorSpy.mock.calls[0][0]);
      expect(loggedText).not.toContain('hunter2-super-secret');
      expect(loggedText).not.toContain('abc123secret');
    });
  });

  describe('Mongoose errors', () => {
    const Probe = mongoose.model(
      'ErrorHandlerProbe',
      new mongoose.Schema({
        name: { type: String, required: true },
        count: { type: Number, min: 0 },
      })
    );

    it('a real ValidationError -> 400 with the per-field messages joined', async () => {
      const validationError = new Probe({ count: -1 }).validateSync();

      const res = await request(appThrowing(validationError)).get('/probe');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name.*required/);
      expect(res.body.message).toMatch(/count.*less than minimum/);
      expect(res.body.message).toContain(', ');
      // The model name in Mongoose's own top-level message ("ErrorHandlerProbe
      // validation failed: …") must not appear.
      expect(res.body.message).not.toContain('ErrorHandlerProbe');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('a CastError -> 400 with a fixed message naming only the path, never the raw cast text', async () => {
      const castError = new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');

      const res = await request(appThrowing(castError)).get('/probe');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Invalid _id' });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  it('delegates to Express when the response has already started (headersSent)', () => {
    const err = new Error('late');
    const next = jest.fn();
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };

    errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
