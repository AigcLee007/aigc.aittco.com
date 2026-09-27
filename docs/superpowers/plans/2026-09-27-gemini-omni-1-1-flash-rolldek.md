# Gemini Omni 1.1 Flash RollDek 视频接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active video catalog with RollDek Gemini Omni 1.1 Flash, support ordered first/last frame images plus one reference video, and charge a fixed 20 points per generation.

**Architecture:** Keep the existing internal `/api/video/generate` contract and dynamic catalog UI. Add a RollDek request adapter at `videoRequestPolicy.cjs`, extend route metadata with an authenticated content path, normalize RollDek task status/result URLs, and retain historical models/routes as inactive records.

**Tech Stack:** Node.js CommonJS server, Express, Axios, MySQL, React, TypeScript, Zustand, Vitest.

---

### Task 1: Lock the catalog and request contract with failing tests

**Files:** `videoRequestPolicy.test.cjs`, `src/config/videoModels.test.ts`, `pixelhubVideoMigration.test.cjs`, `services/videoService.test.ts`

- [ ] **Step 1: Replace active IDs in test fixtures.** Use only `gemini-omni-1.1-flash` and `gemini-omni-1.1-flash-line1` as active targets. Change the client polling expectation from `12_000` to `15_000`.

- [ ] **Step 2: Add the frame/video mapping expectation.** Add this policy test before implementation:

```js
const result = request({
  prompt: 'cinematic transition',
  aspectRatio: '16:9',
  resolution: '720p',
  duration: 5,
  referenceImages: ['https://app.test/first.jpg', 'https://app.test/last.jpg'],
  referenceVideos: ['https://app.test/reference.mp4'],
}, 'gemini-omni-1.1-flash');

assert.strictEqual(result.pointCost, 20);
assert.deepStrictEqual(result.upstreamBody, {
  model: 'gemini-omni-1.1-flash',
  prompt: 'cinematic transition',
  first_frame_url: 'https://app.test/first.jpg',
  last_frame_url: 'https://app.test/last.jpg',
  videos: ['https://app.test/reference.mp4'],
  aspect_ratio: '16:9',
  duration: 5,
  resolution: '720p',
  generateAudio: true,
  n: 1,
});
assert.ok(!('images' in result.upstreamBody));
assert.ok(!('image_urls' in result.upstreamBody));
assert.ok(!('video_urls' in result.upstreamBody));
```

- [ ] **Step 3: Add boundary tests.** Verify three images, two videos, and duration 4 are rejected; one image maps only to `first_frame_url`; two images map in upload order; two images plus one video is accepted.

- [ ] **Step 4: Update catalog/migration assertions.** Assert fixed `selectorCost === 20`, `pricingMode === 'fixed'`, `baseUrl === 'https://rolldek.com'`, and `contentPath === '/v1/videos/{taskId}/content'`.

- [ ] **Step 5: Run the focused tests and confirm they fail.** Run `npx vitest run services/videoService.test.ts src/config/videoModels.test.ts` and `node --test videoRequestPolicy.test.cjs pixelhubVideoMigration.test.cjs`. Expected failures are old IDs, old field mapping, old billing, old polling interval, and missing content path.

### Task 2: Replace the static video catalogs

**Files:** `config/videoModels.json`, `config/videoRoutes.json`, `config/pixelhubVideoCatalog.json`

- [ ] **Step 1: Add the new model.** Set `defaultModelId` to `gemini-omni-1.1-flash` and add an active/default model with `selectorCost: 20`, `pricingMode: 'fixed'`, `pointCostPerSecond: 0`, `maxReferenceImages: 2`, `maxReferenceVideos: 1`, `maxTotalReferences: 3`, `referenceImageMode: 'frames'`, `supportsVideoReference: true`, `referenceLabels: ['首帧', '尾帧']`, aspect ratios `['16:9', '9:16']`, resolution `['720p']`, and duration `['5']`.

- [ ] **Step 2: Add the new route.** Set `defaultRouteId` to `gemini-omni-1.1-flash-line1` and add an active/default route with `baseUrl: 'https://rolldek.com'`, `generatePath: '/v1/videos'`, `taskPath: '/v1/videos/{taskId}'`, `contentPath: '/v1/videos/{taskId}/content'`, `upstreamModel: 'gemini-omni-1.1-flash'`, `apiKeyEnv: 'ROLL_VEDIO_OMNI_KEY'`, and `pointCost: 20`.

