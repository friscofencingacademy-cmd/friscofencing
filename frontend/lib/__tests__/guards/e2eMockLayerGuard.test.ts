import fs from 'fs';
import path from 'path';

// Static guard — every E2E spec runs on the shared mock layer: it imports
// `test` from e2e/fixtures/test.ts, whose `page` fixture installs the mocks
// and fails the test on any unmocked backend call
// (docs/plans/testing-strategy-refresh-plan.md PR B/C). A spec importing
// `test` straight from @playwright/test would run with no mocks and no
// loud-fail. `import type { … } from '@playwright/test'` is not a value
// import and is fine. Adapted from CKQ's e2eMockLayerGuard.test.ts — there the
// raw import is allowed with manual calls; here there is one way, no allowlist.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const E2E_DIR = path.join(FRONTEND_ROOT, 'e2e');

// Value imports only: `import type { … }` does not match `import\s*\{`.
const PLAYWRIGHT_VALUE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@playwright\/test["']/g;
const SHARED_VALUE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](?:\.\/|\.\.\/)fixtures\/test["']/g;

type Problem = 'imports test from @playwright/test' | 'does not import test from fixtures/test';

/** True when one of the import lists names `test` as a value (`test` or `test as x`, not `type test`). */
function importsTest(source: string, importPattern: RegExp): boolean {
  return [...source.matchAll(importPattern)].some((match) =>
    match[1].split(',').some((name) => /^test(?:\s+as\s+\w+)?$/.test(name.trim()))
  );
}

function findProblems(source: string): Problem[] {
  const problems: Problem[] = [];
  if (importsTest(source, PLAYWRIGHT_VALUE_IMPORT)) problems.push('imports test from @playwright/test');
  if (!importsTest(source, SHARED_VALUE_IMPORT)) problems.push('does not import test from fixtures/test');
  return problems;
}

function listSpecFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSpecFiles(full, out);
    else if (entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('E2E shared mock-layer guard', () => {
  const files = listSpecFiles(E2E_DIR);

  it('scans the E2E specs (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it('every spec imports test from fixtures/test and never from @playwright/test', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
      return findProblems(fs.readFileSync(file, 'utf8')).map((problem) => `${rel}: ${problem}`);
    });

    expect(offenders).toEqual([]);
  });

  describe('findProblems', () => {
    it('accepts the shared fixture import, with or without a type import from @playwright/test', () => {
      expect(findProblems(`import { test, expect } from './fixtures/test';`)).toEqual([]);
      expect(
        findProblems(`import type { Page } from '@playwright/test';\nimport { test, expect } from '../fixtures/test';`)
      ).toEqual([]);
    });

    it('flags a raw value import of test, renamed or not', () => {
      expect(findProblems(`import { test, expect } from '@playwright/test';`)).toEqual([
        'imports test from @playwright/test',
        'does not import test from fixtures/test',
      ]);
      expect(
        findProblems(`import { expect, test as base } from '@playwright/test';\nimport { test } from './fixtures/test';`)
      ).toEqual(['imports test from @playwright/test']);
    });

    it('does not count an inline type-only name as a value import', () => {
      expect(
        findProblems(`import { expect, type TestInfo } from '@playwright/test';\nimport { test } from './fixtures/test';`)
      ).toEqual([]);
    });

    it('flags a spec with no shared fixture import', () => {
      expect(findProblems(`import { expect } from '@playwright/test';`)).toEqual(['does not import test from fixtures/test']);
    });
  });
});
