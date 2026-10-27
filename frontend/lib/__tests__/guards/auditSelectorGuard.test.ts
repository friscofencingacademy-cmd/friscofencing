import fs from 'fs';
import path from 'path';

// Static guard — every label and text the live registration audit (audit/)
// finds the app by still exists in the app (docs/plans/audit-and-health-
// refresh-plan.md D8). The audit runs against real staging, so it is the one
// layer that cannot run on a PR; before this guard, a renamed button or a
// reworded notice was only discovered weeks later on a live run (the
// book-trial "Continue" button, the "already registered" skip text and the
// "10% sibling discount applied" preview line had all silently disappeared
// by 2026-10-26). Now the PR that removes the text fails here instead.
//
// What is checked, in every audit/lib, audit/scenarios and audit/gates file
// (the live-gate scripts, docs/plans/playwright-live-gates-plan.md D8):
//  - the argument of getByLabel / getByText / getByPlaceholder, the `name` of
//    getByRole, the `label` of selectOption, and every `expectedReason:`
//    string;
//  - an argument that is an identifier, or a `${IDENT}` inside a template, is
//    resolved to that file's own `const IDENT = '…' | /…/` declaration.
// A string must appear verbatim (case-sensitive) in the app or backend
// source; a simple regex (words, spaces, ' & % ! , - only) must appear as
// text, honoring its `i` flag. A regex with any other metacharacter cannot be
// checked as plain text and is reported, never silently passed — rewrite it
// as a simple one or a string constant. Fixture names (anything starting with
// "audit ") are data the audit seed creates, not app text.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const REPO_ROOT = path.join(FRONTEND_ROOT, '..');
const AUDIT_DIRS = ['lib', 'scenarios', 'gates'].map((dir) => path.join(REPO_ROOT, 'audit', dir));
const GATE_SPECS_DIR = path.join(REPO_ROOT, 'docs', 'live-gates');
const GATE_SCRIPTS_DIR = path.join(REPO_ROOT, 'audit', 'gates');
const SOURCE_ROOTS = [
  path.join(FRONTEND_ROOT, 'app'),
  path.join(FRONTEND_ROOT, 'lib'),
  path.join(REPO_ROOT, 'backend', 'src'),
];

export type AuditText = { kind: 'string'; value: string } | { kind: 'regex'; source: string; flags: string };

export interface ExtractedSelector {
  text: AuditText;
  line: number;
}

const STRING_LITERAL = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
const REGEX_LITERAL = String.raw`\/(?![*/])(?:[^/\\\n]|\\.)+\/[a-z]*`;
const TEMPLATE_LITERAL = String.raw`\x60[^\x60]*\x60`;
const ARG = String.raw`(${STRING_LITERAL}|${REGEX_LITERAL}|new RegExp\(\s*${TEMPLATE_LITERAL}[^)]*\)|[A-Za-z_$][\w$]*)`;

const SELECTOR_PATTERNS = [
  new RegExp(String.raw`getBy(?:Label|Text|Placeholder)\(\s*${ARG}`, 'g'),
  new RegExp(String.raw`getByRole\(\s*(?:${STRING_LITERAL})\s*,\s*\{[^}]*?\bname:\s*${ARG}`, 'g'),
  new RegExp(String.raw`selectOption\(\s*\{[^}]*?\blabel:\s*${ARG}`, 'g'),
  new RegExp(String.raw`\bexpectedReason:\s*(${STRING_LITERAL})`, 'g'),
];
const CONST_DECLARATION = new RegExp(String.raw`^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*(${STRING_LITERAL}|${REGEX_LITERAL})\s*;`, 'gm');

