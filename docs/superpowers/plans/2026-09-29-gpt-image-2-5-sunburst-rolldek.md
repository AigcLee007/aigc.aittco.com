# GPT-Image-2.5 Sunburst RollDek Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two RollDek Sunburst image routes with size-based pricing and expose route-specific GPT quality options, including `xhigh` and `max` on every non-backup route.

**Architecture:** Extend the image route catalog with a normalized `supportedQualities` capability and preserve it through static/MySQL loading and the public API. Store RollDek pricing in existing per-size route overrides so billing and upstream model selection use the current route-size flow. Make both React and classic UIs derive quality options from the selected route, falling back to `auto` when a route does not support a persisted value.

**Tech Stack:** TypeScript/React, vanilla classic-app JavaScript, Node.js CommonJS server, JSON catalogs, Vitest.

---

## File map

- `config/imageRoutes.json`: add the two RollDek Sunburst routes and explicit quality capabilities for all Sunburst routes.
- `src/config/imageRoutes.ts`: normalize and expose quality capability metadata and helper functions.
- `imageRouteStore.cjs`: preserve quality capabilities in static and MySQL route catalogs, including schema seeding and admin payload validation.
- `server.cjs`: include capabilities in the public route catalog.
- `src/store/selectionStore.ts`: extend the GPT quality union to include `xhigh` and `max`.
- `components/ImageFormConfig.tsx`: render route-specific quality choices and normalize unsupported persisted values.
- `public/classic-app/index.html`: add classic UI entries for `xhigh` and `max`.
- `public/classic-app/script.js`: validate and synchronize six quality values, hiding unsupported entries for backup routes.
- `src/config/imageModels.test.ts`, `imageRouteStore.test.cjs`, and focused new tests: verify catalog, normalization, and route-specific options.

### Task 1: Add route capability and pricing data

**Files:**
- Modify: `config/imageRoutes.json`
- Test: `src/config/imageModels.test.ts`

- [ ] **Step 1: Add explicit quality capability data to the four existing Sunburst routes.**

Use `supportedQualities: ["auto", "low", "medium", "high", "xhigh", "max"]` on stable, official, and the two new RollDek routes. Use `supportedQualities: ["auto", "low", "medium", "high"]` on `gpt-image-2.5-sunburst-backup`.

- [ ] **Step 2: Add the RollDek native route.**

Add route `gpt-image-2.5-sunburst-native` with label/line `原生线路`, `transport: "openai-image"`, `mode: "sync"`, `baseUrl: "https://rolldek.com"`, generation/edit paths `/v1/images/generations` and `/v1/images/edits`, API key env `ROLL_IMAGE2.5_BIG_KEY`, and size overrides:

```json
"sizeOverrides": {
  "1k": { "upstreamModel": "gpt-image-2.5-sunburst", "pointCost": 3.5 },
  "2k": { "upstreamModel": "gpt-image-2.5-sunburst-2k", "pointCost": 4 },
  "4k": { "upstreamModel": "gpt-image-2.5-sunburst-4k", "pointCost": 4.5 }
}
```

Set `pointCost` to `3` as the fallback and `sortOrder` to `2`.

- [ ] **Step 3: Add the RollDek high-quality route.**

Add route `gpt-image-2.5-sunburst-max` with label/line `官渠高质`, the same transport/mode/base/path values, API key env `ROLL_IMAGE2.5_MAX_KEY`, and size overrides with upstream models matching the native route and point costs `5`, `5.5`, and `6`. Set fallback `pointCost` to `5` and `sortOrder` to `3`; move the existing backup route to `sortOrder: 4`.

- [ ] **Step 4: Extend the catalog test with exact route assertions.**

Assert Sunburst has five routes ordered `稳定线路`, `官key线路`, `原生线路`, `官渠高质`, `备用线路`; assert both RollDek URLs/key envs, all three size upstream models, all three size point costs, and quality arrays; assert backup retains the four-value array.

- [ ] **Step 5: Run the focused catalog test and verify it fails before implementation support is added.**

Run: `npx vitest run src/config/imageModels.test.ts --maxWorkers=1 --exclude ".worktrees/**"`

Expected: failures for the new route count/data until the catalog changes are complete.

### Task 2: Normalize and persist route quality capabilities

**Files:**
- Modify: `src/config/imageRoutes.ts`
- Modify: `imageRouteStore.cjs`
- Modify: `server.cjs`
- Test: `imageRouteStore.test.cjs`
- Test: `src/config/imageModels.test.ts`

- [ ] **Step 1: Define the shared quality values and route field in TypeScript.**

Add `ImageRouteQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`, `supportedQualities?: ImageRouteQuality[]`, and a default constant containing all six values. Normalize input arrays by filtering to those values, de-duplicating, and defaulting to all six when absent or empty.

- [ ] **Step 2: Add a helper for route quality options.**

Implement `getImageRouteSupportedQualities(route?: ImageRouteConfig | null): ImageRouteQuality[]` returning the normalized route list or the six-value default. Add tests for backup and non-backup routes.

