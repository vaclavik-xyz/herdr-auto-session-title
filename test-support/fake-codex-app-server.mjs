#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import readline from "node:readline";

for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  await appendFile(process.env.FAKE_CODEX_RPC_RECORD, `${JSON.stringify(message)}\n`);
  if (message.method === "initialized") continue;

  let result = {};
  if (message.method === "thread/read") {
    result = {
      thread: {
        id: message.params.threadId,
        name: process.env.FAKE_CODEX_THREAD_NAME || null,
      },
    };
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
}
