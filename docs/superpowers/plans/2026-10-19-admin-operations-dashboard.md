# Admin Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes for tracking.

**Goal:** Build the first phase of an admin operations dashboard that shows durable image-job capacity, queue health, failures, affected users, task timelines, resource snapshots, and historical trends with low database overhead.

**Architecture:** Keep the existing admin dashboard and authorization. Add a single process-local runtime snapshot sourced from the image-job scheduler, an optional MySQL-backed operations store for task facts/events/minute buckets/incidents, and read-only admin APIs that serve cached/aggregated data. Add a focused operations UI section with independent 20-second live and 100-second historical refreshes; polling never triggers provider work, settlement, or full task/ledger scans.

**Tech Stack:** React 19, TypeScript, Express 5, CommonJS services, MySQL 8 via mysql2, Vitest, Node's built-in test runner, Docker Compose.

---

## Scope

Implement phase one from `docs/superpowers/specs/2026-10-16-admin-operations-dashboard-proposal.md`. Cover logged-in durable image jobs. Preserve explicit coverage labels for video, legacy synchronous/anonymous image requests, and historical periods before telemetry was deployed. Do not add admin-triggered generation retries, refunds, concurrency edits, or a Docker socket mount inside the app. Use the approved bounded host Python/systemd collector to publish a read-only JSON snapshot; read cgroup and volume capacity in the app, reporting unavailable sources rather than fabricating values.

## File Map

| File | Responsibility |
| --- | --- |
| `operationsDashboardStore.cjs` | MySQL schema, task facts, safe events, aggregates, filtered queries, incident state, retention. |
| `operationsDashboardStore.test.cjs` | Store schema, sanitization, retention, pagination, aggregation tests with an injected pool. |
| `operationsRuntimeMetrics.cjs` | Process/cgroup/host/volume snapshot parsing and bounded event-loop sampling. |
| `operationsRuntimeMetrics.test.cjs` | Resource parser tests using injected file readers/clock. |
| `imageJobService.cjs` | Expose scheduler configuration and a read-only live runtime snapshot; publish lifecycle callbacks. |
| `imageJobService.test.cjs` | Snapshot semantics, configured limits, upstream queue vs local queue, and telemetry isolation. |
| `server.cjs` | Initialize operations services, expose admin-only summary/trend/task/failure/incidents endpoints, record sanitized task lifecycle facts. |
| `server.admin-operations.test.cjs` | Admin authorization, response contracts, filters, redaction, coverage/freshness, and no mutation/provider calls. |
| `src/services/adminOperationsService.ts` | Typed client for operations endpoints and filters. |
| `src/services/adminOperationsService.test.ts` | Request parameters, auth headers, response parsing and error cases. |
| `components/AdminOperationsPanel.tsx` | Responsive operations dashboard, queue/route/failure summaries, trends, task filters/details and freshness. |
| `components/AdminOperationsPanel.test.tsx` | Loading/error/empty/data states, refresh cadence, filters, stale data and navigation. |
| `components/AdminDashboardPage.tsx` | Add the operations section, foreground visibility behavior and 20/100-second polling lifecycle. |
| `components/AdminDashboardPage.test.tsx` | Admin-only section access, intervals, hidden-page pause and cleanup. |
| `docker-compose.yml` | Configure bounded container log rotation without mounting the Docker socket. |
| `.env.example` | Document configurable telemetry retention and collection intervals if configuration is needed. |
| `docs/image-async-recovery.md` | Document data coverage, deployment effects, log rotation and operations-dashboard acceptance checks. |

## Task 1: Safe Operations Store

**Files:**
- Create: `operationsDashboardStore.cjs`
- Create: `operationsDashboardStore.test.cjs`
- Use: `db.cjs` injected `pool` and configured-MySQL detection.

- [x] **Step 1: Write failing store tests**

Test through an injected fake pool that records SQL and returns controlled rows. Assert `init()` creates only bounded indexed tables; `upsertTaskFact(taskId, fact)` uses task ID as an idempotency key; `appendEvent(event)` rejects or redacts authorization, session tokens, API keys, signed asset URLs, prompts, and base64; list queries bind time/status/user/route filters, clamp page size to 50, and use a stable `(created_at, task_id)` cursor; aggregate queries only use a bounded requested window; retention deletes only expired telemetry rows. Verify MySQL-unavailable mode reports `available: false` and returns explicit unsupported coverage rather than zero-filled history.

