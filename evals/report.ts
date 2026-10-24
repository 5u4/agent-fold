import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Variant, Verdict } from "./contract";

export type Row = {
  harness: string;
  scenario: string;
  model: string;
  variant: Variant;
  trial: number;
  verdict: { status: Verdict["status"] | "unsupported"; evidence: string };
  metrics: Record<string, number>;
};

export function resultsFile(dir: string): string {
  return join(dir, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
}

export function summarize(rows: Row[]): string[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.scenario} / ${row.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, group]) => {
    const count = (status: Row["verdict"]["status"]) => group.filter(row => row.verdict.status === status).length;
    const valid = group.filter(row => row.verdict.status === "pass" || row.verdict.status === "fail");
    const unsupported = count("unsupported");
    const names = Object.keys(group.find(row => row.verdict.status !== "unsupported")?.metrics ?? {});
    return [
      `${key}: pass ${count("pass")}/${valid.length}`,
      `invalid ${count("invalid")}`,
      ...(unsupported > 0 ? [`unsupported ${unsupported}`] : []),
      ...names.map(name => {
        const mean = valid.length ? (valid.reduce((sum, row) => sum + row.metrics[name], 0) / valid.length).toFixed(2) : "n/a";
        return `mean ${name} ${mean}`;
      }),
    ].join(", ");
  });
}

export function createReport(opts: { harness: string; scenario: string; model: string; file: string }) {
  const rows: Row[] = [];
  return {
    record(trial: Pick<Row, "variant" | "trial" | "verdict" | "metrics">) {
      const row: Row = { harness: opts.harness, scenario: opts.scenario, model: opts.model, ...trial };
      rows.push(row);
      mkdirSync(dirname(opts.file), { recursive: true });
      appendFileSync(opts.file, `${JSON.stringify(row)}\n`);
    },
    summary(): string[] {
      return [`harness ${opts.harness}, model ${opts.model}, means over valid trials`, ...summarize(rows), `results: ${opts.file}`];
    },
  };
}
