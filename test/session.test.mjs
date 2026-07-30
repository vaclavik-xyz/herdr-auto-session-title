import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractSessionPrompt,
  locateSessionFile,
} from "../src/session.mjs";

const fixtures = path.join(import.meta.dirname, "fixtures");

test("extractSessionPrompt returns the first usable Codex user request", async () => {
  const prompt = await extractSessionPrompt({
    agent: "codex",
    sessionPath: path.join(fixtures, "codex-session.jsonl"),
  });

  assert.equal(prompt, "Fix the checkout race in src/cart.ts");
});

test("extractSessionPrompt joins Claude text parts and ignores metadata", async () => {
  const prompt = await extractSessionPrompt({
    agent: "claude",
    sessionPath: path.join(fixtures, "claude-session.jsonl"),
  });

  assert.equal(prompt, "Refactor the auth token cache");
});

test("extractSessionPrompt declines unsupported agents", async () => {
  assert.equal(
    await extractSessionPrompt({
      agent: "opencode",
      sessionPath: path.join(fixtures, "codex-session.jsonl"),
    }),
    null,
  );
});

test("locateSessionFile recursively finds an agent session by id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-title-session-"));
  const nested = path.join(root, "2026", "07", "30");
  await mkdir(nested, { recursive: true });
  const expected = path.join(nested, "rollout-codex-session-1.jsonl");
  await copyFile(path.join(fixtures, "codex-session.jsonl"), expected);

  assert.equal(
    await locateSessionFile({
      agent: "codex",
      sessionId: "codex-session-1",
      roots: { codex: root },
    }),
    expected,
  );
});