- [ ] **Step 3: Preserve the field in the CommonJS route store.**

Add `normalizeSupportedQualities`, `stringifySupportedQualities`, and a static-row `supported_qualities` value. Add `supported_qualities LONGTEXT NULL` to the table definition and an idempotent `ALTER TABLE ... ADD COLUMN` check. Merge static defaults when reading rows so existing MySQL rows receive the catalog capability until explicitly updated. Include the field in `mapRowToRoute` and `validateRoutePayload` so admin writes retain it.

- [ ] **Step 4: Expose the field through the public API.**

Add `supportedQualities: Array.isArray(route.supportedQualities) ? route.supportedQualities : undefined` to `toPublicImageRoute`. Keep API keys private.

- [ ] **Step 5: Add persistence/public catalog tests.**

Extend `imageRouteStore.test.cjs` to assert static catalogs retain the field and route store source includes schema/mapper handling. Add a TypeScript test that normalizes an absent field to all six values.

- [ ] **Step 6: Run route/catalog tests.**

Run: `npx vitest run src/config/imageModels.test.ts imageRouteStore.test.cjs --maxWorkers=1 --exclude ".worktrees/**"`

Expected: PASS.

### Task 3: Extend React quality state and controls

**Files:**
- Modify: `src/store/selectionStore.ts`
- Modify: `components/ImageFormConfig.tsx`
- Test: `src/config/imageModels.test.ts` or a focused component test

- [ ] **Step 1: Extend the selection-store type and setter.**

Replace both four-value GPT quality unions with `ImageRouteQuality` (or the equivalent six-value union), keep the initial value `auto`, and preserve the existing persisted state key.

- [ ] **Step 2: Derive the selected route’s supported choices.**

In `ImageFormConfig`, import `getImageRouteSupportedQualities`, define labels for `auto/low/medium/high/xhigh/max`, and memoize the options from `selectedRoute`. Use an effect that calls `setGptImageQuality('auto')` when the current value is not in the selected route’s supported list. Render the memoized list and pass the selected value through unchanged.

- [ ] **Step 3: Add focused assertions.**

Verify the helper returns four choices for the backup route and six for stable/official/native/max routes. Verify the quality setter accepts `xhigh` and `max` at compile/test time through the component/store test path.

- [ ] **Step 4: Run TypeScript-focused tests.**

Run: `npx vitest run src/config/imageModels.test.ts src/test/controlPanel.property.test.ts --maxWorkers=1 --exclude ".worktrees/**"`

Expected: PASS.

### Task 4: Update the classic UI quality menu

**Files:**
- Modify: `public/classic-app/index.html`
- Modify: `public/classic-app/script.js`
- Test: new `public/classic-app` focused test or existing classic bundle assertions

- [ ] **Step 1: Add `xhigh` and `max` menu entries.**

Add two dropdown items after `high` with values `xhigh` and `max`, labels `超高` and `最高`, preserving the existing `auto/low/medium/high` entries.

- [ ] **Step 2: Expand classic local-storage validation.**

Update `getClassicGptSettings` to accept all six values. Keep malformed or unsupported values falling back to `auto`.

- [ ] **Step 3: Synchronize route-specific visibility.**

Use the loaded image route catalog and selected route ID/line to read `supportedQualities`. In `updateClassicGptSettingsUi`, hide or disable quality items outside the selected route’s capabilities, and if the stored value is hidden, remove it from storage and select `auto`. Re-run this synchronization whenever the route changes and on initial catalog load.

- [ ] **Step 4: Add classic assertions.**

Test the settings parser accepts `xhigh`/`max`, rejects an unknown value, and route synchronization leaves four visible choices for backup and six for each other Sunburst route.

- [ ] **Step 5: Run the classic-focused test/build check.**

Run the relevant classic tests if present; otherwise run `npm run build` and assert the generated bundle contains the new quality values.

### Task 5: End-to-end verification and integration commit

**Files:**
- Modify only implementation/test files from Tasks 1–4.

- [ ] **Step 1: Run the complete focused regression set.**

Run:

```powershell
npx vitest run src/config/imageModels.test.ts imageRouteStore.test.cjs imageRouteCompatibility.test.cjs --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: PASS.

- [ ] **Step 2: Build the application.**

Run: `npm run build`

Expected: Vite build completes successfully.

- [ ] **Step 3: Inspect the final diff.**

Run: `git diff --check` and `git status --short`; confirm no unrelated cache/image files are staged and route IDs, env names, prices, and quality arrays match the approved spec.

- [ ] **Step 4: Commit the implementation.**

```powershell
git add config/imageRoutes.json src/config/imageRoutes.ts imageRouteStore.cjs server.cjs src/store/selectionStore.ts components/ImageFormConfig.tsx public/classic-app/index.html public/classic-app/script.js src/config/imageModels.test.ts imageRouteStore.test.cjs
 git commit -m "feat: add RollDek Sunburst image routes"
```
