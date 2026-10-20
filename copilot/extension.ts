import { mkdir } from "node:fs/promises";
import { type CopilotSession, joinSession } from "@github/copilot-sdk/extension";
import { foldHome } from "./paths";
import { queryProxy, readSecret, readState } from "./proxy-state";
import { turnStart } from "./turn-start";

const BYPASS_WARNING =
  "This session's model requests do not go through the agent-fold proxy, so its runs are not folded; start Copilot with `agent-fold copilot` or the app with `agent-fold gh-app`.";

function keepFoldHomeGranted(session: CopilotSession): void {
  const { paths } = session.rpc.permissions;
  const grant = () =>
    paths
      .isPathWithinAllowedDirectories({ path: foldHome })
      .then(({ allowed }) => allowed || paths.add({ path: foldHome }))
      .catch(error => console.error(`agent-fold: could not grant ${foldHome} to session ${session.sessionId}: ${error}`));
  // Copilot CLI 1.0.100: when the TUI switches back to a session it replaces the session's additional directories within about 30 ms after session.foreground, then reloads the session's agents and skills.
  session.on("session.custom_agents_updated", grant);
  session.on("session.skills_loaded", grant);
}

async function routedThroughProxy(sessionId: string, since: number): Promise<boolean> {
  const state = readState();
  const secret = readSecret();
  if (state === undefined || secret === undefined) return false;
  return (await queryProxy(state.port, secret, { session: { id: sessionId, since } }))?.sessionSeen === true;
}

function warnOnBypass(session: CopilotSession): void {
  const stop = session.on("session.idle", () => {
    session
      .getEvents()
      .then(async events => {
        const since = turnStart(events);
        if (since === undefined) return;
        stop();
        if (!(await routedThroughProxy(session.sessionId, since))) await session.log(BYPASS_WARNING, { level: "warning", ephemeral: true });
      })
      .catch(error => {
        stop();
        console.error(`agent-fold: could not check the proxy for session ${session.sessionId}: ${error}`);
      });
  });
}

if (!process.env.SESSION_ID) process.exit(0);

try {
  await mkdir(foldHome, { recursive: true });
  const session = await joinSession({ additionalDirectories: [foldHome] });
  keepFoldHomeGranted(session);
  warnOnBypass(session);
} catch (error) {
  console.error(`agent-fold: could not join the session: ${error instanceof Error ? error.message : error}`);
}
