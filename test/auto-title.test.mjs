import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAutoTitle, shouldHandleInvocation } from "../src/auto-title.mjs";
import { writePaneTitle } from "../src/herdr.mjs";
import { readPaneState, writePaneState } from "../src/state.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureSession = path.join(testDirectory, "fixtures", "codex-session.jsonl");
const pluginRoot = path.join(testDirectory, "..");
const fakeCodex = path.join(pluginRoot, "test-support", "fake-codex.mjs");
const fakeHerdr = path.join(pluginRoot, "test-support", "fake-herdr.mjs");

function codexPane(title = null, tabLabel = "1") {
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
    tab: {
      label: tabLabel,
      number: 1,
      tab_id: "w1:t1",
      workspace_id: "w1",
    },
    tab_id: "w1:t1",
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

function detectionEnv(overrides = {}) {
  return invocationEnv({
    HERDR_PLUGIN_EVENT: "pane.agent_detected",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: "pane.agent_detected",
      data: { agent: "codex", pane_id: "w1:p1" },
    }),
    ...overrides,
  });
}

function releasedEnv(overrides = {}) {
  return invocationEnv({
    HERDR_PLUGIN_EVENT: "pane.agent_detected",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: "pane.agent_detected",
      data: {
        agent: null,
        final_status: "idle",
        pane_id: "w1:p1",
        released: true,
      },
    }),
    ...overrides,
  });
}

function focusedEnv(overrides = {}) {
  return invocationEnv({
    HERDR_PLUGIN_EVENT: "pane.focused",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: "pane.focused",
      data: { pane_id: "w1:p1", workspace_id: "w1" },
    }),
    ...overrides,
  });
}

function releasedPane(tabLabel = "Owned title") {
  const pane = codexPane(null, tabLabel);
  pane.agent = null;
  pane.agent_status = "unknown";
  delete pane.agent_session;
  return pane;
}

test("event filtering accepts useful lifecycle changes and manual refresh", () => {
  assert.equal(shouldHandleInvocation(invocationEnv()), true);
  assert.equal(shouldHandleInvocation(focusedEnv()), true);
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
  let tabTitle = "1";
  let generationCount = 0;
  let codexSyncCount = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "Fix checkout race", description: "Checkout locking regression" };
    },
    readCodexThreadTitle: async () => null,
    readPane: async () => codexPane(paneTitle, tabTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async () => {
      codexSyncCount += 1;
      return { status: "updated", title: "Fix checkout race" };
    },
    writePaneTitle: async ({ title }) => {
      paneTitle = title;
      tabTitle = title;
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

test("Codex detection waits for a resumed session and adopts its native title", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-resume-"));
  const resumedPane = codexPane();
  resumedPane.agent_session.value = "thread-resumed";
  let readCount = 0;
  let writtenTitle = null;
  let readThreadId = null;
  const forbidden = async () => {
    assert.fail("a native resumed title must skip prompt generation");
  };

  const result = await runAutoTitle({
    deps: {
      extractSessionPrompt: forbidden,
      generateTitle: forbidden,
      locateSessionFile: forbidden,
      readCodexThreadTitle: async ({ threadId }) => {
        readThreadId = threadId;
        return "Native resumed title";
      },
      readPane: async () => {
        readCount += 1;
        if (readCount === 1) {
          const detectedPane = codexPane();
          delete detectedPane.agent_session;
          return detectedPane;
        }
        return resumedPane;
      },
      sleep: async () => undefined,
      syncCodexThreadTitle: forbidden,
      writePaneTitle: async ({ title }) => {
        writtenTitle = title;
        return { status: "updated", title };
      },
    },
    env: detectionEnv(),
    sessionPollAttempts: 1,
    sessionPollIntervalMs: 0,
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "Native resumed title" });
  assert.equal(readCount, 2);
  assert.equal(readThreadId, "thread-resumed");
  assert.equal(writtenTitle, "Native resumed title");
});

test("manual refresh preserves a native Codex title adopted by the plugin", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-native-refresh-"));
  let nativeTitle = "Manual native title";
  let paneTitle = null;
  let tabTitle = "1";
  let previousPluginTitle = "not-called";
  const deps = {
    generateTitle: async () => ({
      title: "Generated refresh title",
      description: "Description",
    }),
    locateSessionFile: async () => fixtureSession,
    readCodexThreadTitle: async () => nativeTitle,
    readPane: async () => codexPane(paneTitle, tabTitle),
    syncCodexThreadTitle: async ({ previousPluginTitle: previous, title }) => {
      previousPluginTitle = previous;
      if (nativeTitle && nativeTitle !== previous) {
        return { status: "preserved", title: nativeTitle };
      }
      nativeTitle = title;
      return { status: "updated", title };
    },
    writePaneTitle: async ({ title }) => {
      paneTitle = title;
      tabTitle = title;
      return { status: "updated", title };
    },
  };

  await runAutoTitle({ deps, env: detectionEnv(), stateDir });
  const refreshed = await runAutoTitle({
    deps,
    env: invocationEnv({
      HERDR_PLUGIN_ACTION_ID: "refresh",
      HERDR_PLUGIN_EVENT: undefined,
      HERDR_PLUGIN_EVENT_JSON: undefined,
    }),
    stateDir,
  });

  assert.deepEqual(refreshed, { status: "updated", title: "Manual native title" });
  assert.equal(previousPluginTitle, null);
  assert.equal(nativeTitle, "Manual native title");
  assert.equal(paneTitle, "Manual native title");
});

