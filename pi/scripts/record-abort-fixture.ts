import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSandbox, type PiSandbox } from "../harness/sandbox";

const HOLD = join(import.meta.dir, "..", "harness", "hold-tool-call.ts");
const FIXTURE = join(import.meta.dir, "..", "fixtures", "aborted-sessions.json");

async function held(sandbox: PiSandbox, mark: string, interrupt: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void) {
  const proc = Bun.spawn(["pi", "--mode", "rpc", ...sandbox.args([HOLD])], {
    cwd: sandbox.workdir,
    env: { ...sandbox.env, HOLD_MARK: mark },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(`${JSON.stringify({ type: "prompt", message: "q1 run sleep" })}\n`);
  proc.stdin.flush();
  while (!existsSync(mark)) await Bun.sleep(20);
  interrupt(proc);
  let pending = "";
  for await (const text of proc.stdout.pipeThrough(new TextDecoderStream())) {
    pending += text;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (lines.some(line => line.trim() !== "" && JSON.parse(line).type === "agent_settled")) break;
  }
  proc.kill();
  await proc.exited;
}

async function record(interrupt: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void): Promise<AgentMessage[]> {
  const sandbox = createSandbox();
  try {
    sandbox.provider.enqueue({ toolCall: { name: "bash", arguments: { command: "sleep 30" } } });
    await held(sandbox, join(sandbox.root, "held"), interrupt);
    sandbox.provider.enqueue({ text: "done 2" });
    const result = await sandbox.print(["q2"], { continue: true, extensions: [] });
    if (result.exitCode !== 0) throw new Error(`pi -c exited ${result.exitCode}: ${result.stderr}`);
    return sandbox.entries().flatMap(entry => (entry.type === "message" && entry.message.role !== "system" ? [entry.message] : []));
  } finally {
    sandbox.dispose();
  }
}

const rpcAbort = await record(proc => {
  proc.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
  proc.stdin.flush();
});
const killed = await record(proc => proc.kill("SIGTERM"));
writeFileSync(FIXTURE, `${JSON.stringify({ rpcAbort, killed }, null, 2)}\n`);
