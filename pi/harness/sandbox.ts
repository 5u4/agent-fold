import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type FakeProvider, startFakeProvider } from "./fake-provider";

export const PLUGIN = join(import.meta.dir, "..", "index.ts");

export type PiResult = { stdout: string; stderr: string; exitCode: number };

export type PiSandbox = {
  root: string;
  agentDir: string;
  workdir: string;
  foldHome: string;
  provider: FakeProvider;
  env: Record<string, string | undefined>;
  args(extensions: string[]): string[];
  print(messages: string[], opts?: { continue?: boolean; extensions?: string[] }): Promise<PiResult>;
  compact(opts?: { extensions?: string[] }): Promise<{ success: boolean; error?: string }>;
  entries(): SessionEntry[];
  dispose(): void;
};

export function createSandbox(): PiSandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-fold-")));
  const agentDir = join(root, "agent");
  const workdir = join(root, "workdir");
  const sessions = join(root, "sessions");
  const foldHome = join(root, "fold-home");
  for (const dir of [agentDir, workdir, sessions]) mkdirSync(dir);
  const provider = startFakeProvider();
  const model = { id: "fake", contextWindow: 100_000, maxTokens: 1_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({ providers: { fake: { baseUrl: provider.baseUrl, apiKey: "fake", api: "openai-completions", models: [model] } } }),
  );
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, AGENT_FOLD_HOME: foldHome, PI_OFFLINE: "1" };
  const args = (extensions: string[]) => [
    "--offline",
    "--no-extensions",
    ...extensions.flatMap(path => ["-e", path]),
    "--session-dir",
    sessions,
    "--model",
    "fake/fake",
  ];
  return {
    root,
    agentDir,
    workdir,
    foldHome,
    provider,
    env,
    args,
    async print(messages, opts = {}) {
      const proc = Bun.spawn(["pi", "-p", ...args(opts.extensions ?? [PLUGIN]), ...(opts.continue ? ["-c"] : []), ...messages], {
        cwd: workdir,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
    async compact(opts = {}) {
      const proc = Bun.spawn(["pi", "--mode", "rpc", ...args(opts.extensions ?? [PLUGIN]), "-c"], {
        cwd: workdir,
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(`${JSON.stringify({ id: "compact", type: "compact" })}\n`);
      proc.stdin.flush();
      let pending = "";
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        const response = lines.map(line => JSON.parse(line)).find(event => event.type === "response" && event.id === "compact");
        if (response) {
          proc.kill();
          await proc.exited;
          return response;
        }
      }
      throw new Error(`pi rpc exited without a compact response: ${await new Response(proc.stderr).text()}`);
    },
    entries() {
      return readdirSync(sessions)
        .filter(name => name.endsWith(".jsonl"))
        .flatMap(name => readFileSync(join(sessions, name), "utf8").split("\n"))
        .filter(line => line !== "")
        .map(line => JSON.parse(line));
    },
    dispose() {
      provider.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