test("a released Codex session clears owned pane and tab presentation", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-release-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Owned title",
      herdrPaneTitle: "Owned title",
      herdrTabTitle: "Owned title",
      herdrTitle: "Owned title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let clearInput = null;

  const result = await runAutoTitle({
    deps: {
      clearPaneTitle: async (input) => {
        clearInput = input;
        await input.onPaneTitleCleared?.();
        await input.onTabTitleCleared?.();
        return { status: "updated" };
      },
      readPane: async () => releasedPane(),
    },
    env: releasedEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "cleared" });
  assert.equal(clearInput.previousPluginTitle, "Owned title");
  assert.equal(clearInput.tabId, "w1:t1");
  assert.equal(await readPaneState({ paneId: "w1:p1", stateDir }), null);
});

test("partial release cleanup is retried on a later pane focus", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-release-retry-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Owned title",
      herdrPaneTitle: "Owned title",
      herdrTabTitle: "Owned title",
      herdrTitle: "Owned title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let clearAttempt = 0;
  const deps = {
    clearPaneTitle: async (input) => {
      clearAttempt += 1;
      await input.onPaneTitleCleared?.();
      if (clearAttempt === 1) throw new Error("tab reset failed");
      await input.onTabTitleCleared?.();
      return { status: "updated" };
    },
    readPane: async () => releasedPane(),
  };

  await assert.rejects(
    runAutoTitle({ deps, env: releasedEnv(), stateDir }),
    /tab reset failed/,
  );
  const pending = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(pending.releasePending, true);
  assert.equal(pending.herdrPaneTitle, null);
  assert.equal(pending.herdrTabTitle, "Owned title");

  const retried = await runAutoTitle({ deps, env: focusedEnv(), stateDir });

  assert.deepEqual(retried, { status: "cleared" });
  assert.equal(clearAttempt, 2);
  assert.equal(await readPaneState({ paneId: "w1:p1", stateDir }), null);
});

test("pane focus recovers a Codex release event skipped while the lock was busy", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-release-missed-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Owned title",
      herdrPaneTitle: "Owned title",
      herdrTabTitle: "Owned title",
      herdrTitle: "Owned title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let clearCount = 0;

  const result = await runAutoTitle({
    deps: {
      clearPaneTitle: async (input) => {
        clearCount += 1;
        await input.onPaneTitleCleared?.();
        await input.onTabTitleCleared?.();
        return { status: "updated" };
      },
      readPane: async () => releasedPane(),
    },
    env: focusedEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "cleared" });
  assert.equal(clearCount, 1);
  assert.equal(await readPaneState({ paneId: "w1:p1", stateDir }), null);
});

