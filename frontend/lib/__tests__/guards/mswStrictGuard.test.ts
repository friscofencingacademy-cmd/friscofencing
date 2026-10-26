import fs from 'fs';
import path from 'path';

// Static guard — every MSW server in the Jest suite is strict: it starts with
// `server.listen({ onUnhandledRequest })` from test-utils/msw.ts, so a request
// no handler matches fails the test (jest.setup.js) instead of erroring quietly
// inside a component that tolerates it (docs/plans/testing-strategy-refresh-plan.md PR D).

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib'].map((dir) => path.join(FRONTEND_ROOT, dir));
const SELF = path.resolve(__filename);

const LISTEN = /\bserver\.listen\(([^)]*)\)/g;

/** 1-based lines of `server.listen(...)` calls that do not pass the strict strategy. */
function findViolations(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(LISTEN)) {
    if (!/\{\s*onUnhandledRequest\s*\}/.test(match[1])) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('strict MSW guard', () => {
  const files = SCAN_ROOTS.flatMap((root) => walk(root))
    .filter((file) => path.resolve(file) !== SELF)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('setupServer('));

  it('finds the MSW test files (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  it('every server.listen() uses the strict onUnhandledRequest from test-utils/msw', () => {
    const offenders = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
      const problems = findViolations(source).map((line) => `${rel}:${line}`);
      if (!/import \{ onUnhandledRequest \} from '[./]+test-utils\/msw';/.test(source)) {
        problems.push(`${rel}: does not import onUnhandledRequest from test-utils/msw`);
      }
      return problems;
    });

    expect(offenders).toEqual([]);
  });

  describe('findViolations', () => {
    it('flags a bare listen() and a non-strict strategy', () => {
      expect(findViolations('beforeAll(() => server.listen());')).toEqual([1]);
      expect(findViolations("beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));")).toEqual([1]);
    });

    it('accepts the strict strategy', () => {
      expect(findViolations('beforeAll(() => server.listen({ onUnhandledRequest }));')).toEqual([]);
    });
  });
});
