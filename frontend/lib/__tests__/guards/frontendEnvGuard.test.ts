import fs from 'fs';
import path from 'path';

// Static guard — the frontend's environment stays empty of browser config.
// A NEXT_PUBLIC_* variable is baked into the bundle at build time, so it
// either duplicates config the backend owns (the payment provider's public
// key comes from GET /payments/config — docs/decisions/013) or lets the
// browser call the backend origin directly, which the same-origin /api/v1
// proxy exists to prevent (CLAUDE.md, Deployment & Environments). The only
// variables production code may read are server-side ones, and
// .env.local.example documents exactly those — no more, no less.
//
// Production code only: tests and e2e/ may read process.env freely.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib'];
const SCAN_FILES = ['next.config.js'];
const EXAMPLE = '.env.local.example';
// Set by Next itself, never by a developer — not documented in the example.
const BUILT_IN = new Set(['NODE_ENV']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
const files = [
  ...SCAN_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root))),
  ...SCAN_FILES.map((file) => path.join(FRONTEND_ROOT, file)),
].map((file) => ({ rel: relative(file), content: fs.readFileSync(file, 'utf8') }));

const ENV_READ = /process\.env(?:\.([A-Z0-9_]+)|\[\s*['"]([A-Z0-9_]+)['"]\s*\])/g;
const reads = files.flatMap(({ rel, content }) =>
  [...content.matchAll(ENV_READ)].map((match) => ({ rel, name: match[1] ?? match[2] }))
);
const readNames = new Set(reads.map(({ name }) => name));

const exampleNames = fs
  .readFileSync(path.join(FRONTEND_ROOT, EXAMPLE), 'utf8')
  .split(/\r?\n/)
  .map((line) => /^([A-Z0-9_]+)=/.exec(line.trim())?.[1])
  .filter((name): name is string => Boolean(name));

describe('frontend env guard', () => {
  it('scans the app (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(reads.some(({ rel, name }) => rel === 'next.config.js' && name === 'BACKEND_URL')).toBe(true);
  });

  it('production code mentions no NEXT_PUBLIC_* variable', () => {
    const offenders = files.filter(({ content }) => content.includes('NEXT_PUBLIC_')).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it(`${EXAMPLE} declares no NEXT_PUBLIC_* variable`, () => {
    expect(exampleNames.filter((name) => name.startsWith('NEXT_PUBLIC_'))).toEqual([]);
  });

  it(`every variable production code reads is documented in ${EXAMPLE}`, () => {
    const undocumented = reads.filter(({ name }) => !BUILT_IN.has(name) && !exampleNames.includes(name));

    expect(undocumented).toEqual([]);
  });

  it(`every variable in ${EXAMPLE} is read by production code`, () => {
    expect(exampleNames.filter((name) => !readNames.has(name))).toEqual([]);
  });
});
