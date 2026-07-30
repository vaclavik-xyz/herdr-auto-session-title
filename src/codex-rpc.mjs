import { spawn } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";

import { isolatedChildEnv } from "./process-env.mjs";

export async function syncCodexThreadTitle({
  codexBin = "codex",
  env = process.env,
  previousPluginTitle = null,
  threadId,
  timeoutMs = 15_000,
  title,
}) {
  const client = createStdioClient({ codexBin, env, timeoutMs });
  try {
    await client.initialize();
    const thread = await client.call("thread/read", { threadId });
    const currentTitle = thread?.name?.trim() || null;
    if (currentTitle && currentTitle !== previousPluginTitle) {
      return { status: "preserved", title: currentTitle };
    }
    await client.call("thread/name/set", { threadId, name: title });
    return { status: "updated", title };
  } finally {
    await client.close();
  }
}

function createStdioClient({ codexBin, env, timeoutMs }) {
  const child = spawn(codexBin, ["app-server", "--listen", "stdio://"], {
    env: isolatedChildEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.resume();
  let nextId = 1;
  let processError = null;
  const pending = new Map();
  child.on("error", (error) => {
    processError = error;
    failPending(error);
  });
  child.on("exit", (code) => {
    if (code && !processError) {
      failPending(new Error(`codex app-server exited with status ${code}`));
    }
  });

  const output = readline.createInterface({ input: child.stdout });
  output.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) {
      request.reject(new Error(message.error.message || "Codex RPC error"));
    } else {
      request.resolve(message.result);
    }
  });

  function failPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  function send(message) {
    if (processError) throw processError;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex RPC timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, { reject, resolve, timeout });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  return {
    call,
    async initialize() {
      await call("initialize", {
        capabilities: { experimentalApi: true },
        clientInfo: { name: "herdr-auto-session-title", version: "0.1.0" },
      });
      send({ jsonrpc: "2.0", method: "initialized" });
    },
    async close() {
      output.close();
      child.stdin.end();
      if (child.exitCode !== null) return;
      const exited = once(child, "exit");
      const timer = new Promise((resolve) => setTimeout(resolve, 500, "timeout"));
      if ((await Promise.race([exited, timer])) === "timeout") child.kill();
    },
  };
}
