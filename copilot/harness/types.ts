export type Variant = "without-plugin" | "with-plugin";

export type ActionBody =
  | { kind: "read"; path: string }
  | { kind: "search"; pattern: string }
  | { kind: "write"; path: string; content?: string }
  | { kind: "shell"; command: string }
  | { kind: "other"; name: string; input: unknown };

export type Action = ActionBody & { result: string; isError: boolean };

export type ScriptStep =
  | { kind: "read"; path: string }
  | { kind: "shell"; command: string }
  | { kind: "write"; path: string; content: string }
  | { reply: string };

export const FOLD_DIR = "<fold-dir>";

export type Turn = { prompt: string; reply: string; actions: Action[]; modelInputs: string[] };

export type Run = { variant: Variant; foldHome: string; turns: Turn[] };

export type ScriptedTurn = { prompt: string; script: ScriptStep[] };

export type Scenario<S> = {
  setup(workdir: string): Promise<S>;
  turns: (string | ScriptedTurn)[];
  inspect?(workdir: string, state: S): Promise<S>;
};
