# Gemini Omni Flash PixelHub Contract Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini Omni Flash send PixelHub's verified `image_urls` and `video_urls` contract without leaking signed media URLs or changing Sora/Veo media aliases.

**Architecture:** Keep the browser-to-server request contract unchanged and make `normalizePixelHubVideoRequest` the sole model-specific provider adapter. Return a separate count-only provider summary for persisted generation metadata, and centralize the documented polling interval/deadline as exported client constants.

**Tech Stack:** Node.js CommonJS, TypeScript, Axios, Vitest, Vite

---

## File Structure

- Modify `videoRequestPolicy.cjs`: validate HTTPS media and build model-specific PixelHub bodies plus a count-only summary.
- Modify `videoRequestPolicy.test.cjs`: regression coverage for Gemini, Sora, Veo, legacy alias exclusion, and summary privacy.
- Modify `server.cjs`: persist only the provider summary in generation metadata.
- Modify `services/videoService.ts`: use 12-second polling and a 30-minute deadline.
- Modify `services/videoService.test.ts`: lock polling constants and preserve the internal request contract.

### Task 1: Repair The Model-Specific PixelHub Adapter

**Files:**
- Modify: `videoRequestPolicy.test.cjs`
- Modify: `videoRequestPolicy.cjs`

- [ ] **Step 1: Replace the Gemini regression test and add image-only, privacy, and HTTPS cases**

Update the Gemini tests so the combined request expects this exact body:

```js
assert.deepStrictEqual(result.upstreamBody, {
  model: 'gemini-omni-flash',
  prompt: 'city at night',
  aspect_ratio: '16:9',
  duration: 10,
  resolution: '1080p',
  image_urls: ['https://app.test/a.jpg'],
  video_urls: ['https://app.test/a.mp4'],
});
for (const field of ['image_url', 'reference_image_urls', 'reference_video', 'reference_videos', 'generate_audio']) {
  assert.ok(!(field in result.upstreamBody));
}
assert.deepStrictEqual(result.providerSummary, {
  model: 'gemini-omni-flash',
  referenceImageCount: 1,
  referenceVideoCount: 1,
});
const serializedSummary = JSON.stringify(result.providerSummary);
assert.ok(!serializedSummary.includes('https://'));
assert.ok(!serializedSummary.includes('Authorization'));
assert.ok(!serializedSummary.includes('Bearer'));
```

Add a Gemini image-only test that asserts `image_urls` exists and `video_urls` does not. Extend the invalid-reference test with `http://app.test/insecure.jpg` and expect an `/https/i` validation error. Keep the existing Sora and Veo alias assertions unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: FAIL because Gemini still emits `reference_image_urls`, `reference_videos`, and `generate_audio`, does not return `providerSummary`, and accepts HTTP URLs.

- [ ] **Step 3: Implement the minimal model-specific mapping**

Change media URL validation to require `https://`. Build the base body without `generate_audio`, then apply exact model branches:

```js
const upstreamBody = {
  model: expectedModel,
  prompt,
  aspect_ratio: aspectRatio,
  duration,
  resolution,
};

if (expectedModel === 'gemini-omni-flash') {
  if (images.length) upstreamBody.image_urls = images;
  if (videos.length) upstreamBody.video_urls = videos;
} else if (model.referenceImageMode === 'frames') {
  if (images.length) upstreamBody.image_urls = images;
  upstreamBody.generate_audio = true;
} else {
  if (images.length) upstreamBody.reference_image_urls = images;
  if (videos.length) upstreamBody.reference_videos = videos;
  upstreamBody.generate_audio = true;
}

return {
  upstreamBody,
  providerSummary: {
    model: expectedModel,
    referenceImageCount: images.length,
    referenceVideoCount: videos.length,
  },
  pointCost: toNonNegativePoint(duration * Number(model.pointCostPerSecond || 0), 0),
};
```

This preserves Sora and Veo's current non-Gemini audio behavior while changing only Gemini's contract.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: all `normalizePixelHubVideoRequest` tests pass.

- [ ] **Step 5: Commit the adapter repair**

```bash
git add videoRequestPolicy.cjs videoRequestPolicy.test.cjs
git commit -m "fix: repair Gemini PixelHub media aliases"
```

### Task 2: Persist A Count-Only Provider Summary

**Files:**
- Modify: `videoRequestPolicy.test.cjs`
- Modify: `server.cjs`

