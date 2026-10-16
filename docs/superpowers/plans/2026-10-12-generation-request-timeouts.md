# Generation Request Timeouts Implementation Plan

**Goal:** Stop indefinite browser waiting and preserve edit task results for recovery and diagnosis.

**Architecture:** Bound fetch and response parsing, end local polling at an independent deadline, present elapsed time for image tasks, and reuse generation record persistence in the edit endpoint.

**Tech Stack:** TypeScript, React Query, classic JavaScript, Node.js, Vitest and node:test.

- [x] Add regression cases to `services/api.test.ts`, `classicTaskTimeout.test.cjs`, `src/hooks/useGlobalPolling.test.tsx`, and `server.image-edit-records.test.cjs`. Run targeted tests and verify failures reproduce hangs or missing records.
- [x] Add `src/utils/fetchWithTimeout.ts`; use it for image submission and image/video task queries in `services/api.ts`. Apply equivalent bounded fetch+JSON to classic submit and poll; add a total polling deadline and ignore late responses.
- [x] Correct success-without-image handling and add an image polling deadline in `src/hooks/useGlobalPolling.ts`. Store generation start time in `types.ts` and `src/hooks/useGenerationLogic.ts`.
- [x] In `components/CanvasNode.tsx`, present image submission/confirmed-task waiting with elapsed time; retain the existing video progress display.
- [x] In `server.cjs`, persist edit generation records before dispatch, attach task IDs, and persist final success/failure for background, direct and upstream async paths.
- [x] Add `scripts/diagnose-image-task.cjs`, limited to parameterized SELECT queries and redacted diagnostic output. Document rollout and the known charge ID in `docs/generation-timeout-rollout.md`.
- [x] Run regression suites, relevant existing tests, JavaScript syntax checks, `npm run build`, and `git diff --check`. Review changes and document deployment status.

Execute locally in the task branch. Production rollout needs server access and is a separate final operation after the patch is concrete and verified.

Validation: 8 Node regression tests and 32 Vitest tests passed; production build, TypeScript noEmit, syntax checks and diff whitespace checks passed. Source package: storage/patches/generation-timeout-fix-2026-10-12.zip. Production rollout and original-task database diagnosis remain pending server access.
