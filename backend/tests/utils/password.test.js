const { hashPassword, comparePassword } = require('../../src/utils/password');

describe('password utils', () => {
  it('hashes a password and verifies the correct password matches', async () => {
    const hash = await hashPassword('correct-password');

    expect(hash).not.toBe('correct-password');

    const isMatch = await comparePassword('correct-password', hash);
    expect(isMatch).toBe(true);
  });

  it('fails comparison for a wrong password', async () => {
    const hash = await hashPassword('correct-password');

    const isMatch = await comparePassword('wrong-password', hash);
    expect(isMatch).toBe(false);
  });
});
