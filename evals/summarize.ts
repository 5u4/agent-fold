import { readFileSync } from "node:fs";
import { type Row, summarize } from "./report";

const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: bun evals/summarize.ts <results.jsonl> [more.jsonl ...]");

const groups = new Map<string, Row[]>();
for (const file of files) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row: Row = JSON.parse(line);
    const key = `harness ${row.harness}, model ${row.model}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
}

for (const [header, rows] of groups) console.log([header, ...summarize(rows), ""].join("\n"));
