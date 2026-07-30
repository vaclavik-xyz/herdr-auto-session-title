# Repository Guidelines

## Project Structure & Module Organization

Production code lives in `src/` as focused ES modules. `auto-title.mjs` orchestrates events, while modules such as `session.mjs`, `generator.mjs`, `state.mjs`, and `codex-rpc.mjs` isolate parsing, generation, persistence, and external-process concerns. Tests are in `test/` and mirror source names (`test/title.test.mjs`); shared fake executables belong in `test-support/`, and JSONL samples belong in `test/fixtures/`. The structured title contract is in `schemas/title-output.json`. Plugin hooks, actions, and compatibility are declared in `herdr-plugin.toml`.

## Build, Test, and Development Commands

- `npm test` runs the complete suite with Node's built-in test runner.
- `node --test test/session.test.mjs` runs one test file during focused development.
- `node --check src/*.mjs` checks production modules for syntax errors. There is no compilation step.
- `herdr plugin link .` links the checkout into a local Herdr installation for manual testing.
- `herdr plugin action invoke zhangzujian.auto-session-title.refresh` exercises the refresh action against the targeted pane.

Use Node.js 20 or newer. Keep the package free of runtime dependencies unless a change clearly requires one.

## Coding Style & Naming Conventions

Follow the existing ESM style: two-space indentation, double-quoted strings, semicolons, trailing commas in multiline constructs, and explicit `node:` imports. Use `camelCase` for functions and variables, `PascalCase` for error classes, and kebab-case filenames. Keep modules narrow and pass external commands or environment values as options so behavior remains testable. No formatter or linter is configured; match nearby code.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Name files `<module>.test.mjs` and describe observable behavior in each test title. Add regression coverage for changes involving JSONL parsing, subprocess arguments, environment isolation, locks, or compare-and-set title protection. Prefer temporary directories and the existing fake executables over real Herdr or Codex processes. No numeric coverage threshold is enforced; every behavior change should have a focused test.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit subjects, primarily `feat: imperative summary`; use matching prefixes such as `fix:`, `test:`, or `docs:`. Keep commits focused. Pull requests should explain the user-visible behavior, identify compatibility or privacy implications, link relevant issues, and report the commands run. Update `README.md` and `herdr-plugin.toml` when installation, requirements, actions, or hooks change.

## Security & Configuration

Never commit session JSONL, credentials, or generated plugin state. Preserve `HERDR_*` environment stripping, ephemeral read-only Codex generation, prompt-length limits, and manual-title protection when modifying subprocess or state logic.
