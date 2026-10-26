import fs from 'fs';
import path from 'path';

// Static guard — Jest tests drive interaction with userEvent, which fires the
// full event sequence a browser does (docs/TESTING_STRATEGY.md;
// docs/plans/testing-strategy-refresh-plan.md PR D, T9). `fireEvent` is
// allowed only as a documented exception: a `// fireEvent kept: <reason>`
// comment on the same line or the line above.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib'].map((dir) => path.join(FRONTEND_ROOT, dir));
const SELF = path.resolve(__filename);

const FIRE_EVENT = /\bfireEvent\.\w+\(/;
const KEPT = /\/\/\s*fireEvent kept:\s*\S/;

function findViolations(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line) || !FIRE_EVENT.test(line)) return;
    if (KEPT.test(line) || (i > 0 && KEPT.test(lines[i - 1]))) return;
    hits.push(i + 1);
  });
  return hits;
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

describe('userEvent guard', () => {
  const files = SCAN_ROOTS.flatMap((root) => walk(root)).filter((file) => path.resolve(file) !== SELF);

  it('scans the Jest suite (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
  });

  it('no test uses fireEvent without a documented reason', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
      return findViolations(fs.readFileSync(file, 'utf8')).map((line) => `${rel}:${line}`);
    });

    expect(offenders).toEqual([]);
  });

  describe('findViolations', () => {
    it('flags a bare fireEvent call', () => {
      expect(findViolations("fireEvent.click(screen.getByRole('button'));")).toEqual([1]);
    });

    it('accepts a fireEvent call with a reason on the same line or the line above', () => {
      expect(findViolations('fireEvent.submit(form); // fireEvent kept: jsdom has no implicit submission')).toEqual([]);
      expect(findViolations('// fireEvent kept: jsdom has no implicit submission\nfireEvent.submit(form);')).toEqual([]);
    });

    it('does not flag a comment or the userEvent API', () => {
      expect(findViolations('// was fireEvent.click(x) before PR D\nawait user.click(x);')).toEqual([]);
    });
  });
});
