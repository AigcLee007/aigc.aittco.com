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
      // These suites use node:test directly and run via npm run test:node.
      'operationsDashboardStore.test.cjs',
      'operationsRuntimeMetrics.test.cjs',
      'operationsDashboard.test.cjs',
      'server.admin-operations.test.cjs',
      'operationsDeployment.test.cjs',
      'appVersion.test.cjs',
      'imageCatalogInitialization.test.cjs',
      'imageRouteResolution.test.cjs',
      'productionImageRouteConfig.test.cjs',
      'classicImageJobs.test.cjs',
      'imageHistoryRetention.test.cjs',
      'imageJobAssets.test.cjs',
      'imageJobService.test.cjs',
      'server.image-jobs.test.cjs',
      'server.native-image-results.test.cjs',
      'scripts/repair-inline-image-result.test.cjs',
      'public/classic-app/gallery-stability.test.cjs',
      'public/classic-app/result-assets.test.cjs',
    ],
    // Server-side suites require large CJS modules (server.cjs) and exceed 5s under a full parallel run.
    testTimeout: 20000,
  },
});
