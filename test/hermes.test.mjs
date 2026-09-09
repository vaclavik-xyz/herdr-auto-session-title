import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readHermesSessionPrompt } from "../src/hermes.mjs";

test("readHermesSessionPrompt uses the redacted user-prompt export", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auto-title-hermes-"));
  const argsPath = path.join(directory, "args.json");
  const envPath = path.join(directory, "env.json");
  const hermesBin = path.join(directory, "hermes");
  await writeFile(
    hermesBin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)));
writeFileSync(process.env.ENV_PATH, JSON.stringify({ pluginEvent: process.env.HERDR_PLUGIN_EVENT ?? null }));
process.stdout.write(JSON.stringify({ session_id: "session-123", index: 1, role: "user", text: "Fix the Hermes title bridge" }) + "\\n");
`,
  );
  await chmod(hermesBin, 0o755);

  const prompt = await readHermesSessionPrompt({
    env: {
      ...process.env,
      ARGS_PATH: argsPath,
      ENV_PATH: envPath,
      HERDR_PLUGIN_EVENT: "pane.focused",
    },
    hermesBin,
    sessionId: "session-123",
  });

  assert.equal(prompt, "Fix the Hermes title bridge");
  assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
    "sessions", "export", "-", "--format", "jsonl", "--only", "user-prompts",
    "--session-id", "session-123", "--redact",
  ]);
  assert.deepEqual(JSON.parse(await readFile(envPath, "utf8")), { pluginEvent: null });
});

test("readHermesSessionPrompt rejects unsafe session identifiers", async () => {
  await assert.rejects(
    readHermesSessionPrompt({ sessionId: "../../state.db" }),
    /invalid Hermes session id/,
  );
});
