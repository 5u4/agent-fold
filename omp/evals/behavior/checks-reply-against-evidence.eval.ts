import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runTrial } from "../../harness/run-omp";
import { FOLD_DIR, type Reply, type Run, type Scenario, type Turn, type Verdict } from "../../harness/types";
import { createReport, evalConfig } from "../eval";

const CONFIG_SCRIPT = `#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$root/deploy/\${1:?usage: bin/config <environment>}.env"
[ -f "$env_file" ] || { echo "unknown environment: $1" >&2; exit 1; }
grep -E '^[a-z_]+:' "$root/config/defaults.yaml" | while IFS=': ' read -r key value; do
	var="APP_$(echo "$key" | tr '[:lower:]' '[:upper:]')"
	override="$(grep -E "^$var=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
	echo "$key=\${override:-$value}"
done
`;

const PROJECT: Record<string, string> = {
  "README.md": `# relay

Background worker that drains the jobs queue and retries failed jobs with backoff.

Defaults live in \`config/defaults.yaml\`. Each environment has a \`deploy/<environment>.env\`.
Run \`bin/config <environment>\` to print the settings a deployment ends up with.
`,
  "config/defaults.yaml": `retries: 7
timeout_ms: 2000
concurrency: 4
queue: jobs-default
`,
  "deploy/production.env": `DATABASE_URL=postgres://relay@db.internal:5432/relay
LOG_LEVEL=info
APP_CONCURRENCY=16
APP_RETRIES=7
`,
  "deploy/staging.env": `DATABASE_URL=postgres://relay@db.staging.internal:5432/relay
LOG_LEVEL=debug
APP_CONCURRENCY=2
`,
  "bin/config": CONFIG_SCRIPT,
};

const RECORD = `# Where production's 7 retries come from

## Result
Production's 7 comes from \`APP_RETRIES=7\` in deploy/production.env, which overrides \`retries\` in config/defaults.yaml.

## Evidence
- deploy/production.env:4 \`APP_RETRIES=7\`
- config/defaults.yaml:1 \`retries: 7\`, the default that the env var overrides
- \`bin/config production\` prints \`retries=7\`, and maps each \`APP_<KEY>\` in deploy/<environment>.env over the yaml key

## Reproduction
\`bin/config production\`
`;

const INDEX = `- ${FOLD_DIR}/retries.md, deploy/production.env, config/defaults.yaml — where production's 7 retries come from: APP_RETRIES in deploy/production.env overrides the yaml default\n`;

const investigation: Reply[] = [
  { toolCall: { name: "read", arguments: { path: "config/defaults.yaml" } } },
  { toolCall: { name: "read", arguments: { path: "deploy/production.env" } } },
  { toolCall: { name: "bash", arguments: { command: "bin/config production" } } },
  { toolCall: { name: "write", arguments: { path: `${FOLD_DIR}/retries.md`, content: RECORD } } },
  { toolCall: { name: "write", arguments: { path: `${FOLD_DIR}/INDEX.md`, content: INDEX } } },
  { text: "The 7 comes from `retries: 7` in config/defaults.yaml." },
];

type Effective = { production: string };

type ToolCall = { name: string; arguments: Record<string, unknown> };

function toolCalls(turn: Turn): ToolCall[] {
  return turn.messages
    .flatMap(message => (message.role === "assistant" ? message.content : []))
    .flatMap(block => (block.type === "toolCall" ? [{ name: block.name, arguments: block.arguments }] : []));
}

function grade(run: Run, effective: Effective): Verdict {
  const results = run.turns[0].messages.flatMap(message => (message.role === "toolResult" ? [message] : []));
  const scriptedCalls = investigation.filter(reply => "toolCall" in reply).length;
  if (results.length !== scriptedCalls)
    return { status: "invalid", evidence: `turn 1 has ${results.length} tool results, expected ${scriptedCalls}` };
  const failed = results.filter(result => result.isError);
  if (failed.length)
    return { status: "invalid", evidence: `turn-1 tool errors: ${JSON.stringify(failed.map(result => result.content)).slice(0, 400)}` };
  return /^retries=5$/m.test(effective.production)
    ? { status: "pass", evidence: "bin/config production prints retries=5" }
    : { status: "fail", evidence: `bin/config production prints ${JSON.stringify(effective.production)}` };
}

const title = "acts on recorded evidence when the earlier reply contradicts it";

const scenario: Scenario<Effective> = {
  async setup(workdir) {
    for (const [path, content] of Object.entries(PROJECT)) {
      mkdirSync(dirname(join(workdir, path)), { recursive: true });
      writeFileSync(join(workdir, path), content);
    }
    chmodSync(join(workdir, "bin/config"), 0o755);
    return { production: "" };
  },
  turns: [
    {
      prompt: "Production retries failed jobs 7 times. Where does that 7 come from? Don't change anything yet.",
      script: investigation,
    },
    "Lower production retries to 5.",
  ],
  async inspect(workdir) {
    const proc = Bun.spawnSync(["bin/config", "production"], { cwd: workdir });
    return { production: `${proc.stdout.toString()}${proc.stderr.toString()}` };
  },
  grade,
};

const { model, trials } = evalConfig();
const report = createReport(title, model);

afterAll(() => console.log(report.summary().join("\n")));

describe(title, () => {
  for (const variant of ["without-plugin", "with-plugin"] as const) {
    for (let trial = 1; trial <= trials[variant]; trial++) {
      test.concurrent(`${variant} / trial ${trial}`, async () => {
        const { run, state } = await runTrial(scenario, { variant, model });
        const verdict = scenario.grade(run, state);
        const calls = toolCalls(run.turns[1]);
        report.record({
          variant,
          trial,
          verdict,
          metrics: {
            "turn-2 opened fold-dir evidence": calls.some(call => JSON.stringify(call.arguments).includes(run.foldHome)) ? 1 : 0,
            "turn-2 tool calls": calls.length,
          },
        });
        expect(verdict).toMatchObject({ status: "pass" });
      }, 300_000);
    }
  }
});
