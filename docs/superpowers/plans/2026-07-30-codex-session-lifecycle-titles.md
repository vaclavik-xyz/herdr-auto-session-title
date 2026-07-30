# Codex Session Lifecycle Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the active Codex thread name to the owning Herdr pane and tab when `codex resume` starts or switches a session, then remove only plugin-owned presentation when Codex exits.

**Architecture:** Keep the event handler one-shot. Bridge the startup race by briefly rereading the pane after a Codex detection event, prefer `thread/read` before session-file title generation, and treat Herdr's `pane.agent_detected` release payload as a separate cleanup path. Cleanup is staged in pane state so a later focus or detection event can retry a partial pane/tab reset without overwriting manual titles.

**Tech Stack:** Node.js 20 ESM, `node:test`, Herdr CLI JSON responses, Codex app-server JSON-RPC.

## Global Constraints

- Keep the package free of runtime dependencies.
- Preserve `HERDR_*` environment stripping and ephemeral read-only generation.
- Never overwrite manual Herdr pane/tab titles or manual native Codex thread names.
- Use two-space indentation, double-quoted strings, semicolons, and trailing commas in multiline constructs.
- Keep session JSONL, credentials, and generated plugin state out of the repository.

---

### Task 1: Native Codex title lookup and delayed session discovery

**Files:**
- Modify: `src/codex-rpc.mjs`
- Modify: `src/auto-title.mjs`
- Modify: `test/codex-rpc.test.mjs`
- Modify: `test/auto-title.test.mjs`

**Interfaces:**
- Produces: `readCodexThreadTitle({ codexBin, env, threadId, timeoutMs }) -> Promise<string | null>`.
- Produces: `runAutoTitle({ sessionPollAttempts, sessionPollIntervalMs, ... })`, using injectable `deps.sleep(ms)` in tests.
- Consumes: the existing `readPane`, `writePaneTitle`, and `syncCodexThreadTitle` contracts.

- [x] **Step 1: Write failing RPC and orchestration tests**

```js
test("Codex title lookup reads an existing native thread name without renaming it", async () => {
  const title = await readCodexThreadTitle({
    codexBin: fakeCodexAppServer,
    env: { ...process.env, FAKE_CODEX_RPC_TITLE: "Native resumed title" },
    threadId: "thread-resumed",
  });
  assert.equal(title, "Native resumed title");
});

test("Codex detection waits for a resumed session and adopts its native title", async () => {
  let reads = 0;
  let writtenTitle = null;
  const forbidden = async () => assert.fail("native title must skip generation");
  const resumedPane = codexPane();
  resumedPane.agent_session.value = "thread-resumed";
  const result = await runAutoTitle({
    deps: {
      extractSessionPrompt: forbidden,
      generateTitle: forbidden,
      locateSessionFile: forbidden,
      readCodexThreadTitle: async () => "Native resumed title",
      readPane: async () => {
        reads += 1;
        return reads === 1 ? { ...codexPane(), agent_session: undefined } : resumedPane;
      },
      sleep: async () => undefined,
      writePaneTitle: async ({ title }) => { writtenTitle = title; },
    },
    env: detectionEnv(),
    sessionPollAttempts: 1,
    sessionPollIntervalMs: 0,
    stateDir,
  });
  assert.deepEqual(result, { status: "updated", title: "Native resumed title" });
  assert.equal(writtenTitle, "Native resumed title");
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/codex-rpc.test.mjs test/auto-title.test.mjs`

Expected: FAIL because `readCodexThreadTitle` and delayed session rereading do not exist.

- [x] **Step 3: Implement the minimal native-title and session-wait paths**

```js
export async function readCodexThreadTitle(options) {
  const client = createStdioClient(options);
  try {
    await client.initialize();
    const response = await client.call("thread/read", { threadId: options.threadId });
    return response?.thread?.name?.trim() || null;
  } finally {
    await client.close();
  }
}
```

For a non-release `pane.agent_detected` event whose pane does not yet expose a session, reread it after `sessionPollIntervalMs` up to `sessionPollAttempts`. When a different Codex session is found, call `readCodexThreadTitle` before locating JSONL or generating a title. If the native title is non-empty, persist and write it directly; otherwise retain the existing generation and `thread/name/set` fallback.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/codex-rpc.test.mjs test/auto-title.test.mjs`

Expected: PASS with the resumed thread title applied and no generation call.

- [x] **Step 5: Commit the independently working session-resume behavior**

```bash
git add src/codex-rpc.mjs src/auto-title.mjs test/codex-rpc.test.mjs test/auto-title.test.mjs
git commit -m "feat: sync resumed Codex session titles"
```

### Task 2: Ownership-safe Codex release cleanup

**Files:**
- Modify: `src/herdr.mjs`
- Modify: `src/state.mjs`
- Modify: `src/auto-title.mjs`
- Modify: `test/herdr.test.mjs`
- Modify: `test/state.test.mjs`
- Modify: `test/auto-title.test.mjs`

**Interfaces:**
- Produces: `clearPaneTitle({ paneId, tabId, defaultTabTitle, previousPluginTitle, onPaneTitleCleared, onTabTitleCleared, ... })`.
- Produces: `removePaneState({ paneId, stateDir })`.
- Persists: `releasePending: true` until both presentation surfaces are reconciled.

- [x] **Step 1: Write failing adapter, state, and lifecycle tests**

```js
test("Herdr adapter clears plugin metadata and restores its owned tab label", async () => {
  await clearPaneTitle({
    env: { ...process.env, FAKE_HERDR_RECORD: recordPath, FAKE_HERDR_TAB_LABEL: "Owned" },
    herdrBin: fakeHerdr,
    paneId: "w1:p7",
    previousPluginTitle: "Owned",
    tabId: "w1:t1",
  });
  assert.deepEqual(readCalls(recordPath), [
    ["pane", "report-metadata", "w1:p7", "--source", "plugin:auto-session-title", "--clear-title"],
    ["tab", "get", "w1:t1"],
    ["tab", "rename", "w1:t1", "1"],
  ]);
});

