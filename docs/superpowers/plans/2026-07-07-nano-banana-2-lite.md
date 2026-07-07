# Nano Banana 2-Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Nano Banana 2-Lite` as an image model with Nano Banana 2-compatible route behavior and 1K-only output sizing.

**Architecture:** The app already reads image model and route catalogs from `config/imageModels.json` and `config/imageRoutes.json`. This change adds a static model entry and copies Nano Banana 2 routes into a separate Lite route family so the selector, route dropdown, pricing, and API routing continue to use existing catalog helpers.

**Tech Stack:** TypeScript, Vite, Vitest, JSON catalog configuration.

---

### Task 1: Catalog Regression Test

**Files:**
- Create: `src/config/imageModels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  getDefaultImageSizeForModel,
  getImageModelById,
  getImageModelOptions,
  getImageModelSizeOptions,
} from './imageModels';
import { getImageRouteOptions, getImageRoutesByModelFamily } from './imageRoutes';

describe('Nano Banana 2-Lite catalog', () => {
  it('registers Nano Banana 2-Lite as a 1K-only Nano Banana 2-compatible model', () => {
    const model = getImageModelById('nano-banana-2-lite');

    expect(model.label).toBe('Nano Banana 2-Lite');
    expect(model.panelLayout).toBe('nano-banana');
    expect(model.sizeBehavior).toBe('passthrough');
    expect(model.defaultSize).toBe('1k');
    expect(getImageModelSizeOptions(model.id)).toEqual(['1k']);
    expect(getDefaultImageSizeForModel(model.id)).toBe('1k');
    expect(getImageModelOptions().map((option) => option.id)).toContain('nano-banana-2-lite');
  });

  it('gives Nano Banana 2-Lite its own routes copied from Nano Banana 2', () => {
    const originalRoutes = getImageRoutesByModelFamily('nano-banana-2');
    const liteRoutes = getImageRoutesByModelFamily('nano-banana-2-lite');

    expect(liteRoutes).toHaveLength(originalRoutes.length);
    expect(liteRoutes.map((route) => route.line)).toEqual(originalRoutes.map((route) => route.line));
    expect(liteRoutes.map((route) => route.transport)).toEqual(originalRoutes.map((route) => route.transport));
    expect(liteRoutes.every((route) => route.modelFamily === 'nano-banana-2-lite')).toBe(true);
    expect(getImageRouteOptions('nano-banana-2-lite').map((option) => option.value)).toEqual(
      getImageRouteOptions('nano-banana-2').map((option) => option.value),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/config/imageModels.test.ts`

Expected: FAIL because `nano-banana-2-lite` is not yet present.

### Task 2: Catalog Entries

**Files:**
- Modify: `config/imageModels.json`
- Modify: `config/imageRoutes.json`

- [ ] **Step 1: Add model config**

Add an entry with `id`, `modelFamily`, and `routeFamily` set to `nano-banana-2-lite`; use the Nano Banana 2 visual and request settings, but set `label` to `Nano Banana 2-Lite`, `defaultSize` to `1k`, and `sizeOptions` to `["1k"]`.

- [ ] **Step 2: Add route configs**

Copy each `nano-banana-2` route into a `nano-banana-2-lite` route with matching line, transport, mode, URLs, upstream model, key env, cost, activity, and sort order.

- [ ] **Step 3: Run focused tests**

Run: `npx vitest --run src/config/imageModels.test.ts`

Expected: PASS.

### Task 3: Final Verification

**Files:**
- No additional files.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.
