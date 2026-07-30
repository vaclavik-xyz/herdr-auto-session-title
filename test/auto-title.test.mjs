import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAutoTitle, shouldHandleInvocation } from "../src/auto-title.mjs";
import { readPaneState } from "../src/state.mjs";

const fixtureSession = path.join(
  import.meta.dirname,
  "fixtures",
  "codex-session.jsonl",
);

function codexPane(title = null) {
  return {
    agent: "codex",
    agent_session: {
      agent: "codex",
      kind: "id",
      source: "herdr:codex",
      value: "thread-123",
    },
    agent_status: "working",
    cwd: "/tmp/project",
    pane_id: "w1:p1",
    title,
    workspace_id: "w1",
  };
}

function invocationEnv(overrides = {}) {
  return {
    HERDR_PANE_ID: "w1:p1",
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: "pane.agent_status_changed",
      data: { agent: "codex", agent_status: "working", pane_id: "w1:p1" },
    }),
    ...overrides,
  };
}

test("event filtering accepts useful lifecycle changes and manual refresh", () => {
  assert.equal(shouldHandleInvocation(invocationEnv()), true);
  assert.equal(
    shouldHandleInvocation(
      invocationEnv({
        HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
          event: "pane.agent_status_changed",
          data: { agent_status: "blocked", pane_id: "w1:p1" },
        }),
      }),
    ),
    false,
  );
  assert.equal(
    shouldHandleInvocation({ HERDR_PLUGIN_ACTION_ID: "refresh", HERDR_PANE_ID: "w1:p1" }),
    true,
  );
});

test("first Codex event generates once, syncs native title, and suppresses duplicates", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-run-"));
  let paneTitle = null;
  let generationCount = 0;
  let codexSyncCount = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "Fix checkout race", description: "Checkout locking regression" };
    },
    readPane: async () => codexPane(paneTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async () => {
      codexSyncCount += 1;
      return { status: "updated", title: "Fix checkout race" };
    },
    writePaneTitle: async ({ title }) => {
      paneTitle = title;
    },
  };

  const first = await runAutoTitle({ deps, env: invocationEnv(), stateDir });
  const second = await runAutoTitle({ deps, env: invocationEnv(), stateDir });

  assert.equal(first.status, "updated");
  assert.equal(second.status, "unchanged");
  assert.equal(generationCount, 1);
  assert.equal(codexSyncCount, 1);
  assert.equal(paneTitle, "Fix checkout race");
});

test("a pre-existing Herdr title is treated as a manual override", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-manual-"));
  const forbidden = async () => {
    throw new Error("manual title must prevent side effects");
  };

  const result = await runAutoTitle({
    deps: {
      generateTitle: forbidden,
      readPane: async () => codexPane("Manual pane title"),
      locateSessionFile: async () => fixtureSession,
      syncCodexThreadTitle: forbidden,
      writePaneTitle: forbidden,
    },
    env: invocationEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "preserved", title: "Manual pane title" });
});

test("failed Codex sync retries independently and reconciles a later native title", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-retry-"));
  let paneTitle = null;
  let generationCount = 0;
  let syncAttempt = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "Generated title", description: "Generated description" };
    },
    readPane: async () => codexPane(paneTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async () => {
      syncAttempt += 1;
      if (syncAttempt === 1) throw new Error("temporary app-server failure");
      return { status: "preserved", title: "Native Codex title" };
    },
    writePaneTitle: async ({ title }) => {
      paneTitle = title;
    },
  };

  const first = await runAutoTitle({ deps, env: invocationEnv(), stateDir });
  const second = await runAutoTitle({ deps, env: invocationEnv(), stateDir });
  const state = await readPaneState({ paneId: "w1:p1", stateDir });

  assert.equal(first.status, "updated");
  assert.equal(second.status, "updated");
  assert.equal(generationCount, 1);
  assert.equal(syncAttempt, 2);
  assert.equal(paneTitle, "Native Codex title");
  assert.equal(state.codexTitle, "Native Codex title");
  assert.equal(state.herdrTitle, "Native Codex title");
});

test("manual refresh replaces only titles previously owned by the plugin", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-refresh-"));
  let paneTitle = null;
  let generated = "First title";
  let previousPluginTitle = null;
  const deps = {
    generateTitle: async () => ({ title: generated, description: "Description" }),
    readPane: async () => codexPane(paneTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async (input) => {
      previousPluginTitle = input.previousPluginTitle;
      return { status: "updated", title: input.title };
    },
    writePaneTitle: async ({ title }) => {
      paneTitle = title;
    },
  };
  await runAutoTitle({ deps, env: invocationEnv(), stateDir });
  generated = "Refreshed title";

  const result = await runAutoTitle({
    deps,
    env: invocationEnv({
      HERDR_PLUGIN_ACTION_ID: "refresh",
      HERDR_PLUGIN_EVENT: undefined,
      HERDR_PLUGIN_EVENT_JSON: undefined,
    }),
    stateDir,
  });

  assert.equal(result.status, "updated");
  assert.equal(previousPluginTitle, "First title");
  assert.equal(paneTitle, "Refreshed title");
});
