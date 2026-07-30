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

test("sanitizeTitle turns a leading skill command into a semantic title", () => {
  assert.equal(
    sanitizeTitle("$update-artifacts-plugin-version master/release-4.4 kube-ovn"),
    "update artifacts plugin version",
  );
  assert.equal(
    sanitizeTitle("$record-oncall-jira https://jira.example.test/ACP-1"),
    "record oncall jira",
  );
  assert.equal(sanitizeTitle("$deploy!"), "$deploy");
  assert.equal(sanitizeTitle("$deploy/prod details"), "$deploy/prod details");
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
