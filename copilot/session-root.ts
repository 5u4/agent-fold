import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const sessionStateDir = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "session-state");

type SessionStart = { sessionId: string; startTime: string; rootEventId: string };

type SessionKey = Pick<SessionStart, "sessionId" | "startTime">;

const CHUNK_BYTES = 4096;

function readFirstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = Buffer.alloc(CHUNK_BYTES);
      const read = readSync(fd, chunk, 0, CHUNK_BYTES, null);
      const newline = chunk.subarray(0, read).indexOf(10);
      chunks.push(chunk.subarray(0, newline === -1 ? read : newline));
      if (newline !== -1 || read === 0) return Buffer.concat(chunks).toString("utf8");
    }
  } finally {
    closeSync(fd);
  }
}

function readSessionStart(sessionDir: string): SessionStart | undefined {
  try {
    const event = JSON.parse(readFirstLine(join(sessionDir, "events.jsonl")));
    const { sessionId, startTime } = event?.data ?? {};
    if (event.type !== "session.start" || typeof event.id !== "string") return undefined;
    if (typeof sessionId !== "string" || typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) return undefined;
    return { sessionId, startTime, rootEventId: event.id };
  } catch {
    return undefined;
  }
}

export function conversationRoot(stateDir: string, sessionId: string): SessionKey | undefined {
  const own = readSessionStart(join(stateDir, sessionId));
  if (own === undefined) return undefined;
  let root = own;
  for (const id of readdirSync(stateDir)) {
    if (id === sessionId) continue;
    const start = readSessionStart(join(stateDir, id));
    if (start?.rootEventId !== own.rootEventId) continue;
    const delta = Date.parse(start.startTime) - Date.parse(root.startTime);
    if (delta < 0 || (delta === 0 && start.sessionId < root.sessionId)) root = start;
  }
  return { sessionId: root.sessionId, startTime: root.startTime };
}
