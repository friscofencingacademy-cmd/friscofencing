// Writes a live gate's result file (docs/plans/playwright-live-gates-plan.md
// D6) in docs/live-gates/README.md's format. Never edits an earlier file: a
// name that exists gets -2, -3, … appended.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'friscofencingacademy-cmd/friscofencing';
const VERCEL_CONTEXTS = ['Vercel – friscofencing', 'Vercel – friscofencing-backend'];

// The first free path for <date>-<id>.md in `dir`.
function resultPath(dir, date, id, exists = fs.existsSync) {
  const base = `${date}-${id}`;
  let candidate = path.join(dir, `${base}.md`);
  for (let suffix = 2; exists(candidate); suffix += 1) {
    candidate = path.join(dir, `${base}-${suffix}.md`);
  }
  return candidate;
}

// The develop commit staging serves: develop's head, but only when both Vercel
// deployments for it report success. Anything else — no gh, a failed call, a
// deployment still building — is "unknown". `run(args)` returns gh's stdout.
function lookUpCommit(run = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
  try {
    const sha = run(['api', `repos/${REPO}/commits/develop`, '--jq', '.sha']).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return 'unknown';

    const statuses = JSON.parse(run(['api', `repos/${REPO}/commits/${sha}/status`, '--jq', '.statuses']));
    const allGreen = VERCEL_CONTEXTS.every((context) =>
      statuses.some((status) => status.context === context && status.state === 'success')
    );
    return allGreen ? sha.slice(0, 7) : 'unknown';
  } catch {
    return 'unknown';
  }
}

function cell(text) {
  return String(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

// Replaces every secret value with [redacted] — a password must never reach a
// committed file, however a step happened to quote the page.
function redact(text, secrets = []) {
  return secrets.filter((secret) => secret && secret.length >= 4).reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

// rows: [{ n, expect, seen, result }] — preconditions (n = 'P1' …) first, then steps.
function renderResult({ gate, result, env, url, commit, date, runBy, recording, rows, notes = [], secrets = [] }) {
  const lines = [
    '---',
    `gate: ${gate}`,
    `result: ${result}`,
    `env: ${env}`,
    `url: ${url}`,
    `commit: ${commit}`,
    `date: ${date}`,
    `run_by: ${runBy}`,
    `recording: ${recording}`,
    '---',
    '',
    '| # | Expect | Seen | Result |',
    '|---|---|---|---|',
    ...rows.map((row) => `| ${cell(row.n)} | ${cell(row.expect)} | ${cell(row.seen)} | ${row.result} |`),
    '',
    'Notes:',
    ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ['- None.']),
    '',
  ];
  return redact(lines.join('\n'), secrets);
}

function writeResult(dir, fields, exists) {
  const file = resultPath(dir, fields.date, fields.gate, exists);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, renderResult(fields));
  return file;
}

module.exports = { lookUpCommit, redact, renderResult, resultPath, writeResult };
