import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateTitle } from "../src/generator.mjs";

const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeCodex = path.join(pluginRoot, "test-support", "fake-codex-generator.mjs");

test("generateTitle runs an isolated ephemeral structured Codex turn", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-generator-"));
  const recordPath = path.join(stateDir, "record.json");
  await chmod(fakeCodex, 0o755);

  const result = await generateTitle({
    codexBin: fakeCodex,
    cwd: stateDir,
    env: {
      ...process.env,
      FAKE_CODEX_RECORD: recordPath,
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
    },
    model: "gpt-test-title",
    pluginRoot,
    prompt: "Fix the checkout race",
    stateDir,
  });

  assert.deepEqual(result, {
    title: "Fix checkout race",
    description: "checkout locking regression",
  });
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  assert.deepEqual(record.herdrEnvKeys, []);
  assert.deepEqual(record.args.slice(0, 8), [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
  ]);
  assert.ok(record.args.includes("--output-schema"));
  assert.ok(record.args.includes("--output-last-message"));
  assert.deepEqual(
    record.args.slice(record.args.indexOf("--model"), record.args.indexOf("--model") + 2),
    ["--model", "gpt-test-title"],
  );
  await assert.rejects(access(record.outputPath), { code: "ENOENT" });
});

test("generateTitle closes Codex stdin before waiting for structured output", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-generator-eof-"));
  const recordPath = path.join(stateDir, "record.json");
  await chmod(fakeCodex, 0o755);

  const result = await generateTitle({
    codexBin: fakeCodex,
    cwd: stateDir,
    env: {
      ...process.env,
      FAKE_CODEX_RECORD: recordPath,
      FAKE_CODEX_REQUIRE_STDIN_EOF: "1",
    },
    pluginRoot,
    prompt: "Fix the checkout race",
    stateDir,
    timeoutMs: 1_000,
  });

  assert.equal(result.title, "Fix checkout race");
});
