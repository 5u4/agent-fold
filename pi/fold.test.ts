import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import fixtures from "./fixtures/aborted-sessions.json";
import { foldSettled, foldView, runStarts } from "./fold";
import { assistant, bash, branchSummary, call, compactionSummary, custom, reply, result, user } from "./harness/messages";

const aborted = fixtures as unknown as Record<"rpcAbort" | "killed", AgentMessage[]>;

describe("runStarts", () => {
  test("a user message after a final reply starts a run", () => {
    expect(runStarts([user("q1"), reply("done"), user("q2")])).toEqual([0, 2]);
  });

  test("a user message after an answered tool batch is a steer inside the run", () => {
    expect(runStarts([user("q1"), call("a", "b"), result("a"), result("b"), user("steer"), user("steer 2"), reply("done")])).toEqual([0]);
  });

  test("a user message after a tool batch with an unanswered call starts a run", () => {
    expect(runStarts([user("q1"), call("a", "b"), result("a"), user("q2")])).toEqual([0, 3]);
  });

  test("a user message after an errored or aborted assistant starts a run", () => {
    expect(runStarts([user("q1"), assistant([], "error"), user("q2"), assistant([], "aborted"), user("q3")])).toEqual([0, 2, 4]);
  });

  test("the first user message after a summary starts a run, even mid tool batch", () => {
    expect(runStarts([call("a"), result("a"), compactionSummary(), user("q2")])).toEqual([3]);
    expect(runStarts([user("q1"), call("a"), result("a"), branchSummary, user("q2")])).toEqual([0, 4]);
  });

  test("a session aborted through RPC starts a run at the next prompt", () => {
    expect(runStarts(aborted.rpcAbort)).toEqual([0, 4]);
  });

  test("an aborted tool result alone ends the run, as when pi exits before the error reply lands", () => {
    const beforeErrorReply = aborted.rpcAbort.slice(0, 3);
    expect(runStarts([...beforeErrorReply, ...aborted.rpcAbort.slice(4)])).toEqual([0, 3]);
  });

  test("a session killed mid tool call starts a run at the next prompt", () => {
    expect(runStarts(aborted.killed)).toEqual([0, 2]);
  });
});

describe("foldView", () => {
  test("folds finished runs to the run's first message and final reply, and leaves the last run whole", () => {
    const final = assistant(
      [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "done 1" },
      ],
      "stop",
    );
    const run2 = [user("q2"), call("c"), result("c")];
    expect(
      foldView([
        user("q1"),
        call("a"),
        result("a"),
        assistant(
          [
            { type: "text", text: "looking" },
            { type: "toolCall", id: "b", name: "read", arguments: {} },
          ],
          "toolUse",
        ),
        result("b"),
        final,
        ...run2,
      ]),
    ).toEqual([user("q1"), reply("done 1"), ...run2]);
  });

  test("keeps steers, user bash output, and displayed custom messages, and drops hidden custom messages", () => {
    const messages = [
      user("q1"),
      call("a"),
      result("a"),
      user("steer"),
      custom("shown", true),
      custom("hidden", false),
      reply("done 1"),
      bash("ls"),
      user("q2"),
    ];
    expect(foldView(messages)).toEqual([user("q1"), user("steer"), custom("shown", true), reply("done 1"), bash("ls"), user("q2")]);
  });

  test("a run whose last assistant message is not a final reply stays whole", () => {
    expect(foldView(aborted.rpcAbort)).toEqual(aborted.rpcAbort);
    expect(foldView(aborted.killed)).toEqual(aborted.killed);
    const empty = [user("q1"), call("a"), result("a"), reply(" "), user("q2")];
    expect(foldView(empty)).toEqual(empty);
  });

  test("summaries stay outside runs, verbatim", () => {
    const messages = [
      compactionSummary(),
      call("a"),
      result("a"),
      reply("done 1"),
      user("q2"),
      call("b"),
      result("b"),
      reply("done 2"),
      branchSummary,
      user("q3"),
    ];
    expect(foldView(messages)).toEqual([
      compactionSummary(),
      call("a"),
      result("a"),
      reply("done 1"),
      user("q2"),
      reply("done 2"),
      branchSummary,
      user("q3"),
    ]);
  });

  test("a session without a finished run is unchanged", () => {
    const messages = [user("q1"), call("a"), result("a")];
    expect(foldView(messages)).toEqual(messages);
  });
});

describe("foldSettled", () => {
  test("also folds the last run once it has a final reply", () => {
    expect(foldSettled([user("q1"), call("a"), result("a"), reply("done 1")])).toEqual([user("q1"), reply("done 1")]);
  });
});