test("release retry rereads the pane before synchronizing a newly resumed session", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-release-new-session-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Old title",
      herdrPaneTitle: null,
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "old-hash",
      releasePending: true,
      releaseTabTitle: "Old title",
      sessionKey: "codex:herdr:codex:id:thread-old",
    },
    stateDir,
  });
  let paneTitle = "Old title";
  let tabTitle = "Old title";
  let readCount = 0;
  let writtenTitle = null;

  const result = await runAutoTitle({
    deps: {
      clearPaneTitle: async (input) => {
        paneTitle = null;
        tabTitle = "1";
        await input.onPaneTitleCleared?.();
        await input.onTabTitleCleared?.();
        return { status: "updated" };
      },
      readCodexThreadTitle: async () => "Resumed title",
      readPane: async () => {
        readCount += 1;
        const pane = codexPane(paneTitle, tabTitle);
        pane.agent_session.value = "thread-new";
        return pane;
      },
      writePaneTitle: async ({ title }) => {
        writtenTitle = title;
        return { status: "updated", title };
      },
    },
    env: focusedEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "Resumed title" });
  assert.equal(readCount, 2);
  assert.equal(writtenTitle, "Resumed title");
});

test("a delayed release event synchronizes the new active Codex session", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-delayed-release-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexOwnedTitle: "Old title",
      codexTitle: "Old title",
      herdrPaneTitle: "Old title",
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "old-hash",
      sessionKey: "codex:herdr:codex:id:thread-old",
    },
    stateDir,
  });
  let paneTitle = "Old title";
  let tabTitle = "Old title";
  let readCount = 0;
  let writtenTitle = null;

  const result = await runAutoTitle({
    deps: {
      clearPaneTitle: async (input) => {
        paneTitle = null;
        tabTitle = "1";
        await input.onPaneTitleCleared?.();
        await input.onTabTitleCleared?.();
        return { status: "updated" };
      },
      readCodexThreadTitle: async ({ threadId }) => {
        assert.equal(threadId, "thread-new");
        return "New active title";
      },
      readPane: async () => {
        readCount += 1;
        const pane = codexPane(paneTitle, tabTitle);
        pane.agent_session.value = "thread-new";
        return pane;
      },
      writePaneTitle: async ({ title }) => {
        writtenTitle = title;
        return { status: "updated", title };
      },
    },
    env: releasedEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "New active title" });
  assert.equal(readCount, 2);
  assert.equal(writtenTitle, "New active title");
  const state = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(state.sessionKey, "codex:herdr:codex:id:thread-new");
});

test("pane focus adopts the native title after an in-process session switch", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-session-switch-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Old title",
      herdrPaneTitle: "Old title",
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "old-hash",
      sessionKey: "codex:herdr:codex:id:thread-old",
    },
    stateDir,
  });
  const switchedPane = codexPane("Old title", "Old title");
  switchedPane.agent_session.value = "thread-new";
  let writtenTitle = null;
  const forbidden = async () => {
    assert.fail("a switched native session title must skip generation");
  };

  const result = await runAutoTitle({
    deps: {
      extractSessionPrompt: forbidden,
      generateTitle: forbidden,
      locateSessionFile: forbidden,
      readCodexThreadTitle: async ({ threadId }) => {
        assert.equal(threadId, "thread-new");
        return "New native title";
      },
      readPane: async () => switchedPane,
      syncCodexThreadTitle: forbidden,
      writePaneTitle: async ({ title }) => {
        writtenTitle = title;
        return { status: "updated", title };
      },
    },
    env: focusedEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "New native title" });
  assert.equal(writtenTitle, "New native title");
  const state = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(state.sessionKey, "codex:herdr:codex:id:thread-new");
  assert.equal(state.codexTitle, "New native title");
});

