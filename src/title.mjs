const TITLE_PREFIX = /^title[:\s]+/i;
const SURROUNDING_QUOTES = /^[`"'“”‘’]+|[`"'“”‘’]+$/g;
const SKILL_COMMAND = /^\$([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?=\s|$)/i;

export function sanitizeTitle(value, maxLength = 36) {
  let title = firstUsefulLine(value)
    .replace(TITLE_PREFIX, "")
    .replace(SURROUNDING_QUOTES, "")
    .replace(/\s+/g, " ")
    .trim();
  const skillCommand = title.match(SKILL_COMMAND);
  if (skillCommand) {
    title = skillCommand[1].replaceAll("-", " ");
  } else {
    title = title.replace(/[.?!]+$/u, "");
  }
  if (!title) return null;
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength - 1).trimEnd()}…`;
}

export function sanitizeDescription(value, maxLength = 100) {
  const description = String(value ?? "").replace(/\s+/g, " ").trim();
  return description ? description.slice(0, maxLength).trimEnd() : null;
}

export function buildGenerationPrompt(value) {
  const prompt = String(value ?? "").trim().slice(0, 2_000);
  return [
    "You are a helpful assistant. Generate a concise UI title for the task in the user prompt.",
    "Generate a concise UI title (up to 36 characters and under 5 words where possible).",
    "Write in the user's locale. Preserve ticket references verbatim.",
    "Use an imperative verb first when the user requests a change.",
    "Do not answer the request or perform the task.",
    "Return structured JSON with plain-text title and description fields.",
    "Do not include quotes, markdown, formatting characters, or trailing punctuation.",
    "The description must be a compact search-oriented summary up to 100 characters.",
    "",
    "User prompt:",
    prompt,
  ].join("\n");
}

function firstUsefulLine(value) {
  return (
    String(value ?? "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .find((line) => line.trim()) ?? ""
  ).trim();
}
