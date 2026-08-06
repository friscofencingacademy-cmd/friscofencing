process.env.JWT_SECRET = 'test-jwt-secret';

const { signToken, verifyToken } = require('../../src/utils/jwt');

describe('jwt utils', () => {
  it('signs and verifies a token roundtrip', () => {
    const token = signToken({ id: 'user-123', role: 'parent' });

    const payload = verifyToken(token);

    expect(payload.id).toBe('user-123');
    expect(payload.role).toBe('parent');
  });

  it('rejects a tampered token', () => {
    const token = signToken({ id: 'user-123', role: 'parent' });
    const tampered = `${token}tampered`;

    expect(() => verifyToken(tampered)).toThrow();
  });

  it('rejects a malformed/invalid token', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });
});
