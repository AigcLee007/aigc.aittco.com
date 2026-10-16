import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Build output, git worktrees, patch snapshots and scratch output are not part of the suite.
    exclude: [
      ...configDefaults.exclude,
      'dist/**',
      'output/**',
      'storage/**',
      '.worktrees/**',
      '.codex-chrome-profile*/**',
      '.playwright-cli/**',
    ],
    // Server-side suites require large CJS modules (server.cjs) and exceed 5s under a full parallel run.
    testTimeout: 20000,
  },
});
