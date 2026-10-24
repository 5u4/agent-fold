import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";

type SessionStart = { sessionId: string; startTime: string; rootEventId: string; cwd: unknown };

export type ConversationRoot = { sessionId: string; startTime: string; cwd: string };

const CHUNK_BYTES = 4096;

// Copilot CLI 1.0.101 writes events.jsonl of a new session about when it sends the session's first model request.
export const SESSION_START_WAIT_MS = 2000;

const SESSION_START_POLL_MS = 50;

export function readFirstLine(path: string): string {
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
    const { sessionId, startTime, context } = event?.data ?? {};
    if (event.type !== "session.start" || typeof event.id !== "string") return undefined;
    if (typeof sessionId !== "string" || typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) return undefined;
    return { sessionId, startTime, rootEventId: event.id, cwd: context?.cwd };
  } catch {
    return undefined;
  }
}

export function conversationRoot(stateDir: string, sessionId: string): ConversationRoot | undefined {
  const own = readSessionStart(join(stateDir, sessionId));
  if (own === undefined || typeof own.cwd !== "string") return undefined;
  let root = own;
  for (const id of readdirSync(stateDir)) {
    if (id === sessionId) continue;
    const start = readSessionStart(join(stateDir, id));
    if (start?.rootEventId !== own.rootEventId) continue;
    const delta = Date.parse(start.startTime) - Date.parse(root.startTime);
    if (delta < 0 || (delta === 0 && start.sessionId < root.sessionId)) root = start;
  }
  return { sessionId: root.sessionId, startTime: root.startTime, cwd: own.cwd };
}

export async function awaitConversationRoot(stateDir: string, sessionId: string, waitMs: number): Promise<ConversationRoot> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const root = conversationRoot(stateDir, sessionId);
    if (root !== undefined) return root;
    if (Date.now() >= deadline) throw new Error(`no session.start for session ${sessionId}`);
    await Bun.sleep(SESSION_START_POLL_MS);
  }
}
