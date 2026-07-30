#!/usr/bin/env node

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { syncCodexThreadTitle } from "./codex-rpc.mjs";
import { generateTitle } from "./generator.mjs";
import { readPane, writePaneTitle } from "./herdr.mjs";
import { extractSessionPrompt, locateSessionFile } from "./session.mjs";
import { LockBusyError, readPaneState, withPaneLock, writePaneState } from "./state.mjs";
import { sanitizeDescription, sanitizeTitle } from "./title.mjs";

const defaultDependencies = {
  extractSessionPrompt,
  generateTitle,
  locateSessionFile,
  readPane,
  syncCodexThreadTitle,
  writePaneTitle,
};
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export function shouldHandleInvocation(env) {
  if (env.HERDR_PLUGIN_ACTION_ID === "refresh") return Boolean(env.HERDR_PANE_ID);
  if (env.HERDR_PLUGIN_EVENT === "pane.agent_detected") return true;
  if (env.HERDR_PLUGIN_EVENT !== "pane.agent_status_changed") return false;
  const event = parseJson(env.HERDR_PLUGIN_EVENT_JSON);
  return event?.data?.agent_status === "working" || event?.data?.agent_status === "idle";
}

export async function runAutoTitle({
  codexBin = "codex",
  deps: dependencyOverrides = {},
  env = process.env,
  herdrBin = env.HERDR_BIN_PATH || "herdr",
  model = null,
  pluginRoot = path.join(moduleDirectory, ".."),
  sessionRoots = defaultSessionRoots(env),
  stateDir = env.HERDR_PLUGIN_STATE_DIR || path.join(os.tmpdir(), "herdr-auto-session-title"),
} = {}) {
  if (!shouldHandleInvocation(env)) return { status: "ignored" };
  const event = parseJson(env.HERDR_PLUGIN_EVENT_JSON);
  const paneId = env.HERDR_PANE_ID || event?.data?.pane_id;
  if (!paneId) return { status: "ignored" };
  const deps = { ...defaultDependencies, ...dependencyOverrides };

  try {
    return await withPaneLock({ paneId, stateDir }, async () => {
      const pane = await deps.readPane({ env, herdrBin, paneId });
      const session = pane.agent_session;
      const agent = String(session?.agent || pane.agent || "").trim().toLowerCase();
      if (!session?.value || (agent !== "codex" && agent !== "claude")) {
        return { status: "unsupported" };
      }

      const previous = await readPaneState({ paneId, stateDir });
      const currentPaneTitle = pane.title?.trim() || null;
      const tabLabel = pane.tab?.label?.trim() || null;
      const defaultTabLabel =
        tabLabel && pane.tab?.number != null && tabLabel === String(pane.tab.number);
      const currentTabTitle = defaultTabLabel ? null : tabLabel;
      const ownedPaneTitle = confirmedPaneTitle(previous);
      const ownedTabTitle = confirmedTabTitle(previous);
      const manualTitle =
        (currentPaneTitle && currentPaneTitle !== ownedPaneTitle
          ? currentPaneTitle
          : null) ||
        (currentTabTitle && currentTabTitle !== ownedTabTitle ? currentTabTitle : null);
      if (manualTitle) {
        return { status: "preserved", title: manualTitle };
      }

      const sessionKey = [agent, session.source, session.kind, session.value].join(":");
      const sameSession = previous?.sessionKey === sessionKey;
      const force = env.HERDR_PLUGIN_ACTION_ID === "refresh";
      if (
        sameSession &&
        (previous.pendingHerdrTitle || previous.herdrTitle) &&
        !force
      ) {
        return await reconcileExistingSession({
          agent,
          codexBin,
          deps,
          env,
          herdrBin,
          pane,
          paneId,
          previous,
          stateDir,
          threadId: session.value,
        });
      }

      const sessionPath =
        session.kind === "path"
          ? session.value
          : await deps.locateSessionFile({
              agent,
              roots: sessionRoots,
              sessionId: session.value,
            });
      if (!sessionPath) return { status: "pending", reason: "session-file-not-found" };
      const prompt = await deps.extractSessionPrompt({ agent, sessionPath });
      if (!prompt) return { status: "pending", reason: "prompt-not-found" };

      let generated;
      try {
        generated = await deps.generateTitle({
          codexBin,
          cwd: pane.foreground_cwd || pane.cwd || pluginRoot,
          env,
          model,
          pluginRoot,
          prompt,
          stateDir,
        });
      } catch {
        generated = {
          title: sanitizeTitle(prompt, 36),
          description: sanitizeDescription(prompt, 100),
        };
      }
      if (!generated?.title) return { status: "pending", reason: "empty-title" };

      let resolvedTitle = generated.title;
      let codexTitle = sameSession ? previous?.codexTitle || null : null;
      if (agent === "codex") {
        try {
          const synced = await deps.syncCodexThreadTitle({
            codexBin,
            env,
            previousPluginTitle: sameSession ? previous?.codexTitle : null,
            threadId: session.value,
            title: generated.title,
          });
          resolvedTitle = synced.title;
          codexTitle = synced.title;
        } catch {}
      }

      const stagedState = {
        ...previous,
        codexTitle,
        herdrPaneTitle: confirmedPaneTitle(previous),
        herdrTabTitle: confirmedTabTitle(previous),
        herdrTitle: previous?.herdrTitle || null,
        pendingHerdrTitle: resolvedTitle,
        promptHash: hash(prompt),
        sessionKey,
      };
      await writePaneState({ paneId, state: stagedState, stateDir });
      const herdrResult = await deps.writePaneTitle({
        agent,
        env,
        herdrBin,
        onPaneTitleWritten: async () => {
          stagedState.herdrPaneTitle = resolvedTitle;
          await writePaneState({ paneId, state: stagedState, stateDir });
        },
        onTabTitleWritten: async () => {
          stagedState.herdrTabTitle = resolvedTitle;
          await writePaneState({ paneId, state: stagedState, stateDir });
        },
        paneId,
        previousPluginTitle: stagedState.herdrTabTitle,
        tabId: pane.tab_id,
        title: resolvedTitle,
      });
      if (herdrResult?.status === "preserved") {
        await writePaneState({ paneId, state: stagedState, stateDir });
        return herdrResult;
      }
      const completedState = {
        ...stagedState,
        herdrPaneTitle: resolvedTitle,
        herdrTabTitle: pane.tab_id ? resolvedTitle : stagedState.herdrTabTitle,
        herdrTitle: resolvedTitle,
      };
      delete completedState.pendingHerdrTitle;
      await writePaneState({
        paneId,
        state: completedState,
        stateDir,
      });
      return { status: "updated", title: resolvedTitle };
    });
  } catch (error) {
    if (error instanceof LockBusyError) return { status: "busy" };
    throw error;
  }
}

