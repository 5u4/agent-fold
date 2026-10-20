declare module "@github/copilot-sdk" {
  export interface CopilotRequestContext {
    readonly sessionId?: string;
    readonly interactionType?: string;
    url: string;
  }

  export class CopilotRequestHandler {
    protected sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response>;
  }

  export interface JsonRpcConnection {
    sendRequest(method: string, params: unknown, ...rest: unknown[]): Promise<unknown>;
  }

  export interface CopilotSession {
    readonly rpc: {
      metadata: { snapshot(): Promise<{ startTime: string; workingDirectory: string }> };
      permissions: {
        paths: {
          isPathWithinAllowedDirectories(params: { path: string }): Promise<{ allowed: boolean }>;
          add(params: { path: string }): Promise<unknown>;
        };
      };
    };
    on(eventType: "session.custom_agents_updated" | "session.skills_loaded", handler: () => void): () => void;
    disconnect(): Promise<void>;
  }

  export class CopilotClient {
    constructor(options: { _internalConnection: { kind: "parent-process" }; requestHandler: CopilotRequestHandler });
    connection: JsonRpcConnection | null;
    start(): Promise<void>;
    onLifecycle(type: "session.foreground", handler: (event: { sessionId: string }) => void): () => void;
    resumeSessionForExtension(
      sessionId: string,
      config: { additionalDirectories: string[]; suppressResumeEvent: boolean },
      contributions: object,
      extensionOptions: undefined,
    ): Promise<CopilotSession>;
  }
}

declare module "*.md" {
  const text: string;
  export default text;
}