- [x] **Step 2: Run the store tests and confirm expected failures**

Run: `node --test operationsDashboardStore.test.cjs`
Expected: FAIL because the operations store module is absent.

- [x] **Step 3: Implement the store contract**

Use four tables in the existing MySQL database:

```sql
CREATE TABLE IF NOT EXISTS ops_task_facts (
  task_id VARCHAR(100) PRIMARY KEY,
  request_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  user_label VARCHAR(255) NULL,
  ui_mode VARCHAR(20) NOT NULL,
  model_id VARCHAR(160) NULL,
  route_id VARCHAR(160) NULL,
  status VARCHAR(24) NOT NULL,
  phase VARCHAR(32) NOT NULL,
  storage_status VARCHAR(24) NULL,
  settlement_status VARCHAR(24) NOT NULL,
  failure_stage VARCHAR(32) NULL,
  failure_category VARCHAR(48) NULL,
  failure_code VARCHAR(100) NULL,
  http_status SMALLINT NULL,
  error_summary VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL,
  started_at DATETIME(3) NULL,
  upstream_started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX ops_facts_created (created_at, task_id),
  INDEX ops_facts_status_created (status, created_at, task_id),
  INDEX ops_facts_user_created (user_id, created_at, task_id),
  INDEX ops_facts_route_created (route_id, created_at, task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Add `ops_task_events` keyed by generated event ID with task/time/type indexes; `ops_metric_buckets` keyed by window start/dimension/type; and `ops_incidents` keyed by stable incident fingerprint with occurrence/acknowledge/recovery state. Store only fields from a strict allowlist. Keep task facts 30 days, events 14 days, minute buckets 7 days, hour buckets 90 days, and incidents 90 days. Do not persist full prompts, request/response bodies, credentials, or signed URLs. Provide bounded SQL pagination and retention deletion in small batches. Expose methods `init`, `upsertTaskFact`, `appendEvent`, `listTaskFacts`, `getTaskFact`, `getTrends`, `getFailureSummary`, `listIncidents`, `upsertIncident`, `getCoverage`, and `pruneExpired`.

- [x] **Step 4: Run the store tests and confirm they pass**

Run: `node --test operationsDashboardStore.test.cjs`
Expected: all new store cases PASS; no live MySQL service is required.

## Task 2: Runtime Snapshot and Resource Metrics

**Files:**
- Create: `operationsRuntimeMetrics.cjs`
- Create: `operationsRuntimeMetrics.test.cjs`
- Modify: `imageJobService.cjs`
- Modify: `imageJobService.test.cjs`

- [x] **Step 1: Write failing scheduler/resource tests**

Add tests that create a service with configured `concurrency: 3`, `userConcurrency: 2`, a blocked executor, and a fake store with queued/running/upstream-queued jobs. Assert the operations snapshot reports active slots from the in-memory `active` map; local queued count excludes active tasks; upstream queued is a subset of active slots; per-user active counts obey the configured cap; thresholds reflect actual configured values; and snapshot reads call no new persistence/query methods. Assert callback failure cannot alter generation, refunds, settlement, or `submit()` results. Add parser tests for `/proc/meminfo`, `/proc/stat`, cgroup v2 limits/current usage, Node `process.memoryUsage()`, and filesystem capacity, including missing/invalid files returning `null` coverage.

- [x] **Step 2: Run focused tests and confirm expected failures**

Run: `node --test imageJobService.test.cjs operationsRuntimeMetrics.test.cjs`
Expected: new API/parser assertions fail because the snapshot and resource module are not implemented.

- [x] **Step 3: Implement bounded telemetry**

Expose `getOperationsSnapshot()` from `createImageJobService()` with `generatedAt`, configured concurrency/queue limits, active task counts, upstream-queued subset, pending local jobs, oldest local wait, per-user utilization, and coverage. Build the queue portion from the bounded job list already read by `pump()`; do not add another DB scan for dashboard requests. Refresh the in-memory snapshot after scheduler transitions and at most once per existing scheduler pass. Add an optional `onOperationsEvent(event)` callback for task lifecycle changes. Invoke it asynchronously through a catch-isolated helper so telemetry errors never change business result or settlement. Emit only submit/refusal, first dispatch, upstream-state transitions, terminal result, storage result, and settlement result; do not emit regular polling samples. Normalize failures into safe `stage/category/code/httpStatus/message` with message length capped at 1000 and no raw response. Add a single bounded `monitorEventLoopDelay` sampler plus best-effort `/proc`, cgroup, process, and storage-volume snapshots. Return explicit unavailable fields when a host source cannot be read.

- [x] **Step 4: Run focused tests and confirm they pass**

Run: `node --test imageJobService.test.cjs operationsRuntimeMetrics.test.cjs`
Expected: existing job-service tests and new telemetry tests PASS; telemetry failures leave generation and settlement assertions unchanged.

## Task 3: Admin API and Historical Aggregation

**Files:**
- Modify: `server.cjs`
- Create: `server.admin-operations.test.cjs`
- Use: `authStore.cjs` `requireAdminAccess`, `imageJobService`, `operationsDashboardStore.cjs`, `operationsRuntimeMetrics.cjs`.

- [x] **Step 1: Write failing HTTP/API tests**

Follow `server.admin-password-reset.test.cjs` and `server.image-jobs.test.cjs` ephemeral-server harness patterns. Test anonymous/regular users receive the existing auth denial and admins can access read-only endpoints. Test `GET /api/admin/operations/summary`, `/trends?window=15m|1h|24h|7d`, `/tasks?limit=&status=&userId=&routeId=&cursor=`, `/tasks/:taskId`, `/failures`, and `/incidents` return exact coverage/freshness metadata and never include prompts, `Authorization`, session/API keys, raw upstream bodies, or signed asset URLs. Assert query parameters are validated/clamped, empty history is labeled `unavailable`/`not_collected` when appropriate, repeated requests do not call worker polling/settlement, and stale collectors report stale data rather than zeros.

- [x] **Step 2: Run the API tests and confirm expected failures**

Run: `node --test server.admin-operations.test.cjs`
Expected: FAIL because the operations API routes are absent.

- [x] **Step 3: Implement admin-only, bounded APIs**

Initialize the operations store once with the existing image-job services. Cache summary snapshots process-wide for at most 5 seconds; refresh live snapshots from the scheduler's existing pass rather than the route handler. Refresh minute/hour aggregates on one server timer, not per admin request. Implement the endpoints from Step 1 under existing `requireAdminAccess`. Use a strict 50-row maximum and stable cursor pagination. Decorate task facts with only the safe user label and route/model identifiers recorded by the job service. Keep persisted image-job status as the source for active task details; use `ops_task_facts` for history after the existing 5-hour task cleanup. Add event/summary recording for admit, dispatch, upstream status changes, confirmed success/failure, save/preview status, settlement/compensation, and confirmed queue refusal. Run retention pruning on one unref'd bounded timer. If telemetry writes fail, log a sanitized collection error, report a coverage gap, and preserve the original generation/billing path. Compute incidents from minimum-sample rules and thresholds in the approved design, deduplicate by category/route/window, and track recovery; endpoint reads only incident state.

- [x] **Step 4: Run API tests and existing Node tests**

Run: `node --test server.admin-operations.test.cjs`
Expected: all new API tests PASS.

Run: `npm run test:node`
Expected: the complete existing Node suite and new operations API tests PASS.

## Task 4: Admin Operations UI

**Files:**
- Create: `src/services/adminOperationsService.ts`
- Create: `src/services/adminOperationsService.test.ts`
- Create: `components/AdminOperationsPanel.tsx`
- Create: `components/AdminOperationsPanel.test.tsx`
- Modify: `components/AdminDashboardPage.tsx`
- Modify: `components/AdminDashboardPage.test.tsx`

- [x] **Step 1: Write failing service/page tests**

Test typed requests include existing authorized headers and validated filters; request errors remain visible. Test admin navigation shows operations only for admins; live summary requests use a 20-second timer and trends use a separate 100-second timer; both pause when `document.visibilityState === 'hidden'`, resume with one refresh when visible, add bounded jitter, and clean up timers on unmount. Test the panel renders configured concurrency, local queue, upstream queue, stale/unsupported coverage, route health, real terminal success rate, failure causes and affected-user counts; filters produce paged task requests; selecting a failure exposes task IDs, owner labels, timestamps, error stage and settlement/storage state without rendering secret fields. Include loading, no-sample, unavailable, stale and API-error states.

- [x] **Step 2: Run focused frontend tests and confirm expected failures**

Run: `npx vitest run src/services/adminOperationsService.test.ts components/AdminOperationsPanel.test.tsx components/AdminDashboardPage.test.tsx`
Expected: FAIL because the operations service and panel do not exist and the section/timers are not wired.

- [x] **Step 3: Implement the service and UI**

Add `AdminOperationsPayload` types and fetch helpers that call only admin operations GET endpoints. Add a new `运行看板` section without removing existing `运行总览`. Render compact metric cards, queue/route/failure summaries, simple SVG or CSS-based time-series plots (no new chart dependency), and a filterable task/failure table with task detail timeline. Include coverage label, generated-at timestamp and stale indicator. Keep events and errors text-safe. Separate timer lifecycles: 20-second summary and 100-second trend; pause while hidden; add 0–2 second per-page jitter; use visibility-change refresh on return; prevent overlapping requests and abort stale fetches on unmount. Keep normal admins read-only; do not surface phase-two recovery controls.

- [x] **Step 4: Run focused frontend tests and typecheck**

Run: `npx vitest run src/services/adminOperationsService.test.ts components/AdminOperationsPanel.test.tsx components/AdminDashboardPage.test.tsx`
Expected: all new and affected frontend tests PASS.

Run: `npx tsc --noEmit`
Expected: no TypeScript errors.

## Task 5: Resource Limits, Documentation, and Final Verification

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docs/image-async-recovery.md`
- Modify: `docs/superpowers/specs/2026-10-16-admin-operations-dashboard-proposal.md` only if implementation choices require a documented scope correction.

