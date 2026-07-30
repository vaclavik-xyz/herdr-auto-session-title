import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class LockBusyError extends Error {
  constructor(paneId) {
    super(`Auto-title is already running for pane ${paneId}`);
    this.name = "LockBusyError";
  }
}

export async function readPaneState({ paneId, stateDir }) {
  try {
    return JSON.parse(await readFile(statePath(stateDir, paneId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writePaneState({ paneId, state, stateDir }) {
  await mkdir(stateDir, { recursive: true });
  const target = statePath(stateDir, paneId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export async function removePaneState({ paneId, stateDir }) {
  try {
    await unlink(statePath(stateDir, paneId));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function withPaneLock(
  { paneId, staleMs = 120_000, stateDir },
  operation,
) {
  await mkdir(stateDir, { recursive: true });
  const target = lockPath(stateDir, paneId);
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (!(await isStale(target, staleMs))) throw new LockBusyError(paneId);
    await unlink(target).catch(() => undefined);
    try {
      handle = await open(target, "wx", 0o600);
    } catch (retryError) {
      if (retryError?.code === "EEXIST") throw new LockBusyError(paneId);
      throw retryError;
    }
  }

  try {
    await handle.writeFile(`${process.pid}\n`);
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(target).catch(() => undefined);
  }
}

function statePath(stateDir, paneId) {
  return path.join(stateDir, `${paneKey(paneId)}.json`);
}

function lockPath(stateDir, paneId) {
  return path.join(stateDir, `${paneKey(paneId)}.lock`);
}

function paneKey(paneId) {
  return createHash("sha256").update(String(paneId)).digest("hex");
}

async function isStale(target, staleMs) {
  try {
    const metadata = await stat(target);
    return Date.now() - metadata.mtimeMs > staleMs;
  } catch {
    return true;
  }
}
