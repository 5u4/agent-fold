export type Variant = "without-plugin" | "with-plugin";

export const FOLD_DIR = "<fold-dir>";

export type Call =
  | { kind: "read"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "shell"; command: string }
  | { kind: "search" }
  | { kind: "other" };

export type Action = Call & {
  name: string;
  args: Record<string, unknown>;
  result: string | null;
  isError: boolean;
  touchesSessionLog: boolean;
};

export type ScriptStep = Extract<Call, { kind: "read" | "write" | "shell" }> | { kind: "reply"; text: string };

export type ScriptedTurn = { prompt: string; script: ScriptStep[] };

export type Turn = { prompt: string; reply: string; actions: Action[]; modelInputs: string[] };

export type Run = { variant: Variant; foldHome: string; turns: Turn[] };

export type Verdict = { status: "pass" | "fail" | "invalid"; evidence: string };

export type Scenario<S> = {
  title: string;
  turns: (string | ScriptedTurn)[];
  setup(workdir: string): Promise<S>;
  inspect?(workdir: string, state: S): Promise<S>;
  grade(run: Run, state: S): Verdict;
  metrics(run: Run, state: S): Record<string, number>;
};

export type TrialOutcome<S> = { run: Run; state: S } | { unsupported: string };

export type Harness = {
  name: string;
  runTrial<S>(scenario: Scenario<S>, opts: { variant: Variant; model: string }): Promise<TrialOutcome<S>>;
};