test("a status event adopts the native title of a different Codex session", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-status-switch-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexOwnedTitle: "Old title",
      codexTitle: "Old title",
      herdrPaneTitle: "Old title",
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "old-hash",
      sessionKey: "codex:herdr:codex:id:thread-old",
    },
    stateDir,
  });
  const switchedPane = codexPane("Old title", "Old title");
  switchedPane.agent_session.value = "thread-new";
  let writtenTitle = null;
  const forbidden = async () => {
    assert.fail("a native title must skip session JSONL and generation");
  };

  const result = await runAutoTitle({
    deps: {
      extractSessionPrompt: forbidden,
      generateTitle: forbidden,
      locateSessionFile: forbidden,
      readCodexThreadTitle: async ({ threadId }) => {
        assert.equal(threadId, "thread-new");
        return "Status native title";
      },
      readPane: async () => switchedPane,
      syncCodexThreadTitle: forbidden,
      writePaneTitle: async ({ title }) => {
        writtenTitle = title;
        return { status: "updated", title };
      },
    },
    env: invocationEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "Status native title" });
  assert.equal(writtenTitle, "Status native title");
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

test("a non-default Herdr tab label is treated as a manual override", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-manual-tab-"));
  const forbidden = async () => {
    throw new Error("manual tab title must prevent side effects");
  };

  const result = await runAutoTitle({
    deps: {
      generateTitle: forbidden,
      readPane: async () => codexPane(null, "Manual tab title"),
      locateSessionFile: async () => fixtureSession,
      syncCodexThreadTitle: forbidden,
      writePaneTitle: forbidden,
    },
    env: invocationEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "preserved", title: "Manual tab title" });
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
    readCodexThreadTitle: async () => null,
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

test("Herdr ownership state is staged before a partial title write", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-staged-"));

  await assert.rejects(
    runAutoTitle({
      deps: {
        generateTitle: async () => ({ title: "Generated title", description: "Description" }),
        readCodexThreadTitle: async () => null,
        readPane: async () => codexPane(),
        locateSessionFile: async () => fixtureSession,
        syncCodexThreadTitle: async () => ({ status: "updated", title: "Generated title" }),
        writePaneTitle: async () => {
          throw new Error("tab rename failed");
        },
      },
      env: invocationEnv(),
      stateDir,
    }),
    /tab rename failed/,
  );

  const state = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(state.herdrTitle, null);
  assert.equal(state.pendingHerdrTitle, "Generated title");
  assert.equal(state.codexTitle, "Generated title");
});

test("a partial Herdr replacement retains old ownership and recovers without regenerating", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-partial-retry-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let paneTitle = "Old title";
  let tabTitle = "Old title";
  let generationCount = 0;
  let writeAttempt = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "New title", description: "Description" };
    },
    readPane: async () => codexPane(paneTitle, tabTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async () => ({ status: "updated", title: "New title" }),
    writePaneTitle: async ({ onPaneTitleWritten, title }) => {
      writeAttempt += 1;
      paneTitle = title;
      await onPaneTitleWritten?.();
      if (writeAttempt === 1) throw new Error("tab rename failed");
      tabTitle = title;
      return { status: "updated", title };
    },
  };
  const refreshEnv = invocationEnv({
    HERDR_PLUGIN_ACTION_ID: "refresh",
    HERDR_PLUGIN_EVENT: undefined,
    HERDR_PLUGIN_EVENT_JSON: undefined,
  });

  await assert.rejects(
    runAutoTitle({ deps, env: refreshEnv, stateDir }),
    /tab rename failed/,
  );
  const partialState = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(partialState.herdrTitle, "Old title");
  assert.equal(partialState.pendingHerdrTitle, "New title");

  const recovered = await runAutoTitle({ deps, env: invocationEnv(), stateDir });
  const recoveredState = await readPaneState({ paneId: "w1:p1", stateDir });

  assert.deepEqual(recovered, { status: "updated", title: "New title" });
  assert.equal(generationCount, 1);
  assert.equal(writeAttempt, 2);
  assert.equal(paneTitle, "New title");
  assert.equal(tabTitle, "New title");
  assert.equal(recoveredState.herdrTitle, "New title");
  assert.equal("pendingHerdrTitle" in recoveredState, false);
});

