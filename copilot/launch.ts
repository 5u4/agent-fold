import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RESUME_FLAGS: Record<string, true> = { "-r": true, "--resume": true, "--continue": true };

export function hasResumeFlag(parentArgs: string): boolean {
  return parentArgs.split(/\s+/).some(token => Object.hasOwn(RESUME_FLAGS, token) || token.startsWith("--resume="));
}

export function isThrowawayLaunch(sessionId: string): boolean {
  try {
    if (!hasResumeFlag(execFileSync("ps", ["-o", "args=", "-p", String(process.ppid)], { encoding: "utf8" }))) return false;
    const sessionState = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "session-state");
    if (existsSync(join(sessionState, sessionId, "events.jsonl"))) return false;
    return readdirSync(sessionState).some(id => id !== sessionId && existsSync(join(sessionState, id, "events.jsonl")));
  } catch {
    return false;
  }
}
