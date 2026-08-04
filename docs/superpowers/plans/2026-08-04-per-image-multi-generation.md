# Per-Image Multi-Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Adobe and VISON submit `N` independent `n: 1` image requests while preserving Official T3 behavior and preventing unsupported Gemini batch billing.

**Architecture:** Add a small pure request-plan helper and use it in the canvas Gemini branch so every placeholder owns one request. Add a shared server-side image-count validator to both generation endpoints, and normalize the known stale VISON route before it is exposed to the frontend or used by the backend.

**Tech Stack:** React 19, TypeScript 5.8, Express 5, CommonJS backend modules, Vitest 4.

---

## File Structure

- Create `src/utils/perImageRequestPlan.ts`: pure construction of one-image request attempts.
- Create `src/utils/perImageRequestPlan.test.ts`: request-plan regression test.
- Modify `components/ControlPanel.tsx`: run one Gemini request per planned attempt.
- Create `imageRequestCount.cjs`: shared backend effective-count validation.
- Create `imageRequestCount.test.cjs`: validator regression tests.
- Modify `server.cjs`: apply the validator before billing in both image generation endpoints.
- Create `imageRouteCompatibility.cjs`: normalize the stale VISON route to Visionary OpenAPI semantics.
- Create `imageRouteCompatibility.test.cjs`: route normalization regression tests.
- Modify `imageRouteStore.cjs`: normalize mapped routes before use.

### Task 1: Define The Per-Image Request Plan

**Files:**
- Create: `src/utils/perImageRequestPlan.ts`
- Test: `src/utils/perImageRequestPlan.test.ts`

- [ ] **Step 1: Write the failing request-plan test**

```ts
import { describe, expect, it } from 'vitest';
import { buildPerImageRequestPlan } from './perImageRequestPlan';

describe('buildPerImageRequestPlan', () => {
  it('creates one n:1 attempt per requested image', () => {
    expect(buildPerImageRequestPlan(3)).toEqual([
      { index: 0, n: 1, candidateCount: 1 },
      { index: 1, n: 1, candidateCount: 1 },
      { index: 2, n: 1, candidateCount: 1 },
    ]);
  });

  it('falls back to one attempt for an invalid quantity', () => {
    expect(buildPerImageRequestPlan(Number.NaN)).toEqual([
      { index: 0, n: 1, candidateCount: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/utils/perImageRequestPlan.test.ts`

Expected: FAIL because `./perImageRequestPlan` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

```ts
export interface PerImageRequestAttempt {
  index: number;
  n: 1;
  candidateCount: 1;
}

export const buildPerImageRequestPlan = (
  quantity: number,
): PerImageRequestAttempt[] => {
  const parsed = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  const count = Math.max(1, parsed);
  return Array.from({ length: count }, (_, index) => ({
    index,
    n: 1 as const,
    candidateCount: 1 as const,
  }));
};
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- src/utils/perImageRequestPlan.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the helper**

```bash
git add src/utils/perImageRequestPlan.ts src/utils/perImageRequestPlan.test.ts
git commit -m "test: define per-image request plan"
```

### Task 2: Split Gemini Canvas Generation Into Independent Requests

**Files:**
- Modify: `components/ControlPanel.tsx:1-15`
- Modify: `components/ControlPanel.tsx:1087-1221`
- Test: `src/utils/perImageRequestPlan.test.ts`

- [ ] **Step 1: Import the tested request planner**

```ts
import { buildPerImageRequestPlan, type PerImageRequestAttempt } from '../src/utils/perImageRequestPlan';
```

- [ ] **Step 2: Replace the shared-placeholder Gemini batch with per-image attempts**

Keep the existing reference-image conversion code, but move it into
`prepareGeminiParts()`. Replace the single `placeholderIds` array and batch
payload with this request ownership structure:

```ts
type GeminiAttempt = PerImageRequestAttempt & { placeholderId: string };

const attempts: GeminiAttempt[] = buildPerImageRequestPlan(quantity).map((attempt) => {
  const [placeholderId] = onInitGenerations(1, currentPrompt, effectiveRatio);
  return { ...attempt, placeholderId };
});

