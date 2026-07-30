# Herdr Auto Session Title

Automatically generate a concise title from the first user request in a Herdr
agent session. The plugin updates Herdr's pane metadata and, when the detected
agent is Codex, also synchronizes the native Codex thread name through
`thread/name/set`.

## Behavior

The plugin runs after `pane.agent_detected` and useful
`pane.agent_status_changed` events. It:

1. Reads the first usable user message from the local agent session JSONL.
2. Runs an isolated, ephemeral `codex exec` turn to generate a title of at most
   36 characters.
3. Reports the title to Herdr with pane display metadata and renames the
   containing tab.
4. For Codex panes, reads the native thread through `codex app-server` and sets
   its name with `thread/name/set`.

The first request determines the automatic title. Follow-up messages do not
continually rename the session. Use the refresh action when you explicitly want
to regenerate it.

| Agent | Herdr pane title | Native agent title |
| --- | --- | --- |
| Codex | Yes | Yes, via `thread/name/set` |
| Claude Code | Yes | No |
| Other agents | Ignored | No |

Manual titles win. The plugin only replaces a Herdr pane title, tab label, or
Codex title when it is empty, still has its numeric default, or still equals
the last title written by this plugin. If a Codex thread already has a native
title, that title is adopted as the Herdr title so the surfaces remain
synchronized.

## Requirements

- Herdr 0.7.0 or newer
- Node.js 20 or newer
- Codex CLI available on `PATH` and authenticated

The Codex CLI is used for title generation for both supported agents. Native
Codex synchronization additionally requires a Codex version that provides the
`thread/read` and `thread/name/set` app-server methods. The protocol integration
is tested with Codex CLI 0.146.0. If generation or native synchronization fails,
the plugin still applies a local truncated-title fallback to Herdr and retries
Codex synchronization on a later event.

## Install

```sh
herdr plugin install zhangzujian/herdr-auto-session-title
```

For local development:

```sh
git clone https://github.com/zhangzujian/herdr-auto-session-title.git
cd herdr-auto-session-title
herdr plugin link .
```

No configuration file is required. Herdr supplies its own executable path and
plugin state directory; title generation uses the authenticated Codex CLI's
default model.

## Manual refresh

Invoke the action while targeting a pane:

```sh
herdr plugin action invoke zhangzujian.auto-session-title.refresh
```

The action is also available through Herdr's plugin action UI.

## Privacy and safety

- The plugin reads local Codex (`$CODEX_HOME/sessions`) or Claude Code
  (`~/.claude/projects`) session JSONL files.
- Up to the first 2,000 characters of the first user request are sent to the
  provider used by `codex exec` for title generation.
- Generation uses `--ephemeral`, ignores user configuration and rules, runs in
  a read-only sandbox, and does not persist a new Codex session.
- `HERDR_*` environment variables are removed from Codex subprocesses to avoid
  recursive integration behavior and leaking Herdr invocation context.
- Plugin state stores titles, a prompt hash, and session identifiers under
  `HERDR_PLUGIN_STATE_DIR`; it does not store prompt text.
- Per-pane locks suppress duplicate concurrent generation. Manual Herdr and
  native Codex titles are never overwritten after they diverge from the
  plugin-owned value.

## Development

There are no runtime npm dependencies.

```sh
npm test
```

## License

MIT
