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
  // Every source file counts toward coverage, including ones no test renders
  // — otherwise an untested file is invisible rather than 0%
  // (docs/plans/testing-strategy-refresh-plan.md PR A).
  collectCoverageFrom: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', '!**/__tests__/**', '!**/*.d.ts'],
  coverageReporters: ['text-summary', 'text', 'lcov'],
  // A floor, not a target (docs/TESTING_STRATEGY.md "Coverage Expectations").
  // Applies only when --coverage runs (npm run test:coverage, the CI coverage job).
  coverageThreshold: { global: { statements: 80 } },
};

module.exports = createJestConfig(customJestConfig);
