const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  // jest-environment-jsdom defaults to the "browser" package-export
  // condition, which msw's package.json deliberately maps to `null` for
  // the `msw/node` subpath (it's a Node-only entry point) — causing
  // "Cannot find module 'msw/node'" even though the module exists.
  // Clearing customExportConditions falls back to the "node"/"default"
  // conditions so msw/node resolves correctly.
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
  // Jest's default testMatch also matches **/*.spec.ts, which would pick
  // up frontend/e2e/*.spec.ts (the Playwright suite — @playwright/test's
  // `test`/`expect`, not Jest's) and fail badly. Found while building
  // that suite, not assumed — see docs/plans/e2e-testing-plan.md.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/e2e/'],
};

module.exports = createJestConfig(customJestConfig);
