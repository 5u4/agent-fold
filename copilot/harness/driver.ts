import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionFoldDir } from "../fold-dir";
import { startProxy } from "../proxy";
import { conversationRoot, readFirstLine } from "../session-root";
import { modelInputText, stripIndexSnapshot } from "./model-input";
import { parseTurn } from "./transcript";
import type { Run, Scenario, Turn, Variant } from "./types";
import { startUpstream, type Upstream } from "./upstream";

const TURN_TIMEOUT_MS = 240_000;

const FLAGS = [
  "--allow-all-tools",
  "--no-auto-update",
  "--no-custom-instructions",
  "--no-ask-user",
  "--no-remote",
  "--disable-builtin-mcps",
  "--output-format",
  "json",
];

let cachedVersion: string | undefined;

export function copilotVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  const proc = Bun.spawnSync(["copilot", "--no-auto-update", "--version"], { stdin: "ignore" });
  const output = proc.stdout.toString();
  const version = /^GitHub Copilot CLI (\S+)\.$/m.exec(output)?.[1];
  if (proc.exitCode !== 0 || version === undefined) {
    throw new Error(`copilot --no-auto-update --version exited ${proc.exitCode} without "GitHub Copilot CLI <version>.": ${output}`);
  }
  cachedVersion = version;
  return version;
}

async function runCopilot(args: string[], cwd: string, env: Record<string, string | undefined>) {
  const proc = Bun.spawn(["copilot", ...args], { cwd, env, stdin: Bun.file("/dev/null"), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, TURN_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (timedOut) throw new Error(`copilot did not finish within ${TURN_TIMEOUT_MS / 1000} s: ${stderr}`);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

function modelInputs(upstream: Upstream, from: number, sessionId: string, foldDir: string, variant: Variant, label: string): string[] {
  const requests = upstream.requests.slice(from).filter(request => request.sessionId === sessionId);
  if (requests.length === 0) throw new Error(`${label}: no main-agent model request of the session reached the recorder`);
  return requests.map(request => {
    const { body, found } = stripIndexSnapshot(request.path, request.body, foldDir);
    if (variant === "with-plugin" && !found) throw new Error(`${label}: ${request.interactionType} ${request.path} request not folded`);
    return modelInputText(request.path, body);
  });
}

export async function runTrial<S>(
  scenario: Scenario<S>,
  { variant, model, version }: { variant: Variant; model: string; version: string },
): Promise<{ run: Run; state: S }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "copilot-run-")));
  const workdir = join(root, "workdir");
  const copilotHome = join(root, "copilot-home");
  const foldHome = join(root, "fold-home");
  const sessionStateDir = join(copilotHome, "session-state");
  for (const dir of [workdir, copilotHome, foldHome]) mkdirSync(dir);
  const upstream = startUpstream({ workdir, foldHome, sessionStateDir });
  const proxy =
    variant === "with-plugin"
      ? startProxy({ upstream: upstream.url, secret: randomBytes(32).toString("hex"), foldHome, sessionStateDir })
      : undefined;
  try {
    const { COPILOT_API_URL: _, ...inherited } = process.env;
    const entry = proxy === undefined ? upstream.url.origin : `http://127.0.0.1:${proxy.port}`;
    const env = { ...inherited, COPILOT_HOME: copilotHome, COPILOT_API_URL: entry };
    const grantFoldHome = variant === "with-plugin" || scenario.turns.some(turn => typeof turn !== "string");
    const sessionId = crypto.randomUUID();
    const setupState = await scenario.setup(workdir);
    const turns: Turn[] = [];
    let foldDir = "";
    for (const [index, turn] of scenario.turns.entries()) {
      const label = `turn ${index + 1}`;
      const { prompt, script } = typeof turn === "string" ? { prompt: turn, script: undefined } : turn;
      const args = [
        "-p",
        prompt,
        "--model",
        model,
        ...FLAGS,
        index === 0 ? `--session-id=${sessionId}` : `--resume=${sessionId}`,
        ...(grantFoldHome ? ["--add-dir", foldHome] : []),
      ];
      const from = upstream.requests.length;
      if (script !== undefined) upstream.arm(script);
      const { stdout, stderr, exitCode } = await runCopilot(args, workdir, env);
      if (script !== undefined) {
        const { unconsumed, errors } = upstream.disarm();
        if (errors.length > 0 || unconsumed.length > 0) {
          throw new Error(`${label} script failed: errors ${JSON.stringify(errors)}, unconsumed steps ${JSON.stringify(unconsumed)}`);
        }
      }
      if (exitCode !== 0) throw new Error(`copilot exited ${exitCode} on ${label}: ${stderr}`);
      const parsed = parseTurn(stdout);
      if (parsed.sessionId !== sessionId) throw new Error(`${label} ran session ${parsed.sessionId}, expected ${sessionId}`);
      if (parsed.prompt !== prompt)
        throw new Error(`${label} recorded prompt ${JSON.stringify(parsed.prompt)}, expected ${JSON.stringify(prompt)}`);
      if (index === 0) {
        const ran = JSON.parse(readFirstLine(join(sessionStateDir, sessionId, "events.jsonl"))).data?.copilotVersion;
        if (ran !== version) throw new Error(`session.start says copilotVersion ${JSON.stringify(ran)}, expected ${version}`);
        const conversation = conversationRoot(sessionStateDir, sessionId);
        if (conversation === undefined) throw new Error(`no session.start for session ${sessionId}`);
        foldDir = await sessionFoldDir(foldHome, conversation);
      }
      const inputs = modelInputs(upstream, from, sessionId, foldDir, variant, label);
      turns.push({ prompt, reply: parsed.reply, actions: parsed.actions, modelInputs: inputs });
    }
    const state = scenario.inspect ? await scenario.inspect(workdir, setupState) : setupState;
    return { run: { variant, foldHome, turns }, state };
  } finally {
    proxy?.stop(true);
    upstream.stop();
    rmSync(root, { recursive: true, force: true });
  }
}
