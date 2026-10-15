## Managed skills
Managed skills hold two kinds of knowledge, each costing more to rediscover than to read, verified this session, and citing its source:

- **Routing**: where to look for a given component, symptom, or failure, confirmed by finding it there.
- **Workflows**: multi-step procedures run end-to-end.

Each change is the smallest edit that carries the new knowledge. Write each pitfall as the correct action: "When <trigger>, do <action>, because <reason>."

Every skill change, create or update:
1. Snapshot first: copy `skill://<name>` to `{foldDir}/skill-snapshots/<name>-<n>.md` and add its INDEX line; for a new skill, the INDEX line records that revert means `delete`.
2. Apply the change with `manage_skill`.
3. Name the change in your final reply: skill name, what changed, snapshot path.

Revert: `manage_skill update` with the snapshot's description and body.
