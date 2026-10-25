import { Plugin } from "@opencode/plugin/tui";
import { readSwitch, switchMessage } from "./switch";

export default Plugin.define({
  id: "agent-fold",
  setup(ctx) {
    const lastAt = new Map<string, number | undefined>();
    for (const session of ctx.data.session.list()) lastAt.set(session.id, readSwitch(session.metadata)?.at);
    return ctx.data.on("session.metadata.updated", event => {
      const { sessionID, metadata } = event.data;
      const state = readSwitch(metadata);
      const previous = lastAt.get(sessionID);
      lastAt.set(sessionID, state?.at);
      const route = ctx.ui.router.current();
      if (state === undefined || state.at === previous) return;
      if (route.type !== "session" || route.sessionID !== sessionID) return;
      ctx.ui.toast.show({ title: "agent-fold", message: switchMessage(state), variant: "info" });
    });
  },
});
