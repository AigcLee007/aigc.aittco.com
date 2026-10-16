# Canvas Generation Progress Implementation Plan

> **For agentic workers:** Execute this approved plan inline with test-driven-development and verification-before-completion. Keep the existing uncommitted timeout/cache changes intact.

**Goal:** Restore canvas progress bars and percentages with truthful status and elapsed time.

**Architecture:** Normalize reported progress in one utility and derive estimated display from the persisted start time. A shared one-second display clock updates only active views; task polling writes only actual upstream changes. Both canvas nodes and tooltips consume the same view model.

**Tech Stack:** React 19, TypeScript, React Query, Zustand, react-konva, Vitest, Playwright.

### Task 1: Progress model and regression cases

Files: `src/utils/generationProgress.ts`, `src/utils/generationProgress.test.ts`, `types.ts`.

- [x] Add failing cases for nested `progress: '65%'`, placeholder 0/100, invalid values, source selection, elapsed time, queue text, long waiting, error and usable-success handling.
- [x] Run `npm test -- src/utils/generationProgress.test.ts` and confirm failure before implementation.
- [x] Implement `readTaskProgress(payload): number | undefined` and `getGenerationProgress(node, now, fallbackStartedAt)` returning `{percent, percentLabel, statusText, elapsedLabel}`.
- [x] Add optional `progressSource: 'reported' | 'estimated'` and `generationStatus` to NodeData. Estimated values use `Math.min(95, Math.floor(1 + 95 * (1 - Math.exp(-elapsedMs / 90000))))` and never decide task completion.

### Task 2: Task updates and persistence

Files: `src/hooks/useGlobalPolling.ts`, `src/hooks/useGlobalPolling.test.tsx`, `src/hooks/useGenerationLogic.ts`, `src/store/canvasStore.ts`, `src/store/canvasStore.progress.test.ts`.

- [x] Extend polling cases: same-status progress 25 → 65, repeated identical progress, nested queue status, multiple nodes sharing one task, failed 100, success without an image, expired tasks with late data.
- [x] Run polling tests and confirm new behavior fails.
- [x] Invoke the progress callback with a `reported` source only for nonterminal intermediate values. Store task status only when changed, include progress in effect dependencies, and ignore updates after task settlement.
- [x] Preserve reported monotonic values and prevent legacy simulated video callbacks from replacing them. Mark a valid completed result as 100; clear stale progress on errors.
- [x] Add persistence regressions and retain valid reported progress/source/status alongside the existing start timestamp; estimated ticks are never stored.

### Task 3: Shared display and UI

Files: `src/hooks/useGenerationProgress.ts`, `src/hooks/useGenerationProgress.test.tsx`, `components/CanvasNode.tsx`, `components/InfiniteCanvas.tsx`.

- [x] Add failing hook cases: two subscribers share one interval, disabled/completed views do not tick, remount resumes elapsed progress, last unsubscribe clears interval.
- [x] Implement a lazy shared one-second clock with `useSyncExternalStore`; derive display with the utility from Task 1.
- [x] Replace per-node simulation with the shared hook. Render progress, bar, status and elapsed together using dimensions that fit square, portrait and wide placeholders. Keep resource/error handling intact and localize image loading text.
- [x] Use the same hook in SmartTooltip and resolve its node from the latest nodes array, so hover data changes with polling.

### Task 4: Verification and review

- [x] Run the new utility/hook/polling/store suites and relevant API/image asset suites.
- [x] Run `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- [x] Verify real browser rendering for estimated/reported/queued/long-wait/error states, different aspect ratios, tooltip updates, pan away/back and reload. Use mocked local task results without paid generation.
- [x] Request a focused read-only code review, address material findings, and rerun checks affected by changes.
- [x] Record results here and deliver the local implementation with a screenshot.

### Additional integration from review

- [x] Share a bounded legacy timestamp origin between node, tooltip and persistence so delayed hover and remount do not restart elapsed time; add regression cases.
- [x] Forward accepted/queued/processing status and reported progress from the existing internal video and batch image polling paths. Wire ControlPanel and BatchProcessModal callbacks without adding a second poller.
- [x] Remove internal simulated progress ticks; persist status changes and increasing reported progress only. Add video, batch and generation logic regression cases.

### Verification evidence (2026-10-16)

- `npm test -- --maxWorkers=2`: 52 test files passed, 1 skipped; 248 tests passed, 4 skipped. An earlier run alongside the production build timed out importing the server in an unrelated admin test; this full run passed with no build competing for resources.
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0, 2396 modules, built in 1m 17s. Existing environment, CSS, browserslist and bundle-size warnings remain.
- `git diff --check`: passed for changed tracked files.
- Playwright: reported 65 → 78 updates both node and open tooltip, estimated/queued/long-wait/video/error labels render, pan preserves elapsed time, reload restores reported 78 and estimated progress, success replaces placeholder with an actual Konva image. Display-only clock produced 0 store writes; 0 page errors.
- Browser fixtures intercepted API requests locally; no paid generation used. Screenshot: `output/playwright/canvas-generation-progress.png`; machine-readable report: `output/playwright/canvas-progress-verification.json`.
- Focused review: both P2 findings addressed, follow-up found no new material issues; reviewer independently reran 13 related tests successfully.
- Local implementation only; no commit, push or deployment performed.
