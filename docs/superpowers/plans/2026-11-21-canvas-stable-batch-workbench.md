# Canvas Stability and Batch Workbench Implementation Plan

> **For agentic workers:** Execute this approved plan inline, task by task. Use the test-driven-development skill for every behavior change.

**Goal:** Keep existing canvas node coordinates stable while adding a persistent batch workbench for model-aware text-to-image and image-to-image generation.

**Architecture:** Add a pure placement planner and contain-fit geometry helper, then route all new canvas placeholders through that planner. Add an IndexedDB-backed batch manifest and an app-lifetime coordinator that uses the existing image job APIs, recovery IDs, model catalogs, and polling. Replace the legacy batch modal with a full-screen workbench that edits and resumes batch records.

**Tech Stack:** React 19, TypeScript, Zustand, Konva, idb-keyval, Vitest, fake-indexeddb.

---

## Working Baseline

The implementation uses the current `feature/canvas-sidebar` checkout because the approved design depends on in-progress changes in `components/BatchProcessModal.tsx`, `components/InfiniteCanvas.tsx`, `src/hooks/useGenerationLogic.ts`, `src/hooks/useGlobalPolling.ts`, and `src/store/canvasStore.ts`.

Baseline verification before implementation

- `npx vitest run src/hooks/useGenerationLogic.progress.test.tsx src/hooks/useGlobalPolling.jobs.test.tsx src/hooks/useGlobalPolling.recovery.test.tsx src/store/canvasStore.progress.test.ts src/services/imageJobClient.test.ts` passed 34 tests.
- `npm run build` passed. Existing warnings mention a malformed generated CSS selector, a dynamic/static import of `canvasStore.ts`, and a large JS chunk.

## Task 1: Canvas Placement Planner

**Files:**
- Create `src/utils/canvasPlacement.ts`
- Create `src/utils/canvasPlacement.test.ts`
- Reuse `Point` from `types.ts`

- [ ] Write tests first for a deterministic spiral placement order, collision avoidance against existing image/video rectangles, collision avoidance among new rectangles, mixed aspect ratios, and unchanged input nodes.
- [ ] Run `npx vitest run src/utils/canvasPlacement.test.ts` and verify the missing planner causes the expected failures.
- [ ] Implement `findCanvasFreePositions(existingRects, requestedSizes, anchor, gap = 20)` as a pure function. Candidate offsets begin at the anchor, then scan right, down, left, and up in expanding rings. Each requested rectangle uses its own width and height to derive scan spacing. Append each allocated rectangle to the occupied set before planning the next one.
- [ ] Run the focused test and verify all placement cases pass.

Expected public types

```ts
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export function findCanvasFreePositions(
  occupied: CanvasRect[],
  requested: CanvasSize[],
  anchor: Point,
  gap?: number,
): Point[];
```

## Task 2: Stable Placeholder Creation and Image Fit

**Files:**
- Create `src/utils/canvasImageFit.ts`
- Create `src/utils/canvasImageFit.test.ts`
- Modify `src/hooks/useGenerationLogic.ts`
- Modify `components/CanvasNode.tsx`
- Modify `src/hooks/useGenerationLogic.progress.test.tsx`
- Modify `src/services/imageAssets.test.ts`

- [ ] Write contain-fit tests for equal, landscape-in-square, and portrait-in-landscape dimensions. A 16:9 image inside a 512 by 512 frame must return a centered 512 by 288 draw rectangle.
- [ ] Write a generation-hook test with two existing nodes at manually moved coordinates. Initializing a new image must preserve both coordinates and place the new node in a non-overlapping location.
- [ ] Write a test proving one initialization call applies one canvas transform for a multi-output request.
- [ ] Update the existing asset completion test so a 720 by 405 returned image does not change a 512 by 512 requested frame.
- [ ] Run the focused tests and verify they fail on the current reflow and height-adjustment behavior.
- [ ] Replace `arrangeNodes(allNodes, ...)` in `handleInitGenerations` with `findCanvasFreePositions` applied only to new nodes. Compute a viewport-centered canvas anchor from the current offset and scale. Preserve `arrangeNodes` for the explicit toolbar action in `useCanvasOperations.ts`.
- [ ] Keep automatic centering to one call after all requested placeholders have positions.
- [ ] Remove the asynchronous natural-height mutation from `handleUpdateGeneration`. Keep the requested frame dimensions for the lifetime of that node.
- [ ] Draw the source image centered with contain-fit geometry inside the existing clip group in `CanvasNode`. Preserve mask alignment against the frame and use the frame background for any letterboxing.
- [ ] Run `npx vitest run src/utils/canvasPlacement.test.ts src/utils/canvasImageFit.test.ts src/hooks/useGenerationLogic.progress.test.tsx src/services/imageAssets.test.ts`.

