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
};

module.exports = createJestConfig(customJestConfig);
