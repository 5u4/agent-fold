export type Kind = "boundary" | "steering" | "reply" | "drop" | "keep";

export type JsonObject = { [key: string]: unknown };

export type Format<Item> = {
  items(body: JsonObject): Item[] | undefined;
  withItems(body: JsonObject, items: Item[]): JsonObject;
  classify(item: Item): Kind;
  keptInFold(item: Item): Item | undefined;
  withRules(body: JsonObject, rules: string): JsonObject;
  indexItem(text: string): Item;
  runKey(boundary: Item): string;
};

export const BOUNDARY_PREFIXES = ["<current_datetime>", "Some of the conversation history has been summarized"];

export function startsRun(text: string): boolean {
  return BOUNDARY_PREFIXES.some(prefix => text.startsWith(prefix));
}

function foldRun<Item>(format: Format<Item>, run: Item[], kinds: Kind[]): Item[] {
  const last = kinds.findLastIndex(kind => kind === "reply" || kind === "drop");
  if (last < 1 || kinds[last] !== "reply") return run;
  return run.flatMap((item, index): Item[] => {
    if (index === 0) return [item];
    if (kinds[index] === "drop") return [];
    const kept = format.keptInFold(item);
    return kept === undefined ? [] : [kept];
  });
}

export function foldItems<Item>(format: Format<Item>, items: Item[], kinds: Kind[]): Item[] {
  const starts = kinds.flatMap((kind, index) => (kind === "boundary" ? [index] : []));
  if (starts.length < 2) return items;
  const ends = [...starts.slice(1), items.length];
  const runs = starts.slice(0, -1).flatMap((start, k) => foldRun(format, items.slice(start, ends[k]), kinds.slice(start, ends[k])));
  return [...items.slice(0, starts[0]), ...runs, ...items.slice(starts[starts.length - 1])];
}

export type Injection = { rules: string; index: (runKey: string) => string };

export function rewriteBody<Item>(format: Format<Item>, body: JsonObject, { rules, index }: Injection): JsonObject | undefined {
  const items = format.items(body);
  if (!items) return undefined;
  const kinds = items.map(item => format.classify(item));
  const lastBoundary = kinds.lastIndexOf("boundary");
  if (lastBoundary === -1) return undefined;
  const folded = foldItems(format, items, kinds);
  const at = folded.length - (items.length - lastBoundary) + 1;
  const indexItem = format.indexItem(index(format.runKey(items[lastBoundary])));
  return format.withRules(format.withItems(body, [...folded.slice(0, at), indexItem, ...folded.slice(at)]), rules);
}