Expected fit helper

```ts
export function fitImageInFrame(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): CanvasRect;
```

## Task 3: Batch Records and IndexedDB Store

**Files:**
- Create `src/services/batchGenerationTypes.ts`
- Create `src/services/batchGenerationStore.ts`
- Create `src/services/batchGenerationStore.test.ts`
- Reuse `assetStorage` from `src/services/assetStorage.ts`
- Reuse account ownership helpers from `src/services/imageJobClient.ts` and `src/services/accountIdentity.ts`

- [ ] Write store tests for creating, updating, listing, and deleting owner-scoped batches using `fake-indexeddb/auto`.
- [ ] Write tests that update one task without replacing sibling tasks and that reject records with a mismatched owner ID.
- [ ] Run `npx vitest run src/services/batchGenerationStore.test.ts` and verify the missing store causes expected failures.
- [ ] Add batch settings for mode, model ID, route ID, aspect ratio, image size, default output count, concurrency, and auto-download preference.
- [ ] Add input groups for prompt rows and reference-image groups. Expand each requested output into an independently retryable task with stable client request ID, output index, optional canvas node ID, service task ID, result URL, status, and error.
- [ ] Persist one complete batch record per IndexedDB key in a dedicated store. Store reference images through `assetStorage.storeBlob` and persist only asset IDs in batch records.
- [ ] Implement owner-scoped `createBatch`, `getBatch`, `listBatches`, `putBatch`, and `deleteBatch` operations with record validation and schema versioning.
- [ ] Run the focused store tests and verify owner isolation and task-level updates.

## Task 4: Route-Aware Batch Request Construction

**Files:**
- Create `src/services/batchImageRequest.ts`
- Create `src/services/batchImageRequest.test.ts`
- Reuse `buildGptImagePayload` from `src/utils/gptImagePayload.ts`
- Reuse `generateImageApi`, `editImageApi`, and `generateGeminiImage` from `services/api.ts`
- Reuse edit capability helpers from `src/config/imageEditCapabilities.ts`
- Reuse reference conversion from `src/services/imageAssetCache.ts` and `src/services/imageBlobUtils.ts`

- [ ] Write payload tests for generic text-to-image, native Gemini text-to-image, single-reference edit, GPT/Seedream edit, Grok references, Doubao references, and legacy collage references. Tests must assert the actual route ID, model ID, output count, input image fields, and `clientLiveTaskIds`.
- [ ] Run `npx vitest run src/services/batchImageRequest.test.ts` and verify the request builder is missing.
- [ ] Extract the route-specific request branch behavior currently embedded in `components/ControlPanel.tsx` into typed helpers. Keep the main generation path behavior unchanged by using those helpers from both callers.
- [ ] Provide a single async function that accepts one durable batch task and its settings snapshot, submits exactly one output request, and normalizes direct image results or managed task IDs.
- [ ] Keep native Gemini sync routing on `/gemini/generate`, GPT/Seedream edit on `/edit`, and model-specific Grok, Doubao, and legacy multi-reference payload shapes consistent with current ControlPanel behavior.
- [ ] Run `npx vitest run src/services/batchImageRequest.test.ts components/ControlPanel.access.test.tsx src/config/imageModels.catalog.test.ts`.

## Task 5: Batch Queue Coordinator and Recovery

**Files:**
- Create `src/services/batchGenerationCoordinator.ts`
- Create `src/services/batchGenerationCoordinator.test.ts`
- Create `src/hooks/useBatchGeneration.ts`
- Create `src/hooks/useBatchGeneration.test.tsx`
- Reuse `src/services/imageJobRequests.ts` and `src/services/imageJobClient.ts`
- Reuse canvas callbacks from `src/hooks/useGenerationLogic.ts`

- [ ] Write coordinator tests for a concurrency limit of 1, 3, and 6; pausing stops future dispatch while active tasks settle; resume dispatches pending tasks only; failed-only retry leaves successful tasks untouched.
- [ ] Write recovery tests proving the same `clientRequestId` is reused after a lost acknowledgement and the original task is queried before any retry POST.
- [ ] Run the focused tests and verify the coordinator is missing.
- [ ] Implement a coordinator whose lifetime is owned by the app-level hook, not by the visible workspace screen. The hook loads owner-scoped batches on startup and persists every task transition.
- [ ] Mark tasks `submitting` before the API call, `awaiting-confirmation` for ambiguous transport failures, `queued` or `running` after task admission, and `succeeded` or `failed` after completion.
- [ ] On resume, query tasks in `submitting`, `awaiting-confirmation`, `queued`, or `running` state using their stored request/task IDs before deciding whether to resubmit.
- [ ] Handle `USER_QUEUE_FULL` as a retained pending task with an explanation. Do not discard it or retry automatically in a tight loop.
- [ ] Store each task's canvas node IDs in the batch record. Create all placeholders through a new batch initialization callback before dispatch, so the canvas planner reserves positions once and the viewport is focused once.
- [ ] Add global batch state to `App.tsx` or an app-level provider, so hiding the workbench does not stop the current run. Account change pauses dispatch and prevents cross-account task updates.
- [ ] Run `npx vitest run src/services/batchGenerationCoordinator.test.ts src/hooks/useBatchGeneration.test.tsx src/services/imageJobClient.test.ts src/hooks/useGlobalPolling.recovery.test.tsx`.

