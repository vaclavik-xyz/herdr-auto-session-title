import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LockBusyError,
  readPaneState,
  withPaneLock,
  writePaneState,
} from "../src/state.mjs";

test("pane state survives an atomic round trip", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-state-"));
  const expected = {
    codexTitle: null,
    herdrTitle: "Fix checkout race",
    promptHash: "hash",
    sessionKey: "codex:thread-123",
  };

  await writePaneState({ paneId: "w1:p1", state: expected, stateDir });

  assert.deepEqual(
    await readPaneState({ paneId: "w1:p1", stateDir }),
    expected,
  );
});

test("a concurrent invocation cannot enter the same pane lock", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "auto-title-lock-"));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const first = withPaneLock({ paneId: "w1:p1", stateDir }, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;

  await assert.rejects(
    withPaneLock({ paneId: "w1:p1", stateDir }, async () => undefined),
    LockBusyError,
  );
  release.resolve();
  await first;
});
