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
    agent: pane.agent,
    paneId: pane.pane_id,
    tabId: "w1:t1",
    title: "Fix checkout; no shell",
  });

  assert.equal(pane.agent_session.value, "thread-123");
  assert.equal(pane.tab.label, "1");
  const calls = (await readFile(recordPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(calls, [
    ["pane", "get", "w1:p7"],
    ["tab", "get", "w1:t1"],
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
    ],
    ["tab", "get", "w1:t1"],
    ["tab", "rename", "w1:t1", "Fix checkout; no shell"],
  ]);
});

test("Herdr adapter preserves a tab label changed before rename", async () => {
  await chmod(fakeHerdr, 0o755);

  for (const manualTitle of ["Manual during generation", "Generated title"]) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-herdr-manual-"));
    const recordPath = path.join(tempDir, "record.jsonl");
    const result = await writePaneTitle({
      agent: "codex",
      env: {
        ...process.env,
        FAKE_HERDR_RECORD: recordPath,
        FAKE_HERDR_TAB_LABEL: manualTitle,
      },
      herdrBin: fakeHerdr,
      paneId: "w1:p7",
      previousPluginTitle: "Old plugin title",
      tabId: "w1:t1",
      title: "Generated title",
    });

    assert.deepEqual(result, { status: "preserved", title: manualTitle });
    const calls = (await readFile(recordPath, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(calls, [
      [
        "pane",
        "report-metadata",
        "w1:p7",
        "--source",
        "plugin:auto-session-title",
        "--agent",
        "codex",
        "--title",
        "Generated title",
      ],
      ["tab", "get", "w1:t1"],
    ]);
  }
});
