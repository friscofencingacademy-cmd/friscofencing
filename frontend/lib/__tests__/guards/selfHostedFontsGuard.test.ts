import fs from 'fs';
import path from 'path';

// Static guard: the site's fonts are self-hosted (app/layout.tsx, next/font/
// local over the @fontsource-variable packages), never downloaded from Google
// during `next build`. next/font/google's build-time fetch failed a develop CI
// build on a transient bad response (2026-09-30) — the same failure would fail
// a Vercel deploy. This fails the suite if any file goes back to it, and if a
// font package update renames a file layout.tsx points at (which otherwise
// surfaces only as a build failure).

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib'].map((dir) => path.join(FRONTEND_ROOT, dir));
const LAYOUT = path.join(FRONTEND_ROOT, 'app', 'layout.tsx');

// What actually loads a Google font: importing/requiring the module, or a
// quoted / url() reference to Google's font hosts (a <link>, an @import, a
// CSS url()). Prose in a comment that merely names them does not match.
const GOOGLE_FONT_LOAD = [
  /(?:from|require\()\s*['"]next\/font\/google['"]/,
  /['"(]https?:\/\/fonts\.(?:googleapis|gstatic)\.com/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('self-hosted fonts guard', () => {
  const files = SCAN_ROOTS.flatMap((root) => walk(root));
  const self = path.resolve(__filename);

  it('scans the app (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no file loads fonts from Google at build or run time', () => {
    const offenders = files
      .filter((file) => path.resolve(file) !== self)
      .filter((file) => GOOGLE_FONT_LOAD.some((pattern) => pattern.test(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(FRONTEND_ROOT, file).split(path.sep).join('/'));

    expect(offenders).toEqual([]);
  });

  it('every font file app/layout.tsx points at exists', () => {
    const layout = fs.readFileSync(LAYOUT, 'utf8');
    const sources = [...layout.matchAll(/src:\s*'([^']+\.woff2)'/g)].map((match) => match[1]);

    expect(sources).toHaveLength(3);
    sources.forEach((src) => {
      expect(fs.existsSync(path.resolve(path.dirname(LAYOUT), src))).toBe(true);
    });
  });
});