test("Herdr reconciliation proceeds when a pending Codex sync fails", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-independent-retry-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: null,
      herdrTitle: "Owned title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let tabTitle = "1";
  let writeCount = 0;

  const result = await runAutoTitle({
    deps: {
      generateTitle: async () => {
        throw new Error("must not regenerate");
      },
      readPane: async () => codexPane("Owned title", tabTitle),
      locateSessionFile: async () => {
        throw new Error("must not relocate session");
      },
      syncCodexThreadTitle: async () => {
        throw new Error("temporary app-server failure");
      },
      writePaneTitle: async ({ title }) => {
        writeCount += 1;
        tabTitle = title;
        return { status: "updated", title };
      },
    },
    env: invocationEnv(),
    stateDir,
  });
  const state = await readPaneState({ paneId: "w1:p1", stateDir });

  assert.deepEqual(result, { status: "updated", title: "Owned title" });
  assert.equal(writeCount, 1);
  assert.equal(tabTitle, "Owned title");
  assert.equal(state.codexTitle, null);
  assert.equal(state.herdrTitle, "Owned title");
});

test("a pending target does not claim an equal late manual tab label", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-pending-manual-"));
  const recordPath = path.join(stateDir, "herdr.jsonl");
  await chmod(fakeHerdr, 0o755);
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "New title",
      herdrPaneTitle: "New title",
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      pendingHerdrTitle: "New title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });

  const result = await runAutoTitle({
    deps: {
      readPane: async () => codexPane("New title", "Old title"),
      writePaneTitle,
    },
    env: invocationEnv({
      FAKE_HERDR_RECORD: recordPath,
      FAKE_HERDR_TAB_LABEL: "New title",
    }),
    herdrBin: fakeHerdr,
    stateDir,
  });
  const state = await readPaneState({ paneId: "w1:p1", stateDir });

  assert.deepEqual(result, { status: "preserved", title: "New title" });
  assert.equal(state.herdrTitle, "Old title");
  assert.equal(state.herdrTabTitle, "Old title");
  assert.equal(state.pendingHerdrTitle, "New title");
});

test("a pane write before a late manual tab remains recoverable", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-late-manual-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let paneTitle = "Old title";
  let tabTitle = "Old title";
  let generationCount = 0;
  let writeCount = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "New title", description: "Description" };
    },
    readPane: async () => codexPane(paneTitle, tabTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async ({ title }) => ({ status: "updated", title }),
    writePaneTitle: async ({ onPaneTitleWritten, title }) => {
      writeCount += 1;
      paneTitle = title;
      await onPaneTitleWritten?.();
      if (writeCount === 1) {
        tabTitle = "Manual during generation";
        return { status: "preserved", title: tabTitle };
      }
      tabTitle = title;
      return { status: "updated", title };
    },
  };
  const refreshEnv = invocationEnv({
    HERDR_PLUGIN_ACTION_ID: "refresh",
    HERDR_PLUGIN_EVENT: undefined,
    HERDR_PLUGIN_EVENT_JSON: undefined,
  });

  const preserved = await runAutoTitle({ deps, env: refreshEnv, stateDir });
  tabTitle = "1";
  const recovered = await runAutoTitle({ deps, env: invocationEnv(), stateDir });

  assert.deepEqual(preserved, {
    status: "preserved",
    title: "Manual during generation",
  });
  assert.deepEqual(recovered, { status: "updated", title: "New title" });
  assert.equal(generationCount, 1);
  assert.equal(writeCount, 2);
  assert.equal(paneTitle, "New title");
  assert.equal(tabTitle, "New title");
});