test("Herdr adapter preserves a manual tab label while clearing plugin metadata", async () => {
  const result = await clearPaneTitle({
    env: { ...process.env, FAKE_HERDR_RECORD: recordPath, FAKE_HERDR_TAB_LABEL: "Manual" },
    herdrBin: fakeHerdr,
    paneId: "w1:p7",
    previousPluginTitle: "Owned",
    tabId: "w1:t1",
  });
  assert.deepEqual(result, { status: "preserved", title: "Manual" });
});

test("a released Codex session clears owned pane and tab presentation", async () => {
  await writePaneState({ paneId: "w1:p1", state: ownedState, stateDir });
  const result = await runAutoTitle({
    deps: { clearPaneTitle: async () => ({ status: "updated" }), readPane: releasedPane },
    env: releasedEnv(),
    stateDir,
  });
  assert.deepEqual(result, { status: "cleared" });
  assert.equal(await readPaneState({ paneId: "w1:p1", stateDir }), null);
});

test("partial release cleanup is retried on a later pane focus", async () => {
  await assert.rejects(runAutoTitle({ deps: failingClear, env: releasedEnv(), stateDir }));
  assert.equal((await readPaneState({ paneId: "w1:p1", stateDir })).releasePending, true);
  const result = await runAutoTitle({ deps: successfulClear, env: focusedEnv(), stateDir });
  assert.deepEqual(result, { status: "cleared" });
  assert.equal(await readPaneState({ paneId: "w1:p1", stateDir }), null);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/herdr.test.mjs test/state.test.mjs test/auto-title.test.mjs`

Expected: FAIL because presentation clearing, state removal, and release retry do not exist.

- [x] **Step 3: Implement staged cleanup**

```js
export async function removePaneState({ paneId, stateDir }) {
  await unlink(statePath(stateDir, paneId)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}
```

On `released: true`, stage `releasePending`, clear the plugin metadata source with `--clear-title`, and rename the tab to `String(tab.number)` only when its current label still equals the recorded plugin title. Record each successful surface clear, then remove pane state after cleanup completes. Accept `pane.focused` invocations so a partial cleanup can retry. If a new session exists during such a retry, finish cleanup and continue synchronizing that session in the same invocation.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/herdr.test.mjs test/state.test.mjs test/auto-title.test.mjs`

Expected: PASS; manual labels remain unchanged and partial cleanup recovers.

- [x] **Step 5: Commit release behavior**

```bash
git add src/herdr.mjs src/state.mjs src/auto-title.mjs test/herdr.test.mjs test/state.test.mjs test/auto-title.test.mjs
git commit -m "feat: clear titles when Codex exits"
```

### Task 3: Plugin hooks, documentation, and end-to-end verification

**Files:**
- Modify: `herdr-plugin.toml`
- Modify: `README.md`
- Modify: `test/auto-title.test.mjs`

**Interfaces:**
- Consumes: `pane.agent_detected`, `pane.agent_status_changed`, and `pane.focused` plugin events.
- Documents: native-title precedence, detection retry, exit cleanup, and manual-title preservation.

- [x] **Step 1: Add the focus retry hook and lifecycle documentation**

```toml
[[events]]
on = "pane.focused"
command = ["node", "src/auto-title.mjs"]
```

Update README behavior to state that resumed Codex native titles are adopted, release clears plugin-owned pane metadata and restores an owned tab label to its number, and later focus/status events retry incomplete synchronization.

- [x] **Step 2: Run syntax and complete test verification**

Run: `node --check src/*.mjs`

Expected: every production module exits successfully.

Run: `npm test`

Expected: all tests pass with zero failures, cancellations, or skipped tests.

- [x] **Step 3: Inspect the final diff and manifest compatibility**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `herdr plugin link .`

Expected: the local plugin links without manifest validation errors on Herdr 0.7.5.

- [x] **Step 4: Commit documentation and manifest changes**

```bash
git add README.md herdr-plugin.toml test/auto-title.test.mjs docs/superpowers/plans/2026-07-30-codex-session-lifecycle-titles.md
git commit -m "docs: describe Codex title lifecycle sync"
```

### Task 4: Review follow-ups for ownership and event races

- [x] Separate the last observed Codex title (`codexTitle`) from the title
  confirmed as plugin-written (`codexOwnedTitle`). New state records an explicit
  `null` owner when adopting a pre-existing native title; legacy state without
  the new field retains its earlier ownership interpretation.
- [x] After release cleanup, always reread the pane and synchronize any live
  replacement session, including when the release event itself was delayed.
- [x] Prefer `thread/read` for every non-forced, different Codex session,
  including `pane.agent_status_changed` as the first switch event.
- [x] Add RED/GREEN regressions for adopted-title refresh, delayed release, and
  status-first session switching.
- [x] Run final syntax, full-suite, whitespace, and Herdr link verification.

Herdr 0.7.5 exposes separate tab-read and tab-rename commands, with no atomic
compare-and-set rename. A manual rename racing between those commands remains
an upstream limitation and is documented in the README.