const executeGeminiCall = async (
  attempt: GeminiAttempt,
  parts: any[],
) => {
  try {
    const payload: any = {
      model: modelName,
      modelId: selectedImageModelConfig.id,
      prompt: currentPrompt,
      aspect_ratio: effectiveRatio,
      image_size: mapSize(imageSize),
      routeId: selectedImageRoute.id,
      strict_native_config: true,
      n: attempt.n,
      contents: [{ role: 'user', parts }],
      generationConfig: {
        imageConfig: {
          aspectRatio: effectiveRatio,
          imageSize: mapSize(imageSize),
        },
        candidateCount: attempt.candidateCount,
      },
    };

    const res: any = await generateGeminiImage(apiKey, payload);
    const generatedImages: string[] = [];

    if (res.candidates && Array.isArray(res.candidates)) {
      res.candidates.forEach((candidate: any) => {
        candidate.content?.parts?.forEach((part: any) => {
          const inlineData = part.inlineData || part.inline_data;
          if (inlineData?.data) {
            const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
            generatedImages.push(`data:${mimeType};base64,${inlineData.data}`);
          }
        });
      });
    } else if (Array.isArray(res.images)) {
      generatedImages.push(...res.images);
    } else if (Array.isArray(res.data)) {
      res.data.forEach((item: any) => {
        if (item.url) generatedImages.push(item.url);
        else if (item.b64_json) {
          const normalized = normalizeImageResultValue(item.b64_json);
          if (normalized) generatedImages.push(normalized);
        }
      });
    }

    const image = generatedImages[0];
    if (!image) throw new Error(GENERATION_FALLBACK_MESSAGE);
    onUpdateGeneration(attempt.placeholderId, image);
  } catch (error: any) {
    onUpdateGeneration(
      attempt.placeholderId,
      null,
      toDisplayGenerationError(error),
    );
  }
};

void (async () => {
  try {
    const parts = await prepareGeminiParts();
    await Promise.all(attempts.map((attempt) => executeGeminiCall(attempt, parts)));
  } catch (error: any) {
    const message = toDisplayGenerationError(error);
    attempts.forEach(({ placeholderId }) => {
      onUpdateGeneration(placeholderId, null, message);
    });
  }
})();
```

`prepareGeminiParts()` must return the current `parts` array after processing
the reference images once. Do not re-fetch or re-encode the same references for
every attempt.

- [ ] **Step 3: Run focused tests and type/build verification**

Run: `npm test -- src/utils/perImageRequestPlan.test.ts`

Expected: 2 tests PASS.

Run: `npm run build`

Expected: Vite exits 0 with no TypeScript or bundling error.

- [ ] **Step 4: Commit the canvas change**

```bash
git add components/ControlPanel.tsx
git commit -m "fix: split Gemini image batches into single requests"
```

### Task 3: Reject Multi-Image Gemini Requests Before Billing

**Files:**
- Create: `imageRequestCount.cjs`
- Test: `imageRequestCount.test.cjs`
- Modify: `server.cjs:1-25`
- Modify: `server.cjs:3390-3408`
- Modify: `server.cjs:5478-5501`

- [ ] **Step 1: Write the failing effective-count tests**

```js
const assert = require('assert');
const { getEffectiveImageRequestCount } = require('./imageRequestCount.cjs');