- [x] **Step 1: Add failing deployment/config assertions**

Add a node test or script-level assertion that `docker compose config --quiet` succeeds and app log options have explicit bounded `max-size` and `max-file` values. Assert no Docker socket volume is added and existing DB/job/storage volumes remain intact. Verify docs specify the 20/100-second polling, intervals/retention, metrics coverage limits, and no historical backfill.

- [x] **Step 2: Implement bounded logging and deployment notes**

Set Docker logging options for app and MySQL containers to `json-file` with a 10 MB maximum and 3 files, without changing image/job data volumes. Document MySQL table auto-creation, operational coverage, freshness, log rotation, expected additional writes (state changes only), monitoring rollout, and acceptance/rollback checks. Do not claim host Docker container state is available without a host agent.

- [x] **Step 3: Run the full verification set**

Run: `npx vitest run --maxWorkers=2`
Expected: frontend suite passes with existing intentional skips only.

Run: `npm run test:node`
Expected: all Node integration/unit tests pass.

Run: `npx tsc --noEmit`
Expected: no TypeScript errors.

Run: `npm run build`
Expected: production build exits 0.

Run: `docker compose config --quiet`
Expected: configuration exits 0 with bounded logs and unchanged volumes.

Run: `git diff --check`
Expected: no whitespace errors.

Use a fake 48-task workload and at least two browser dashboard sessions to compare request/query counts and service latency before/after. Verify dashboard reads return snapshots and no SQL scan/aggregate is issued per page request. Report these benchmark values; do not extrapolate them to production without a server test.

## Spec Coverage Review

The approved phase-one requirements map to Tasks 1–5: task/event history and retention (Tasks 1, 3), accurate in-memory concurrency and queue semantics (Task 2), safe failure classification and user/route linking (Tasks 1–3), freshness/coverage and admin-only query behavior (Task 3), 20/100-second refresh, trends, responsive admin UI (Task 4), basic host/process/container-volume observability available inside the app, resource protection and deployment logs (Tasks 2, 5), and simulated load/verification (Task 5). Video and legacy synchronous job stages, operator recovery actions, real payment revenue/cost, and external uptime probes remain phase two as approved.
