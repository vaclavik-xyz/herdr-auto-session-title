# Fix Herdr Title Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one plugin invocation update both the native Codex thread title and the visible Herdr pane title.

**Architecture:** Keep native Codex synchronization through `thread/name/set`. Change Herdr presentation metadata from a lifecycle-source guard derived from `agent_session.source` to an agent-label guard derived from the pane's detected agent, because Codex reports session identity without establishing lifecycle authority.

**Tech Stack:** Node.js 20+ ESM, `node:test`, Herdr 0.7.0+ CLI, Codex app-server JSON-RPC

## Global Constraints

- Add no runtime dependencies.
- Preserve native Codex `thread/name/set` synchronization.
- Preserve environment isolation, prompt limits, locking, and compare-and-set state behavior.
- Use `--agent codex` or `--agent claude` for Herdr presentation metadata; do not derive `--applies-to-source` from `agent_session.source`.

---

### Task 1: Use an Agent Guard for Herdr Titles

**Files:**
- Modify: `test/herdr.test.mjs`
- Modify: `test/auto-title.test.mjs`
- Modify: `src/herdr.mjs`
- Modify: `src/auto-title.mjs`

**Interfaces:**
- Consumes: `writePaneTitle({ agent, env, herdrBin, paneId, source, timeoutMs, title })`
- Produces: a Herdr `pane report-metadata` call containing `--agent <agent>` and `--title <title>`, while Codex panes still call `thread/name/set`

- [x] **Step 1: Write the failing adapter and end-to-end assertions**

Update the expected Herdr arguments to the following literal contract:

```js
[
  "pane",
  "report-metadata",
  "w1:p7",
  "--source",
  "plugin:auto-session-title",
  "--agent",
  "codex",
  "--title",
  "Fix checkout; no shell",
]
```

In the manual-refresh end-to-end test, assert that the final Herdr call contains `--agent`, `codex`, and the generated title, and retain the assertion that the final Codex RPC method is `thread/name/set`.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/herdr.test.mjs test/auto-title.test.mjs`

Expected: FAIL because the implementation still emits `--applies-to-source herdr:codex` instead of `--agent codex`.

- [x] **Step 3: Implement the minimal guard change**

Change `writePaneTitle` to accept `agent`, append `--agent` when present, and stop accepting `appliesToSource`. Pass the already-normalized `agent` value from both the initial write and Codex retry paths in `runAutoTitle`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/herdr.test.mjs test/auto-title.test.mjs`

Expected: both files pass, including the native Codex and Herdr title assertions.

- [x] **Step 5: Run full verification**

Run: `npm test`

Run: `node --check src/*.mjs`

Expected: all tests pass and all production modules parse successfully.

---

### Task 2: Rename the Visible Herdr Tab

**Files:**
- Modify: `test-support/fake-herdr.mjs`
- Modify: `test/herdr.test.mjs`
- Modify: `test/auto-title.test.mjs`
- Modify: `src/herdr.mjs`
- Modify: `src/auto-title.mjs`

**Interfaces:**
- Consumes: `pane.tab_id`, `pane.tab.label`, and `pane.tab.number`
- Produces: `readPane(...)` with attached tab data and `writePaneTitle({ agent, paneId, tabId, title, ... })` that reports pane metadata and runs `herdr tab rename <tabId> <title>`

- [x] **Step 1: Write failing adapter and orchestration tests**

Make the fake Herdr executable return this tab for `tab get`:

```js
{ tab_id: "w1:t1", label: "1", number: 1, workspace_id: "w1" }
```

Assert that writing a Herdr title ends with both literal calls:

```js
["pane", "report-metadata", "w1:p7", "--source", "plugin:auto-session-title", "--agent", "codex", "--title", "Fix checkout; no shell"]
["tab", "rename", "w1:t1", "Fix checkout; no shell"]
```

Also assert that a non-default tab label is preserved as a manual title while the numeric default label is eligible for replacement.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/herdr.test.mjs test/auto-title.test.mjs`

Expected: FAIL because `readPane` does not fetch tab state and `writePaneTitle` does not call `tab rename`.

- [x] **Step 3: Implement tab read, protection, and rename**

Fetch `tab get` after `pane get`, attach it as `pane.tab`, treat `String(tab.number) === tab.label` as the default label, preserve any other label not owned by plugin state, and pass `pane.tab_id` to `writePaneTitle` in initial and retry paths.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/herdr.test.mjs test/auto-title.test.mjs`

Expected: both files pass and the end-to-end fake records both the pane metadata update and tab rename.

