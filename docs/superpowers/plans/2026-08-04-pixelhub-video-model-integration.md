# PixelHub Three-Model Video Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini Omni Flash, Sora V3 Pro, and Veo 3.1 Fast the only active video models, with capability-driven controls, independent PixelHub keys, exact reference-media payloads, and validated per-second billing.

**Architecture:** Extend the video model catalog so model capabilities are data rather than component-level model-ID checks. Add a pure server policy that validates an internal video request and constructs the PixelHub payload, plus a focused media materializer that converts browser image data into public URLs. Apply the catalog transition through an explicit idempotent migration rather than destructive startup behavior.

**Tech Stack:** React 19, Zustand, TypeScript 5.8, Express 5, CommonJS backend modules, MySQL 8, Axios, Vitest 4, Docker Compose.

---

## File Structure

### New files

- `config/pixelhubVideoCatalog.json`: authoritative definitions for the three active models and routes.
- `videoRequestPolicy.cjs`: pure capability validation, cost calculation, and PixelHub payload construction.
- `videoRequestPolicy.test.cjs`: server policy boundary and pricing tests.
- `videoReferenceMedia.cjs`: materialize image reference arrays and normalize uploaded video URLs.
- `videoReferenceMedia.test.cjs`: public URL and array materialization tests.
- `pixelhubVideoMigration.cjs`: pure migration operations and database transaction runner.
- `pixelhubVideoMigration.test.cjs`: migration definition, idempotency-shape, and history-table exclusion tests.
- `scripts/activate-pixelhub-video-models.cjs`: production CLI wrapper for the one-time migration.
- `src/utils/videoSelectionMigration.ts`: persisted Zustand state migration for resolution and reference videos.
- `src/utils/videoSelectionMigration.test.ts`: legacy-state migration tests.

### Modified files

- `config/videoModels.json`: retain legacy entries as inactive and activate the three target models.
- `config/videoRoutes.json`: retain legacy entries as inactive and activate the three PixelHub routes.
- `videoModelStore.cjs`: schema columns, row mapping, public model fields, and admin validation.
- `videoModelStore.test.cjs`: schema and row-shape regression coverage.
- `src/config/videoModels.ts`: capability types, normalization, and selectors.
- `src/config/videoModels.test.ts`: model capability and frame-label coverage.
- `server.cjs`: pre-billing policy enforcement, exact PixelHub body, route-family check, and 10-second polling compatibility.
- `videoFrameUpload.cjs`: reuse image parsing/storage primitives from the new media materializer.
- `services/videoService.ts`: send the internal request contract and poll every 10 seconds.
- `services/videoService.test.ts`: client request and polling contract tests.
- `src/store/selectionStore.ts`: explicit resolution and plural reference-video state.
- `components/VideoFormConfig.tsx`: capability-driven controls and multi-video upload list.
- `components/ControlPanel.tsx`: validate counts and submit the new internal request shape without `--ar`.
- `components/ContextSatellite/SatelliteLayer.tsx`: stop hard-coding the inactive legacy Veo model.
- `components/VideoPricingModal.tsx`: render active catalog pricing dynamically.
- `src/services/videoModelAdminService.ts`: admin capability payload fields.
- `components/MediaCatalogAdminPanel.tsx`: capability editor fields and validation.
- `.env.example`: document the three PixelHub key variables and `PUBLIC_BASE_URL`.
- `.env.bt.example`: document the same production variables.
- `Dockerfile`: copy the new runtime CommonJS modules.

## Task 1: Define The Authoritative PixelHub Catalog

**Files:**
- Create: `config/pixelhubVideoCatalog.json`
- Modify: `config/videoModels.json`
- Modify: `config/videoRoutes.json`
- Test: `src/config/videoModels.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Replace the mojibake-focused tests in `src/config/videoModels.test.ts` with catalog behavior tests that import both static catalogs:

```ts
import { describe, expect, it } from 'vitest';
import targetCatalog from '../../config/pixelhubVideoCatalog.json';
import modelCatalog from '../../config/videoModels.json';
import routeCatalog from '../../config/videoRoutes.json';

