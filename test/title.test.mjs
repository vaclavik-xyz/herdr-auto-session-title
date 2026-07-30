import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenerationPrompt,
  sanitizeDescription,
  sanitizeTitle,
} from "../src/title.mjs";

test("sanitizeTitle removes wrappers and truncates the first useful line", () => {
  assert.equal(
    sanitizeTitle("\n title: `Fix the checkout race!!!`\nignored", 20),
    "Fix the checkout ra…",
  );
});

test("sanitizeDescription collapses whitespace and caps searchable text", () => {
  assert.equal(
    sanitizeDescription(" cart   checkout\nlocking ", 18),
    "cart checkout lock",
  );
});

test("buildGenerationPrompt includes no more than 2000 prompt characters", () => {
  const prompt = `${"a".repeat(2000)}SHOULD_NOT_APPEAR`;
  const generated = buildGenerationPrompt(prompt);

  assert.match(generated, /Generate a concise UI title/);
  assert.ok(generated.includes("a".repeat(2000)));
  assert.ok(!generated.includes("SHOULD_NOT_APPEAR"));
});
