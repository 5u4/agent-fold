import { describeEvals, scenarios } from "@agent-fold/evals";
import { piHarness } from "../harness/adapter";
import { evalConfig, RESULTS_FILE, selectScenarios } from "./eval";

const { model, trials } = evalConfig();

describeEvals({
  harness: piHarness,
  model,
  trials,
  resultsFile: RESULTS_FILE,
  scenarios: selectScenarios(scenarios, process.env.FOLD_EVAL_SCENARIO),
});
