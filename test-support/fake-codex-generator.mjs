#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const record = {
  args,
  herdrEnvKeys: Object.keys(process.env).filter((key) => key.startsWith("HERDR_")),
  outputPath,
};

await writeFile(process.env.FAKE_CODEX_RECORD, JSON.stringify(record));
if (!outputPath) process.exit(2);
await writeFile(
  outputPath,
  JSON.stringify({
    title: "title: `Fix checkout race!!!`",
    description: " checkout   locking regression ",
  }),
);