test("forced refresh retains confirmed surface ownership from an earlier pending write", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-refresh-pending-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Pending title",
      herdrPaneTitle: "Pending title",
      herdrTabTitle: "Pending title",
      herdrTitle: "Old title",
      pendingHerdrTitle: "Pending title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let paneTitle = "Pending title";
  let tabTitle = "Pending title";
  let generationCount = 0;
  let writeCount = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "Newest title", description: "Description" };
    },
    readPane: async () => codexPane(paneTitle, tabTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async ({ title }) => ({ status: "updated", title }),
    writePaneTitle: async ({ title }) => {
      writeCount += 1;
      if (writeCount === 1) throw new Error("pane write failed");
      paneTitle = title;
      tabTitle = title;
      return { status: "updated", title };
    },
  };
  const refreshEnv = invocationEnv({
    HERDR_PLUGIN_ACTION_ID: "refresh",
    HERDR_PLUGIN_EVENT: undefined,
    HERDR_PLUGIN_EVENT_JSON: undefined,
  });

  await assert.rejects(
    runAutoTitle({ deps, env: refreshEnv, stateDir }),
    /pane write failed/,
  );
  const stagedState = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(stagedState.herdrPaneTitle, "Pending title");
  assert.equal(stagedState.herdrTabTitle, "Pending title");
  assert.equal(stagedState.pendingHerdrTitle, "Newest title");

  const recovered = await runAutoTitle({ deps, env: invocationEnv(), stateDir });

  assert.deepEqual(recovered, { status: "updated", title: "Newest title" });
  assert.equal(generationCount, 1);
  assert.equal(writeCount, 2);
  assert.equal(paneTitle, "Newest title");
  assert.equal(tabTitle, "Newest title");
});

test("a different session retains confirmed surface ownership until replacement succeeds", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-new-session-partial-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Old title",
      herdrPaneTitle: "Old title",
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "old-hash",
      sessionKey: "codex:herdr:codex:id:thread-old",
    },
    stateDir,
  });
  let paneTitle = "Old title";
  let tabTitle = "Old title";
  let generationCount = 0;
  let writeCount = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "New title", description: "Description" };
    },
    readCodexThreadTitle: async () => null,
    readPane: async () => codexPane(paneTitle, tabTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async ({ title }) => ({ status: "updated", title }),
    writePaneTitle: async ({ onPaneTitleWritten, title }) => {
      writeCount += 1;
      paneTitle = title;
      await onPaneTitleWritten?.();
      if (writeCount === 1) throw new Error("tab rename failed");
      tabTitle = title;
      return { status: "updated", title };
    },
  };

  await assert.rejects(
    runAutoTitle({ deps, env: invocationEnv(), stateDir }),
    /tab rename failed/,
  );
  const partialState = await readPaneState({ paneId: "w1:p1", stateDir });
  assert.equal(partialState.herdrPaneTitle, "New title");
  assert.equal(partialState.herdrTabTitle, "Old title");
  assert.equal(partialState.pendingHerdrTitle, "New title");

  const recovered = await runAutoTitle({ deps, env: invocationEnv(), stateDir });

  assert.deepEqual(recovered, { status: "updated", title: "New title" });
  assert.equal(generationCount, 1);
  assert.equal(writeCount, 2);
  assert.equal(paneTitle, "New title");
  assert.equal(tabTitle, "New title");
});

test("forced refresh retains confirmed Codex ownership after a sync failure", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-codex-refresh-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Old title",
      herdrPaneTitle: "Old title",
      herdrTabTitle: "Old title",
      herdrTitle: "Old title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  let paneTitle = "Old title";
  let tabTitle = "Old title";
  let generationCount = 0;
  let syncCount = 0;
  const deps = {
    generateTitle: async () => {
      generationCount += 1;
      return { title: "New title", description: "Description" };
    },
    readPane: async () => codexPane(paneTitle, tabTitle),
    locateSessionFile: async () => fixtureSession,
    syncCodexThreadTitle: async ({ previousPluginTitle, title }) => {
      syncCount += 1;
      if (syncCount === 1) throw new Error("temporary app-server failure");
      return previousPluginTitle === "Old title"
        ? { status: "updated", title }
        : { status: "preserved", title: "Old title" };
    },
    writePaneTitle: async ({ title }) => {
      paneTitle = title;
      tabTitle = title;
      return { status: "updated", title };
    },
  };
  const refreshEnv = invocationEnv({
    HERDR_PLUGIN_ACTION_ID: "refresh",
    HERDR_PLUGIN_EVENT: undefined,
    HERDR_PLUGIN_EVENT_JSON: undefined,
  });

  const refreshed = await runAutoTitle({ deps, env: refreshEnv, stateDir });
  const retried = await runAutoTitle({ deps, env: invocationEnv(), stateDir });
  const state = await readPaneState({ paneId: "w1:p1", stateDir });

  assert.deepEqual(refreshed, { status: "updated", title: "New title" });
  assert.deepEqual(retried, { status: "updated", title: "New title" });
  assert.equal(generationCount, 1);
  assert.equal(syncCount, 2);
  assert.equal(paneTitle, "New title");
  assert.equal(tabTitle, "New title");
  assert.equal(state.codexTitle, "New title");
});

