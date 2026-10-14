# Classic gallery stability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Keep classic generation/gallery cards stable, recover local originals first, share image bytes with canvas, and bound loading/memory while automatically downloading each new result once.

**Architecture:** A browser-compatible ImageResultStore uses the existing canvas keyval-store/keyval database, immutable owner/job/output IDs, owner-scoped source aliases, committed cache flags and atomic download claims. Classic retains its legacy history database and Blob fallback, but uses keyed cards and serialized record upserts; canvas adopts the shared result identity without changing existing assetStorage consumers. Preview queues and original caching remain separate and bounded.

**Tech Stack:** Vanilla browser JavaScript, TypeScript/React, IndexedDB, Node test/VM/JSDOM, Vitest/fake-indexeddb, Playwright Chrome.

---

## Task 1: Shared original/preview repository and canvas compatibility

Files: create public/shared/image-result-store.js, src/services/imageResultStore.ts and focused tests; modify src/services/imageAssetCache.ts, src/services/assetStorage.ts and src/hooks/useGenerationLogic.ts.

- [x] Add failing tests for owner/job/output identity, source changes, committed Blob flags, preview-only state, transaction abort, atomic download claims, account isolation and explicit legacy migration. Run the tests and confirm failures before implementing.
- [x] Implement global ImageResultStore with resultId, register, find, getOriginal, getPreview, putOriginal, putPreview, getState, claimDownload, markDownloadStarted and explicit legacy adoption. Use asset-<id>, asset-preview-<id>, asset-meta-<id> for bytes and result-info-<id> plus result-source-<owner>-<url> for result metadata. Resolve writes only on transaction completion. Reuse one connection, close on versionchange, bound blocked/read/write operations.
- [x] Add a 384 MiB shared byte budget (128 MiB on mobile); reclaim only unpinned reproducible cloud-backed assets whose expiry is still safely in the future. Never silently delete expired local-only originals. Quota failure stays visible and does not report originalCached.
- [x] Register canvas generated results with generationOwnerId, taskId/clientRequestId (fallback node ID for legacy/unmanaged generations) and output index. Pass explicit result identity to caching; preserve assetStorage legacy ID reads. Source aliases are scoped to the owner, never guessed from prompts.
- [x] Share auto-download preference using image-auto-download-v1; preserve existing canvas setting on first migration. Cache/download must share one original read; original storage/download itself must not decode large images. Guard canvas cleanup against deleting shared originals based only on canvas node references.
- [x] Run shared repository tests and existing canvas asset/memory tests. Commit the working unit.

## Task 2: Stable classic records, keyed cards and local-first history

Files: public/classic-app/script.js, public/classic-app/unified-bridge.js; create public/classic-app/gallery-stability.test.cjs; update affected existing classic tests.

- [x] Add regressions reproducing update-time reorder, repeated completion timestamp changes, card disconnection, parallel-history lost writes, stale responses, multi-output and provider/site URL replacement. Confirm each fails for the intended reason.
- [x] Sort tasks by immutable createdAt descending, batch output index ascending, fixed ID tie-break. Preserve supplied createdAt and first completedAt. Ignore no-op status updates. Stable output identity is ownerId + managed job ID + output index; retain IDs while promoting temporary tasks.
- [x] Retain connected unchanged generation and gallery cards. Insert/move only if the next keyed node differs; remove/release only disappeared nodes. Patch status/metadata in place and rebind only when image input changes. Preserve selected generation and gallery scroll position.
- [x] Extend normalized history metadata with ownerId, jobId, outputIndex, assetId, storageStatus and immutable times. Serialize atomic upserts; avoid whole-array read/write loss and preserve other owners. Keep old ownerless records available only through their legacy compatibility path until ownership is explicitly established.
- [x] Render current-owner local records before starting remote fetch. Merge server results asynchronously with stable identity, pagination 24 desktop / 12 mobile, session + request-generation guards and coalesced refreshes. API failure keeps local cards visible. Process every output, including late preview/site storage changes.
- [x] Keep bounded asset-finalization queries for known storage_status pending jobs after generation settles, without settling UI/billing counters twice. Stop at saved/failed/expiry or account switch.
- [x] Run classic job/model/gallery/memory tests and commit.

## Task 3: Classic cache/download lifecycle, truthful UI and bounded reads

