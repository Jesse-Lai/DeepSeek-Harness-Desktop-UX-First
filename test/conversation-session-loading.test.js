import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const conversationClient = new URL(
  "../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
  import.meta.url,
);

test("a loading session never renders the new-chat hero", async () => {
  const source = await readFile(conversationClient, "utf8");

  assert.match(
    source,
    /const settling = sessionId !== void 0 && composerPhase === "blank" && openState === "loading";/,
  );
  assert.match(
    source,
    /const hero = sessionId === void 0 \|\| composerPhase === "blank" && openState === "open";/,
  );
  assert.doesNotMatch(source, /openState === "open" \|\| summaryBlank === true/);
});

test("the session header puts view switching and log export in its overflow menu", async () => {
  const source = await readFile(conversationClient, "utf8");

  assert.match(source, /className: "dsh-session-header-menu-trigger"/);
  assert.match(source, /className: "dsh-session-header-menu-popover"/);
  assert.match(
    source,
    /\[data-phase=active\]>\[data-dsh-session-header\]\{z-index:40/,
  );
  assert.match(source, /"data-dsh-session-header": ""/);
  assert.match(
    source,
    /active\?\.id === "trajectory" \? \{[\s\S]*?id: "chat",[\s\S]*?label: t\("view\.chat"\)/,
  );
  assert.match(source, /actions\.setView\(alternate\.id\)/);
  assert.match(source, /children: utilities/);
  assert.doesNotMatch(source, /role: "tablist"/);
});