describe('getEffectiveImageRequestCount', () => {
  it('reads all supported image-count fields', () => {
    assert.strictEqual(getEffectiveImageRequestCount({ n: 3 }), 3);
    assert.strictEqual(getEffectiveImageRequestCount({ candidateCount: 4 }), 4);
    assert.strictEqual(
      getEffectiveImageRequestCount({ generationConfig: { candidateCount: 2 } }),
      2,
    );
    assert.strictEqual(
      getEffectiveImageRequestCount({ generationConfig: { candidate_count: 5 } }),
      5,
    );
  });

  it('returns one for missing or invalid counts', () => {
    assert.strictEqual(getEffectiveImageRequestCount({}), 1);
    assert.strictEqual(getEffectiveImageRequestCount({ n: 'invalid' }), 1);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- imageRequestCount.test.cjs`

Expected: FAIL because `imageRequestCount.cjs` does not exist.

- [ ] **Step 3: Implement the shared count resolver**

```js
const getEffectiveImageRequestCount = (requestBody = {}) => {
  const parsed = Number.parseInt(
    String(
      requestBody.n ||
        requestBody.candidateCount ||
        requestBody.generationConfig?.candidateCount ||
        requestBody.generationConfig?.candidate_count ||
        1,
    ),
    10,
  );
  return Math.max(1, Number.isFinite(parsed) ? parsed : 1);
};

module.exports = { getEffectiveImageRequestCount };
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- imageRequestCount.test.cjs`

Expected: 2 tests PASS.

- [ ] **Step 5: Use the resolver in both server endpoints**

Import the helper near the other local CommonJS imports:

```js
const { getEffectiveImageRequestCount } = require('./imageRequestCount.cjs');
```

Replace the inline count parsing in `POST /api/generate` with:

```js
const geminiRequestedCount = getEffectiveImageRequestCount(requestBody);
if (isGeminiNativeRoute(route) && geminiRequestedCount > 1) {
  return res.status(400).json({
    error: '当前 Gemini 原生线路暂仅支持 1 张图片，请先选择 1 张生成。',
  });
}
```

Add the same block in `POST /api/gemini/generate` immediately after route
validation and before `requireBillingAccount(req)` and `reservePoints(...)`.

- [ ] **Step 6: Verify server validation tests and syntax**

Run: `npm test -- imageRequestCount.test.cjs`

Expected: 2 tests PASS.

Run: `node --check server.cjs`

Expected: exit 0 with no output.

- [ ] **Step 7: Commit the server guard**

```bash
git add imageRequestCount.cjs imageRequestCount.test.cjs server.cjs
git commit -m "fix: reject Gemini multi-image requests before billing"
```

### Task 4: Normalize The Stale VISON Route

**Files:**
- Create: `imageRouteCompatibility.cjs`
- Test: `imageRouteCompatibility.test.cjs`
- Modify: `imageRouteStore.cjs:129-171`

- [ ] **Step 1: Write failing VISON compatibility tests**

```js
const assert = require('assert');
const { normalizeImageRouteCompatibility } = require('./imageRouteCompatibility.cjs');

describe('normalizeImageRouteCompatibility', () => {
  it('routes the production VISON line through Visionary OpenAPI parsing', () => {
    const route = normalizeImageRouteCompatibility({
      id: 'nano-banana-pro-line4',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://visionary.beer',
      generatePath: '/v1beta/models/{model}:generateContent',
    });

    assert.strictEqual(route.transport, 'openai-image');
    assert.strictEqual(route.mode, 'sync');
    assert.strictEqual(route.generatePath, '/openapi/v1/images/generations');
  });

  it('does not change the Adobe Gemini route', () => {
    const adobe = {
      id: 'nano-banana-pro-线路二',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://api.pixellelabs.com',
      generatePath: '/v1beta/models/{model}:generateContent',
    };
    assert.deepStrictEqual(normalizeImageRouteCompatibility(adobe), adobe);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- imageRouteCompatibility.test.cjs`

Expected: FAIL because `imageRouteCompatibility.cjs` does not exist.

- [ ] **Step 3: Implement the focused route normalization**

```js
const VISION_ROUTE_ID = 'nano-banana-pro-line4';
const VISIONARY_GENERATE_PATH = '/openapi/v1/images/generations';

const normalizeImageRouteCompatibility = (route = {}) => {
  const isProductionVisionRoute =
    String(route.id || '').trim() === VISION_ROUTE_ID &&
    String(route.baseUrl || '').toLowerCase().includes('visionary.beer');
  if (!isProductionVisionRoute) return route;
  return {
    ...route,
    transport: 'openai-image',
    mode: 'sync',
    generatePath: VISIONARY_GENERATE_PATH,
  };
};

module.exports = {
  normalizeImageRouteCompatibility,
  VISIONARY_GENERATE_PATH,
  VISION_ROUTE_ID,
};
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- imageRouteCompatibility.test.cjs`

Expected: 2 tests PASS.

- [ ] **Step 5: Normalize routes at the store boundary**

Import the helper in `imageRouteStore.cjs`:

```js
const {
  normalizeImageRouteCompatibility,
} = require('./imageRouteCompatibility.cjs');
```

Wrap the object returned by `mapRowToRoute`:

```js
const mapRowToRoute = (row, { includeSecrets = false } = {}) =>
  normalizeImageRouteCompatibility({
    id: trimToString(row.route_id),
    label: trimToString(row.label || row.route_id),
    description: trimToString(row.description || ''),
    modelFamily: trimToString(row.model_family || 'default'),
    line: trimToString(row.line_value || 'default'),
    transport: trimToString(row.transport || 'openai-image'),
    mode: trimToString(row.mode || 'async'),
    baseUrl: trimTrailingSlash(row.base_url || ''),
    generatePath: trimToString(row.generate_path || '/v1/images/generations'),
    taskPath: trimToString(row.task_path || ''),
    editPath: trimToString(row.edit_path || ''),
    chatPath: trimToString(row.chat_path || ''),
    upstreamModel: trimToString(row.upstream_model || ''),
    useRequestModel: parseBoolean(row.use_request_model, false),
    allowUserApiKeyWithoutLogin: parseBoolean(
      row.allow_user_api_key_without_login,
      false,
    ),
    apiKeyEnv: trimToString(row.api_key_env || ''),
    pointCost: parsePoint(row.point_cost, 0),
    sizeOverrides: getMergedSizeOverrides(row),
    sortOrder: parseInteger(row.sort_order, 0),
    isActive: parseBoolean(row.is_active, true),
    isDefaultRoute: parseBoolean(row.is_default_route, false),
    isDefaultNanoBananaLine: parseBoolean(
      row.is_default_nano_banana_line,
      false,
    ),
    hasApiKey: Boolean(trimToString(row.api_key || '')),
    createdAt: row.created_at ? fromDbDateTime(row.created_at) : null,
    updatedAt: row.updated_at ? fromDbDateTime(row.updated_at) : null,
    ...(includeSecrets ? { apiKey: trimToString(row.api_key || '') } : {}),
  });
```

This normalization must happen after snake-case database columns have been
mapped to the public camel-case route shape. It therefore affects backend
routing, the public catalog, and the admin view consistently without exposing
secrets or mutating unrelated routes.

- [ ] **Step 6: Verify compatibility and existing route-store tests**

Run: `npm test -- imageRouteCompatibility.test.cjs imageRouteStore.test.cjs`

Expected: 3 tests PASS.

- [ ] **Step 7: Commit the VISON compatibility change**

```bash
git add imageRouteCompatibility.cjs imageRouteCompatibility.test.cjs imageRouteStore.cjs
git commit -m "fix: normalize VISON route transport"
```

### Task 5: Full Verification And Production Rollout Check

**Files:**
- Verify: all files modified in Tasks 1-4
- Operational update: production `image_routes` row `nano-banana-pro-line4`

- [ ] **Step 1: Run the complete automated test suite**

Run: `npm test`

Expected: all test files PASS with zero failures.

- [ ] **Step 2: Run backend syntax verification**

Run: `node --check server.cjs`

Expected: exit 0 with no output.

- [ ] **Step 3: Build the production frontend**

Run: `npm run build`

Expected: Vite exits 0 and writes the production bundle to `dist/`.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff HEAD~4 --check`

Expected: exit 0 with no whitespace errors.

Run: `git status --short`

Expected: only unrelated pre-existing untracked files remain.

- [ ] **Step 5: Correct the production route source of truth during deployment**

Update `nano-banana-pro-line4` through the super-admin route editor to these
values, while preserving its existing API key, point cost, labels, and size
overrides:

```json
{
  "transport": "openai-image",
  "mode": "sync",
  "baseUrl": "https://visionary.beer",
  "generatePath": "/openapi/v1/images/generations"
}
```

The runtime compatibility normalization protects the first deployment, but
the database row must still be corrected so the admin configuration reflects
the actual protocol.

- [ ] **Step 6: Run production smoke tests**

Generate three images on Adobe, VISON, and Official T3. Confirm Adobe and VISON
create three one-image requests, partial failures are isolated and refunded,
VISON displays `results[].url`, and Official T3 remains unchanged.