Files: public/classic-app/image-runtime.js, script.js, index.html, relevant styles, runtime/download integration tests.

- [x] Add failing tests for queue wait vs execution timeout, queue cancellation/capacity, truthful committed cache flags, preview surviving original expiry, cached-original reuse without decoding and repeated/multitab automatic-download deduplication.
- [x] Load ImageResultStore before classic script, integrate repository reads/writes with confirmed-owner legacy Blob fallback. Queue original caching for all new/recovered successes, including mobile and when gallery is closed. Cache/download concurrency 1, preview network at most 3 and preview decode 1. Preserve original when preview preparation fails.
- [x] Replace overall queued-operation timeout with bounded cancellable queue wait and execution timeout starting only after admission; show 等待读取 while queued. Offscreen cancellation must release queue items and leases. Maintain a small preview byte/count budget and release original object URLs after use.
- [x] Add default-on automatic-original-download toggle, synchronized with canvas preference. Reserve persistent per-result download intent before triggering browser download; never automatically duplicate an ambiguous intent after refresh. Use serialized downloads and original bytes from the same cache read. Supply manual 下载原图 / 下载未处理原图.
- [x] Display 原图已缓存（本浏览器）, 仅预览已缓存, 云端暂存, 已发起下载, 缓存空间不足 and 原图已过期 accurately. Add 从本地恢复 picker tied to the specific record; commit selected original, regenerate preview, patch only that card. Retain the 4-hour notice / 5-hour server policy.
- [x] Run runtime/gallery/job/canvas regressions and commit.

## Task 4: Integration review, browser verification and delivery

- [x] Request independent spec review against the approved proposal, then quality review. Correct material findings and rerun focused checks.
- [x] Browser QA with mocked non-billing APIs and real IndexedDB: desktop/mobile, local-first slow/offline history, refresh, two-tab download claims, local-file recovery, and 50/100 synthetic results. Verify stable DOM identity, bounded decoded previews and released object URLs, no original bytes in list markup. Simultaneous completion and delayed storage publication also verified by focused integration regressions.
- [x] Run node --test classicImageJobs.test.cjs public/classic-app/image-runtime.test.cjs public/classic-app/image-memory.test.cjs public/classic-app/gallery-stability.test.cjs public/classic-app/result-assets.test.cjs; npm test -- classicModelCatalog.test.cjs src/services/imageAssets.test.ts src/services/imageMemoryBudget.test.ts src/services/imageJobClient.test.ts src/services/imageResultStore.test.ts src/services/canvasResultIdentity.test.ts src/services/imageAutoDownloadPreference.test.ts; npx tsc --noEmit; npm run build -- --outDir D:/image-async-recovery-build; git diff --check.
- [x] Update proposal/plan with actual verification and limitations. Commit and push codex/image-async-recovery using per-command proxy http://127.0.0.1:7900; verify remote SHA. Supply production git update/build/restart commands matching existing deployment docs, without deploying production here.

## Review checklist

All eight acceptance scenarios in the approved proposal map to tasks 1–4. Browser download invocation cannot prove file completion; show 已发起下载. Ownerless legacy assets remain intact. Cloud retention does not shorten local-cache life. Read retries never initiate paid generation.

## Verification notes

2026-10-15: all tasks implemented and reviewed. Independent shared-storage spec/quality, runtime and classic spec/quality reviews approved. Final focused Node 98 and Vitest 53 tests pass; TypeScript, syntax, diff checks and the production build pass. Existing bundle-size and Browserslist warnings remain.

Chrome real IndexedDB QA with 100 synthetic 4K originals confirmed desktop/mobile 24/12 paging, 8 visible preview reads, 0 original reads, decoder peak 1 and Object URL peak 8 after three paging cycles. A 50-record mobile page remained bounded at 12 cards. Failed slow history retained connected cards; offline authentication retained the exact session's confirmed owner and local previews; actual file recovery and download preserved SHA256; two actual tabs issued one automatic download.

Final quality findings corrected: owner changes invalidate the closure reader even across tabs, and failed original preparation can resume independently with backoff without blocking subsequent task recovery or repeating UI settlement. Code committed and pushed as dc7de1d; remote SHA verified. Full delivery evidence, deployment instructions and limits are in docs/classic-gallery-stability.md.
