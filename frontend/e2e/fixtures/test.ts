import { test as base, expect } from '@playwright/test';

import { assertNoUnmockedRequests, installApiMocks, type UnmockedAllowPattern } from './mock-api';

// The ONE `test` every spec imports (docs/plans/testing-strategy-refresh-plan.md
// PR B; CKQ's e2e/fixtures/auth.ts pattern). Before each test it installs the
// loud-fail API mock layer (./mock-api.ts); after the test body it fails the
// test if any request reached no mock rule. Enforced by
// lib/__tests__/guards/e2eMockLayerGuard.test.ts.
type Options = {
  /** Requests a test deliberately lets go unmocked — substring or RegExp of the URL. */
  allowUnmocked: UnmockedAllowPattern[];
};

export const test = base.extend<Options>({
  allowUnmocked: [[], { option: true }],
  page: async ({ page, allowUnmocked }, use) => {
    await installApiMocks(page, allowUnmocked);
    await use(page);
    assertNoUnmockedRequests(page);
  },
});

export { expect };
