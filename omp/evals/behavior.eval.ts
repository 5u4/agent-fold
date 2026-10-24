import { describeEvals, scenarios } from "@agent-fold/evals";
import { ompHarness } from "../harness/adapter";
import { evalConfig, RESULTS_FILE } from "./eval";

const { model, trials } = evalConfig();

describeEvals({ harness: ompHarness, model, trials, resultsFile: RESULTS_FILE, scenarios });
