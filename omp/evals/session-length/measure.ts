import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_COMPACTION_SETTINGS, resolveThresholdTokens } from "@oh-my-pi/pi-agent-core/compaction";
import { analyzeSession, calibrate, classify, countTokens, type Footprint, quantile, type Session, simulate } from "./session-length";

const WINDOWS = [200_000, 1_000_000];
const TRIALS = 2000;
const SEED = 1;

const root = process.argv[2] ?? join(homedir(), ".omp", "agent", "sessions");
const byKey = new Map<string, Session>();
let scanned = 0;
for (const project of readdirSync(root).sort()) {
  const dir = join(root, project);
  if (!statSync(dir).isDirectory()) continue;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    scanned++;
    const session = analyzeSession(readFileSync(join(dir, name), "utf8"));
    if (!session) continue;
    const seen = byKey.get(session.key);
    if (!seen || session.runCount > seen.runCount) byKey.set(session.key, session);
  }
}

const sessions = [...byKey.values()].filter(session => session.segments.length > 0);
const runsOf = (group: Session[]) => group.flatMap(session => session.segments.flat());
const calibration = calibrate(runsOf(sessions));
if (calibration === undefined) {
  console.log("no tool-free runs to calibrate the token estimate");
  process.exit(0);
}
const modes = sessions.map(session => classify(runsOf([session]), calibration));
const unfoldedSessions = sessions.filter((_, index) => modes[index] === "unfolded");
const foldedSessions = sessions.filter((_, index) => modes[index] === "folded");
const unfoldedRuns = runsOf(unfoldedSessions);
const foldedRuns = runsOf(foldedSessions);
const startPrompts = unfoldedSessions.flatMap(session => (session.startPrompt === undefined ? [] : [session.startPrompt]));

const k = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`;
const x = (ratio: number) => `${ratio.toFixed(1)}x`;
console.log(`main session files scanned: ${scanned}; distinct sessions with a measurable run: ${sessions.length}`);
console.log(
  `unfolded: ${unfoldedSessions.length} sessions, ${unfoldedRuns.length} runs; folded: ${foldedSessions.length} sessions, ${foldedRuns.length} runs; ` +
    `ambiguous: ${sessions.length - unfoldedSessions.length - foldedSessions.length}`,
);
console.log(`token estimate calibration (reported/estimated on tool-free runs): ${calibration.toFixed(2)}`);
if (unfoldedRuns.length === 0 || startPrompts.length === 0) {
  console.log("no unfolded sessions to measure");
  process.exit(0);
}
if (foldedRuns.length > 0) {
  const errors = foldedRuns.map(run => run.reportedHistoryGrowth / (calibration * run.estimatedFoldedGrowth));
  console.log(
    `folded-growth estimate check on folded sessions: reported/estimated median ${quantile(errors, 0.5).toFixed(2)} ` +
      `(p25 ${quantile(errors, 0.25).toFixed(2)}, p75 ${quantile(errors, 0.75).toFixed(2)}, n=${foldedRuns.length})`,
  );
}

const unfoldedPool: Footprint[] = unfoldedRuns.map(run => ({
  historyGrowth: run.reportedHistoryGrowth,
  inFlightGrowth: run.inFlightGrowth,
}));
const counterfactualPool: Footprint[] = unfoldedRuns.map(run => ({
  historyGrowth: run.estimatedFoldedGrowth * calibration,
  inFlightGrowth: run.inFlightGrowth,
}));
const foldedPool: Footprint[] = foldedRuns.map(run => ({
  historyGrowth: run.reportedHistoryGrowth,
  inFlightGrowth: run.inFlightGrowth,
}));
const footprint = (pool: Footprint[], key: keyof Footprint) =>
  `median ${k(
    quantile(
      pool.map(run => run[key]),
      0.5,
    ),
  )}, mean ${k(pool.reduce((sum, run) => sum + run[key], 0) / pool.length)}`;
console.log(`history growth per finished run — unfolded: ${footprint(unfoldedPool, "historyGrowth")}`);
console.log(`history growth per finished run — same runs folded: ${footprint(counterfactualPool, "historyGrowth")}`);
if (foldedPool.length > 0) console.log(`history growth per finished run — folded sessions: ${footprint(foldedPool, "historyGrowth")}`);
console.log(`in-flight growth per run — unfolded: ${footprint(unfoldedPool, "inFlightGrowth")}`);
if (foldedPool.length > 0) console.log(`in-flight growth per run — folded sessions: ${footprint(foldedPool, "inFlightGrowth")}`);
console.log(`starting prompt per session: median ${k(quantile(startPrompts, 0.5))}`);

const foldRulesTokens = countTokens([
  { role: "user", content: readFileSync(join(import.meta.dir, "..", "..", "context", "fold.md"), "utf8"), timestamp: 0 },
]);
for (const window of WINDOWS) {
  const threshold = resolveThresholdTokens(window, DEFAULT_COMPACTION_SETTINGS);
  console.log(`\nwindow ${k(window)} (auto-compaction above ${k(threshold)}), ${TRIALS} simulated sessions each:`);
  const report = (label: string, folded: Footprint[]) => {
    const trials = simulate({ startPrompts, foldRulesTokens, threshold, trials: TRIALS, seed: SEED, unfolded: unfoldedPool, folded });
    const comparable = trials.filter(trial => trial.unfolded > 0);
    const ratios = comparable.map(trial => trial.folded / trial.unfolded);
    const n =
      ratios.length === 0
        ? "N undefined"
        : `N median ${x(quantile(ratios, 0.5))} (p25 ${x(quantile(ratios, 0.25))}, p75 ${x(quantile(ratios, 0.75))})`;
    console.log(
      `  ${label}: runs before compaction median ${quantile(
        trials.map(t => t.unfolded),
        0.5,
      )} -> ${quantile(
        trials.map(t => t.folded),
        0.5,
      )}; ` + `${n}; ${trials.length - comparable.length} sessions compacted inside their first run`,
    );
  };
  report("same runs folded (calibrated estimate)", counterfactualPool);
  if (foldedPool.length > 0) report(`folded sessions as measured (n=${foldedPool.length} runs)`, foldedPool);
}
