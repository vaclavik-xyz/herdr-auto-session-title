import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readPane({
  env = process.env,
  herdrBin = env.HERDR_BIN_PATH || "herdr",
  paneId,
  timeoutMs = 10_000,
}) {
  const response = await runHerdrJson({
    args: ["pane", "get", paneId],
    env,
    herdrBin,
    timeoutMs,
  });
  const pane = response?.result?.pane;
  if (!pane?.pane_id) throw new Error(`Herdr did not return pane ${paneId}`);
  return pane;
}

export async function writePaneTitle({
  appliesToSource = null,
  env = process.env,
  herdrBin = env.HERDR_BIN_PATH || "herdr",
  paneId,
  source = "plugin:auto-session-title",
  timeoutMs = 10_000,
  title,
}) {
  const args = ["pane", "report-metadata", paneId, "--source", source];
  if (appliesToSource) {
    args.push("--applies-to-source", appliesToSource);
  }
  args.push("--title", title);
  await runHerdrJson({ args, env, herdrBin, timeoutMs });
}

async function runHerdrJson({ args, env, herdrBin, timeoutMs }) {
  const { stdout } = await execFileAsync(herdrBin, args, {
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });
  const output = stdout.trim();
  return output ? JSON.parse(output) : null;
}
