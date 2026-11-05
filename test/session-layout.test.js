import assert from "node:assert/strict";
import test from "node:test";
import { DROP_DIRECTIONS, dropDirectionAt, insertPane, movePane, pane, parseWorkspaceLayout, removePane, replacePane, resizeSplit, serializeWorkspaceLayout, sessionIds, split, validateLayout } from "../src/session-layout.js";

test("layout inserts in all directional zones and collapses empty splits", () => {
  const a = pane("a", "pa");
  const b = pane("b", "pb");
  const right = insertPane(a, "pa", b, "right");
  assert.equal(right.direction, "horizontal");
  assert.deepEqual(sessionIds(right), ["a", "b"]);
  const top = insertPane(right, "pb", pane("c", "pc"), "top");
  assert.deepEqual(sessionIds(top), ["a", "c", "b"]);
  assert.deepEqual(removePane(top, "pc").root, right);
});

test("moving a pane is atomic and never duplicates the session", () => {
  const root = split("horizontal", pane("a", "pa"), split("vertical", pane("b", "pb"), pane("c", "pc"), 0.5, "nested"), 0.5, "root");
  const moved = movePane(root, "pc", "pa", "left");
  assert.deepEqual(sessionIds(moved), ["c", "a", "b"]);
  assert.equal(new Set(sessionIds(moved)).size, 3);
});

test("drag directions exclude replacement and replacement stays explicit", () => {
  assert.deepEqual([...DROP_DIRECTIONS], ["top", "right", "bottom", "left"]);
  assert.throws(() => insertPane(pane("a", "pa"), "pa", pane("b", "pb"), "center"), /invalid drop direction/);
  assert.equal(replacePane(pane("a", "pa"), "pa", pane("b", "pb")).sessionId, "b");
});

test("drop hit testing chooses the nearest normalized edge and stabilizes ties", () => {
  const bounds = { left: 100, top: 50, width: 800, height: 400 };
  assert.equal(dropDirectionAt(bounds, { x: 110, y: 250 }), "left");
  assert.equal(dropDirectionAt(bounds, { x: 890, y: 250 }), "right");
  assert.equal(dropDirectionAt(bounds, { x: 500, y: 60 }), "top");
  assert.equal(dropDirectionAt(bounds, { x: 500, y: 440 }), "bottom");
  assert.equal(dropDirectionAt(bounds, { x: 500, y: 250 }), "top");
  assert.equal(dropDirectionAt(bounds, { x: 500, y: 250 }, "left"), "left");
  assert.equal(dropDirectionAt(bounds, { x: 504, y: 250 }, "left"), "left");
  assert.equal(dropDirectionAt(bounds, { x: 540, y: 250 }, "left"), "right");
});

test("split ratios clamp and persisted layouts reject duplicates", () => {
  const root = split("horizontal", pane("a", "pa"), pane("b", "pb"), 0.5, "root");
  assert.equal(resizeSplit(root, "split:root", 0.99).ratio, 0.8);
  assert.equal(validateLayout(split("vertical", pane("a", "one"), pane("a", "two"))), null);
  const encoded = serializeWorkspaceLayout({ workspaceId: "w", windows: [{ id: "main", root }] });
  assert.deepEqual(sessionIds(parseWorkspaceLayout(encoded).windows[0].root), ["a", "b"]);
});
