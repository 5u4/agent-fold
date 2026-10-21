import { expect, test } from "bun:test";
import { turnStart } from "./turn-start";

const event = (type: string, timestamp: string, agentId?: string) => ({ type, timestamp, agentId });

test("the turn starts at the latest main-agent user message of this activation", () => {
  expect(
    turnStart([
      event("session.start", "2026-10-20T18:50:31.830Z"),
      event("user.message", "2026-10-20T18:50:38.585Z"),
      event("session.resume", "2026-10-20T18:50:55.402Z"),
      event("user.message", "2026-10-20T18:51:04.354Z"),
      event("assistant.message", "2026-10-20T18:51:05.444Z"),
      event("user.message", "2026-10-20T18:51:06.000Z", "subagent-1"),
    ]),
  ).toBe(Date.UTC(2026, 9, 20, 18, 51, 4, 354));
});

test("a resumed session without a new user message has no turn to check", () => {
  expect(
    turnStart([
      event("session.start", "2026-10-20T18:50:31.830Z"),
      event("user.message", "2026-10-20T18:50:38.585Z"),
      event("session.resume", "2026-10-20T18:50:55.402Z"),
    ]),
  ).toBeUndefined();
});
