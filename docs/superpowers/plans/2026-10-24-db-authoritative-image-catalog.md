# Database-Authoritative Image Catalog Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task, and verify each checkpoint before continuing.

**Goal:** Keep deleted server image routes and models deleted across restarts and deployments while seeding defaults once for new installations.

**Architecture:** Add one MySQL initialization-state table shared by image routes and models. In the same transaction as seeding, an insert-once marker elects one initializer per catalog; existing rows suppress seeding, and a completed marker prevents any later import even if an operator removes every row.

**Tech Stack:** Node.js CommonJS, MySQL/InnoDB, `node:test`.

---

### Task 1: Add an idempotent catalog initializer

**Files:**
- Create: `imageCatalogInitialization.cjs`
- Create: `imageCatalogInitialization.test.cjs`

- [ ] Test empty first-time catalogs seed exactly once; pre-existing catalogs mark initialized without seeding; initialized catalogs stay empty; and a second concurrent initializer loses the marker insert and does not seed.
- [ ] Run `node --test imageCatalogInitialization.test.cjs` and verify the new behavior tests fail before implementation.
- [ ] Implement a helper that claims a per-catalog marker using `INSERT IGNORE`, checks existing row count only for the marker winner, invokes the supplied seed callback only when the count is zero, and sets `initialized_at` before transaction commit.
- [ ] Run `node --test imageCatalogInitialization.test.cjs` and verify all cases pass.

### Task 2: Make both catalog stores use the initializer

**Files:**
- Modify: `imageRouteStore.cjs`
- Modify: `imageModelStore.cjs`
- Modify: `imageRouteStore.test.cjs`
- Modify: `imageModelStore.test.cjs`

- [ ] Replace route and model “insert every missing static entry” initialization with the shared one-time initializer while keeping their current insert statements and row mapping.
- [ ] Keep the existing GPT size-override repair migration independent of first-time catalog seeding.
- [ ] Add focused source or store-boundary assertions that each catalog supplies its row count query and static seed callback to the shared initializer, rather than importing missing rows on each startup.
- [ ] Run `node --test imageCatalogInitialization.test.cjs imageRouteStore.test.cjs imageModelStore.test.cjs` and verify all pass.

### Task 3: Verify and deliver

**Files:**
- Verify: `imageRouteStore.cjs`, `imageModelStore.cjs`, `imageCatalogInitialization.cjs`

- [ ] Run `node --test imageCatalogInitialization.test.cjs imageRouteStore.test.cjs imageModelStore.test.cjs`.
- [ ] Run the full `npm run test:node` suite and `npm run build`; report any unrelated existing failures separately.
- [ ] Review `git diff --check` and ensure only catalog initialization code and focused tests are staged for the implementation commit.
- [ ] Commit and push the implementation to `origin/main` after verification.
