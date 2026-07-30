import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { isolatedChildEnv } from "./process-env.mjs";
import {
  buildGenerationPrompt,
  sanitizeDescription,
  sanitizeTitle,
} from "./title.mjs";

export async function generateTitle({
  codexBin = "codex",
  cwd,
  env = process.env,
  model = null,
  pluginRoot,
  prompt,
  stateDir,
  timeoutMs = 45_000,
}) {
  await mkdir(stateDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(stateDir, "generation-"));
  const outputPath = path.join(tempDir, "result.json");
  const schemaPath = path.join(pluginRoot, "schemas", "title-output.json");
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--cd",
    cwd,
  ];
  if (model) args.push("--model", model);
  args.push(buildGenerationPrompt(prompt));

  try {
    await execFileWithoutInput(codexBin, args, {
      env: isolatedChildEnv(env),
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    const title = sanitizeTitle(parsed.title, 36);
    const description = sanitizeDescription(parsed.description, 100);
    if (!title || !description) {
      throw new Error("Codex returned an empty title or description");
    }
    return { title, description };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function execFileWithoutInput(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stderr, stdout });
    });
    child.stdin?.end();
  });
}
