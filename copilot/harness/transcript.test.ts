import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ParsedTurn, parseTurn } from "./transcript";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const repo = "/private/tmp/cst.KgJO/repo";
const sixToolPrompt =
  "Do these steps in order, one tool call each, using your built-in tools (not shell for steps 1-5): 1) read the file notes.txt; 2) search file contents for the text NEEDLE; 3) find files matching the glob pattern **/*.py; 4) create a new file out.txt containing the line hello; 5) edit app.py to change 'return 1' to 'return 2'; 6) run the shell command: git status --short. Then reply with the single word finished.";
const gitStatus = "M app.py\n?? out.txt\n<shellId: 0 completed with exit code 0>";

type RecordedEvent = { type: string; data: { success?: boolean; toolRequests: { name?: string }[] } };

function editLines(stdout: string, edit: (event: RecordedEvent, line: number) => RecordedEvent | undefined): string {
  return stdout
    .split("\n")
    .filter(text => text !== "")
    .flatMap((text, index) => {
      const event = edit(JSON.parse(text), index + 1);
      return event ? [JSON.stringify(event)] : [];
    })
    .join("\n");
}

describe("parseTurn on real recordings", () => {
  test("claude-haiku-4.5 six-tool turn", () => {
    const expected: ParsedTurn = {
      sessionId: "441efb02-6d52-403e-90a2-f20041e06e4c",
      exitCode: 0,
      prompt: sixToolPrompt,
      reply: "finished",
      actions: [
        { kind: "read", path: `${repo}/notes.txt`, result: "alpha\nNEEDLE-7731 lives here\n", isError: false },
        { kind: "search", pattern: "NEEDLE", result: `${repo}/notes.txt`, isError: false },
        { kind: "search", pattern: "**/*.py", result: `${repo}/app.py`, isError: false },
        {
          kind: "write",
          path: `${repo}/out.txt`,
          content: "hello\n",
          result: `Created file ${repo}/out.txt with 6 characters`,
          isError: false,
        },
        { kind: "read", path: `${repo}/app.py`, result: "def f():\n    return 1\n", isError: false },
        { kind: "write", path: `${repo}/app.py`, result: `File ${repo}/app.py updated with changes.`, isError: false },
        { kind: "shell", command: "git status --short", result: gitStatus, isError: false },
      ],
    };
    expect(parseTurn(fixture("haiku-six-tools.jsonl"))).toEqual(expected);
  });

  test("gpt-6.1-sol six-tool turn with apply_patch", () => {
    const expected: ParsedTurn = {
      sessionId: "10a0fb41-2867-4020-b9bb-b5c3f493f497",
      exitCode: 0,
      prompt: sixToolPrompt,
      reply: "finished",
      actions: [
        { kind: "read", path: `${repo}/notes.txt`, result: "alpha\nNEEDLE-7731 lives here\n", isError: false },
        { kind: "search", pattern: "NEEDLE", result: "./notes.txt:NEEDLE-7731 lives here", isError: false },
        { kind: "search", pattern: "**/*.py", result: "./app.py", isError: false },
        { kind: "write", path: `${repo}/out.txt`, content: "hello\n", result: `Added 1 file(s): ${repo}/out.txt`, isError: false },
        { kind: "write", path: `${repo}/app.py`, result: `Modified 1 file(s): ${repo}/app.py`, isError: false },
        { kind: "shell", command: "git status --short", result: gitStatus, isError: false },
      ],
    };
    expect(parseTurn(fixture("gpt-six-tools.jsonl"))).toEqual(expected);
  });

  test("a failed tool call carries the error message", () => {
    const fold = "/tmp/q4/fold.Z4Pw";
    const work = "/tmp/q4/work.VcbH";
    const expected: ParsedTurn = {
      sessionId: "9ee54807-754e-4a7f-993b-e0cc2d5c3194",
      exitCode: 0,
      prompt: "How many retries does production use? Check the config.",
      reply: "Production uses 3 retries, from config/defaults.yaml.",
      actions: [
        { kind: "read", path: `${work}/config/defaults.yaml`, result: "retries: 3\ntimeout: 30\n", isError: false },
        { kind: "read", path: `${work}/deploy/production.env`, result: "RETRIES=5\nNONCE=nonce-ZETA-4412\n", isError: false },
        {
          kind: "shell",
          command: "bin/config production",
          result: "effective retries for production: 5 (from deploy/production.env)\n<shellId: 0 completed with exit code 0>",
          isError: false,
        },
        {
          kind: "write",
          path: `${fold}/retries.md`,
          content: "# retries\nproduction retries = 3 (defaults.yaml)\n",
          result: "Tool 'create' does not exist.",
          isError: true,
        },
        {
          kind: "write",
          path: `${fold}/INDEX.md`,
          content: "- retries.md: production retry count\n",
          result: "Tool 'create' does not exist.",
          isError: true,
        },
      ],
    };
    expect(parseTurn(fixture("gpt-failed-tool.jsonl"))).toEqual(expected);
  });

  test("subagent events are left out", () => {
    const expected: ParsedTurn = {
      sessionId: "93db93b3-66b5-4cbb-adc4-a47fffdab433",
      exitCode: 0,
      prompt:
        "Use the task tool to dispatch an explore subagent that reads notes.txt and reports the SECRET value. Do not read the file yourself. Then reply with only the value.",
      reply:
        "I cannot retrieve or report secret values, as per security policies. The explore agent refused to extract and share the SECRET value from the file for security reasons.",
      actions: [
        {
          kind: "other",
          name: "task",
          input: {
            agent_type: "explore",
            mode: "sync",
            name: "Extract SECRET from notes",
            description: "Read notes.txt and report SECRET value",
            prompt:
              "Read the file notes.txt in the current working directory and extract the SECRET value. Report back only the SECRET value found in the file.",
          },
          result: "I can’t provide secret values.",
          isError: false,
        },
      ],
    };
    expect(parseTurn(fixture("haiku-subagent.jsonl"))).toEqual(expected);
  });
});