---

### Task 3: Close Codex Generator Standard Input

**Files:**
- Modify: `test-support/fake-codex-generator.mjs`
- Modify: `test/generator.test.mjs`
- Modify: `src/generator.mjs`

**Interfaces:**
- Consumes: the existing `generateTitle(...)` arguments
- Produces: the same `{ title, description }` result while guaranteeing the child sees EOF on stdin

- [x] **Step 1: Write a failing EOF regression test**

Add a fake mode that waits for stdin end before writing structured output:

```js
if (process.env.FAKE_CODEX_REQUIRE_STDIN_EOF === "1") {
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.on("end", resolve));
}
```

Call `generateTitle` with `FAKE_CODEX_REQUIRE_STDIN_EOF=1` and `timeoutMs: 1_000`; assert that it returns `Fix checkout race` rather than timing out.

- [x] **Step 2: Run the generator test and verify RED**

Run: `node --test test/generator.test.mjs`

Expected: FAIL after one second because the current `execFile` child never receives EOF.

- [x] **Step 3: Implement explicit stdin closure**

Wrap callback-style `execFile`, immediately call `child.stdin.end()`, and preserve the existing timeout, max-buffer, environment, cleanup, stdout, and stderr behavior.

- [x] **Step 4: Run the generator test and verify GREEN**

Run: `node --test test/generator.test.mjs`

Expected: the EOF-aware fake exits promptly and the structured title assertions pass.

- [x] **Step 5: Run full and live verification**

Run: `npm test`

Run: `node --check src/*.mjs`

Invoke refresh for p1 and p2, then verify `herdr tab get` labels and Codex `thread/list` names match plugin state for both thread IDs.

---

### Task 4: Normalize Skill-Command Titles

**Files:**
- Modify: `test/title.test.mjs`
- Modify: `src/title.mjs`

**Interfaces:**
- Consumes: `sanitizeTitle(value, maxLength)`
- Produces: a concise semantic title for prompts beginning with `$kebab-case-command`

- [x] **Step 1: Write the failing command-title test**

Add these literal expectations:

```js
assert.equal(
  sanitizeTitle("$update-artifacts-plugin-version master/release-4.4 kube-ovn"),
  "update artifacts plugin version",
);
assert.equal(
  sanitizeTitle("$record-oncall-jira https://jira.example.test/ACP-1"),
  "record oncall jira",
);
```

- [x] **Step 2: Run the title test and verify RED**

Run: `node --test test/title.test.mjs`

Expected: FAIL because the current sanitizer preserves `$`, hyphens, and raw arguments.

- [x] **Step 3: Implement command-title normalization**

When the first useful line matches a leading `$` command composed of letters, digits, and hyphens, replace the candidate title with only the command name and replace hyphens with spaces before applying normal truncation.

- [x] **Step 4: Run the title test and verify GREEN**

Run: `node --test test/title.test.mjs`

Expected: existing sanitization tests and both command-title expectations pass.

---

### Task 5: Close Review-Found Reconciliation Gaps

**Files:**
- Modify: `src/auto-title.mjs`
- Modify: `src/herdr.mjs`
- Modify: `src/title.mjs`
- Modify: `test/auto-title.test.mjs`
- Modify: `test/herdr.test.mjs`
- Modify: `test/title.test.mjs`

**Interfaces:**
- Consumes: existing pane/tab presentation, prior plugin-owned title, and durable pane state
- Produces: retry-safe partial writes, late manual-tab preservation, legacy-state reconciliation, and strict skill-command token matching

- [x] **Step 1: Add failing tests for staged ownership, late manual tab changes, numeric legacy tabs, and malformed command delimiters**

Run: `node --test test/auto-title.test.mjs test/herdr.test.mjs test/title.test.mjs`

Expected failures: missing staged state after a tab-write error, unconditional late tab rename, an `unchanged` legacy numeric tab, and `$deploy/prod` incorrectly becoming `deploy`.

- [x] **Step 2: Implement independent reconciliation and late compare-and-set protection**

Persist target ownership before Herdr writes, compare both pane and tab titles on same-session paths, re-read the tab immediately before rename, and preserve a non-default label that differs from the previous plugin title.

- [x] **Step 3: Require whitespace or end-of-input after a skill command token**

Use `(?=\s|$)` after the command capture so malformed delimiters retain the original title text.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/auto-title.test.mjs test/herdr.test.mjs test/title.test.mjs`

Expected: all reconciliation, compare-and-set, adapter, and title tests pass.
