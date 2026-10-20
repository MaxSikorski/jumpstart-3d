// Requests only: deliberately contains no model plans or feature recipes.
export const AGENT_TASKS = Object.freeze([
  {
    id: "coaster-revision",
    request: "Starting with the existing tutorial coaster, change it to 110 mm diameter with nine evenly spaced drainage channels. Keep each channel 4 mm wide and 3 mm deep and preserve the existing floor thickness. Keep the channels symmetric and open at both ends. Preview before applying, inspect the resulting geometry, save and reopen it, export STL, exercise retry and stale-edit protection, and undo back to the original coaster.",
    startingDocument: "An existing tutorial coaster; begin must capture its original geometry and parameters.",
    dimensions: { x: 110, y: 110 },
    channelRequirements: { count: 9, width: 4, depth: 3, symmetric: true, openEnds: true, preserveFloor: true },
    requires: ["images", "parameters", "reopen", "undo", "retry", "stale", "channels"],
  },
  {
    id: "offset-tray",
    request: "Design an editable rectangular parts tray, 83 mm by 57 mm by 12 mm overall. Use a 2 mm floor and walls. Add one divider parallel to the short side, leaving clear compartment lengths of 25 mm and 52 mm. Keep it open at the top. Inspect the actual walls and floor, preview, apply, save and reopen, export STL, then undo. Ask for clarification if the dimensions are inconsistent.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 83, y: 57, z: 12 },
    requires: ["images", "parameters", "reopen", "undo", "tray-sections"],
  },
  {
    id: "reject-and-correct",
    request: "Make an editable 74 mm diameter coaster, 5 mm tall, with channels 8 mm deep and at least 2 mm of floor beneath them. First explain and reject that impossible combination without changing the document. Then use the corrected channel depth of 3 mm, create the model, inspect it, export STL, and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 74, y: 74, z: 5 },
    requires: ["images", "undo", "rejected-request", "corrected-depth"],
  },
]);

export function agentTask(id) {
  const task = AGENT_TASKS.find((entry) => entry.id === id);
  if (!task) throw new Error(`Unknown task ${id}; choose ${AGENT_TASKS.map((entry) => entry.id).join(", ")}`);
  return task;
}
