import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isolatedChildEnv } from "./process-env.mjs";

const execFileAsync = promisify(execFile);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/u;

export async function readHermesSessionPrompt({
  env = process.env,
  hermesBin = "hermes",
  sessionId,
  timeoutMs = 10_000,
}) {
  const id = String(sessionId ?? "").trim();
  if (!id || !SESSION_ID_PATTERN.test(id)) {
    throw new Error("invalid Hermes session id");
  }
  const { stdout } = await execFileAsync(
    hermesBin,
    [
      "sessions", "export", "-", "--format", "jsonl", "--only", "user-prompts",
      "--session-id", id, "--redact",
    ],
    {
      env: isolatedChildEnv(env),
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    },
  );
  for (const line of stdout.split(/\r?\n/u)) {
    const entry = parseJson(line);
    if (entry?.session_id !== id || entry?.role !== "user") continue;
    const prompt = compactPrompt(entry.text);
    if (prompt.length >= 2) return prompt;
  }
  return null;
}

function compactPrompt(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function parseJson(value) {
  try {
    return value.trim() ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