- [ ] **Step 3: Deactivate historical entries.** Keep old entries in `videoModels.json` and `videoRoutes.json`, but set their active/default flags to false. Make `pixelhubVideoCatalog.json` contain only the new model and route so the server allowlist rejects old IDs.

- [ ] **Step 4: Run catalog tests.** Run `npx vitest run src/config/videoModels.test.ts` and `node --test pixelhubVideoMigration.test.cjs`.

### Task 3: Implement frame mapping and fixed billing

**Files:** `videoRequestPolicy.cjs`, `videoModelStore.cjs`, `videoRequestPolicy.test.cjs`

- [ ] **Step 1: Make frame/video validation capability-aware.** Replace the unconditional frame-mode video rejection with:

```js
if (
  model.referenceImageMode === 'frames' &&
  videos.length > 0 &&
  model.supportsVideoReference !== true
) {
  throw badRequest('reference videos are not supported by the selected model');
}
```

- [ ] **Step 2: Add the RollDek mapping branch.** For `expectedModel === 'gemini-omni-1.1-flash'`, map `images[0]` to `first_frame_url`, `images[1]` to `last_frame_url`, `videos` to `videos`, and add `generateAudio: true` and `n: 1`. Do not emit generic `images` or legacy `image_urls`/`video_urls`.

- [ ] **Step 3: Honor model pricing mode.** Replace duration-only billing with:

```js
const pointCost = toNonNegativePoint(
  model.pricingMode === 'per_second'
    ? duration * Number(model.pointCostPerSecond || 0)
    : Number(model.selectorCost || 0),
  0,
);
```

- [ ] **Step 4: Allow `frames + supportsVideoReference`.** Remove the unconditional management error from `normalizeManagedVideoModelInput`; request validation remains responsible for models that do not support videos.

- [ ] **Step 5: Run policy tests.** Run `node --test videoRequestPolicy.test.cjs` and expect all mapping, combined-reference, limit, duration, and fixed-cost tests to pass.

### Task 4: Add `contentPath` to route types, MySQL, admin payloads, and migration

**Files:** `src/config/videoRoutes.ts`, `videoRouteStore.cjs`, `src/services/videoRouteAdminService.ts`, `pixelhubVideoMigration.cjs`, `pixelhubVideoMigration.test.cjs`

- [ ] **Step 1: Extend route types and normalizers.** Add optional `contentPath?: string` beside `taskPath` in the TypeScript interface and normalize it as a trimmed optional string. Add matching `content_path` mapping in static and database row conversion.

- [ ] **Step 2: Extend the MySQL schema safely.** Add `content_path VARCHAR(255) NULL` to `CREATE TABLE IF NOT EXISTS video_routes`. After table creation, add the column for existing installations with a guarded `ALTER TABLE`; rethrow every error except duplicate-column errors.

```js
try {
  await pool.execute(
    'ALTER TABLE video_routes ADD COLUMN content_path VARCHAR(255) NULL AFTER task_path',
  );
} catch (error) {
  if (!/duplicate column/i.test(String(error?.message || ''))) throw error;
}
```

- [ ] **Step 3: Extend managed route CRUD.** Accept `contentPath` in validation, insert/update SQL, `AdminVideoRoutePayload`, and admin responses. Empty content paths remain valid for historical routes.

- [ ] **Step 4: Extend `pixelhubVideoMigration.cjs`.** Add `content_path` to route insert/update columns and pass `route.contentPath || null`. Assert column, placeholder, and parameter counts remain aligned.

- [ ] **Step 5: Run migration tests.** Run `node --test pixelhubVideoMigration.test.cjs`.

### Task 5: Normalize RollDek status, result URLs, and authenticated content playback

**Files:** `server.cjs`, `services/videoService.ts`, `src/services/videoService.ts`, `services/videoService.test.ts`

- [ ] **Step 1: Recognize `in_progress`.** Add `in_progress` to both client polling status lists; it remains nonterminal.

