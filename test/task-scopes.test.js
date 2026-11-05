import assert from "node:assert/strict";
import { relative, resolve } from "node:path";
import test from "node:test";
import { createTaskScope, handleCreateTaskScope } from "../src/task-scopes.js";

test("createTaskScope creates unique application-owned Task directories", async () => {
  const created = [];
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const options = {
    createId: () => ids.shift(),
    createDirectory: async (...args) => created.push(args),
  };

  const first = await createTaskScope("/application/data", options);
  const second = await createTaskScope("/application/data", options);

  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(first.sessionId, "session-11111111-1111-4111-8111-111111111111");
  assert.equal(first.cwd, resolve("/application/data/tasks", first.sessionId));
  assert.equal(relative(resolve("/application/data/tasks"), first.cwd).startsWith(".."), false);
  assert.deepEqual(created, [
    [resolve("/application/data/tasks"), { recursive: true }],
    [first.cwd, { recursive: false }],
    [resolve("/application/data/tasks"), { recursive: true }],
    [second.cwd, { recursive: false }],
  ]);
});

test("handleCreateTaskScope rejects every sender except the main renderer", async () => {
  const mainWebContents = {};
  await assert.rejects(
    handleCreateTaskScope({ sender: {} }, mainWebContents, "/application/data"),
    /Unauthorized Task scope request/,
  );
});

test("handleCreateTaskScope propagates directory creation failures", async () => {
  const mainWebContents = {};
  const failure = new Error("disk full");
  await assert.rejects(
    handleCreateTaskScope({ sender: mainWebContents }, mainWebContents, "/application/data", {
      createId: () => "33333333-3333-4333-8333-333333333333",
      createDirectory: async () => {
        throw failure;
      },
    }),
    failure,
  );
});
