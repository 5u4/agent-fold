import type { Sandbox } from "./sandbox";

export type RunResult = { exitCode: number; sessionID: string | undefined; events: Record<string, unknown>[]; stderr: string };

export type TranscriptEntry = { id: string; type: string; outcome?: string; status?: string; reason?: string; text?: string };

export type Server = {
  url: string;
  api<T = unknown>(operation: string, input?: { params?: Record<string, string>; data?: unknown }): Promise<T>;
  run(prompt: string, options?: { session?: string }): Promise<RunResult>;
  createSession(): Promise<string>;
  prompt(sessionID: string, text: string, delivery?: "steer" | "queue"): Promise<void>;
  transcript(sessionID: string): Promise<TranscriptEntry[]>;
  waitForTranscript(sessionID: string, done: (entries: TranscriptEntry[]) => boolean): Promise<TranscriptEntry[]>;
  waitForIdles(sessionID: string, count: number): Promise<TranscriptEntry[]>;
  stop(): Promise<void>;
};

export const PASSWORD = "agent-fold-test";

async function spawnOpencode(sandbox: Sandbox, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["opencode", ...args], {
    cwd: sandbox.project,
    env: { ...sandbox.env, OPENCODE_PASSWORD: PASSWORD },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { exitCode, stdout, stderr };
}

async function run(sandbox: Sandbox, target: string[], prompt: string, session: string | undefined): Promise<RunResult> {
  const { exitCode, stdout, stderr } = await spawnOpencode(sandbox, [
    "run",
    ...target,
    "--format",
    "json",
    "--auto",
    ...(session ? ["--session", session] : []),
    prompt,
  ]);
  const events = stdout
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line) as Record<string, unknown>);
  const sessionID = events.map(event => event.sessionID).find((id): id is string => typeof id === "string");
  return { exitCode, sessionID, events, stderr };
}

export function runStandalone(sandbox: Sandbox, prompt: string, options: { session?: string } = {}): Promise<RunResult> {
  return run(sandbox, ["--standalone"], prompt, options.session);
}

export async function startServer(sandbox: Sandbox): Promise<Server> {
  const proc = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: sandbox.project,
    env: { ...sandbox.env, OPENCODE_PASSWORD: PASSWORD },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let output = "";
  let url: string | undefined;
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    output += chunk;
    url = output.match(/server listening on (http:\/\/\S+)/)?.[1];
    if (url) break;
  }
  if (!url) throw new Error(`opencode serve exited before listening: ${output}${await new Response(proc.stderr).text()}`);
  const server = url;
  async function api<T>(operation: string, input: { params?: Record<string, string>; data?: unknown } = {}): Promise<T> {
    const args = ["api", "--server", server, operation];
    for (const [key, value] of Object.entries(input.params ?? {})) args.push("--param", `${key}=${value}`);
    if (input.data !== undefined) args.push("-d", JSON.stringify(input.data));
    const { exitCode, stdout, stderr } = await spawnOpencode(sandbox, args);
    if (exitCode !== 0) throw new Error(`opencode api ${operation} exited ${exitCode}: ${stdout}${stderr}`);
    const body: unknown = stdout.trim() === "" ? undefined : JSON.parse(stdout);
    if (typeof body !== "object" || body === null || !("data" in body)) return undefined as T;
    return body.data as T;
  }
  const transcript = (sessionID: string) => api<TranscriptEntry[]>("session.context", { params: { sessionID } });
  async function waitForTranscript(sessionID: string, done: (entries: TranscriptEntry[]) => boolean): Promise<TranscriptEntry[]> {
    for (let attempt = 0; attempt < 300; attempt++) {
      const entries = await transcript(sessionID);
      if (done(entries)) return entries;
      await Bun.sleep(200);
    }
    throw new Error(`session ${sessionID} transcript never reached the expected state: ${JSON.stringify(await transcript(sessionID))}`);
  }
  return {
    url: server,
    api,
    run: (prompt, options = {}) => run(sandbox, ["--server", server], prompt, options.session),
    async createSession() {
      return (await api<{ id: string }>("session.create", { data: {} })).id;
    },
    async prompt(sessionID, text, delivery) {
      await api("session.prompt", { params: { sessionID }, data: delivery ? { text, delivery } : { text } });
    },
    transcript,
    waitForTranscript,
    waitForIdles: (sessionID, count) =>
      waitForTranscript(sessionID, entries => entries.filter(entry => entry.type === "idle").length >= count),
    async stop() {
      proc.kill();
      await proc.exited;
    },
  };
}
