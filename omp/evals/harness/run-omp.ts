import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { Run, Scenario, Turn, Variant } from "./types";

const REPO = join(import.meta.dir, "..", "..");
const FIXTURES = join(import.meta.dir, "..", "fixtures");

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line !== "");
}

function readSessionEntries(sessionsDir: string): SessionEntry[] {
  return readdirSync(sessionsDir)
    .filter(name => name.endsWith(".jsonl"))
    .flatMap(name => readLines(join(sessionsDir, name)))
    .map(line => JSON.parse(line));
}

function createProfile(settings: Record<string, unknown> | undefined): { name: string; dir: string } {
  const name = `omp-run-${crypto.randomUUID().slice(0, 8)}`;
  const dir = join(homedir(), ".omp", "profiles", name);
  mkdirSync(join(dir, "agent"), { recursive: true });
  const agentDb = join(homedir(), ".omp", "agent", "agent.db");
  if (existsSync(agentDb)) copyFileSync(agentDb, join(dir, "agent", "agent.db"));
  if (settings) writeFileSync(join(dir, "agent", "config.yml"), JSON.stringify(settings));
  return { name, dir };
}

export async function runTrial<S>(
  scenario: Pick<Scenario<S>, "setup" | "turns" | "inspect">,
  opts: { variant: Variant; model: string; settings?: Record<string, unknown> },
): Promise<{ run: Run; state: S }> {
  const root = mkdtempSync(join(tmpdir(), "omp-run-"));
  const profile = createProfile(opts.settings);
  try {
    const workdir = join(root, "workdir");
    const sessions = join(root, "sessions");
    const requestsFile = join(root, "requests.jsonl");
    mkdirSync(workdir);
    mkdirSync(sessions);
    const plugin = opts.variant === "with-plugin" ? ["-e", join(REPO, "index.ts")] : [];

    const setupState = await scenario.setup(workdir);
    const turns: Turn[] = [];
    for (const [index, turn] of scenario.turns.entries()) {
      const scripted = typeof turn !== "string";
      const prompt = scripted ? turn.prompt : turn;
      const commands = scripted ? (turn.commands ?? []) : [];
      const scriptFile = join(root, `script-${index}.json`);
      if (scripted) writeFileSync(scriptFile, JSON.stringify(turn.script));
      const recorder = join(FIXTURES, scripted ? "scripted-provider.ts" : "probe.ts");
      const model = scripted ? "scripted/scripted" : opts.model;
      const env = { ...process.env, FOLD_EVAL_REQUESTS: requestsFile, FOLD_EVAL_SCRIPT: scriptFile };
      const requestsBefore = readLines(requestsFile).length;
      const entriesBefore = readSessionEntries(sessions).length;
      const proc = Bun.spawn(
        [
          "omp",
          "-p",
          "--profile",
          profile.name,
          "--session-dir",
          sessions,
          "--no-extensions",
          "-e",
          recorder,
          ...plugin,
          "--model",
          model,
          ...(index > 0 ? ["-c"] : []),
          ...commands,
          prompt,
        ],
        { cwd: workdir, env, stdin: Bun.file("/dev/null"), stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) throw new Error(`omp exited ${exitCode} on turn ${index + 1}: ${stderr}`);
      const entries = readSessionEntries(sessions).slice(entriesBefore);
      turns.push({
        prompt,
        stdout,
        requests: readLines(requestsFile)
          .slice(requestsBefore)
          .map(line => JSON.parse(line)),
        messages: entries.flatMap(entry => (entry.type === "message" ? [entry.message] : [])),
        entries,
      });
    }
    const state = scenario.inspect ? await scenario.inspect(workdir, setupState) : setupState;
    return { run: { variant: opts.variant, turns }, state };
  } finally {
    rmSync(profile.dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}
