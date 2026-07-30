# Herdr Auto Session Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a Herdr plugin that generates concise titles from supported agent session prompts, writes them to Herdr pane metadata, and also writes the title to the native Codex thread when the pane agent is Codex.

**Architecture:** A one-shot Node.js event handler consumes Herdr plugin context, reads the current agent session, generates a structured title with an isolated ephemeral `codex exec`, and stores compare-and-set state under `HERDR_PLUGIN_STATE_DIR`. Herdr display updates use `pane report-metadata`; Codex-native updates use a short-lived stdio JSON-RPC app-server client that reads the thread before calling `thread/name/set`.

**Tech Stack:** Herdr plugin v1 manifest, Node.js ESM and built-in test runner, Codex CLI/app-server JSON-RPC, GitHub CLI.

## Global Constraints

- Require Herdr 0.7.0 or newer and Node.js 20 or newer.
- Add no runtime npm dependencies.
- Never overwrite a title that differs from the last title written by this plugin.
- Treat Herdr title success and Codex-native title success independently so Codex synchronization can retry.
- Strip `HERDR_*` variables from generator and app-server child environments to prevent integration recursion.
- Keep title generation read-only, ephemeral, and limited to the first 2,000 prompt characters.
- Generate titles up to 36 characters and descriptions up to 100 characters.
- Publish the completed repository publicly as `zhangzujian/herdr-auto-session-title`.

---

### Task 1: Pure title and session parsing

**Files:**
- Create: `package.json`
- Create: `src/title.mjs`
- Create: `src/session.mjs`
- Create: `test/title.test.mjs`
- Create: `test/session.test.mjs`
- Create: `test/fixtures/codex-session.jsonl`
- Create: `test/fixtures/claude-session.jsonl`

**Interfaces:**
- Produces: `sanitizeTitle(value, maxLength)`, `buildGenerationPrompt(prompt)`, `extractSessionPrompt({agent, sessionPath})`, and `locateSessionFile({agent, sessionId, roots})`.
- Consumes: Codex `event_msg/user_message` and Claude `user/message.content` JSONL records.

- [ ] **Step 1: Write failing tests for title normalization, prompt limits, unsupported agents, and Codex/Claude JSONL extraction.**
- [ ] **Step 2: Run `npm test` and verify failures are caused by missing production modules.**
- [ ] **Step 3: Implement only the parsing and sanitizing behavior required by the tests.**
- [ ] **Step 4: Run `npm test` and verify all Task 1 tests pass.**

### Task 2: Isolated structured title generator

**Files:**
- Create: `schemas/title-output.json`
- Create: `src/process-env.mjs`
- Create: `src/generator.mjs`
- Create: `test/generator.test.mjs`
- Create: `test/fixtures/fake-codex-generator.mjs`

**Interfaces:**
- Consumes: `buildGenerationPrompt` and `sanitizeTitle` from Task 1.
- Produces: `generateTitle({codexBin, cwd, model, pluginRoot, prompt, stateDir}) -> Promise<{title, description}>` and `isolatedChildEnv(env)`.

- [ ] **Step 1: Write a failing integration test whose fake Codex executable verifies `exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --output-schema` and writes structured output.**
- [ ] **Step 2: Run the generator test and verify it fails because the generator module is missing.**
- [ ] **Step 3: Implement the minimal spawn, temporary output file, JSON parsing, cleanup, and environment isolation behavior.**
- [ ] **Step 4: Run `npm test` and verify generator and Task 1 tests pass.**

### Task 3: Herdr and Codex title writers

**Files:**
- Create: `src/herdr.mjs`
- Create: `src/codex-rpc.mjs`
- Create: `test/herdr.test.mjs`
- Create: `test/codex-rpc.test.mjs`
- Create: `test/fixtures/fake-herdr.mjs`
- Create: `test/fixtures/fake-codex-app-server.mjs`

**Interfaces:**
- Produces: `readPane`, `writePaneTitle`, and `syncCodexThreadTitle({threadId, title, previousPluginTitle})`.
- Codex synchronization must call `initialize`, send `initialized`, read `thread/read`, and call `thread/name/set` only when the native title is empty or still equals the plugin's previous title.

- [ ] **Step 1: Write failing subprocess tests for argv-safe Herdr metadata writes and JSON-RPC handshake/read/compare/set behavior.**
- [ ] **Step 2: Run the focused tests and verify expected missing-module failures.**
- [ ] **Step 3: Implement the minimal CLI adapter and newline-delimited JSON-RPC client with timeouts and child cleanup.**
- [ ] **Step 4: Run `npm test` and verify all writer tests pass.**

### Task 4: Event orchestration and durable compare-and-set state

**Files:**
- Create: `src/state.mjs`
- Create: `src/auto-title.mjs`
- Create: `test/state.test.mjs`
- Create: `test/auto-title.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3 modules and Herdr environment variables.
- Produces: `runAutoTitle(options)` and a CLI entrypoint.
- State records `sessionKey`, `promptHash`, `herdrTitle`, and `codexTitle`, with an exclusive per-pane lock and stale-lock recovery.

- [ ] **Step 1: Write failing tests for lifecycle-event filtering, duplicate suppression, manual-title protection, independent Codex retry, forced refresh, and lock contention.**
- [ ] **Step 2: Run focused tests and verify failures arise from missing orchestration.**
- [ ] **Step 3: Implement orchestration and atomic JSON state replacement with the smallest behavior needed by the tests.**
- [ ] **Step 4: Run `npm test` and verify the complete behavioral suite passes.**

### Task 5: Plugin packaging, documentation, and publication

**Files:**
- Create: `herdr-plugin.toml`
- Create: `README.md`
- Create: `LICENSE`
- Create: `.gitignore`

**Interfaces:**
- Manifest action: `zhangzujian.auto-session-title.refresh`.
- Manifest hooks: `pane.agent_detected` and `pane.agent_status_changed`.

- [ ] **Step 1: Add the manifest, configuration/privacy documentation, compatibility table, install/link instructions, and MIT license.**
- [ ] **Step 2: Run `npm test`, `node --check` for every source module, and `herdr plugin link` plus action-list validation.**
- [ ] **Step 3: Exercise the refresh action against a fake executable configuration without changing a real pane or Codex thread.**
- [ ] **Step 4: Commit the verified repository, create `zhangzujian/herdr-auto-session-title` as public with `gh repo create`, push `main`, and verify repository visibility and files through the GitHub API.**
