import tokens from "../tokens/ai-status.json" with { type: "json" };
export const STATUS_HOLD_MS = Number.parseFloat(tokens.feedback.$value);

export const AI_STATUS_CSS = `
:root { --ai-status-gap: ${tokens.gap.$value}; --ai-status-icon: ${tokens.icon.$value}; --ai-status-font: ${tokens.font.$value}; }
.ai-status { display: inline-flex; align-items: center; gap: var(--ai-status-gap); flex: none; white-space: nowrap; color: var(--block-ink); font: 500 var(--ai-status-font)/1.35 var(--f-ui); }
.ai-status svg { width: var(--ai-status-icon); height: var(--ai-status-icon); flex: none; }
.ai-status .ai-status-full { display: none; }
@media (min-width: ${tokens.wide.$value}) { .ai-status .ai-status-full { display: inline; } .ai-status .ai-status-short { display: none; } }
`;

const ACTIONS = {
  get_document: ["reading", "Reading model", "AI read"],
  inspect_geometry: ["reading", "Inspecting geometry", "AI read"],
  select_geometry: ["reading", "Selecting geometry", "AI read"],
  preview_model: ["previewing", "Previewing model", "AI preview"],
  preview_parameters: ["previewing", "Previewing changes", "AI preview"],
  preview_resize_body: ["previewing", "Previewing resize", "AI preview"],
  preview_new_document: ["previewing", "Preparing document", "AI preview"],
  apply_model: ["editing", "Updating model", "AI edit"],
  undo: ["editing", "Undoing model edit", "AI undo"],
  reopen_document: ["editing", "Reopening model", "AI open"],
  save_document: ["saving", "Saving model", "AI save"],
  export_model: ["exporting", "Exporting model", "AI export"],
};

export function agentStatus({ online = false, checking = false, connected = false, recent = false, action, outcome, error } = {}) {
  if (action) {
    const [state, label, compact] = ACTIONS[action] || ["working", "Agent working", "AI busy"];
    return { state, label, compact, detail: `AI agent: ${label.toLowerCase()}.` };
  }
  if (checking) return { state: "checking", label: "Checking AI bridge", compact: "AI linking", detail: "Checking the local MCP bridge. An editor connection does not mean an agent is connected." };
  if (!online) return { state: "offline", label: "AI bridge offline", compact: "AI offline", detail: "Local MCP bridge is unavailable. Start the local server to connect an AI client." };
  if (error) return { state: "error", label: "Agent request failed", compact: "AI error", detail: `AI request failed: ${String(error).slice(0, 240)}` };
  if (outcome) {
    if (outcome === "no_change") return { state: "completed", label: "Agent left model unchanged", compact: "AI unchanged", detail: "The request finished without changing the document, including a duplicate retry." };
    const changed = ["apply_model", "undo", "reopen_document"].includes(outcome);
    return { state: "completed", label: changed ? "Agent updated model" : outcome === "save_document" ? "Agent saved model" : outcome === "export_model" ? "Agent exported model" : "Agent preview ready", compact: changed ? "AI updated" : outcome === "save_document" ? "AI saved" : outcome === "export_model" ? "AI exported" : "AI preview", detail: changed ? "The agent's model edit finished. Use Undo to recover the previous state." : "The agent's request finished." };
  }
  if (connected) return { state: "connected", label: "AI client connected", compact: "AI ready", detail: "An MCP client has a live local connection. It is not currently changing this document." };
  if (recent) return { state: "recent", label: "Recent AI activity", compact: "AI recent", detail: "An MCP client recently sent a request. This transport has no persistent connection to verify." };
  return { state: "waiting", label: "Waiting for AI client", compact: "AI waiting", detail: "The local MCP bridge is available. No AI client connection or recent request has been detected." };
}

export function initAgentStatus() {
  const element = document.getElementById("ai-status");
  if (!element) return () => {};
  return (input) => {
    const status = agentStatus(input);
    if (element.dataset.state === status.state && element.title === status.detail) return;
    element.dataset.state = status.state; element.title = status.detail;
    element.setAttribute("aria-label", `${status.label}. ${status.detail}`);
    element.querySelector(".ai-status-full").textContent = status.label;
    element.querySelector(".ai-status-short").textContent = status.compact;
  };
}
