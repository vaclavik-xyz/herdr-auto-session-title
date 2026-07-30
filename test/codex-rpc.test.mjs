import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncCodexThreadTitle } from "../src/codex-rpc.mjs";

const pluginRoot = path.join(import.meta.dirname, "..");
const fakeServer = path.join(pluginRoot, "test-support", "fake-codex-app-server.mjs");

async function runSync({ nativeTitle = "", previousPluginTitle = null } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-rpc-"));
  const recordPath = path.join(tempDir, "record.jsonl");
  await chmod(fakeServer, 0o755);
  const result = await syncCodexThreadTitle({
    codexBin: fakeServer,
    env: {
      ...process.env,
      FAKE_CODEX_RPC_RECORD: recordPath,
      FAKE_CODEX_THREAD_NAME: nativeTitle,
      HERDR_PANE_ID: "must-not-leak",
    },
    previousPluginTitle,
    threadId: "thread-123",
    title: "Fix checkout race",
  });
  const messages = (await readFile(recordPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  return { messages, result };
}

test("Codex sync initializes, reads, and names an untitled thread", async () => {
  const { messages, result } = await runSync();

  assert.deepEqual(result, { status: "updated", title: "Fix checkout race" });
  assert.deepEqual(
    messages.map((message) => message.method),
    ["initialize", "initialized", "thread/read", "thread/name/set"],
  );
  assert.deepEqual(messages.at(-1).params, {
    threadId: "thread-123",
    name: "Fix checkout race",
  });
});

test("Codex sync preserves a native title not previously written by the plugin", async () => {
  const { messages, result } = await runSync({ nativeTitle: "Manual title" });

  assert.deepEqual(result, { status: "preserved", title: "Manual title" });
  assert.deepEqual(
    messages.map((message) => message.method),
    ["initialize", "initialized", "thread/read"],
  );
});

test("Codex sync replaces the plugin's previous native title", async () => {
  const { messages, result } = await runSync({
    nativeTitle: "Old plugin title",
    previousPluginTitle: "Old plugin title",
  });

  assert.equal(result.status, "updated");
  assert.equal(messages.at(-1).method, "thread/name/set");
});
