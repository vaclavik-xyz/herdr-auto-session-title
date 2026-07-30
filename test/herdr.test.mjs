import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readPane, writePaneTitle } from "../src/herdr.mjs";

const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeHerdr = path.join(pluginRoot, "test-support", "fake-herdr.mjs");

test("Herdr adapter reads a pane and writes argv-safe targeted metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-herdr-"));
  const recordPath = path.join(tempDir, "record.jsonl");
  await chmod(fakeHerdr, 0o755);
  const options = {
    env: { ...process.env, FAKE_HERDR_RECORD: recordPath },
    herdrBin: fakeHerdr,
  };

  const pane = await readPane({ ...options, paneId: "w1:p7" });
  await writePaneTitle({
    ...options,
    appliesToSource: pane.agent_session.source,
    paneId: pane.pane_id,
    title: "Fix checkout; no shell",
  });

  assert.equal(pane.agent_session.value, "thread-123");
  const calls = (await readFile(recordPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(calls, [
    ["pane", "get", "w1:p7"],
    [
      "pane",
      "report-metadata",
      "w1:p7",
      "--source",
      "plugin:auto-session-title",
      "--applies-to-source",
      "herdr:codex",
      "--title",
      "Fix checkout; no shell",
    ],
  ]);
});