describe('PixelHub video catalog', () => {
  it('exposes only the three target models', () => {
    const activeIds = modelCatalog.models
      .filter((model) => model.isActive !== false)
      .map((model) => model.id);
    expect(activeIds).toEqual([
      'gemini-omni-flash',
      'sora-v3-pro',
      'veo31-fast',
    ]);
    expect(modelCatalog.defaultModelId).toBe('gemini-omni-flash');
  });

  it('keeps one independently keyed active route per target model', () => {
    const activeRoutes = routeCatalog.routes.filter(
      (route) => route.isActive !== false,
    );
    expect(activeRoutes.map((route) => route.apiKeyEnv)).toEqual([
      'PIXELHUB_GEMINI_OMNI_FLASH_KEY',
      'PIXELHUB_SORA_V3_PRO_KEY',
      'PIXELHUB_VEO31_FAST_KEY',
    ]);
    expect(activeRoutes.every((route) => route.baseUrl === 'https://api.pixellelabs.com')).toBe(true);
    expect(activeRoutes.every((route) => route.generatePath === '/v1/videos')).toBe(true);
    expect(activeRoutes.every((route) => route.taskPath === '/v1/videos/{taskId}')).toBe(true);
  });

  it('matches the migration source of truth', () => {
    expect(targetCatalog.models.map((model) => model.id)).toEqual([
      'gemini-omni-flash',
      'sora-v3-pro',
      'veo31-fast',
    ]);
    expect(targetCatalog.routes.map((route) => route.id)).toEqual([
      'gemini-omni-flash-line1',
      'sora-v3-pro-line1',
      'veo31-fast-line1',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- src/config/videoModels.test.ts
```

Expected: FAIL because `pixelhubVideoCatalog.json` does not exist and the old static catalogs expose legacy active models.

- [ ] **Step 3: Create the authoritative target catalog**

Create `config/pixelhubVideoCatalog.json` with this top-level shape and exact capability values:

```json
{
  "defaultModelId": "gemini-omni-flash",
  "defaultRouteId": "gemini-omni-flash-line1",
  "models": [
    {
      "id": "gemini-omni-flash",
      "label": "Gemini Omni Flash",
      "description": "PixelHub Gemini Omni Flash video generation",
      "modelFamily": "gemini-omni-flash",
      "routeFamily": "gemini-omni-flash",
      "requestModel": "gemini-omni-flash",
      "selectorCost": 4,
      "pricingMode": "per_second",
      "pointCostPerSecond": 1,
      "maxReferenceImages": 5,
      "maxReferenceVideos": 1,
      "maxTotalReferences": 6,
      "referenceImageMode": "style",
      "supportsVideoReference": true,
      "referenceLabels": [],
      "defaultAspectRatio": "16:9",
      "aspectRatioOptions": ["16:9", "9:16"],
      "defaultResolution": "720p",
      "resolutionOptions": ["720p", "1080p"],
      "defaultDuration": "4",
      "durationOptions": ["4", "6", "8", "10"],
      "promptMaxLength": null,
      "isActive": true,
      "isDefaultModel": true,
      "sortOrder": 0
    },
    {
      "id": "sora-v3-pro",
      "label": "Sora V3 Pro",
      "description": "PixelHub Sora V3 Pro video generation",
      "modelFamily": "sora-v3-pro",
      "routeFamily": "sora-v3-pro",
      "requestModel": "sora-v3-pro",
      "selectorCost": 40,
      "pricingMode": "per_second",
      "pointCostPerSecond": 10,
      "maxReferenceImages": 9,
      "maxReferenceVideos": 3,
      "maxTotalReferences": 12,
      "referenceImageMode": "general",
      "supportsVideoReference": true,
      "referenceLabels": [],
      "defaultAspectRatio": "16:9",
      "aspectRatioOptions": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      "defaultResolution": "720p",
      "resolutionOptions": ["720p"],
      "defaultDuration": "4",
      "durationOptions": ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
      "promptMaxLength": 2500,
      "isActive": true,
      "isDefaultModel": false,
      "sortOrder": 1
    },
    {
      "id": "veo31-fast",
      "label": "Veo 3.1 Fast",
      "description": "PixelHub Veo 3.1 Fast video generation",
      "modelFamily": "veo31-fast",
      "routeFamily": "veo31-fast",
      "requestModel": "veo31-fast",
      "selectorCost": 2,
      "pricingMode": "per_second",
      "pointCostPerSecond": 0.5,
      "maxReferenceImages": 2,
      "maxReferenceVideos": 0,
      "maxTotalReferences": 2,
      "referenceImageMode": "frames",
      "supportsVideoReference": false,
      "referenceLabels": ["First frame", "Last frame"],
      "defaultAspectRatio": "16:9",
      "aspectRatioOptions": ["16:9", "9:16"],
      "defaultResolution": "1080p",
      "resolutionOptions": ["720p", "1080p"],
      "defaultDuration": "4",
      "durationOptions": ["4", "6", "8"],
      "promptMaxLength": null,
      "isActive": true,
      "isDefaultModel": false,
      "sortOrder": 2
    }
  ],
  "routes": [
    {
      "id": "gemini-omni-flash-line1",
      "label": "Line 1",
      "description": "PixelHub Gemini Omni Flash",
      "routeFamily": "gemini-omni-flash",
      "line": "line1",
      "transport": "openai-video",
      "mode": "async",
      "baseUrl": "https://api.pixellelabs.com",
      "generatePath": "/v1/videos",
      "taskPath": "/v1/videos/{taskId}",
      "upstreamModel": "gemini-omni-flash",
      "apiKeyEnv": "PIXELHUB_GEMINI_OMNI_FLASH_KEY",
      "pointCost": 4,
      "isActive": true,
      "isDefaultRoute": true,
      "sortOrder": 0
    },
    {
      "id": "sora-v3-pro-line1",
      "label": "Line 1",
      "description": "PixelHub Sora V3 Pro",
      "routeFamily": "sora-v3-pro",
      "line": "line1",
      "transport": "openai-video",
      "mode": "async",
      "baseUrl": "https://api.pixellelabs.com",
      "generatePath": "/v1/videos",
      "taskPath": "/v1/videos/{taskId}",
      "upstreamModel": "sora-v3-pro",
      "apiKeyEnv": "PIXELHUB_SORA_V3_PRO_KEY",
      "pointCost": 40,
      "isActive": true,
      "isDefaultRoute": true,
      "sortOrder": 1
    },
    {
      "id": "veo31-fast-line1",
      "label": "Line 1",
      "description": "PixelHub Veo 3.1 Fast",
      "routeFamily": "veo31-fast",
      "line": "line1",
      "transport": "openai-video",
      "mode": "async",
      "baseUrl": "https://api.pixellelabs.com",
      "generatePath": "/v1/videos",
      "taskPath": "/v1/videos/{taskId}",
      "upstreamModel": "veo31-fast",
      "apiKeyEnv": "PIXELHUB_VEO31_FAST_KEY",
      "pointCost": 2,
      "isActive": true,
      "isDefaultRoute": true,
      "sortOrder": 2
    }
  ]
}
```

- [ ] **Step 4: Align the static fallback catalogs**

In `config/videoModels.json`, set every existing entry to `"isActive": false` and `"isDefaultModel": false`, then upsert the three model definitions above and set `defaultModelId` to `gemini-omni-flash`.

In `config/videoRoutes.json`, set every existing entry to `"isActive": false` and `"isDefaultRoute": false`, then upsert the three route definitions above and set `defaultRouteId` to `gemini-omni-flash-line1`. Do not remove legacy entries.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/config/videoModels.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit the catalog**

```bash
git add config/pixelhubVideoCatalog.json config/videoModels.json config/videoRoutes.json src/config/videoModels.test.ts
git commit -m "config: define active PixelHub video catalog"
```

## Task 2: Extend Video Model Capabilities End To End

**Files:**
- Modify: `videoModelStore.cjs`
- Create: `videoModelStore.test.cjs`
- Modify: `src/config/videoModels.ts`
- Modify: `src/services/videoModelAdminService.ts`

- [ ] **Step 1: Write failing backend schema and mapping tests**

Create `videoModelStore.test.cjs`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('video model capability schema', () => {
  const source = fs.readFileSync(path.join(__dirname, 'videoModelStore.cjs'), 'utf8');

  it('stores every capability required by the PixelHub models', () => {
    for (const column of [
      'resolution_options_json',
      'default_resolution',
      'max_reference_videos',
      'max_total_references',
      'reference_image_mode',
      'supports_video_reference',
      'prompt_max_length',
    ]) {
      assert.ok(source.includes(column), `missing ${column}`);
    }
  });

  it('maps capability columns to the public camel-case shape', () => {
    for (const property of [
      'resolutionOptions',
      'defaultResolution',
      'maxReferenceVideos',
      'maxTotalReferences',
      'referenceImageMode',
      'supportsVideoReference',
      'promptMaxLength',
    ]) {
      assert.ok(source.includes(property), `missing ${property}`);
    }
  });
});
```

- [ ] **Step 2: Run the backend test and verify RED**

Run:

```bash
npm test -- videoModelStore.test.cjs
```

Expected: FAIL because the capability columns and mappings do not exist.

- [ ] **Step 3: Extend the store schema and model mapping**

Add the seven columns to the create-table SQL and use the existing guarded
`ensureColumn` pattern for existing databases. Use these SQL definitions:

```sql
resolution_options_json LONGTEXT NOT NULL
default_resolution VARCHAR(16) NOT NULL DEFAULT '720p'
max_reference_videos INT NOT NULL DEFAULT 0
max_total_references INT NOT NULL DEFAULT 1
reference_image_mode VARCHAR(24) NOT NULL DEFAULT 'general'
supports_video_reference TINYINT(1) NOT NULL DEFAULT 0
prompt_max_length INT NULL
```

Extend static normalization, `mapRowToModel`, INSERT statements, and admin
create/update normalization with the exact camel-case properties tested above.
Normalize `referenceImageMode` to `style`, `general`, or `frames`; reject other
values. Require defaults to be present in their option arrays and require
`maxTotalReferences >= maxReferenceImages` and
`maxTotalReferences >= maxReferenceVideos`.

Delete `normalizePublicVideoModelFlags`; capabilities now come from data and no
longer need Sora-specific output overrides.

- [ ] **Step 4: Extend frontend model types and selectors**

Add to `VideoModelConfig` and `AdminVideoModelPayload`:

```ts
resolutionOptions?: string[];
defaultResolution?: string;
maxReferenceVideos?: number;
maxTotalReferences?: number;
referenceImageMode?: 'style' | 'general' | 'frames';
supportsVideoReference?: boolean;
promptMaxLength?: number | null;
```

Add these selectors to `src/config/videoModels.ts`:

```ts
export const getVideoModelResolutionOptions = (modelId?: string) =>
  getVideoModelById(modelId).resolutionOptions || ['720p'];
export const getDefaultVideoResolutionForModel = (modelId?: string) =>
  getVideoModelById(modelId).defaultResolution ||
  getVideoModelResolutionOptions(modelId)[0] ||
  '720p';
export const getVideoModelMaxReferenceVideos = (modelId?: string) =>
  Math.max(0, Number(getVideoModelById(modelId).maxReferenceVideos || 0));
export const getVideoModelMaxTotalReferences = (modelId?: string) =>
  Math.max(0, Number(getVideoModelById(modelId).maxTotalReferences || 0));
export const getVideoModelReferenceImageMode = (modelId?: string) =>
  getVideoModelById(modelId).referenceImageMode || 'general';
export const getVideoModelSupportsVideoReference = (modelId?: string) =>
  getVideoModelById(modelId).supportsVideoReference === true;
```

Remove `supportsHd`, `defaultHd`, `VideoReferenceMode`, and Sora-specific frame
logic after all call sites have moved in later tasks. Keep compatibility exports
temporarily only if required to keep the intermediate commit buildable.

- [ ] **Step 5: Run tests and build**

```bash
npm test -- videoModelStore.test.cjs src/config/videoModels.test.ts
npm run build
```

Expected: focused tests PASS and Vite exits 0.

- [ ] **Step 6: Commit capability support**

```bash
git add videoModelStore.cjs videoModelStore.test.cjs src/config/videoModels.ts src/services/videoModelAdminService.ts
git commit -m "feat: model video capabilities explicitly"
```

## Task 3: Add The Idempotent Catalog Migration

**Files:**
- Create: `pixelhubVideoMigration.cjs`
- Create: `pixelhubVideoMigration.test.cjs`
- Create: `scripts/activate-pixelhub-video-models.cjs`

- [ ] **Step 1: Write failing migration definition tests**

Create `pixelhubVideoMigration.test.cjs`:

```js
const assert = require('assert');
const {
  buildPixelHubVideoMigrationOperations,
} = require('./pixelhubVideoMigration.cjs');

describe('PixelHub video catalog migration', () => {
  it('deactivates legacy catalog entries and upserts only three targets', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.strictEqual(operations.models.length, 3);
    assert.strictEqual(operations.routes.length, 3);
    assert.strictEqual(operations.deactivateLegacyModels, true);
    assert.strictEqual(operations.deactivateLegacyRoutes, true);
    assert.strictEqual(operations.defaultModelId, 'gemini-omni-flash');
    assert.strictEqual(operations.defaultRouteId, 'gemini-omni-flash-line1');
  });

  it('clears direct database keys for all target routes', () => {
    const operations = buildPixelHubVideoMigrationOperations();
    assert.deepStrictEqual(
      operations.routes.map((route) => route.apiKey),
      [null, null, null],
    );
  });

  it('does not define operations for historical or billing tables', () => {
    const serialized = JSON.stringify(buildPixelHubVideoMigrationOperations());
    assert.ok(!serialized.includes('generation_records'));
    assert.ok(!serialized.includes('billing'));
    assert.ok(!serialized.includes('pending_tasks'));
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- pixelhubVideoMigration.test.cjs
```

Expected: FAIL because `pixelhubVideoMigration.cjs` does not exist.

- [ ] **Step 3: Implement the pure operation builder and transaction runner**

`buildPixelHubVideoMigrationOperations()` reads
`config/pixelhubVideoCatalog.json`, clones all records, and adds `apiKey: null`
to each target route. `applyPixelHubVideoMigration(connection)` executes:

```sql
UPDATE video_models SET is_active = 0, is_default_model = 0;
UPDATE video_routes SET is_active = 0, is_default_route = 0;
```

Then use `INSERT ... ON DUPLICATE KEY UPDATE` for every target model and route.
The route update clause must include `api_key = NULL`, `api_key_env`, paths,
upstream model, cost, activation, default flag, and sort order. The model update
clause must include every capability and pricing field.

Export both functions so the pure definition is testable without MySQL:

```js
module.exports = {
  applyPixelHubVideoMigration,
  buildPixelHubVideoMigrationOperations,
};
```

- [ ] **Step 4: Implement the production CLI wrapper**

Create `scripts/activate-pixelhub-video-models.cjs`:

```js
const { closePool, isMySqlConfigured, withTransaction } = require('../db.cjs');
const { ensureVideoModelSchema } = require('../videoModelStore.cjs');
const { ensureVideoRouteSchema } = require('../videoRouteStore.cjs');
const { applyPixelHubVideoMigration } = require('../pixelhubVideoMigration.cjs');

const main = async () => {
  if (!isMySqlConfigured()) throw new Error('MySQL is not configured');
  await ensureVideoModelSchema();
  await ensureVideoRouteSchema();
  await withTransaction((connection) => applyPixelHubVideoMigration(connection));
  console.log('PixelHub video catalog migration complete.');
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool());
```

- [ ] **Step 5: Verify the migration module**

```bash
npm test -- pixelhubVideoMigration.test.cjs
node --check pixelhubVideoMigration.cjs
node --check scripts/activate-pixelhub-video-models.cjs
```

Expected: 3 tests PASS and both syntax checks exit 0.

- [ ] **Step 6: Commit the migration**

```bash
git add pixelhubVideoMigration.cjs pixelhubVideoMigration.test.cjs scripts/activate-pixelhub-video-models.cjs
git commit -m "feat: migrate active PixelHub video catalog"
```

## Task 4: Build The Pure PixelHub Request Policy

**Files:**
- Create: `videoRequestPolicy.cjs`
- Create: `videoRequestPolicy.test.cjs`

- [ ] **Step 1: Write failing payload and pricing tests**

Create tests using model objects from `config/pixelhubVideoCatalog.json`:

```js
const assert = require('assert');
const catalog = require('./config/pixelhubVideoCatalog.json');
const {
  normalizePixelHubVideoRequest,
} = require('./videoRequestPolicy.cjs');

const model = (id) => catalog.models.find((item) => item.id === id);

describe('normalizePixelHubVideoRequest', () => {
  it('builds Gemini references and charges one point per second', () => {
    const result = normalizePixelHubVideoRequest({
      body: {
        prompt: 'city at night',
        aspectRatio: '16:9',
        resolution: '1080p',
        duration: 10,
        referenceImages: ['https://app.test/a.jpg'],
        referenceVideos: ['https://app.test/a.mp4'],
      },
      model: model('gemini-omni-flash'),
      upstreamModel: 'gemini-omni-flash',
    });
    assert.strictEqual(result.pointCost, 10);
    assert.deepStrictEqual(result.upstreamBody, {
      model: 'gemini-omni-flash',
      prompt: 'city at night',
      aspect_ratio: '16:9',
      duration: 10,
      resolution: '1080p',
      generate_audio: true,
      reference_image_urls: ['https://app.test/a.jpg'],
      reference_videos: ['https://app.test/a.mp4'],
    });
  });

  it('builds Sora references and charges ten points per second', () => {
    const result = normalizePixelHubVideoRequest({
      body: {
        prompt: 'portrait motion',
        aspectRatio: '1:1',
        resolution: '720p',
        duration: 15,
        referenceImages: ['https://app.test/1.jpg'],
        referenceVideos: ['https://app.test/1.mp4'],
      },
      model: model('sora-v3-pro'),
      upstreamModel: 'sora-v3-pro',
    });
    assert.strictEqual(result.pointCost, 150);
    assert.deepStrictEqual(result.upstreamBody.reference_image_urls, ['https://app.test/1.jpg']);
    assert.deepStrictEqual(result.upstreamBody.reference_videos, ['https://app.test/1.mp4']);
  });

  it('maps Veo references to ordered frame URLs', () => {
    const result = normalizePixelHubVideoRequest({
      body: {
        prompt: 'camera move',
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 4,
        referenceImages: ['https://app.test/start.jpg', 'https://app.test/end.jpg'],
        referenceVideos: [],
      },
      model: model('veo31-fast'),
      upstreamModel: 'veo31-fast',
    });
    assert.strictEqual(result.pointCost, 2);
    assert.deepStrictEqual(result.upstreamBody.image_urls, [
      'https://app.test/start.jpg',
      'https://app.test/end.jpg',
    ]);
    assert.ok(!('reference_videos' in result.upstreamBody));
  });
});
```

Add separate tests asserting rejection of unsupported ratios, resolutions,
durations, non-integer durations, image/video/combined count overflow, non-HTTP
URLs, Veo video references, Sora prompts longer than 2500 characters, and an
upstream model outside the target catalog. Also reject `quantity` values other
than one and any request containing legacy upstream fields such as
`video_reference`, `start_frame`, `end_frame`, or `hd`.

- [ ] **Step 2: Run the tests and verify RED**

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: FAIL because `videoRequestPolicy.cjs` does not exist.

- [ ] **Step 3: Implement the pure policy**

Export a single public function:

```js
const normalizePixelHubVideoRequest = ({ body = {}, model, upstreamModel }) => {
  const prompt = String(body.prompt || '').trim();
  const aspectRatio = String(body.aspectRatio || '').trim();
  const resolution = String(body.resolution || '').trim().toLowerCase();
  const duration = Number(body.duration);
  const images = uniqueUrls(body.referenceImages);
  const videos = uniqueUrls(body.referenceVideos);

  if (!prompt) throw badRequest('prompt is required');
  if (!Number.isInteger(duration)) throw badRequest('duration must be an integer');
  if (body.quantity !== undefined && Number(body.quantity) !== 1) {
    throw badRequest('video quantity must be one');
  }
  for (const field of ['video_reference', 'start_frame', 'end_frame', 'hd']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw badRequest(`${field} is not supported by the PixelHub request contract`);
    }
  }
  const expectedModel = String(model.requestModel || model.id || '').trim();
  if (!expectedModel || upstreamModel !== expectedModel) {
    throw badRequest('upstream model does not match the selected model');
  }
  requireAllowedValue('aspect ratio', aspectRatio, model.aspectRatioOptions);
  requireAllowedValue('resolution', resolution, model.resolutionOptions);
  requireAllowedValue('duration', String(duration), model.durationOptions);
  requireReferenceLimits({ images, videos, model });
  requirePromptLength(prompt, model.promptMaxLength);

  const upstreamBody = {
    model: upstreamModel,
    prompt,
    aspect_ratio: aspectRatio,
    duration,
    resolution,
    generate_audio: true,
  };

  if (model.referenceImageMode === 'frames') {
    if (images.length) upstreamBody.image_urls = images;
  } else {
    if (images.length) upstreamBody.reference_image_urls = images;
    if (videos.length) upstreamBody.reference_videos = videos;
  }

  return {
    upstreamBody,
    pointCost: roundPoint(duration * Number(model.pointCostPerSecond || 0)),
  };
};
```

Implement `uniqueUrls`, `requireAllowedValue`, `requireReferenceLimits`,
`requirePromptLength`, `badRequest`, and `roundPoint` as private helpers. Reject duplicate
aliases by accepting only the internal `referenceImages` and `referenceVideos`
arrays. Error objects must carry `status = 400`.

- [ ] **Step 4: Run the policy tests and verify GREEN**

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: all payload, boundary, and error tests PASS.

- [ ] **Step 5: Commit the policy**

```bash
git add videoRequestPolicy.cjs videoRequestPolicy.test.cjs
git commit -m "feat: validate PixelHub video requests"
```

## Task 5: Materialize Reference Media As Public URLs

**Files:**
- Create: `videoReferenceMedia.cjs`
- Create: `videoReferenceMedia.test.cjs`
- Modify: `videoFrameUpload.cjs`
- Modify: `Dockerfile`

- [ ] **Step 1: Write failing media materialization tests**

Use a temporary directory and a fake request with forwarded HTTPS headers:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  materializeVideoReferenceMedia,
} = require('./videoReferenceMedia.cjs');

describe('materializeVideoReferenceMedia', () => {
  it('converts image data URLs and relative video URLs to absolute URLs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-media-'));
    const req = {
      protocol: 'http',
      get: (name) => ({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'app.example.com',
        host: 'internal:3365',
      }[name]),
    };
    const result = materializeVideoReferenceMedia({
      referenceImages: ['data:image/png;base64,aGVsbG8='],
      referenceVideos: ['/uploads/video-references/ref.mp4'],
    }, req, root);
    assert.match(result.referenceImages[0], /^https:\/\/app\.example\.com\/uploads\/video-frames\//);
    assert.deepStrictEqual(result.referenceVideos, [
      'https://app.example.com/uploads/video-references/ref.mp4',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- videoReferenceMedia.test.cjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement array materialization**

Reuse `normalizePublicVideoFrameUrl` and `toAbsolutePublicUrl` from
`videoFrameUpload.cjs`:

```js
const materializeVideoReferenceMedia = (body = {}, req, baseDir) => ({
  ...body,
  referenceImages: toArray(body.referenceImages).map((value, index) =>
    normalizePublicVideoFrameUrl(value, req, `reference-${index + 1}`, baseDir),
  ),
  referenceVideos: toArray(body.referenceVideos).map((value) =>
    toAbsolutePublicUrl(value, req),
  ),
});
```

Keep `videoFrameUpload.cjs` legacy exports until old inactive tasks no longer
need them. Do not log base64 input or full reference URLs.

- [ ] **Step 4: Copy new runtime modules into the production image**

Add these lines near the other backend module copies in `Dockerfile`:

```dockerfile
COPY videoRequestPolicy.cjs ./
COPY videoReferenceMedia.cjs ./
COPY pixelhubVideoMigration.cjs ./
```

The existing `COPY config ./config` and `COPY scripts ./scripts` include the
catalog and migration CLI.

- [ ] **Step 5: Verify tests and syntax**

```bash
npm test -- videoReferenceMedia.test.cjs videoFrameUpload.test.cjs
node --check videoReferenceMedia.cjs
```

Expected: all tests PASS and syntax check exits 0.

- [ ] **Step 6: Commit media materialization**

```bash
git add videoReferenceMedia.cjs videoReferenceMedia.test.cjs videoFrameUpload.cjs Dockerfile
git commit -m "feat: publish PixelHub video references"
```

## Task 6: Wire Policy And Billing Into The Server

**Files:**
- Modify: `server.cjs`
- Test: `videoRequestPolicy.test.cjs`

- [ ] **Step 1: Add failing source-order regression tests**

Add a source-level test that reads `server.cjs` and asserts these call-order
indices inside `/api/video/generate`:

```js
const endpointStart = source.indexOf('app.post("/api/video/generate"');
const endpointEnd = source.indexOf('// ==================== Video Task Polling', endpointStart);
const endpoint = source.slice(endpointStart, endpointEnd);
assert.ok(endpoint.indexOf('materializeVideoReferenceMedia(') < endpoint.indexOf('normalizePixelHubVideoRequest('));
assert.ok(endpoint.indexOf('normalizePixelHubVideoRequest(') < endpoint.indexOf('reservePoints('));
assert.ok(endpoint.includes('route.routeFamily !== requestedVideoModel.routeFamily'));
assert.ok(endpoint.indexOf('refundPoints(') > endpoint.indexOf('catch (error)'));
```

Also assert the client polling interval constant is changed to `10_000` in
Task 7; keep that assertion in `services/videoService.test.ts` rather than here.

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: FAIL because the server endpoint does not call the new policy.

- [ ] **Step 3: Replace the legacy forwarding branch**

Import:

```js
const { normalizePixelHubVideoRequest } = require('./videoRequestPolicy.cjs');
const { materializeVideoReferenceMedia } = require('./videoReferenceMedia.cjs');
```

Resolve active records explicitly:

```js
const route = await resolveVideoRoute(requestBody.routeId);
const requestedVideoModel = await resolveRequestedVideoModel(requestBody, {
  includeInactive: false,
});
if (!route || !requestedVideoModel) {
  return sendUserFacingGenerationError(res, 400, new Error('Video model or route is unavailable'));
}
if (route.routeFamily !== requestedVideoModel.routeFamily) {
  return sendUserFacingGenerationError(res, 400, new Error('Video route does not match the selected model'));
}

const materializedBody = materializeVideoReferenceMedia(requestBody, req);
const { upstreamBody, pointCost } = normalizePixelHubVideoRequest({
  body: materializedBody,
  model: requestedVideoModel,
  upstreamModel: route.upstreamModel || requestedVideoModel.requestModel || requestedVideoModel.id,
});
```

Only after this block call `requireBillingAccount` and `reservePoints`. Remove
the legacy Grok mapping and generic `start_frame`, `end_frame`,
`video_reference`, `hd`, and `--ar` compatibility from the active request path.
Keep inactive-task polling compatibility because historical task tokens can
still point to old routes.

Set generation record `outputSize` from `upstreamBody.resolution`, ratio from
`upstreamBody.aspect_ratio`, and duration from `upstreamBody.duration`.

- [ ] **Step 4: Preserve route-specific polling and refunds**

Keep the encoded `{ routeId, upstreamTaskId }` task token. The polling endpoint
must continue calling `getVideoRouteById(..., { includeInactive: true,
includeSecrets: true })` so historical tasks on now-inactive routes can finish
and settle correctly.

- [ ] **Step 5: Verify server behavior**

```bash
npm test -- videoRequestPolicy.test.cjs
node --check server.cjs
```

Expected: tests PASS and syntax check exits 0.

- [ ] **Step 6: Commit server integration**

```bash
git add server.cjs videoRequestPolicy.test.cjs
git commit -m "feat: enforce PixelHub video policy before billing"
```

## Task 7: Migrate Persisted Video Selection State

**Files:**
- Create: `src/utils/videoSelectionMigration.ts`
- Create: `src/utils/videoSelectionMigration.test.ts`
- Modify: `src/store/selectionStore.ts`

- [ ] **Step 1: Write failing persisted-state tests**

```ts
import { describe, expect, it } from 'vitest';
import { migrateVideoSelectionState } from './videoSelectionMigration';

describe('migrateVideoSelectionState', () => {
  it('maps legacy HD and single video reference fields', () => {
    expect(migrateVideoSelectionState({
      videoHd: true,
      videoReferenceUrl: 'https://app.test/ref.mp4',
    })).toMatchObject({
      videoResolution: '1080p',
      videoReferenceVideos: [{ url: 'https://app.test/ref.mp4' }],
    });
  });

  it('uses Gemini defaults for empty legacy state', () => {
    expect(migrateVideoSelectionState({})).toMatchObject({
      videoModel: 'gemini-omni-flash',
      videoResolution: '720p',
      videoReferenceVideos: [],
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- src/utils/videoSelectionMigration.test.ts
```

Expected: FAIL because the migration helper does not exist.

- [ ] **Step 3: Implement the state migration**

Define:

```ts
export interface VideoReferenceItem {
  id?: string;
  url: string;
  name?: string;
}

export const migrateVideoSelectionState = (state: Record<string, unknown>) => {
  const legacyUrl = String(state.videoReferenceUrl || '').trim();
  const existingVideos = Array.isArray(state.videoReferenceVideos)
    ? state.videoReferenceVideos
    : legacyUrl
      ? [{ url: legacyUrl }]
      : [];
  return {
    ...state,
    videoModel: String(state.videoModel || 'gemini-omni-flash'),
    videoResolution: String(
      state.videoResolution || (state.videoHd === true ? '1080p' : '720p'),
    ),
    videoReferenceVideos: existingVideos,
  };
};
```

In `selectionStore.ts`, replace `videoHd`, `videoReferenceMode`, and
`videoReferenceUrl` with `videoResolution` and `videoReferenceVideos`. Add set,
append, and remove actions. Update the persisted whitelist and call
`migrateVideoSelectionState` from the `merge` hook. Default to Gemini, line1,
720p, and an empty video-reference list.

- [ ] **Step 4: Run tests and build**

```bash
npm test -- src/utils/videoSelectionMigration.test.ts
npm run build
```

Expected: tests PASS and Vite exits 0. To keep this commit buildable, retain deprecated compatibility
aliases for `videoHd`, `videoReferenceMode`, and `videoReferenceUrl` in the store
until Task 8 removes all call sites; the new fields are the source of truth and
the aliases are derived during reads.

- [ ] **Step 5: Commit selection state**

```bash
git add src/utils/videoSelectionMigration.ts src/utils/videoSelectionMigration.test.ts src/store/selectionStore.ts
git commit -m "refactor: model video resolution and references explicitly"
```

## Task 8: Replace The Client Video Request Contract

**Files:**
- Modify: `services/videoService.ts`
- Modify: `services/videoService.test.ts`
- Modify: `components/ControlPanel.tsx`
- Modify: `components/ContextSatellite/SatelliteLayer.tsx`

- [ ] **Step 1: Write failing client payload tests**

Extract and export `buildInternalVideoRequest` from `services/videoService.ts`.
Test the exact internal body:

```ts
expect(buildInternalVideoRequest({
  modelId: 'gemini-omni-flash',
  routeId: 'gemini-omni-flash-line1',
  prompt: 'city at night',
  aspectRatio: '16:9',
  resolution: '1080p',
  duration: '10',
  referenceImages: ['data:image/jpeg;base64,YQ=='],
  referenceVideos: ['https://app.test/ref.mp4'],
})).toEqual({
  modelId: 'gemini-omni-flash',
  routeId: 'gemini-omni-flash-line1',
  prompt: 'city at night',
  aspectRatio: '16:9',
  resolution: '1080p',
  duration: 10,
  referenceImages: ['data:image/jpeg;base64,YQ=='],
  referenceVideos: ['https://app.test/ref.mp4'],
});
```

Add assertions that the body has none of `model`, `hd`, `generate_audio`,
`video_reference`, `start_frame`, `end_frame`, or `--ar` prompt content. Add a
source assertion that `VIDEO_POLL_INTERVAL_MS` equals `10_000`.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- services/videoService.test.ts
```

Expected: FAIL because the internal builder and new fields do not exist.

- [ ] **Step 3: Simplify the video service**

Replace model-specific upstream payload construction with the internal builder.
`generateVideo` accepts one options object:

```ts
export interface GenerateVideoInput {
  modelId: string;
  routeId: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  duration: string;
  referenceImages: string[];
  referenceVideos: string[];
}
```

POST this body to `/api/video/generate`. The server owns upstream model names,
audio flags, and reference-field mapping. Set:

```ts
export const VIDEO_POLL_INTERVAL_MS = 10_000;
```

and use it in `pollVideoTask` while keeping the 15-minute timeout.

- [ ] **Step 4: Update ControlPanel submission**

Do not append `--ar` to the prompt. Convert selected image references to image
data URLs as today, then call:

```ts
await generateVideo(apiKey, {
  modelId: selectedVideoModelConfig.id,
  routeId: selectedVideoRoute.id,
  prompt: parsedPrompt,
  aspectRatio: videoAspectRatio,
  resolution: videoResolution,
  duration: videoDuration,
  referenceImages: imageDataUrls,
  referenceVideos: videoReferenceVideos.map((item) => item.url),
}, (progress) => onUpdateProgress?.(pid, progress));
```

Before creating a generation placeholder, block submission if the image,
video, or combined counts exceed the selected model capability. Do not slice
arrays. Keep the user assets intact and show the allowed counts.

- [ ] **Step 5: Update satellite shortcuts**

Replace hard-coded `veo3.1-fast` calls with the active default model and route
from the catalogs. Send the same internal request shape with the default
resolution and duration selectors. This prevents the satellite feature from
calling an inactive route after migration.

- [ ] **Step 6: Verify client tests and build**

```bash
npm test -- services/videoService.test.ts
npm run build
```

Expected: tests PASS and Vite exits 0.

- [ ] **Step 7: Commit the client request contract**

```bash
git add services/videoService.ts services/videoService.test.ts components/ControlPanel.tsx components/ContextSatellite/SatelliteLayer.tsx
git commit -m "feat: send capability-safe video requests"
```

## Task 9: Render Capability-Driven Video Controls

**Files:**
- Modify: `components/VideoFormConfig.tsx`
- Modify: `components/ControlPanel.tsx`
- Modify: `components/VideoPricingModal.tsx`
- Modify: `src/config/videoModels.test.ts`

- [ ] **Step 1: Add failing selector tests**

Extend `src/config/videoModels.test.ts`:

```ts
expect(getVideoModelResolutionOptions('sora-v3-pro')).toEqual(['720p']);
expect(getVideoModelResolutionOptions('veo31-fast')).toEqual(['720p', '1080p']);
expect(getVideoModelMaxReferenceVideos('gemini-omni-flash')).toBe(1);
expect(getVideoModelMaxReferenceVideos('sora-v3-pro')).toBe(3);
expect(getVideoModelReferenceImageMode('veo31-fast')).toBe('frames');
expect(getVideoModelDisplayCost('veo31-fast', '4')).toBe(2);
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/config/videoModels.test.ts
```

Expected: FAIL until all capability selectors read the active catalog.

- [ ] **Step 3: Replace HD and hard-coded reference controls**

In `VideoFormConfig.tsx`:

- Render a resolution `DropUpSelect` only when the model has more than one
  option; render a non-interactive `720P` value for fixed Sora resolution.
- Render duration and aspect-ratio choices from catalog arrays.
- Render a reference-video upload strip only when
  `supportsVideoReference === true`.
- Allow one Gemini video and three Sora videos.
- Show each uploaded video's filename with remove control and stable dimensions.
- Remove Sora ID checks and the image/frame mode segmented control.
- When the current selection is invalid for a newly selected model, use that
  model's defaults.

In `ControlPanel.tsx`, label the shared image-reference strip as first frame and
last frame when `referenceImageMode === 'frames'`; otherwise retain numbered
reference labels. Remove the Sora-only image/frame segmented control.

The generated model options display current duration cost through
`getVideoModelDisplayCost`.

- [ ] **Step 4: Make pricing modal catalog-driven**

Replace its hard-coded model list with:

```ts
const rows = getVisibleVideoModels().map((model) => ({
  id: model.id,
  label: model.label,
  unitCost: model.pointCostPerSecond || 0,
  minimumCost: getVideoModelDisplayCost(model.id, model.defaultDuration),
}));
```

Display per-second price and the four-second/default minimum without listing
inactive legacy models.

- [ ] **Step 5: Verify tests and production build**

```bash
npm test -- src/config/videoModels.test.ts
npm run build
```

Expected: tests PASS and Vite exits 0 without TypeScript errors.

- [ ] **Step 6: Commit capability-driven controls**

```bash
git add components/VideoFormConfig.tsx components/ControlPanel.tsx components/VideoPricingModal.tsx src/config/videoModels.test.ts
git commit -m "feat: render video controls from capabilities"
```

## Task 10: Extend The Video Model Admin Editor

**Files:**
- Modify: `components/MediaCatalogAdminPanel.tsx`
- Modify: `src/services/videoModelAdminService.ts`
- Test: `videoModelStore.test.cjs`

- [ ] **Step 1: Add failing admin validation tests**

Add pure store validator coverage for:

```js
assert.throws(
  () => normalizeManagedVideoModelInput({
    id: 'bad',
    label: 'Bad',
    modelFamily: 'bad',
    routeFamily: 'bad',
    resolutionOptions: ['720p'],
    defaultResolution: '1080p',
    maxReferenceImages: 2,
    maxReferenceVideos: 1,
    maxTotalReferences: 1,
  }),
  /default resolution|max total references/i,
);
```

Export the existing input normalizer under the stable name
`normalizeManagedVideoModelInput` so tests exercise real validation.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- videoModelStore.test.cjs
```

Expected: FAIL because validation and the exported helper are incomplete.

- [ ] **Step 3: Add admin form fields**

Extend `VideoModelForm` with `resolutionOptionsInput`. Add controls for:

- Default resolution.
- Resolution options, comma separated.
- Maximum reference videos.
- Maximum combined references.
- Reference image mode select with `style`, `general`, and `frames`.
- Supports video reference toggle.
- Prompt maximum length, with blank mapped to null.

Build the payload using `inputToArray` and numeric normalization. Presently
stored inactive legacy rows remain editable.

- [ ] **Step 4: Enforce admin validation server-side**

Require non-empty aspect ratio, resolution, and duration arrays; defaults must
belong to their arrays; limits must be non-negative; combined limit must be at
least each individual limit; `frames` mode cannot support reference videos.

- [ ] **Step 5: Run tests and build**

```bash
npm test -- videoModelStore.test.cjs
npm run build
```

Expected: tests PASS and Vite exits 0.

- [ ] **Step 6: Commit admin support**

```bash
git add components/MediaCatalogAdminPanel.tsx src/services/videoModelAdminService.ts videoModelStore.cjs videoModelStore.test.cjs
git commit -m "feat: manage video capabilities in admin"
```

## Task 11: Document Production Configuration

**Files:**
- Modify: `.env.example`
- Modify: `.env.bt.example`
- Modify: `package.json`

- [ ] **Step 1: Add the migration command to package scripts**

Add:

```json
"migrate:pixelhub-video": "node scripts/activate-pixelhub-video-models.cjs"
```

- [ ] **Step 2: Document environment names without values**

Add to both environment examples:

```dotenv
PUBLIC_BASE_URL=https://aigc.aittco.com
PIXELHUB_GEMINI_OMNI_FLASH_KEY=
PIXELHUB_SORA_V3_PRO_KEY=
PIXELHUB_VEO31_FAST_KEY=
```

- [ ] **Step 3: Verify environment files contain no real keys**

Run:

```bash
git diff -- .env.example .env.bt.example
```

Expected: only variable names and the public application URL appear; all key
values remain empty.

- [ ] **Step 4: Commit deployment configuration**

```bash
git add .env.example .env.bt.example package.json
git commit -m "docs: configure PixelHub video deployment"
```

## Task 12: Full Verification And Production Rollout

**Files:**
- Verify: all files changed in Tasks 1-11
- Operational: production MySQL and Docker deployment

- [ ] **Step 1: Run the complete automated test suite**

```bash
npm test
```

Expected: all test files PASS with zero failures.

- [ ] **Step 2: Run backend syntax checks**

```bash
node --check server.cjs
node --check videoModelStore.cjs
node --check videoRequestPolicy.cjs
node --check videoReferenceMedia.cjs
node --check pixelhubVideoMigration.cjs
node --check scripts/activate-pixelhub-video-models.cjs
```

Expected: every command exits 0 with no syntax error.

- [ ] **Step 3: Build the production frontend**

```bash
npm run build
```

Expected: Vite exits 0 and writes `dist/`.

- [ ] **Step 4: Build the production image**

```bash
docker build -t image-pro:pixelhub-video-verify .
```

Expected: image build exits 0 and the runtime stage contains every new CommonJS
module.

- [ ] **Step 5: Inspect final changes**

```bash
implementation_base="$(git merge-base HEAD main)"
git diff --check "$implementation_base" HEAD
git status --short
```

Expected: no whitespace errors and no task-related uncommitted files. Resolve
the base at execution time as shown; do not hard-code a stale commit SHA.

- [ ] **Step 6: Back up production catalog tables**

Run from the server project directory:

```bash
docker compose exec -T mysql sh -lc 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" video_models video_routes' > "video-catalog-before-pixelhub-$(date +%Y%m%d-%H%M%S).sql"
```

Expected: a non-empty SQL backup file exists in the project directory.

- [ ] **Step 7: Verify production environment variables without printing secrets**

```bash
docker compose exec -T app sh -lc 'for name in PIXELHUB_GEMINI_OMNI_FLASH_KEY PIXELHUB_SORA_V3_PRO_KEY PIXELHUB_VEO31_FAST_KEY PUBLIC_BASE_URL; do eval "value=\${$name}"; if [ -n "$value" ]; then echo "$name=SET"; else echo "$name=MISSING"; fi; done'
```

Expected: all four lines end in `=SET`.

- [ ] **Step 8: Apply the one-time catalog migration**

```bash
docker compose exec -T app npm run migrate:pixelhub-video
```

Expected: `PixelHub video catalog migration complete.`

- [ ] **Step 9: Restart and inspect the service**

```bash
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
```

Expected: app is running and logs contain no missing-module, schema, or missing-key errors.

- [ ] **Step 10: Run production smoke tests**

Generate one four-second video per model and confirm:

```text
gemini-omni-flash -> 4 points
sora-v3-pro       -> 40 points
veo31-fast        -> 2 points
```

Then test Gemini with five images and one video, Sora with nine images and three
videos, and Veo with two ordered frame images. Confirm request creation,
10-second polling, final video display, generation history, and exact billing.

- [ ] **Step 11: Verify no-charge validation and refund evidence**

Submit a Sora prompt containing exactly 2501 characters and a Veo request with
duration 10. Confirm both return HTTP 400 and the account ledger is unchanged.
Run the Task 6 policy and server-order tests again and confirm the established
catch path calls `refundPoints` for a reservation that has no local task ID.
Do not intentionally corrupt a production API key merely to force a live
upstream failure.

- [ ] **Step 12: Record rollback command**

If rollout validation fails, restore the backup created in Step 6 and deploy the
previous application image:

```bash
backup_file="$(find "$PWD" -maxdepth 1 -type f -name 'video-catalog-before-pixelhub-*.sql' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
test -n "$backup_file"
test -s "$backup_file"
printf 'Restoring %s\n' "$backup_file"
docker compose exec -T mysql sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$backup_file"
docker compose up -d app
```

The two `test` commands must pass and the printed path must be the backup created
in Step 6 before running the database restore line.
