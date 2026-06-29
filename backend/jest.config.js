/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],

  collectCoverageFrom: [
    '**/*.service.ts',
    '**/*.guard.ts',
    '**/*.controller.ts',
    '**/*.filter.ts',
    '**/task-invariants.ts',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/test-utils/**',
  ],
  coverageDirectory: '../coverage',

  // docs/07 §1: ≥ 80% lines / 75% branches overall;
  // RBAC, AuthService, TaskService, BudgetService must be ≥ 90% lines.
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 75,
    },
    './rbac/rbac.service.ts': { lines: 90 },
    './auth/auth.service.ts': { lines: 90 },
    './tasks/tasks.service.ts': { lines: 90 },
    './budget/budget.service.ts': { lines: 90 },
  },

  testTimeout: 60_000,
};
