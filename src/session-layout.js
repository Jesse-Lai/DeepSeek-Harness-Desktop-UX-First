export const SESSION_LAYOUT_VERSION = 1;
export const DROP_DIRECTIONS = new Set(["top", "right", "bottom", "left"]);
export const DROP_ZONES = DROP_DIRECTIONS;

export function pane(sessionId, id = `pane:${sessionId}`) {
  if (typeof sessionId !== "string" || sessionId.length === 0) throw new TypeError("sessionId required");
  return { type: "pane", id, sessionId };
}

export function split(direction, first, second, ratio = 0.5, id = crypto.randomUUID()) {
  if (direction !== "horizontal" && direction !== "vertical") throw new TypeError("invalid direction");
  return { type: "split", id: `split:${id}`, direction, ratio: clampRatio(ratio), first, second };
}

export function clampRatio(value) {
  return Math.min(0.8, Math.max(0.2, Number.isFinite(value) ? value : 0.5));
}

export function sessionIds(root) {
  if (!root) return [];
  return root.type === "pane"
    ? [root.sessionId]
    : [...sessionIds(root.first), ...sessionIds(root.second)];
}

export function findPane(root, paneId) {
  if (!root) return undefined;
  if (root.type === "pane") return root.id === paneId ? root : undefined;
  return findPane(root.first, paneId) ?? findPane(root.second, paneId);
}

export function removePane(root, paneId) {
  if (!root) return { root: null, removed: undefined };
  if (root.type === "pane") return root.id === paneId ? { root: null, removed: root } : { root, removed: undefined };
  const left = removePane(root.first, paneId);
  if (left.removed) return {
    root: left.root ? { ...root, first: left.root } : root.second,
    removed: left.removed,
  };
  const right = removePane(root.second, paneId);
  if (right.removed) return {
    root: right.root ? { ...root, second: right.root } : root.first,
    removed: right.removed,
  };
  return { root, removed: undefined };
}

export function insertPane(root, targetPaneId, incoming, zone) {
  if (!DROP_DIRECTIONS.has(zone)) throw new TypeError("invalid drop direction");
  if (!root) return incoming;
  if (root.type === "pane") {
    if (root.id !== targetPaneId) return root;
    const direction = zone === "left" || zone === "right" ? "horizontal" : "vertical";
    return zone === "left" || zone === "top"
      ? split(direction, incoming, root)
      : split(direction, root, incoming);
  }
  return {
    ...root,
    first: insertPane(root.first, targetPaneId, incoming, zone),
    second: insertPane(root.second, targetPaneId, incoming, zone),
  };
}

export function replacePane(root, targetPaneId, incoming) {
  if (!root) return incoming;
  if (root.type === "pane") return root.id === targetPaneId ? incoming : root;
  return {
    ...root,
    first: replacePane(root.first, targetPaneId, incoming),
    second: replacePane(root.second, targetPaneId, incoming),
  };
}

export function movePane(root, paneId, targetPaneId, zone) {
  if (paneId === targetPaneId) return root;
  const removal = removePane(root, paneId);
  return removal.removed ? insertPane(removal.root, targetPaneId, removal.removed, zone) : root;
}

export function dropDirectionAt(bounds, point, previousDirection, hysteresisPixels = 8) {
  const width = Math.max(1, Number(bounds?.width) || 0);
  const height = Math.max(1, Number(bounds?.height) || 0);
  const left = Number(bounds?.left) || 0;
  const top = Number(bounds?.top) || 0;
  const x = Math.min(1, Math.max(0, ((Number(point?.x) || 0) - left) / width));
  const y = Math.min(1, Math.max(0, ((Number(point?.y) || 0) - top) / height));
  const distances = { top: y, right: 1 - x, bottom: 1 - y, left: x };
  const direction = [...DROP_DIRECTIONS].reduce((best, candidate) => (
    distances[candidate] < distances[best] ? candidate : best
  ));
  if (DROP_DIRECTIONS.has(previousDirection)) {
    const hysteresis = Math.max(0, Number(hysteresisPixels) || 0) / Math.min(width, height);
    if (distances[previousDirection] <= distances[direction] + hysteresis) return previousDirection;
  }
  return direction;
}

export function resizeSplit(root, splitId, ratio) {
  if (!root || root.type === "pane") return root;
  if (root.id === splitId) return { ...root, ratio: clampRatio(ratio) };
  return { ...root, first: resizeSplit(root.first, splitId, ratio), second: resizeSplit(root.second, splitId, ratio) };
}

export function validateLayout(root, { allowedSessions } = {}) {
  const seenPanes = new Set();
  const seenSessions = new Set();
  let invalid = false;
  const visit = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "pane") {
      if (typeof node.id !== "string" || typeof node.sessionId !== "string") return null;
      if (seenPanes.has(node.id) || seenSessions.has(node.sessionId)) {
        invalid = true;
        return null;
      }
      if (allowedSessions && !allowedSessions.has(node.sessionId)) return null;
      seenPanes.add(node.id);
      seenSessions.add(node.sessionId);
      return { type: "pane", id: node.id, sessionId: node.sessionId };
    }
    if (node.type !== "split") return null;
    const first = visit(node.first);
    const second = visit(node.second);
    if (!first) return second;
    if (!second) return first;
    return { type: "split", id: String(node.id), direction: node.direction === "vertical" ? "vertical" : "horizontal", ratio: clampRatio(node.ratio), first, second };
  };
  const result = visit(root);
  return invalid ? null : result;
}

export function serializeWorkspaceLayout(state) {
  return JSON.stringify({ version: SESSION_LAYOUT_VERSION, ...state });
}

export function parseWorkspaceLayout(value, options) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== SESSION_LAYOUT_VERSION || !Array.isArray(parsed.windows)) return undefined;
    return { ...parsed, windows: parsed.windows.map((window) => ({ ...window, root: validateLayout(window.root, options) })).filter((window) => window.root) };
  } catch {
    return undefined;
  }
}
