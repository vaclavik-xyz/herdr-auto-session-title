import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export async function extractSessionPrompt({ agent, sessionPath }) {
  const normalizedAgent = String(agent ?? "").trim().toLowerCase();
  if (normalizedAgent !== "codex" && normalizedAgent !== "claude") return null;

  const input = createReadStream(sessionPath, { encoding: "utf8" });
  try {
    for await (const line of readline.createInterface({ input })) {
      const entry = parseJson(line);
      const prompt =
        normalizedAgent === "codex"
          ? codexUserPrompt(entry)
          : claudeUserPrompt(entry);
      if (isUsablePrompt(prompt)) return compactPrompt(prompt);
    }
  } finally {
    input.destroy();
  }
  return null;
}

export async function locateSessionFile({ agent, sessionId, roots }) {
  const normalizedAgent = String(agent ?? "").trim().toLowerCase();
  const root = roots?.[normalizedAgent];
  const id = String(sessionId ?? "").trim();
  if (!root || !id || id.includes("/") || id.includes("\\")) return null;
  const expected = normalizedAgent === "claude" ? `${id}.jsonl` : `${id}.jsonl`;
  return findSessionFile(root, expected, normalizedAgent === "codex");
}

async function findSessionFile(directory, expected, suffixMatch) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSessionFile(candidate, expected, suffixMatch);
      if (nested) return nested;
    } else if (
      entry.isFile() &&
      (entry.name === expected || (suffixMatch && entry.name.endsWith(expected)))
    ) {
      return candidate;
    }
  }
  return null;
}

function codexUserPrompt(entry) {
  if (entry?.type === "event_msg" && entry.payload?.type === "user_message") {
    return typeof entry.payload.message === "string" ? entry.payload.message : null;
  }
  if (
    entry?.type !== "response_item" ||
    entry.payload?.type !== "message" ||
    entry.payload?.role !== "user" ||
    !Array.isArray(entry.payload.content)
  ) {
    return null;
  }
  const parts = entry.payload.content
    .filter((part) => part?.type === "input_text" && typeof part.text === "string")
    .map((part) => part.text)
    .filter((text) => !isCodexContextBlock(text));
  return parts.length ? parts.join(" ") : null;
}

function isCodexContextBlock(value) {
  const text = String(value ?? "").trimStart();
  return (
    text.startsWith("# AGENTS.md instructions for ") ||
    text.startsWith("<environment_context>")
  );
}

function claudeUserPrompt(entry) {
  if (entry?.type !== "user" || entry.isMeta) return null;
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .map((part) => (typeof part === "string" ? part : part?.text))
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
}

function compactPrompt(value) {
  return String(value ?? "")
    .replace(/^<command-name>.*?<\/command-name>\s*/isu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/^\s*[>›]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsablePrompt(value) {
  const prompt = compactPrompt(value);
  if (prompt.length < 2) return false;
  if (prompt.startsWith("/clear")) return false;
  if (String(value).startsWith("<local-command")) return false;
  return true;
}

function parseJson(line) {
  try {
    return line.trim() ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}
