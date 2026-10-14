# 全线路生图异步与断网恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 所有生图线路在 VIP 和画布中异步受理，断网恢复结果与费用一致。

**Architecture:** 独立任务存储和后台执行服务复用既有三个线路处理器；资产服务返回小 URL；两端共享任务编号和请求编号恢复协议。

**Tech Stack:** Node/Express、MySQL/file store、Sharp、React/Zustand、原生 VIP JavaScript、Node test/Vitest。

## Task 1: 持久任务与接口

Files: create imageJobStore.cjs, imageJobService.cjs, imageJobService.test.cjs; modify server.cjs, Dockerfile, docker-compose.yml as needed.

- [x] Write failing tests for submit ack before upstream, duplicate concurrent requests with one execution, fingerprint conflict, owner-only polling, background completion/failure settlement, restart reconciliation; run `node --test imageJobService.test.cjs` and confirm missing behavior.
- [x] Implement submit({req,res,endpoint,execute}), route adapters for /api/generate,/api/edit,/api/gemini/generate, GET /api/image-jobs/request/:requestId and GET /api/task/:taskId for task IDs prefixed job-. Client contract uses asyncTask:true and clientRequestId. Small result payload: {task_id,id,status,results,images,data:[{url}],storage_status,preview_url}; statuses queued/processing/succeeded/failed.
- [x] Persist tasks before ack with unique owner/request ID; enforce same-payload fingerprint; store charge and generation record associations before upstream call, reusing idempotent existing refund code. Track native inner task ID and poll without browser. Recover queued/native tasks on restart, never replay uncertain running sync calls, compensate interrupted charges once. Bounded worker, deadline and cleanup; request validation/auth before accepting.
- [x] Verify real endpoint/worker behavior with simulated delayed upstream, disconnected response, storage/settlement error, and standalone store tests.

## Task 2: All-line result assets

Files: create imageJobAssets.cjs, imageJobAssets.test.cjs; only modify generatedAssetService.cjs if necessary. Runtime dependency and volume changes coordinated with Task 1.

- [x] Write failing tests for inline image saved and usable after fresh service, compact payload without base64, remote result immediate while download unresolved, URL replaced after save, bounded download, storage fail retry, traversal/private source rejection, 72h cleanup; run `node --test imageJobAssets.test.cjs`.
- [x] Export createImageJobAssets(options) with `prepare({payload,resultUrls,context,onSaved})` returning {payload,resultUrls,previewUrl,storageStatus}; inline await atomic write, remote return immediately and invoke onSaved upon completion. Export STORAGE_ROOT and attach signed asset route: task polling verifies the owner and issues scoped, expiring capabilities so image elements need no custom authentication header. Use unpredictable IDs and user/task directories, atomic writes, rate/concurrency bounds; no full result retained in job memory.
- [x] Verify with tiny real image fixtures and controlled HTTP source, no production requests. Document TTL and failure status.

## Task 3: Canvas and VIP recovery

Files: modify services/api.ts, components/ControlPanel.tsx, src/hooks/useGlobalPolling.ts, public/classic-app/unified-bridge.js; create frontend recovery helpers/tests.

- [x] Write failing tests for all API sends asyncTask and unique stable request ID, Gemini task acknowledgment handling, failed request ack recovered without new generation, temporary poll failure not final, page reload/account scoping, polling success/no-image failure.
- [x] Send asyncTask:true/clientRequestId for all image calls; recover ack by GET /api/image-jobs/request/:requestId using same account credentials; persist unresolved IDs in browser and reuse them for retry. Network failures keep recoverable state; successful ack joins existing polling. Gemini ControlPanel accepts taskId and passes it to onUpdateGeneration.
- [x] VIP single-image request IDs preserve per-task pricing and batch semantics; all routes including Gemini/native/reference/edit reuse polling; account-safe reload/focus/online recovery. Previews use available image URL, server saving status never claims already-saved early.
- [x] Run Vitest and controlled browser/harness tests.

## Task 4: Integration, review and delivery

Files: Dockerfile/docker-compose.yml/.env.example, docs/image-async-recovery.md, relevant integration tests.

- [x] Inspect actual implementation against design with independent spec reviewer then code quality reviewer; fix all material findings.
- [x] Run targeted Node + Vitest tests, `npx tsc --noEmit`, `npm run build`, `git diff --check`; verify queue/asset paths are on persistent volume and production requires no new external service.
- [x] Provide measured local submit/render timing and fault-injection evidence with practical limits. Commit verified code on codex/image-async-recovery; preserve original checkout and pending changes. Never modify historical user balances.
