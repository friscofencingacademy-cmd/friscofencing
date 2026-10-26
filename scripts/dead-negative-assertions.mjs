#!/usr/bin/env node
/**
 * dead-negative-assertions.mjs
 *
 * /audit-tests Check 13. Finds frontend unit-test assertions that check text
 * is NOT rendered when no code can render that text any more, so the
 * assertion can never fail. Shape:
 *
 *   expect(screen.queryByText('Billing')).not.toBeInTheDocument();
 *
 * where "Billing" was deleted from the app. Ported from CKQ's
 * scripts/dead-negative-assertions.mjs (docs/plans/testing-strategy-refresh-plan.md
 * PR C, C7), adapted to this repo: the app lives under frontend/app and
 * frontend/lib, and its Jest tests sit beside the code in __tests__/ folders.
 *
 * A literal is flagged only when it appears in none of:
 *   - non-test app source under frontend/app and frontend/lib
 *   - shared test support files (a non-test file under __tests__/, __mocks__/,
 *     test-utils/ or testUtils/)
 *   - any other line of the same test file (its fixtures, MSW handlers,
 *     jest.mock factories) other than another queryBy* line or an
 *     it/test/describe title line
 * Template literals containing ${...} are skipped. Hits are candidates, not
 * verdicts: text the app builds at runtime (a formatter, a count) also lands
 * here, so every hit needs the triage in .claude/skills/audit-tests/SKILL.md.
 *
 * Not covered: testid/regex queries, frontend/e2e (Playwright), backend.
 *
 * Usage: node scripts/dead-negative-assertions.mjs --frontend frontend
 *
 * Exit codes:
 *   0 — no candidates
 *   1 — candidates found (one "file:line  "text"" per line)
 *   2 — could not run (bad --frontend path, or zero test files scanned) —
 *       this must NEVER look like a pass
 *
 * Zero npm dependencies — Node built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';

function fail(msg) {
  console.error(`dead-negative-assertions: ${msg}`);
  process.exit(2);
}

const argIdx = process.argv.indexOf('--frontend');
const frontend = argIdx > -1 ? process.argv[argIdx + 1] : null;
if (!frontend) fail('missing --frontend <path>');
const roots = ['app', 'lib'].map((dir) => path.join(frontend, dir));
for (const root of roots) if (!fs.existsSync(root)) fail(`no ${path.basename(root)}/ under ${frontend}`);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isTest = (f) => /\.test\.tsx?$/.test(f);
const isSupport = (f) => /[\\/](__tests__|__mocks__|test-utils|testUtils)[\\/]/.test(f) && !isTest(f);
const isSource = (f) => /\.(tsx?|json)$/.test(f);

const files = roots.flatMap((root) => walk(root));
const tests = files.filter(isTest);
if (tests.length === 0) fail(`scanned zero test files under ${roots.join(', ')}`);

const read = (f) => fs.readFileSync(f, 'utf8');
const appText = files.filter((f) => isSource(f) && !isTest(f) && !isSupport(f)).map(read).join('\n');
const supportText = files.filter((f) => isSource(f) && isSupport(f)).map(read).join('\n');

// queryBy*("text") or queryByRole("role", { name: "text" }), then .not.toBeInTheDocument / .toBeNull on the same line.
const ASSERTION =
  /queryBy(?:Text|Role|LabelText|PlaceholderText|TitleText|AltText|DisplayValue)\(\s*(?:["'][^"']*["']\s*,\s*\{\s*name:\s*)?(["'`])((?:(?!\1).)+)\1[^\n]*?\.(?:not\.toBeInTheDocument|toBeNull)/g;
const QUERY_LINE = /queryBy[A-Za-z]*\(/;
// A test's own title often names the absent text ("does not show Billing") — it is not a definition.
const TITLE_LINE = /^\s*(?:it|test|describe)(?:\.each\([^)]*\))?\s*\(/;

let checked = 0;
const hits = [];
for (const file of tests) {
  const lines = read(file).split(/\r?\n/);
  lines.forEach((line, i) => {
    ASSERTION.lastIndex = 0;
    let m;
    while ((m = ASSERTION.exec(line))) {
      checked++;
      const text = m[2];
      if (text.includes('${')) continue;
      if (appText.includes(text) || supportText.includes(text)) continue;
      if (lines.some((other, j) => j !== i && other.includes(text) && !QUERY_LINE.test(other) && !TITLE_LINE.test(other))) continue;
      hits.push(`${path.relative(frontend, file).split(path.sep).join('/')}:${i + 1}  "${text}"`);
    }
  });
}

console.log(`dead-negative-assertions: ${tests.length} test files, ${checked} literal negative assertions, ${hits.length} candidates`);
if (hits.length) {
  console.log(hits.join('\n'));
  process.exit(1);
}
