#!/usr/bin/env node

import { appendFile } from "node:fs/promises";

const args = process.argv.slice(2);
await appendFile(process.env.FAKE_HERDR_RECORD, `${JSON.stringify(args)}\n`);

if (args[0] === "pane" && args[1] === "get") {
  process.stdout.write(
    JSON.stringify({
      id: "fake:pane:get",
      result: {
        pane: {
          agent: "codex",
          agent_session: {
            agent: "codex",
            kind: "id",
            source: "herdr:codex",
            value: "thread-123",
          },
          agent_status: "working",
          cwd: "/tmp/project",
          pane_id: args[2],
          title: null,
          workspace_id: "w1",
        },
        type: "pane_get",
      },
    }),
  );
}
