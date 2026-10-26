import fs from 'fs';
import path from 'path';

// Static guard — the E2E layer has exactly one `**/api/v1/**` handler:
// installApiMocks() in e2e/fixtures/mock-api.ts, which answers an unmocked
// call with 599 and fails the test (docs/plans/testing-strategy-refresh-plan.md
// PR B/C). A second, spec-local catch-all would serve whatever it likes to
// every call the spec did not anticipate and silently bypass loud-fail.
// Specs add responses with mockApi(page, overrides), never their own route.
// Ported from CKQ's e2eCatchAllGuard.test.ts.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const E2E_DIR = path.join(FRONTEND_ROOT, 'e2e');
const ALLOWED_FILE = 'e2e/fixtures/mock-api.ts';

interface Violation {
  file: string;
  line: number;
}

/** Every `.route('**\/api/v1/**', …)` literal catch-all in `source`; a narrower pattern is not one. */
function findCatchAllViolations(file: string, source: string): Violation[] {
  const re = /\.route\(\s*(["'`])\*\*\/api\/v1\/\*\*\1/g;
  const violations: Violation[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    violations.push({ file, line: source.slice(0, m.index).split('\n').length });
  }
  return violations;
}

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('E2E spec-local **/api/v1/** catch-all guard', () => {
  const files = listTsFiles(E2E_DIR).map((file) => ({
    file,
    rel: path.relative(FRONTEND_ROOT, file).split(path.sep).join('/'),
  }));

  it('scans e2e/ and finds the one allowed handler (fails loudly if either moves)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    const allowed = files.find(({ rel }) => rel === ALLOWED_FILE);
    expect(allowed).toBeDefined();
    expect(findCatchAllViolations(ALLOWED_FILE, fs.readFileSync(allowed!.file, 'utf8'))).toHaveLength(1);
  });

  it(`no e2e file other than ${ALLOWED_FILE} registers a **/api/v1/** catch-all`, () => {
    const violations = files
      .filter(({ rel }) => rel !== ALLOWED_FILE)
      .flatMap(({ file, rel }) => findCatchAllViolations(rel, fs.readFileSync(file, 'utf8')));

    expect(violations).toEqual([]);
  });

  describe('findCatchAllViolations', () => {
    it.each([
      `page.route("**/api/v1/**", (route) => route.fulfill({}));`,
      `await page.route('**/api/v1/**', async (route) => {});`,
      'await page.route(`**/api/v1/**`, async (route) => {});',
    ])('flags %s', (source) => {
      expect(findCatchAllViolations('x.ts', source)).toEqual([{ file: 'x.ts', line: 1 }]);
    });

    it('does not flag a narrower pattern', () => {
      expect(findCatchAllViolations('x.ts', `page.route('**/api/v1/levels', () => {});`)).toEqual([]);
    });

    it('does not flag the pattern in a comment', () => {
      expect(findCatchAllViolations('x.ts', `// a spec-local "**/api/v1/**" catch-all is banned`)).toEqual([]);
    });

    it('reports every match with its line', () => {
      const source = `const a = 1;\npage.route('**/api/v1/**', () => {});\npage.route("**/api/v1/**", () => {});`;
      expect(findCatchAllViolations('x.ts', source)).toEqual([
        { file: 'x.ts', line: 2 },
        { file: 'x.ts', line: 3 },
      ]);
    });
  });
});