- [ ] **Step 1: Add a failing server wiring assertion**

Extend the endpoint source-order test with:

```js
assert.ok(endpoint.includes('const { upstreamBody, providerSummary, pointCost }'));
const recordStart = endpoint.indexOf('generationRecord = await buildGenerationRecordPayload');
const recordEnd = endpoint.indexOf('const response = await requestWithRetry', recordStart);
const recordCall = endpoint.slice(recordStart, recordEnd);
assert.ok(recordCall.includes('providerSummary,'));
assert.ok(!recordCall.includes('image_urls'));
assert.ok(!recordCall.includes('video_urls'));
assert.ok(!recordCall.includes('Authorization'));
```

The scoped assertions prove generation metadata does not persist provider media
fields or credentials while allowing the later Axios call to use `upstreamBody`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: FAIL because `server.cjs` does not yet destructure or persist `providerSummary`.

- [ ] **Step 3: Wire the safe summary into generation metadata**

Update normalization destructuring:

```js
const { upstreamBody, providerSummary, pointCost } = normalizePixelHubVideoRequest({
  body: materializedBody,
  model: requestedVideoModel,
  upstreamModel: route.upstreamModel || requestedVideoModel.requestModel || requestedVideoModel.id,
});
```

Add only the safe summary to the generation record metadata:

```js
meta: {
  transport: route.transport,
  routeMode: route.mode,
  duration: upstreamBody.duration,
  pricingMode: requestedVideoModel?.pricingMode || 'fixed',
  pointCostPerSecond: requestedVideoModel?.pointCostPerSecond || null,
  providerSummary,
},
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- videoRequestPolicy.test.cjs
```

Expected: all focused policy and server-wiring tests pass.

- [ ] **Step 5: Commit the summary wiring**

```bash
git add server.cjs videoRequestPolicy.test.cjs
git commit -m "fix: persist safe PixelHub request summaries"
```

### Task 3: Align Polling With The Provider Contract

**Files:**
- Modify: `services/videoService.test.ts`
- Modify: `services/videoService.ts`

- [ ] **Step 1: Write the failing polling-constant test**

Import both constants and add:

```ts
import {
  buildInternalVideoRequest,
  VIDEO_POLL_DEADLINE_MS,
  VIDEO_POLL_INTERVAL_MS,
} from './videoService';

it('polls PixelHub every 12 seconds for at most 30 minutes', () => {
  expect(VIDEO_POLL_INTERVAL_MS).toBe(12_000);
  expect(VIDEO_POLL_DEADLINE_MS).toBe(30 * 60 * 1000);
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
npm test -- services/videoService.test.ts
```

Expected: FAIL because the interval is 10 seconds and the deadline is not exported.

- [ ] **Step 3: Implement the polling constants**

Change the constants and use the deadline in `pollVideoTask`:

```ts
export const VIDEO_POLL_INTERVAL_MS = 12_000;
export const VIDEO_POLL_DEADLINE_MS = 30 * 60 * 1000;
```

Replace `const maxDuration = 15 * 60 * 1000;` and its comparison with `VIDEO_POLL_DEADLINE_MS`.

- [ ] **Step 4: Run the service test and verify GREEN**

Run:

```bash
npm test -- services/videoService.test.ts
```

Expected: all video service tests pass.

- [ ] **Step 5: Commit the polling repair**

```bash
git add services/videoService.ts services/videoService.test.ts
git commit -m "fix: align PixelHub video polling limits"
```

### Task 4: Full Verification

**Files:**
- Verify: `videoRequestPolicy.cjs`
- Verify: `server.cjs`
- Verify: `services/videoService.ts`

- [ ] **Step 1: Run focused regression tests**

```bash
npm test -- videoRequestPolicy.test.cjs services/videoService.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the full repository test suite**

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run syntax and production build checks**

```bash
node --check videoRequestPolicy.cjs
node --check server.cjs
npm run build
```

Expected: both syntax checks and the Vite production build exit with code 0.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff HEAD~3 --check
git status --short
```

Expected: no whitespace errors; only unrelated pre-existing user files remain untracked.

- [ ] **Step 5: Deployment-only validation**

After deployment, run one controlled Gemini image-plus-video generation and confirm the output follows both the reference image and source-video motion/environment. This requires live PixelHub credentials and is not part of the local automated verification.
