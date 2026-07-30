#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import readline from "node:readline";

const args = process.argv.slice(2);

if (args[0] === "exec") {
  const outputIndex = args.indexOf("--output-last-message");
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
  await writeFile(
    process.env.FAKE_CODEX_RECORD,
    JSON.stringify({
      args,
      herdrEnvKeys: Object.keys(process.env).filter((key) => key.startsWith("HERDR_")),
      outputPath,
    }),
  );
  if (!outputPath) process.exit(2);
  await writeFile(
    outputPath,
    JSON.stringify({
      title: "title: `Fix checkout race!!!`",
      description: " checkout   locking regression ",
    }),
  );
} else if (args[0] === "app-server") {
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    await appendFile(
      process.env.FAKE_CODEX_RPC_RECORD,
      `${JSON.stringify(message)}\n`,
    );
    if (message.method === "initialized") continue;

    const result =
      message.method === "thread/read"
        ? {
            thread: {
              id: message.params.threadId,
              name: process.env.FAKE_CODEX_THREAD_NAME || null,
            },
          }
        : {};
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`,
    );
  }
} else {
  process.exitCode = 2;
}