- [ ] **Step 2: Add local content URL normalization.** Add a helper that returns `/api/video/task/${encodeURIComponent(taskId)}/content`. When a successful response has `metadata.url` or an equivalent nested URL and the route has `contentPath`, attach local `video_url` and `url` fields before returning the response and recording result URLs.

- [ ] **Step 3: Add `GET /api/video/task/:taskId/content`.** Require billing, decode the local task token, load the route with secrets, require `contentPath`, build the upstream URL from the configured template, send route Authorization, forward `Range`, and stream content headers/body without accepting an arbitrary URL query parameter.

- [ ] **Step 4: Expand client URL extraction.** In both video services, read `video_url`, `url`, `metadata.url`, `data.output`, and `data.metadata.url`, with the server-provided local `video_url` taking precedence.

- [ ] **Step 5: Set 15-second polling.** Set `VIDEO_POLL_INTERVAL_MS = 15_000`, retain the 30-minute deadline, and update recovery polling behavior.

- [ ] **Step 6: Add tests for `in_progress`, metadata URLs, local URL precedence, and the 15-second constant.** Run `npx vitest run services/videoService.test.ts`.

### Task 6: Update UI labels and fixed-cost presentation

**Files:** `components/ControlPanel.tsx`, `components/VideoFormConfig.tsx`, `src/config/videoModels.ts`, `src/store/selectionStore.ts` if stale persistence needs migration

- [ ] **Step 1: Label the frame strip.** When the selected video model uses `referenceImageMode === 'frames'`, change the video reference header from `参考图` to `首尾帧` and use `referenceLabels` for thumbnail labels. Preserve drag ordering: index 0 is 首帧 and index 1 is 尾帧.

- [ ] **Step 2: Keep the existing video upload control.** Verify `supportsVideoReference: true` renders the current upload control with one-video and three-total-reference limits. Do not add audio UI.

- [ ] **Step 3: Verify fixed cost display.** Confirm `getVideoModelDisplayCost` returns `selectorCost` for fixed pricing so the UI shows `预计 20 金币`.

- [ ] **Step 4: Handle stale persisted selections.** Ensure disabled historical model/route selections fall back to the new default without deleting generation records.

- [ ] **Step 5: Run UI/config tests.** Run `npx vitest run src/config/videoModels.test.ts src/utils/videoSelectionMigration.test.ts`.

### Task 7: Apply and verify the database catalog migration

**Files:** no additional source files; use the completed catalog and migration code

- [ ] **Step 1: Run the complete local suite.** Run `npm test`. Expected: one active model and route, and all policy, migration, client, and UI tests pass.

- [ ] **Step 2: Configure the production secret without printing its value.** Ensure the deployment environment contains `ROLL_VEDIO_OMNI_KEY`.

- [ ] **Step 3: Apply the migration.** Run `npm run migrate:pixelhub-video`.

- [ ] **Step 4: Verify runtime catalogs.** Query `/api/video-models/catalog` and `/api/video-routes/catalog`; expect exactly one active/default model and route, fixed cost 20, RollDek paths, and the content path.

### Task 8: Run RollDek smoke tests and final verification

**Files:** no source changes

- [ ] **Step 1: Submit text-to-video.** Use 5 seconds, no references, and verify model, 720p, ratio, `generateAudio: true`, `n: 1`, and a 20-point reservation.

- [ ] **Step 2: Submit first-frame-only and first/last-frame requests.** Verify one image maps only to `first_frame_url`; two images map in upload order to the two frame fields.

- [ ] **Step 3: Submit two frames plus one video.** Verify both frame fields and `videos` are present and exactly 20 points are charged.

- [ ] **Step 4: Verify polling and playback.** Confirm `queued`/`in_progress` continue, `completed` resolves to the local content URL, and Canvas plays through `/api/video/task/:taskId/content`.

- [ ] **Step 5: Verify refunds and disabled models.** Confirm failed tasks refund 20 points and historical model IDs are rejected before upstream generation.

- [ ] **Step 6: Review the final diff.** Run `git diff --check`, `git status --short`, and `git diff --stat`; only planned implementation files/tests should be changed, while local preview folders remain untracked and unadded.
