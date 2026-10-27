const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { EXIT, checkRefusals, parseArgs, readFrontmatter } = require('../run-gate');

const STAGING = 'https://friscofencing-git-develop-frisco-fencing.vercel.app';
const FULL_ENV = {
  AUDIT_STAGING_URL: STAGING,
  AUDIT_SUPERADMIN_EMAIL: 'admin@example.com',
  AUDIT_SUPERADMIN_PASSWORD: 'x',
  AUDIT_TEST_PASSWORD: 'y',
};

function refusal(argv, env = FULL_ENV, dirs = {}) {
  return checkRefusals({ args: parseArgs(argv), env, ...dirs }).problem;
}

test('exit codes are 0 pass, 1 fail, 2 blocked, 3 refused', () => {
  assert.deepEqual(EXIT, { pass: 0, fail: 1, blocked: 2, refused: 3 });
});

test('parses the id and options', () => {
  assert.deepEqual(parseArgs(['register-quote', '--headed', '--slow', '300']), {
    id: 'register-quote',
    headed: true,
    slowMo: 300,
    allowWrites: false,
    problem: null,
  });
  assert.match(parseArgs(['x', '--slow', 'fast']).problem, /--slow/);
  assert.match(parseArgs(['x', '--force']).problem, /Unknown option --force/);
  assert.match(parseArgs(['a', 'b']).problem, /Only one gate id/);
});

test('refuses without an id, listing the gates', () => {
  assert.match(refusal([]), /Name a gate.*f15-prorated-top-payer/);
});

test('refuses an unknown id, and anything that is not a plain id', () => {
  assert.match(refusal(['no-such-gate']), /Unknown gate "no-such-gate"/);
  assert.match(refusal(['../run-gate']), /Unknown gate/);
});

test('refuses a production URL', () => {
  assert.match(refusal(['f15-prorated-top-payer'], { ...FULL_ENV, AUDIT_STAGING_URL: 'https://friscofencing.vercel.app' }), /production/);
  assert.match(refusal(['f15-prorated-top-payer'], { ...FULL_ENV, AUDIT_STAGING_URL: '' }), /must be set/);
});

test('refuses with missing env, naming the variables', () => {
  assert.match(refusal(['f15-prorated-top-payer'], { AUDIT_STAGING_URL: STAGING }), /AUDIT_SUPERADMIN_EMAIL, AUDIT_SUPERADMIN_PASSWORD/);
  // A gate that signs in as a parent also needs the audit accounts' password.
  const { AUDIT_TEST_PASSWORD, ...withoutTest } = FULL_ENV;
  assert.match(refusal(['register-quote'], withoutTest), /AUDIT_TEST_PASSWORD/);
  assert.equal(refusal(['f15-prorated-top-payer'], withoutTest), undefined);
});

test('refuses a mutating gate without --allow-writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  const gatesDir = path.join(root, 'gates');
  const specsDir = path.join(root, 'specs');
  fs.mkdirSync(gatesDir);
  fs.mkdirSync(specsDir);
  fs.writeFileSync(path.join(gatesDir, 'saves-something.js'), "module.exports = { id: 'saves-something', accounts: { admin: 'superadmin' }, steps: [] };");
  fs.writeFileSync(path.join(specsDir, 'saves-something.md'), '---\nid: saves-something\nenv: staging\nmutates: true     # charges\n---\n');

  assert.match(refusal(['saves-something'], FULL_ENV, { gatesDir, specsDir }), /--allow-writes/);
  assert.equal(refusal(['saves-something', '--allow-writes'], FULL_ENV, { gatesDir, specsDir }), undefined);
});

test('accepts each shipped gate with a full env', () => {
  ['f15-prorated-top-payer', 'charge-dialog-modes', 'payment-history', 'register-quote'].forEach((id) => {
    const checked = checkRefusals({ args: parseArgs([id]), env: FULL_ENV });
    assert.equal(checked.problem, undefined, id);
    assert.equal(checked.gate.id, id);
    assert.equal(checked.spec.mutates, 'false');
  });
});

test('reads frontmatter, ignoring trailing comments', () => {
  assert.deepEqual(readFrontmatter('---\nid: x\nmutates: false        # true when it charges\nlogin: superadmin\n---\n# Title'), {
    id: 'x',
    mutates: 'false',
    login: 'superadmin',
  });
});
