import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const TASK_SESSION_PREFIX = "session-";

export async function createTaskScope(
  userDataPath,
  { createDirectory = mkdir, createId = randomUUID } = {},
) {
  const tasksRoot = resolve(userDataPath, "tasks");
  const sessionId = `${TASK_SESSION_PREFIX}${createId()}`;
  const cwd = resolve(join(tasksRoot, sessionId));
  const child = relative(tasksRoot, cwd);

  if (child === "" || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Refusing to create a Task outside the application Tasks directory");
  }

  await createDirectory(tasksRoot, { recursive: true });
  await createDirectory(cwd, { recursive: false });
  return { sessionId, cwd };
}

export async function handleCreateTaskScope(event, mainWebContents, userDataPath, options) {
  if (event.sender !== mainWebContents) {
    throw new Error("Unauthorized Task scope request");
  }
  return createTaskScope(userDataPath, options);
}