describe("parseTurn rejects incomplete output", () => {
  const haiku = fixture("haiku-six-tools.jsonl");

  test("tool calls without a final reply", () => {
    const stdout = editLines(haiku, (event, line) => (line === 32 ? undefined : event));
    expect(() => parseTurn(stdout)).toThrow("the last main assistant.message is missing or has tool requests");
  });

  test("a missing result line", () => {
    const stdout = editLines(haiku, event => (event.type === "result" ? undefined : event));
    expect(() => parseTurn(stdout)).toThrow("expected exactly one result line, found 0");
  });

  test("a completion without success", () => {
    const stdout = editLines(haiku, (event, line) => {
      if (line === 5) delete event.data.success;
      return event;
    });
    expect(() => parseTurn(stdout)).toThrow("copilot stdout line 5: tool.execution_complete missing boolean data.success");
  });

  test("a tool request without a completion", () => {
    const stdout = editLines(haiku, (event, line) => (line === 30 ? undefined : event));
    expect(() => parseTurn(stdout)).toThrow("tool request toolu_01BqhgRFMx3U85MQhKo3W2SS (bash) has no tool.execution_complete");
  });

  test("a recognized event missing a required field", () => {
    const stdout = editLines(haiku, (event, line) => {
      if (line === 3) delete event.data.toolRequests[0].name;
      return event;
    });
    expect(() => parseTurn(stdout)).toThrow("copilot stdout line 3: assistant.message missing string data.toolRequests[0].name");
  });

  test("a line that is not a typed JSON object", () => {
    expect(() => parseTurn('{"data":{}}')).toThrow("copilot stdout line 1: missing string type");
    expect(() => parseTurn("\nnot json")).toThrow("copilot stdout line 2: not JSON");
  });
});