test("legacy state reconciles a numeric Herdr tab without regenerating", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-legacy-tab-"));
  await writePaneState({
    paneId: "w1:p1",
    state: {
      codexTitle: "Owned title",
      herdrTitle: "Owned title",
      promptHash: "existing-hash",
      sessionKey: "codex:herdr:codex:id:thread-123",
    },
    stateDir,
  });
  const forbidden = async () => {
    throw new Error("reconciliation must not regenerate or resync Codex");
  };
  const writes = [];

  const result = await runAutoTitle({
    deps: {
      generateTitle: forbidden,
      readPane: async () => codexPane("Owned title", "1"),
      locateSessionFile: forbidden,
      syncCodexThreadTitle: forbidden,
      writePaneTitle: async (options) => {
        writes.push(options);
        return { status: "updated", title: options.title };
      },
    },
    env: invocationEnv(),
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "Owned title" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].previousPluginTitle, "Owned title");
  assert.equal(writes[0].tabId, "w1:t1");
});

test("manual refresh replaces only titles previously owned by the plugin", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-refresh-"));
  let paneTitle = null;
  let generated = "First title";
  let previousPluginTitle = null;
  const deps = {
    generateTitle: async () => ({ title: generated, description: "Description" }),
    readCodexThreadTitle: async () => null,
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

test("manual refresh crosses the real session, generator, RPC, and Herdr adapters", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-e2e-"));
  const sessionRoot = path.join(tempDir, "sessions");
  const stateDir = path.join(tempDir, "state");
  const herdrRecord = path.join(tempDir, "herdr.jsonl");
  const generatorRecord = path.join(tempDir, "generator.json");
  const rpcRecord = path.join(tempDir, "rpc.jsonl");
  await mkdir(sessionRoot);
  await copyFile(fixtureSession, path.join(sessionRoot, "thread-123.jsonl"));
  await chmod(fakeCodex, 0o755);
  await chmod(fakeHerdr, 0o755);

  const result = await runAutoTitle({
    codexBin: fakeCodex,
    env: {
      ...process.env,
      FAKE_CODEX_RECORD: generatorRecord,
      FAKE_CODEX_RPC_RECORD: rpcRecord,
      FAKE_HERDR_RECORD: herdrRecord,
      HERDR_PANE_ID: "w1:p9",
      HERDR_PLUGIN_ACTION_ID: "refresh",
    },
    herdrBin: fakeHerdr,
    pluginRoot,
    sessionRoots: { codex: sessionRoot },
    stateDir,
  });

  assert.deepEqual(result, { status: "updated", title: "Fix checkout race" });
  const herdrCalls = (await readFile(herdrRecord, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(herdrCalls.slice(-3), [
    [
      "pane",
      "report-metadata",
      "w1:p9",
      "--source",
      "plugin:auto-session-title",
      "--agent",
      "codex",
      "--title",
      "Fix checkout race",
    ],
    ["tab", "get", "w1:t1"],
    ["tab", "rename", "w1:t1", "Fix checkout race"],
  ]);
  const rpcCalls = (await readFile(rpcRecord, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(rpcCalls.at(-1).method, "thread/name/set");
  assert.equal(JSON.parse(await readFile(generatorRecord, "utf8")).herdrEnvKeys.length, 0);
});
