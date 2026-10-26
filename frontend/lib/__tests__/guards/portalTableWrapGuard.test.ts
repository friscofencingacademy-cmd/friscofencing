import fs from 'fs';
import path from 'path';

// Static guard — every table styled with the portal's shared `.table`
// (app/components/ui/shared.module.css) sits directly inside a `.tableWrap`,
// so a table wider than a phone scrolls inside its own box instead of
// making the whole page scroll sideways. Found by e2e/subscriptions.spec.ts:
// /parent/subscriptions was 740 px wide in a 393 px viewport
// (docs/plans/testing-strategy-refresh-plan.md PR F). Admin pages use
// admin.module.css's own `.tableWrap` and are not scanned here.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const APP = path.join(FRONTEND_ROOT, 'app');
const SHARED_STYLES = /import styles from '[./]+(components\/ui\/)?shared\.module\.css';/;
const TABLE = /<table className=\{styles\.table\}>/;
const WRAP = /<div className=\{styles\.tableWrap\}>/;

/** 1-based lines of portal tables whose nearest non-blank line above is not a tableWrap. */
function findUnwrappedTables(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!TABLE.test(line)) return;
    let previous = i - 1;
    while (previous >= 0 && lines[previous].trim() === '') previous--;
    if (previous < 0 || !WRAP.test(lines[previous])) hits.push(i + 1);
  });
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('portal table wrap guard', () => {
  const files = walk(APP).filter((file) => SHARED_STYLES.test(fs.readFileSync(file, 'utf8')));

  it('finds the portal pages that use the shared styles (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('every portal table sits directly inside a tableWrap', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
      return findUnwrappedTables(fs.readFileSync(file, 'utf8')).map((line) => `${rel}:${line}`);
    });

    expect(offenders).toEqual([]);
  });

  describe('findUnwrappedTables', () => {
    it('flags a bare table and accepts a wrapped one', () => {
      expect(findUnwrappedTables('<Card>\n  <table className={styles.table}>')).toEqual([2]);
      expect(findUnwrappedTables('<div className={styles.tableWrap}>\n  <table className={styles.table}>')).toEqual([]);
    });
  });
});
