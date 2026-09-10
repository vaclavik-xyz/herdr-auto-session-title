import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAutoTitle } from "../src/auto-title.mjs";

const fixtureSession = fileURLToPath(new URL("./fixtures/codex-session.jsonl", import.meta.url));

function eventEnv(name, status = "working") {
  return {
    HERDR_PANE_ID: "w1:p1",
    HERDR_PLUGIN_EVENT: name,
    // Herdr's hook selector is dotted, but EventEnvelope uses snake_case.
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: name.replace(".", "_"),
      data: { agent: "codex", agent_status: status, pane_id: "w1:p1" },
    }),
  };
}

async function harness(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auto-title-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = { agent: "codex", source: "herdr:codex", kind: "id", value: "thread-123" };
  const pane = {
    agent: "codex",
    agent_session: session,
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    tab: { tab_id: "w1:t1", number: 1, label: "1" },
    title: null,
  };
  const calls = { generate: 0, sync: 0, write: 0, sleep: 0 };
  const deps = {
    clearPaneTitle: async () => assert.fail("unexpected release cleanup"),
    readPane: async () => structuredClone(pane),
    readCodexThreadTitle: async () => null,
    locateSessionFile: async () => fixtureSession,
    generateTitle: async () => {
      calls.generate += 1;
      return { title: "Fix first task", description: "First request" };
    },
    syncCodexThreadTitle: async ({ title }) => {
      calls.sync += 1;
      return { status: "updated", title };
    },
    writePaneTitle: async ({ title }) => {
      calls.write += 1;
      pane.title = title;
      pane.tab.label = title;
      return { status: "updated", title };
    },
    sleep: async () => { calls.sleep += 1; },
  };
  return {
    calls, deps, directory, pane, session,
    run: (env = eventEnv("pane.agent_status_changed")) => runAutoTitle({
      deps,
      env,
      sessionPollAttempts: 3,
      sessionPollIntervalMs: 0,
      stateDir: path.join(directory, "state"),
    }),
  };
}

for (const event of ["pane.agent_detected", "pane.agent_status_changed"]) {
  test(`${event} waits for a delayed first session identity`, async (t) => {
    const h = await harness(t);
    delete h.pane.agent_session;
    h.deps.sleep = async () => {
      h.calls.sleep += 1;
      h.pane.agent_session = h.session;
    };

    assert.deepEqual(await h.run(eventEnv(event)), { status: "updated", title: "Fix first task" });
    assert.equal(h.calls.sleep, 1);
    assert.equal(h.calls.generate, 1);
    assert.equal(h.pane.tab.label, "Fix first task");
  });
}

test("first working event waits for a transcript and prompt without another user turn", async (t) => {
  const h = await harness(t);
  const sessionPath = path.join(h.directory, "session.jsonl");
  h.session.kind = "path";
  h.session.value = sessionPath;
  h.deps.sleep = async () => {
    h.calls.sleep += 1;
    const content = h.calls.sleep === 1 ? "" : `${JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix checkout" }] },
    })}\n`;
    await writeFile(sessionPath, content);
  };
  const generate = h.deps.generateTitle;
  h.deps.generateTitle = async (args) => {
    assert.equal(args.prompt, "Fix checkout");
    return generate(args);
  };

  assert.equal((await h.run()).status, "updated");
  assert.equal(h.calls.sleep, 2);
  assert.equal(h.calls.generate, 1);
  assert.equal(h.pane.title, "Fix first task");
  assert.equal((await h.run(eventEnv("pane.agent_status_changed", "done"))).status, "unchanged");
  assert.equal(h.calls.generate, 1);
});

test("completion recovers an untitled first task after identity polling expires", async (t) => {
  const h = await harness(t);
  delete h.pane.agent_session;
  assert.deepEqual(await h.run(), { status: "pending", reason: "session-identity-not-found" });
  assert.equal(h.calls.sleep, 3);
  assert.equal(h.calls.generate, 0);

  h.pane.agent_session = h.session;
  assert.deepEqual(await h.run(eventEnv("pane.agent_status_changed", "done")), {
    status: "updated", title: "Fix first task",
  });
  assert.equal(h.calls.generate, 1);
});

test("a completion event during prompt polling does not lose the first title", async (t) => {
  const h = await harness(t);
  let ready = false;
  h.deps.locateSessionFile = async () => ready ? fixtureSession : null;
  h.deps.sleep = async () => {
    assert.deepEqual(await h.run(eventEnv("pane.agent_status_changed", "done")), { status: "busy" });
    ready = true;
  };

  assert.equal((await h.run()).status, "updated");
  assert.equal(h.calls.generate, 1);
  assert.equal(h.calls.write, 1);
});

test("dotted JSON event names remain compatible", async (t) => {
  const h = await harness(t);
  delete h.pane.agent_session;
  h.deps.sleep = async () => { h.pane.agent_session = h.session; };
  const env = eventEnv("pane.agent_detected");
  const event = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON);
  env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ ...event, event: "pane.agent_detected" });
  assert.equal((await h.run(env)).status, "updated");
});

for (const missing of ["session-file-not-found", "prompt-not-found"]) {
  test(`waiting for ${missing} is bounded`, async (t) => {
    const h = await harness(t);
    h.deps.locateSessionFile = async () => missing === "session-file-not-found" ? null : fixtureSession;
    h.deps.extractSessionPrompt = async () => null;

    assert.deepEqual(await h.run(), { status: "pending", reason: missing });
    assert.equal(h.calls.sleep, 3);
    assert.equal(h.calls.generate, 0);
  });
}

test("prompt polling stops when the pane switches sessions", async (t) => {
  const h = await harness(t);
  h.deps.locateSessionFile = async () => null;
  h.deps.sleep = async () => {
    h.pane.agent_session = { ...h.session, value: "replacement-thread" };
  };

  assert.deepEqual(await h.run(), { status: "pending", reason: "session-changed" });
  assert.equal(h.calls.generate, 0);
  assert.equal(h.calls.sync, 0);
  assert.equal(h.calls.write, 0);
});

for (const surface of ["pane", "tab"]) {
  test(`a manual ${surface} title written during prompt polling is preserved`, async (t) => {
    const h = await harness(t);
    let ready = false;
    h.deps.locateSessionFile = async () => ready ? fixtureSession : null;
    h.deps.sleep = async () => {
      ready = true;
      if (surface === "pane") h.pane.title = "My title";
      else h.pane.tab.label = "My title";
    };

    assert.deepEqual(await h.run(), { status: "preserved", title: "My title" });
    assert.equal(h.calls.generate, 0);
    assert.equal(h.calls.sync, 0);
    assert.equal(h.calls.write, 0);
  });
}

test("completion preserves a manual title instead of generating a missing one", async (t) => {
  const h = await harness(t);
  h.pane.title = "Manual title";
  assert.deepEqual(await h.run(eventEnv("pane.agent_status_changed", "done")), {
    status: "preserved", title: "Manual title",
  });
  assert.equal(h.calls.generate, 0);
});

test("prompt polling does not hide transcript errors other than a missing file", async (t) => {
  const h = await harness(t);
  h.deps.extractSessionPrompt = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
  await assert.rejects(h.run(), { code: "EACCES" });
  assert.equal(h.calls.sleep, 0);
});

test("unsupported agents are ignored without polling", async (t) => {
  const h = await harness(t);
  h.pane.agent = "other";
  delete h.pane.agent_session;
  assert.deepEqual(await h.run(), { status: "unsupported" });
  assert.equal(h.calls.sleep, 0);
  assert.equal(h.calls.generate, 0);
});