function parseLiteral(token: string): AuditText | null {
  if (token.startsWith("'") || token.startsWith('"')) {
    return { kind: 'string', value: JSON.parse(`"${token.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) };
  }
  if (token.startsWith('/')) {
    const end = token.lastIndexOf('/');
    return { kind: 'regex', source: token.slice(1, end), flags: token.slice(end + 1) };
  }
  return null;
}

/** Every app-facing text an audit file selects by, with identifiers resolved to the file's own constants. */
export function extractSelectors(source: string): ExtractedSelector[] {
  const constants = new Map<string, AuditText>();
  for (const match of source.matchAll(CONST_DECLARATION)) {
    const parsed = parseLiteral(match[2]);
    if (parsed) constants.set(match[1], parsed);
  }

  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const found: ExtractedSelector[] = [];

  for (const pattern of SELECTOR_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const token = match[1];
      const line = lineOf(match.index ?? 0);
      const literal = parseLiteral(token);

      if (literal) {
        found.push({ text: literal, line });
      } else if (token.startsWith('new RegExp')) {
        for (const ref of token.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
          const resolved = constants.get(ref[1]);
          if (resolved) found.push({ text: resolved, line });
        }
      } else {
        // A function parameter (a child name, a level name) has no constant
        // to resolve; the caller's literal is captured where it is written.
        const resolved = constants.get(token);
        if (resolved) found.push({ text: resolved, line });
      }
    }
  }

  return found;
}

const SIMPLE_REGEX = /^[\w\s'&%!,-]+$/;

export function isFixtureName(text: AuditText): boolean {
  const value = text.kind === 'string' ? text.value : text.source;
  return /^audit /i.test(value);
}

/** 'found' | 'missing' | 'unchecked' (a regex too complex to read as plain text). */
export function lookUp(text: AuditText, corpus: string): 'found' | 'missing' | 'unchecked' {
  if (text.kind === 'string') return corpus.includes(text.value) ? 'found' : 'missing';
  if (!SIMPLE_REGEX.test(text.source)) return 'unchecked';
  const haystack = text.flags.includes('i') ? corpus.toLowerCase() : corpus;
  const needle = text.flags.includes('i') ? text.source.toLowerCase() : text.source;
  return haystack.includes(needle) ? 'found' : 'missing';
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const describeText = (text: AuditText) => (text.kind === 'string' ? `'${text.value}'` : `/${text.source}/${text.flags}`);

/** The step numbers of a gate spec's Steps table, in order. */
export function specStepNumbers(markdown: string): number[] {
  const steps = markdown.split(/^## Steps\s*$/m)[1];
  if (!steps) return [];
  const table = steps.split(/^## /m)[0];
  return [...table.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((match) => Number(match[1]));
}

/** The step numbers a gate script declares with step(n, …), in order. */
export function scriptStepNumbers(source: string): number[] {
  return [...source.matchAll(/\bstep\(\s*(\d+)\s*,/g)].map((match) => Number(match[1]));
}

/** One problem per gate whose spec and script disagree, or that has only one of the two. */
export function gatePairingProblems(specs: Record<string, string>, scripts: Record<string, string>): string[] {
  const problems: string[] = [];
  const ids = [...new Set([...Object.keys(specs), ...Object.keys(scripts)])].sort();
  for (const id of ids) {
    if (!(id in scripts)) problems.push(`docs/live-gates/${id}.md has no audit/gates/${id}.js`);
    else if (!(id in specs)) problems.push(`audit/gates/${id}.js has no docs/live-gates/${id}.md`);
    else {
      const fromSpec = specStepNumbers(specs[id]).join(',');
      const fromScript = scriptStepNumbers(scripts[id]).join(',');
      if (fromSpec !== fromScript) problems.push(`${id}: the spec's steps are [${fromSpec}], the script's are [${fromScript}]`);
    }
  }
  return problems;
}

function readDir(dir: string, extension: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(extension) && entry.name !== 'README.md') {
      files[entry.name.slice(0, -extension.length)] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    }
  }
  return files;
}

describe('live-gate spec/script pairing', () => {
  const specs = readDir(GATE_SPECS_DIR, '.md');
  const scripts = readDir(GATE_SCRIPTS_DIR, '.js');

  it('finds the gates (fails loudly on a wrong root)', () => {
    expect(Object.keys(specs).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(scripts).length).toBeGreaterThanOrEqual(4);
  });

  it('every gate spec has a script with the same steps, and every script a spec', () => {
    expect(gatePairingProblems(specs, scripts)).toEqual([]);
  });

  it('reports a missing script, a missing spec, and a step-count mismatch', () => {
    const spec = [
      '# T',
      '',
      '## Steps',
      '| # | Do | Expect |',
      '|---|---|---|',
      '| 1 | a | b |',
      '| 2 | c | d |',
      '',
      '## Pass rule',
      '| 3 | not a step | x |',
    ].join('\n');
    expect(specStepNumbers(spec)).toEqual([1, 2]);
    expect(scriptStepNumbers("step(1, 'a', 'b', fn),\n  step(2, 'c', 'd', fn), liveStep(9, 'x')")).toEqual([1, 2]);
    expect(
      gatePairingProblems(
        { 'only-spec': spec, mismatch: spec, ok: spec },
        { 'only-script': 'step(1,', mismatch: "step(1, 'a'", ok: "step(1, 'a'\nstep(2, 'c'" }
      )
    ).toEqual([
      "mismatch: the spec's steps are [1,2], the script's are [1]",
      'audit/gates/only-script.js has no docs/live-gates/only-script.md',
      'docs/live-gates/only-spec.md has no audit/gates/only-spec.js',
    ]);
  });
});

describe('live-audit selector guard', () => {
  const auditFiles = AUDIT_DIRS.flatMap((dir) => walk(dir));
  // JSX wraps long text across lines; collapse whitespace so a wrapped
  // sentence still matches.
  const corpus = SOURCE_ROOTS.flatMap((root) => walk(root))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
    .replace(/\s+/g, ' ');
  const selectors = auditFiles.flatMap((file) =>
    extractSelectors(fs.readFileSync(file, 'utf8')).map((selector) => ({
      ...selector,
      file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
    }))
  );
  const checked = selectors.filter((selector) => !isFixtureName(selector.text));

  it('scans the audit package (fails loudly on a wrong root or a broken extractor)', () => {
    expect(auditFiles.length).toBeGreaterThanOrEqual(10);
    expect(checked.length).toBeGreaterThanOrEqual(20);
    expect(checked.filter((selector) => selector.file.endsWith('s3-sibling-discount.js') || selector.file.endsWith('s5-sibling-discount-bridge.js'))
      .filter(({ text }) => text.kind === 'string' && text.value.includes('sibling discount'))).toHaveLength(2);
  });

  it('every text the live audit selects by still exists in the app or backend source', () => {
    const missing = checked
      .filter(({ text }) => lookUp(text, corpus) === 'missing')
      .map(({ file, line, text }) => `${file}:${line} ${describeText(text)}`);

    expect(missing).toEqual([]);
  });

  it('every regex the audit selects by is simple enough to check', () => {
    const unchecked = checked
      .filter(({ text }) => lookUp(text, corpus) === 'unchecked')
      .map(({ file, line, text }) => `${file}:${line} ${describeText(text)}`);

    expect(unchecked).toEqual([]);
  });

  describe('extractSelectors', () => {
    it('reads string, regex and role-name arguments, and selectOption labels', () => {
      const source = [
        "page.getByLabel('Email').fill(email);",
        "page.getByRole('button', { name: /book trial class/i }).click();",
        "page.getByText('Trial class booked!');",
        "page.getByLabel('Level').selectOption({ label: 'Audit Level A' });",
      ].join('\n');

      expect(extractSelectors(source).map(({ text, line }) => [describeText(text), line])).toEqual([
        ["'Email'", 1],
        ["'Trial class booked!'", 3],
        ["'Level'", 4],
        ['/book trial class/i', 2],
        ["'Audit Level A'", 4],
      ]);
    });

    it("resolves an identifier and a template's ${IDENT} to the file's own constant, and skips parameters", () => {
      const source = [
        'const NOTE = /lower-priced plan/i;',
        "const LABEL = 'Sibling Discount';",
        'page.getByText(NOTE);',
        'page.getByText(new RegExp(`^${LABEL}`)).first();',
        'page.getByRole(\'radio\', { name: childNameRegex });',
      ].join('\n');

      expect(extractSelectors(source).map(({ text }) => describeText(text))).toEqual([
        '/lower-priced plan/i',
        "'Sibling Discount'",
      ]);
    });

    it('captures expectedReason strings, including an apostrophe in double quotes', () => {
      const source = `registerChild(page, config, /x/i, 'L', true, {\n  expectedReason:\n    "Your family's discount applies.",\n});`;

      expect(extractSelectors(source).map(({ text }) => describeText(text))).toEqual(["'Your family's discount applies.'"]);
    });
  });

  describe('lookUp', () => {
    const corpus = 'Card on file: visa · Book Trial Class · We’ll';

    it('matches strings case-sensitively and simple regexes per their flags', () => {
      expect(lookUp({ kind: 'string', value: 'Book Trial Class' }, corpus)).toBe('found');
      expect(lookUp({ kind: 'string', value: 'book trial class' }, corpus)).toBe('missing');
      expect(lookUp({ kind: 'regex', source: 'card on file', flags: 'i' }, corpus)).toBe('found');
      expect(lookUp({ kind: 'regex', source: 'card on file', flags: '' }, corpus)).toBe('missing');
    });

    it('refuses to guess about a regex with metacharacters', () => {
      expect(lookUp({ kind: 'regex', source: '^Sibling', flags: '' }, corpus)).toBe('unchecked');
    });

    it('treats audit fixture names as data, not app text', () => {
      expect(isFixtureName({ kind: 'regex', source: 'audit childone', flags: 'i' })).toBe(true);
      expect(isFixtureName({ kind: 'string', value: 'Audit Level A' })).toBe(true);
      expect(isFixtureName({ kind: 'string', value: 'Level' })).toBe(false);
    });
  });
});
