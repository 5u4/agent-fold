import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationRoot } from "./session-root";

const ORIGINAL = "4390376c-2266-4658-b66d-330ae07cbad8";
const FORK = "68185701-af3a-41f0-9806-28fc1bf16145";
const FORK_OF_FORK = "a1d2c3e4-0000-4000-8000-000000000003";
const OTHER = "b7e8f9a0-0000-4000-8000-000000000004";
const NO_CWD = "c0ffee00-0000-4000-8000-000000000005";
const ROOT_EVENT = "9419a594-8564-4547-9929-ab0bce51c987";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "session-state-"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function writeEvents(sessionId: string, text: string) {
  mkdirSync(join(stateDir, sessionId));
  writeFileSync(join(stateDir, sessionId, "events.jsonl"), text);
}

const cwdOf = (sessionId: string) => `/private/tmp/${sessionId}-${"d".repeat(5000)}`;

function writeSession(sessionId: string, startTime: string, rootEventId: string) {
  const start = {
    type: "session.start",
    data: { sessionId, version: 1, startTime, context: { cwd: cwdOf(sessionId) } },
    id: rootEventId,
    timestamp: startTime,
    parentId: null,
  };
  const next = { type: "user.message", data: { content: "x".repeat(10000) }, id: "e2", parentId: rootEventId };
  writeEvents(sessionId, `${JSON.stringify(start)}\n${JSON.stringify(next)}\n`);
}

test("an ordinary session is its own root and keeps its working directory", () => {
  writeSession(ORIGINAL, "2026-10-16T05:27:05.991Z", ROOT_EVENT);
  writeSession(OTHER, "2026-10-15T01:00:00.000Z", "other-root-event");
  expect(conversationRoot(stateDir, ORIGINAL)).toEqual({
    sessionId: ORIGINAL,
    startTime: "2026-10-16T05:27:05.991Z",
    cwd: cwdOf(ORIGINAL),
  });
});

test("a fork and a fork of that fork resolve to the original session, each with its own working directory", () => {
  writeSession(ORIGINAL, "2026-10-16T05:27:05.991Z", ROOT_EVENT);
  writeSession(FORK, "2026-10-16T05:28:27.280Z", ROOT_EVENT);
  writeSession(FORK_OF_FORK, "2026-10-16T05:30:00.000Z", ROOT_EVENT);
  writeSession(OTHER, "2026-10-15T01:00:00.000Z", "other-root-event");
  const original = { sessionId: ORIGINAL, startTime: "2026-10-16T05:27:05.991Z" };
  expect(conversationRoot(stateDir, FORK)).toEqual({ ...original, cwd: cwdOf(FORK) });
  expect(conversationRoot(stateDir, FORK_OF_FORK)).toEqual({ ...original, cwd: cwdOf(FORK_OF_FORK) });
});

test("with the original deleted, the earliest surviving fork is the root", () => {
  writeSession(FORK_OF_FORK, "2026-10-16T05:30:00.000Z", ROOT_EVENT);
  writeSession(FORK, "2026-10-16T05:28:27.280Z", ROOT_EVENT);
  expect(conversationRoot(stateDir, FORK_OF_FORK)).toEqual({
    sessionId: FORK,
    startTime: "2026-10-16T05:28:27.280Z",
    cwd: cwdOf(FORK_OF_FORK),
  });
});

test("a session without a readable session.start or working directory has no root, and other sessions skip it", () => {
  writeSession(FORK, "2026-10-16T05:28:27.280Z", ROOT_EVENT);
  mkdirSync(join(stateDir, ORIGINAL));
  writeEvents(OTHER, "{not json\n");
  writeEvents(FORK_OF_FORK, `${JSON.stringify({ type: "user.message", data: {}, id: ROOT_EVENT })}\n`);
  writeEvents(
    NO_CWD,
    `${JSON.stringify({ type: "session.start", data: { sessionId: NO_CWD, startTime: "2026-10-16T05:28:27.280Z" }, id: "e" })}\n`,
  );
  writeFileSync(join(stateDir, "stray-file"), "");
  expect(conversationRoot(stateDir, ORIGINAL)).toBeUndefined();
  expect(conversationRoot(stateDir, OTHER)).toBeUndefined();
  expect(conversationRoot(stateDir, FORK_OF_FORK)).toBeUndefined();
  expect(conversationRoot(stateDir, "never-created")).toBeUndefined();
  expect(conversationRoot(stateDir, NO_CWD)).toBeUndefined();
  expect(conversationRoot(stateDir, FORK)).toEqual({ sessionId: FORK, startTime: "2026-10-16T05:28:27.280Z", cwd: cwdOf(FORK) });
});
