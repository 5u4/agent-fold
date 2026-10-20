import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sessionStateDir } from "./session-root";

const RESUME_FLAGS: Record<string, true> = { "-r": true, "--resume": true, "--continue": true };

export function hasResumeFlag(parentArgs: string): boolean {
  return parentArgs.split(/\s+/).some(token => Object.hasOwn(RESUME_FLAGS, token) || token.startsWith("--resume="));
}

export function isThrowawayLaunch(sessionId: string): boolean {
  try {
    if (!hasResumeFlag(execFileSync("ps", ["-o", "args=", "-p", String(process.ppid)], { encoding: "utf8" }))) return false;
    if (existsSync(join(sessionStateDir, sessionId, "events.jsonl"))) return false;
    return readdirSync(sessionStateDir).some(id => id !== sessionId && existsSync(join(sessionStateDir, id, "events.jsonl")));
  } catch {
    return false;
  }
}