async function reconcileExistingSession({
  agent,
  codexBin,
  deps,
  env,
  herdrBin,
  pane,
  paneId,
  previous,
  stateDir,
  threadId,
}) {
  let target = previous.pendingHerdrTitle || previous.herdrTitle;
  let codexTitle = previous.codexTitle;
  let codexUpdated = false;
  if (agent === "codex" && codexTitle !== target) {
    try {
      const synced = await deps.syncCodexThreadTitle({
        codexBin,
        env,
        previousPluginTitle: previous.codexTitle,
        threadId,
        title: target,
      });
      target = synced.title;
      codexTitle = synced.title;
      codexUpdated = codexTitle !== previous.codexTitle;
    } catch {
      // Codex and Herdr are reconciled independently so either side can recover.
    }
  }

  let herdrUpdated = false;
  if (!herdrPresentationMatches(pane, target)) {
    const stagedState = {
      ...previous,
      codexTitle,
      herdrPaneTitle: confirmedPaneTitle(previous),
      herdrTabTitle: confirmedTabTitle(previous),
      pendingHerdrTitle: target,
    };
    await writePaneState({
      paneId,
      state: stagedState,
      stateDir,
    });
    const reconciled = await deps.writePaneTitle({
      agent,
      env,
      herdrBin,
      onPaneTitleWritten: async () => {
        stagedState.herdrPaneTitle = target;
        await writePaneState({ paneId, state: stagedState, stateDir });
      },
      onTabTitleWritten: async () => {
        stagedState.herdrTabTitle = target;
        await writePaneState({ paneId, state: stagedState, stateDir });
      },
      paneId,
      previousPluginTitle: stagedState.herdrTabTitle,
      tabId: pane.tab_id,
      title: target,
    });
    if (reconciled?.status === "preserved") {
      await writePaneState({ paneId, state: stagedState, stateDir });
      return reconciled;
    }
    herdrUpdated = true;
  }

  const reconciledState = {
    ...previous,
    codexTitle,
    herdrPaneTitle: target,
    herdrTabTitle: pane.tab_id ? target : confirmedTabTitle(previous),
    herdrTitle: target,
  };
  delete reconciledState.pendingHerdrTitle;
  await writePaneState({ paneId, state: reconciledState, stateDir });
  const status =
    codexUpdated || herdrUpdated || previous.pendingHerdrTitle ? "updated" : "unchanged";
  return { status, title: target };
}

function defaultSessionRoots(env) {
  const userHomeDirectory = os.homedir();
  const codexHomeDirectory = env.CODEX_HOME || path.join(userHomeDirectory, ".codex");
  return {
    claude: path.join(userHomeDirectory, ".claude", "projects"),
    codex: path.join(codexHomeDirectory, "sessions"),
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function herdrPresentationMatches(pane, title) {
  return (
    pane.title?.trim() === title &&
    (!pane.tab || pane.tab.label?.trim() === title)
  );
}

function confirmedPaneTitle(state) {
  return state?.herdrPaneTitle ?? state?.herdrTitle ?? null;
}

function confirmedTabTitle(state) {
  return state?.herdrTabTitle ?? state?.herdrTitle ?? null;
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAutoTitle()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