## Task 6: Full-Screen Batch Workbench

**Files:**
- Create `components/BatchWorkspace.tsx`
- Create `components/BatchWorkspace.test.tsx`
- Modify `src/layouts/ModalsContainer.tsx`
- Modify `App.tsx`
- Delete `components/BatchProcessModal.tsx` after the new view is integrated
- Delete `src/utils/batchProcessor.ts` after confirming it has no other callers
- Reuse `src/utils/fileParser.ts`, `src/config/imageModels.ts`, `src/config/imageRoutes.ts`, and `src/config/imageEditCapabilities.ts`

- [ ] Write UI tests for opening the workspace, switching T2I/I2I modes, editing task rows, showing model/route choices, calculating the batch total, pausing, retrying a failed task, and reopening persisted batch state.
- [ ] Run `npx vitest run components/BatchWorkspace.test.tsx` and verify the new component is missing.
- [ ] Build a three-region full-screen view with batch navigation, a task table, and a configuration panel. Keep the existing toolbar entry and return-to-canvas action.
- [ ] For T2I, show file parsing preview with Excel sheet/column selection and editable prompt rows. Each row supports a prompt and output count.
- [ ] For I2I, show reference rows with a shared prompt default, per-image prompt/output overrides, and a grouped-reference mode that binds selected images into one task.
- [ ] Use active model catalogs. T2I options use active image models and compatible routes. I2I options use `getEditableImageModels` and `getEditableRoutesForModel`, respecting direct-key access.
- [ ] Show aspect ratio, route-supported image size, output count, concurrency, per-task point estimate, batch total, task state, result count, and error summary.
- [ ] Disable batch configuration after start. Allow editing or deselecting pending rows. Keep successful rows out of retry actions.
- [ ] Replace the modal wiring in `ModalsContainer.tsx` with `BatchWorkspace`, pass app-level controller methods from `App.tsx`, and keep the coordinator mounted while the workspace is closed.
- [ ] Remove old batch files only after a repository-wide reference search and tests confirm no remaining import.
- [ ] Run `npx vitest run components/BatchWorkspace.test.tsx src/services/batchGenerationStore.test.ts src/services/batchGenerationCoordinator.test.ts`.

## Task 7: Integration and Verification

**Files:**
- Modify focused tests only where behavior changed
- Verify the design acceptance criteria in `docs/superpowers/specs/2026-11-21-canvas-stable-layout-batch-workbench-design.md`

- [ ] Run `npx vitest run src/utils/canvasPlacement.test.ts src/utils/canvasImageFit.test.ts src/hooks/useGenerationLogic.progress.test.tsx src/services/imageAssets.test.ts src/services/batchGenerationStore.test.ts src/services/batchImageRequest.test.ts src/services/batchGenerationCoordinator.test.ts src/hooks/useBatchGeneration.test.tsx components/BatchWorkspace.test.tsx src/hooks/useGlobalPolling.recovery.test.tsx src/services/imageJobClient.test.ts`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build` and compare warnings with the recorded baseline.
- [ ] Run `npm run test:node` for API integration coverage of image-job admission and recovery.
- [ ] Verify a generated result with a different source aspect ratio stays fully visible in its fixed frame and does not change any existing node coordinates.
- [ ] Verify T2I and both I2I reference modes create the expected task counts and canvas result nodes.
- [ ] Verify pause, refresh, resume, queue-full, failed-only retry, and account-switch behavior without duplicate billed requests.

## Plan Self-Review

- Canvas coordinate stability and image fit map to Tasks 1 and 2.
- Persistent batch records, model filtering, per-row task state, request IDs, pause/resume, and account-aware recovery map to Tasks 3 through 6.
- T2I import parsing, I2I independent/grouped reference modes, cost estimate, and result-to-canvas linking map to Tasks 4 through 6.
- The final verification task covers the design acceptance criteria and existing user changes.
