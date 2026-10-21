export type SessionEvent = { type: string; timestamp: string; agentId?: string | null };

export function turnStart(events: readonly SessionEvent[]): number | undefined {
  for (const event of events.toReversed()) {
    if (event.type === "session.start" || event.type === "session.resume") return undefined;
    if (event.type === "user.message" && !event.agentId) return Date.parse(event.timestamp);
  }
  return undefined;
}
