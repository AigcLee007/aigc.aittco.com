# Seedream-5-pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the Seedream-5-pro image model and PixelleLabs route with GPT-Image-2-compatible parameters and 1K/2K-only sizing.

**Architecture:** Extend the JSON model/route catalogs, reuse existing GPT image request formatting in both UIs and server, and add a small server-side size guard before billing/upstream forwarding.

**Tech Stack:** TypeScript, React, Express, JSON catalogs, Vitest, CommonJS server tests.

---

### Task 1: Catalog and request-format regression coverage

**Files:** `src/config/imageModels.test.ts`, `src/config/imageModels.ts`, `config/imageModels.json`, `config/imageRoutes.json`, `components/ImageFormConfig.tsx`, `components/ControlPanel.tsx`, `public/classic-app/unified-bridge.js`, `public/classic-app/script.js`

- [ ] Add tests asserting the model is 1K/2K-only and its route uses PixelleLabs.
- [ ] Run the focused tests and confirm they fail before implementation.
- [ ] Add the model/route records and include Seedream in the existing GPT-format UI predicates and classic allow-list.
- [ ] Run focused tests and build.

### Task 2: Server compatibility guard

**Files:** `imageRequestCount.cjs` (or a focused helper), `server.cjs`, related test

- [ ] Add a failing test for rejecting Seedream 4K and accepting 1K/2K.
- [ ] Implement canonical Seedream model detection and a pre-billing 4K guard; reuse existing GPT payload shaping for valid requests.
- [ ] Run the focused server/helper tests.

### Task 3: Full verification

**Files:** no additional files

- [ ] Run the complete Vitest suite.
- [ ] Run the production build and inspect the final diff for route, key, and size consistency.

