import type { Scenario } from "../contract";
import { checksReplyAgainstEvidence } from "./checks-reply-against-evidence";
import { recoversArtifactResult } from "./recovers-artifact-result";
import { recoversFoldedDetail } from "./recovers-folded-detail";
import { reusesLocatedFiles } from "./reuses-located-files";
import { skipsIndexWhenReplyHoldsAnswer } from "./skips-index-when-reply-holds-answer";

export const scenarios: Scenario<unknown>[] = [
  checksReplyAgainstEvidence,
  recoversArtifactResult,
  recoversFoldedDetail,
  reusesLocatedFiles,
  skipsIndexWhenReplyHoldsAnswer,
];
