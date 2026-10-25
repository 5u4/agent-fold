import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { FOLD_DIR, type Scenario, type ScriptStep, type Variant } from "@agent-fold/evals";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { type ChatRequest, type QueuedReply, type Reply, startFakeProvider } from "./fake-provider";
import { PLUGIN } from "./sandbox";
import { systemPrompt } from "./view";

const REQUEST_LOG = join(import.meta.dir, "request-log.ts");
const SCRIPTED_MODEL = "scripted/scripted";

export type PiMessage = SessionMessageEntry["message"];

export type PiTurn = { prompt: string; reply: string; requests: unknown[]; messages: PiMessage[] };

export type PiRun = { variant: Variant; foldHome: string; turns: PiTurn[] };

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line !== "");
}

function sessionEntries(sessions: string): SessionEntry[] {
  return readdirSync(sessions)
    .filter(name => name.endsWith(".jsonl"))
    .flatMap(name => readLines(join(sessions, name)))
    .map(line => JSON.parse(line));
}

function foldDirIn(request: ChatRequest, foldHome: string): string | undefined {
  const text = systemPrompt(request);
  const start = text.indexOf(`${foldHome}/`);
  if (start === -1) return undefined;
  const segments = text.slice(start + foldHome.length + 1).match(/^([^/\s`]+)\/([^/\s`]+)\/([^/\s`]+)/);
  return segments ? join(foldHome, segments[1], segments[2], segments[3]) : undefined;
}

function stepReply(step: ScriptStep): Reply {
  switch (step.kind) {
    case "read":
      return { toolCall: { name: "read", arguments: { path: step.path } } };
    case "shell":
      return { toolCall: { name: "bash", arguments: { command: step.command } } };
    case "write":
      return { toolCall: { name: "write", arguments: { path: step.path, content: step.content } } };
    default:
      return { text: step.text };
  }
}

export async function runTrial<S>(
  scenario: Pick<Scenario<S>, "setup" | "turns" | "inspect">,
  opts: { variant: Variant; model: string },
): Promise<{ run: PiRun; state: S }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-run-")));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  let active: Subprocess | undefined;
  const onSignal = (signal: NodeJS.Signals) => {
    active?.kill("SIGKILL");
    cleanup();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const provider = startFakeProvider();
  try {
    const agentDir = join(root, "agent");
    const workdir = join(root, "workdir");
    const sessions = join(root, "sessions");
    const foldHome = join(root, "fold-home");
    const scratch = join(root, "scratch");
    const requestsFile = join(root, "requests.jsonl");
    mkdirSync(agentDir, { mode: 0o700 });
    for (const dir of [workdir, sessions, foldHome, scratch]) mkdirSync(dir);
    const scriptedModel = {
      id: "scripted",
      contextWindow: 100_000,
      maxTokens: 1_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: { scripted: { baseUrl: provider.baseUrl, apiKey: "scripted", api: "openai-completions", models: [scriptedModel] } },
      }),
    );
    if (scenario.turns.some(turn => typeof turn === "string")) {
      const source = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json");
      if (existsSync(source)) {
        const auth = join(agentDir, "auth.json");
        copyFileSync(source, auth);
        chmodSync(auth, 0o600);
      }
    }
    const extensions = opts.variant === "with-plugin" ? ["-e", PLUGIN, "-e", REQUEST_LOG] : ["-e", REQUEST_LOG];
    const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, AGENT_FOLD_HOME: foldHome, FOLD_EVAL_REQUESTS: requestsFile };

    const setupState = await scenario.setup(workdir);
    const turns: PiTurn[] = [];
    for (const [index, turn] of scenario.turns.entries()) {
      const scripted = typeof turn !== "string";
      const prompt = scripted ? turn.prompt : turn;
      let scriptError: Error | undefined;
      if (scripted) {
        provider.enqueue(
          ...turn.script.map(
            (step): QueuedReply =>
              request => {
                const prefix = `${foldDirIn(request, foldHome) ?? scratch}/`;
                const reply: Reply = JSON.parse(JSON.stringify(stepReply(step)).replaceAll(`${FOLD_DIR}/`, prefix));
                if (step.kind === "write" && "toolCall" in reply) {
                  const path = resolve(workdir, String(reply.toolCall.arguments.path));
                  if (existsSync(path)) {
                    scriptError = new Error(`scripted write target already exists: ${path}`);
                    throw scriptError;
                  }
                }
                return reply;
              },
          ),
        );
      }
      const requestsBefore = readLines(requestsFile).length;
      const entriesBefore = sessionEntries(sessions).length;
      const args = [
        "-p",
        "-ne",
        ...extensions,
        "--session-dir",
        sessions,
        "--model",
        scripted ? SCRIPTED_MODEL : opts.model,
        ...(index > 0 ? ["-c"] : []),
        prompt,
      ];
      const proc = Bun.spawn(["pi", ...args], { cwd: workdir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      active = proc;
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      active = undefined;
      if (scriptError) throw scriptError;
      if (exitCode !== 0) throw new Error(`pi exited ${exitCode} on turn ${index + 1}: ${stderr}`);
      const reply = stdout.trim();
      if (reply === "") throw new Error(`pi printed no reply on turn ${index + 1}: ${stderr}`);
      turns.push({
        prompt,
        reply,
        requests: readLines(requestsFile)
          .slice(requestsBefore)
          .map(line => JSON.parse(line)),
        messages: sessionEntries(sessions)
          .slice(entriesBefore)
          .flatMap(entry => (entry.type === "message" ? [entry.message] : [])),
      });
    }
    const state = scenario.inspect ? await scenario.inspect(workdir, setupState) : setupState;
    return { run: { variant: opts.variant, foldHome, turns }, state };
  } finally {
    provider.stop();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    cleanup();
  }
}
