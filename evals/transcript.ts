import type { Action, Turn } from "./contract";

export function mentions(action: Action, text: string): boolean {
  return JSON.stringify(action.args).includes(text);
}

export function resultText(turn: Turn): string {
  return turn.actions.flatMap(action => (action.result === null ? [] : [action.result])).join("\n");
}
