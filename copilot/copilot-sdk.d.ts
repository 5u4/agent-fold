declare module "@github/copilot-sdk/extension" {
  export interface CopilotSession {
    readonly sessionId: string;
    readonly rpc: {
      permissions: {
        paths: {
          isPathWithinAllowedDirectories(params: { path: string }): Promise<{ allowed: boolean }>;
          add(params: { path: string }): Promise<unknown>;
        };
      };
    };
    on(eventType: "session.custom_agents_updated" | "session.skills_loaded" | "session.idle", handler: () => void): () => void;
    log(message: string, options?: { level?: "info" | "warning" | "error"; ephemeral?: boolean }): Promise<void>;
  }

  export function joinSession(config?: { additionalDirectories?: string[] }): Promise<CopilotSession>;
}

declare module "*.md" {
  const text: string;
  export default text;
}
