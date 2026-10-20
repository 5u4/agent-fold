import { expect, test } from "bun:test";
import { hasResumeFlag } from "./launch";

test.each([
  ["copilot --experimental --resume 383bedde-7f2a-4c1e-9d55-0a1b2c3d4e5f", true],
  ["copilot --resume", true],
  ["copilot --resume=383bedde", true],
  ["copilot -r", true],
  ["copilot --experimental --continue --model claude-haiku-4.5", true],
  ["copilot --experimental --model claude-haiku-4.5", false],
  ["copilot --session-id 383bedde-7f2a-4c1e-9d55-0a1b2c3d4e5f", false],
  ["copilot --resume-x", false],
  ["copilot -rx", false],
  ['copilot -p "hi"', false],
])("hasResumeFlag(%p) is %p", (args, expected) => {
  expect(hasResumeFlag(args)).toBe(expected);
});
