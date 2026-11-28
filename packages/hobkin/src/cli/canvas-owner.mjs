// Session run ids contain a colon. Give each a stable, filename-safe key distinct from main and durable ids.
const sessionName = '[a-z0-9][a-z0-9-]{0,63}';
const sessionRun = new RegExp(`^session:(${sessionName})$`);
export const AGENT_CANVAS_OWNER = new RegExp(`^(?:[0-9a-f]{8}|session-${sessionName})$`);

export function sessionCanvasOwner(run) {
  const name = sessionRun.exec(run ?? '')?.[1];
  return name ? `session-${name}` : null;
}
