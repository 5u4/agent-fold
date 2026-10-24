import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FOLD_DIR, type Scenario, type ScriptStep } from "../contract";
import { mentions } from "../transcript";

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

const investigation: ScriptStep[] = [
  { kind: "read", path: "config/defaults.yaml" },
  { kind: "read", path: "deploy/production.env" },
  { kind: "shell", command: "bin/config production" },
  { kind: "write", path: `${FOLD_DIR}/retries.md`, content: RECORD },
  { kind: "write", path: `${FOLD_DIR}/INDEX.md`, content: INDEX },
  { kind: "reply", text: "The 7 comes from `retries: 7` in config/defaults.yaml." },
];

type Effective = { production: string };

export const checksReplyAgainstEvidence: Scenario<Effective> = {
  title: "acts on recorded evidence when the earlier reply contradicts it",
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
  grade(run, effective) {
    const results = run.turns[0].actions.filter(action => action.result !== null);
    const scriptedCalls = investigation.filter(step => step.kind !== "reply").length;
    if (results.length !== scriptedCalls)
      return { status: "invalid", evidence: `turn 1 has ${results.length} tool results, expected ${scriptedCalls}` };
    const failed = results.filter(action => action.isError);
    if (failed.length)
      return { status: "invalid", evidence: `turn-1 tool errors: ${JSON.stringify(failed.map(action => action.result)).slice(0, 400)}` };
    return /^retries=5$/m.test(effective.production)
      ? { status: "pass", evidence: "bin/config production prints retries=5" }
      : { status: "fail", evidence: `bin/config production prints ${JSON.stringify(effective.production)}` };
  },
  metrics(run) {
    const actions = run.turns[1].actions;
    return {
      "turn-2 opened fold-dir evidence": actions.some(action => mentions(action, run.foldHome)) ? 1 : 0,
      "turn-2 tool calls": actions.length,
    };
  },
};
