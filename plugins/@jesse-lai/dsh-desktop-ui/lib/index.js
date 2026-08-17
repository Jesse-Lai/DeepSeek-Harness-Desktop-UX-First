/** Services required by the model guidance paired with the desktop renderer. */
export const inject = ["systemPrompt"];

/**
 * The browser renders ordinary Assistant text between activity groups as
 * user-facing progress. Ask the model to produce that semantic layer; tool
 * rows and the live shimmer remain renderer-owned and should not be narrated.
 */
export const PROGRESS_UPDATE_PROMPT = [
  "For requests that require multiple actions, keep the user informed with brief user-facing progress updates as normal assistant text before the first tool call and between meaningful phases.",
  "Each update should communicate only new, decision-relevant progress: what was achieved or learned, any current challenge, and what you will do next.",
  "When work remains, state the immediate next objective explicitly with 'Next' or the natural equivalent in the user's language so the live status can stay specific between tool calls.",
  "Do not narrate every tool call, restate the live activity indicator, or expose private chain-of-thought.",
  "Use the user's language and keep each update to one to three concise sentences; progress updates are not the final answer.",
].join(" ");

/**
 * Host half of the DSH Desktop presentation plugin. The browser behavior is
 * shipped through the package's `./client` export.
 */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: "ui:desktop-progress-updates",
    order: 180,
    text: PROGRESS_UPDATE_PROMPT,
  });
}
