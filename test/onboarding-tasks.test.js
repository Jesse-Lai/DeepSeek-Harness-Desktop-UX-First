import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const dependencySources = {
  runtime: join(root, "node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js"),
  conversation: join(root, "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js"),
  model: join(root, "node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js"),
  permission: join(root, "node_modules/@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js"),
  settings: join(root, "node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js"),
  settingsModels: join(root, "node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js"),
  sidebar: join(root, "node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js"),
  workspace: join(root, "node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js"),
};

test("rc.6 onboarding changes are pinned and applied by patch-package", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@deepseek-ai/dsh"], "0.1.0-rc.6");
  assert.equal(packageJson.devDependencies["patch-package"], "8.0.1");
  assert.equal(packageJson.scripts.postinstall, "patch-package");

  for (const name of [
    "runtime",
    "ui-conversation",
    "ui-sidebar",
    "ui-workspace",
    "ui-model-selection",
    "ui-permission-presets",
    "ui-settings-general",
    "ui-settings-models",
  ]) {
    await readFile(join(root, `patches/@deepseek-ai+dsh-client-${name}+0.1.0-rc.6.patch`), "utf8");
  }

  for (const name of [
    "dsh-host-apiproxy",
    "dsh-llm",
    "dsh-llm-deepseek",
    "dsh-llm-pi-ai",
  ]) {
    await readFile(join(root, `patches/@deepseek-ai+${name}+0.1.0-rc.6.patch`), "utf8");
  }
});

test("permission defaults live in General Settings instead of the Composer", async () => {
  const [conversation, permission] = await Promise.all([
    readFile(dependencySources.conversation, "utf8"),
    readFile(dependencySources.permission, "utf8"),
  ]);
  assert.match(permission, /ctx\.slots\.inject\("settings\.general\.item"/);
  assert.match(permission, /id: "permission",[\s\S]*?order: -20/);
  assert.match(permission, /"description": "选择新会话的默认权限模式"/);
  assert.doesNotMatch(permission, /command\.decorate\(\{[\s\S]*?name: "permission"/);
  assert.match(conversation, /const accessSelect = null;/);
  assert.doesNotMatch(conversation, /const permissions = useProjection\("permissions"\)/);
});

test("global New Task creates an application Task while Workspace create stays scoped", async () => {
  const [source, sidebar] = await Promise.all([
    readFile(dependencySources.runtime, "utf8"),
    readFile(dependencySources.sidebar, "utf8"),
  ]);
  assert.match(source, /async connectTask\(\)[\s\S]*?globalThis\.desktop\?\.createTaskScope[\s\S]*?sessions\.create\(\{ sessionId: scope\.sessionId, cwd: scope\.cwd \}\)/);
  assert.match(source, /const connect = workspaceId === void 0 \? this\.connectTask\(\) : this\.connectWorkspace\(workspaceId\)/);
  assert.match(source, /this\.connectTask\(\)\.then\(\(sessionId\) => \{[\s\S]*?this\.sessions\.open\(sessionId\)/);
  assert.match(source, /currentSummary\?\.blank === true && !belongsToWorkspace/);
  assert.match(sidebar, /"session\.new": "新任务"/);
  assert.match(sidebar, /"session\.new\.label": "新建任务"/);
  assert.match(sidebar, /"session\.new": "New Task"/);
  assert.match(sidebar, /"session\.new\.label": "New task"/);
});

test("atom panes persist an independent current Session selection", async () => {
  const [source, patch] = await Promise.all([
    readFile(dependencySources.runtime, "utf8"),
    readFile(
      join(root, "patches/@deepseek-ai+dsh-client-runtime+0.1.0-rc.6.patch"),
      "utf8",
    ),
  ]);
  for (const text of [source, patch]) {
    assert.match(text, /new URLSearchParams\(globalThis\.location\?\.search \?\? ""\)\.get\("dshAtomSession"\)/);
    assert.match(text, /`dsh\.sessions\.current:\$\{atomPaneSession\}`/);
    assert.match(text, /this\.selection\.set\(\{ sessionId: atomPaneSession \}\)/);
  }
});

test("composer supports a Task and routes a configuration block to Models", async () => {
  const [conversation, model, settings] = await Promise.all([
    readFile(dependencySources.conversation, "utf8"),
    readFile(dependencySources.model, "utf8"),
    readFile(dependencySources.settings, "utf8"),
  ]);
  assert.match(conversation, /const inert = sessionId === void 0;/);
  assert.match(conversation, /blockedTrigger = blocked\?\.onRequest !== void 0/);
  assert.match(conversation, /"aria-haspopup": workspaceTrigger \? "menu" : blockedTrigger \? "dialog"/);
  assert.match(conversation, /composerBlock\?\.onRequest !== void 0 \? \{/);
  assert.match(conversation, /hooks: \{ composerBlock: composerBlocks\.storeFor\(sessionId\) \}/);
  assert.doesNotMatch(conversation, /sessionId === void 0 \? ABSENT_BLOCK/);
  assert.match(model, /conversation\.blocks\.set\(void 0, needsConfiguration \? \{/);
  assert.match(model, /"ui-model-selection: root composer block"/);
  assert.match(conversation, /"hero\.chooseWorkspace": "工作区"/);
  assert.doesNotMatch(conversation, /"hero\.chooseWorkspace": "选择工作区"/);
  assert.match(settings, /openSection\(navigation\.sectionId\)/);
});

test("running Composer stops only while its draft is empty", async () => {
  const conversation = await readFile(dependencySources.conversation, "utf8");
  const expression = conversation.match(
    /const primaryStops = ([^;]+);/,
  )?.[1];
  assert.ok(expression);

  const primaryStops = Function(
    "running",
    "empty",
    "subagent",
    `return ${expression};`,
  );
  assert.equal(primaryStops(true, true, null), true);
  assert.equal(primaryStops(true, false, null), false);
  assert.equal(primaryStops(false, true, null), false);
  assert.equal(primaryStops(true, true, {}), false);

  assert.match(
    conversation,
    /const empty = draft\.trim\(\) === "" && attachments\.length === 0;/,
  );
  assert.match(
    conversation,
    /if \(primaryStops\) \{\s*stop\?\.\(\);\s*return;\s*\}/,
  );
  assert.match(
    conversation,
    /if \(!empty && !disabled && !machineBusy\) inputActions\.submit\(\);/,
  );
});

test("Add a model appears only when no routable or alternative model exists", async () => {
  const source = await readFile(dependencySources.model, "utf8");
  const match = source.match(/function needsModelConfiguration\(state, settings\) \{\s*(return [^;]+;)\s*\}/);
  assert.ok(match);
  const providerUsable = (row) => row.entry.active && (row.apiKeyEnv === undefined || row.credential?.configured === true);
  const needsModelConfiguration = Function("providerUsable", `return (state, settings) => { ${match[1]} }`)(providerUsable);
  const state = (overrides = {}) => ({
    status: "ready",
    routable: false,
    groups: [],
    failures: [],
    ...overrides,
  });

  const settings = (rows) => ({ status: "ready", rows });
  const missingKey = { entry: { active: true, provider: "deepseek-official" }, apiKeyEnv: "DEEPSEEK_API_KEY" };
  const configured = { ...missingKey, credential: { configured: true } };
  const otherProvider = { entry: { active: true, provider: "other" }, apiKeyEnv: undefined };
  assert.equal(needsModelConfiguration(state(), settings([missingKey])), true);
  assert.equal(needsModelConfiguration(state(), settings([configured])), false);
  assert.equal(needsModelConfiguration(state(), settings([missingKey, otherProvider])), false);
  assert.equal(needsModelConfiguration(state(), { status: "error", rows: [] }), false);
  assert.match(source, /needsConfiguration \? t\("trigger\.add"\) : !currentUsable \? t\("trigger\.fallback"\)/);
  assert.match(source, /const openModels = \(\) => ctx\.settingsNavigation\.openSection\("models"\)/);
  const settingsModels = await readFile(dependencySources.settingsModels, "utf8");
  assert.match(settingsModels, /ctx\.reflect\.provide\("modelsSettings", controller, void 0\)/);
});

test("configured model trigger opens from cached state without reloading the directory", async () => {
  const source = await readFile(dependencySources.model, "utf8");
  const show = source.match(/const show = \(\) => \{([\s\S]*?)\n\s*\};\n\s*const close/);
  assert.ok(show);
  assert.match(show[1], /setOpen\(true\)/);
  assert.doesNotMatch(show[1], /reload\(\)/);
  assert.match(source, /if \(available\) \{[\s\S]*?load\(\);[\s\S]*?loadConfiguration\(\);/);
});

test("Tasks are a flat top-level section only when they contain a durable session", async () => {
  const source = await readFile(dependencySources.workspace, "utf8");
  const patch = await readFile(
    join(root, "patches/@deepseek-ai+dsh-client-ui-workspace+0.1.0-rc.6.patch"),
    "utf8",
  );
  assert.match(source, /const TASKS_LABEL = "Tasks"/);
  for (const text of [source, patch]) {
    assert.match(text, /if \(stray\.some\(\(session\) => !session\.blank\)\) groups\.push/);
  }
  assert.match(source, /className: clsx\(WorkspaceBrowser_module_css_default\.sectionHeader, WorkspaceBrowser_module_css_default\.tasksSectionHeader\)[\s\S]*?className: WorkspaceBrowser_module_css_default\.sectionLabel,[\s\S]*?role: "heading",[\s\S]*?"aria-level": 2,[\s\S]*?children: t\("section\.tasks"\)/);
  assert.doesNotMatch(source, /className: Rows_module_css_default\.projectRow,[\s\S]{0,300}?children: t\("section\.tasks"\)/);
  assert.match(source, /tasksSectionCss = "\.qDHVXG_root:not\(\.qDHVXG_rail\) \.qDHVXG_tasksSectionHeader\{justify-content:flex-start;/);
  assert.match(source, /flat: group\.workspaceId === void 0/);
  assert.match(source, /onRename: onSessionRename,[\s\S]*?onFork: forkSession,[\s\S]*?onArchive: onSessionArchive/);
  assert.match(source, /group\.sessions\.length > COLLAPSED_SESSION_LIMIT/);
  assert.match(source, /sessions will appear under Tasks/);
});

test("Workspace search names both searchable top-level collections", async () => {
  const source = await readFile(dependencySources.workspace, "utf8");
  const patch = await readFile(
    join(root, "patches/@deepseek-ai+dsh-client-ui-workspace+0.1.0-rc.6.patch"),
    "utf8",
  );

  for (const text of [source, patch]) {
    assert.match(text, /"search\.sessions\.aria": "搜索工作区和任务"/);
    assert.match(text, /"search\.placeholder": "搜索工作区和任务"/);
    assert.match(text, /"search\.sessions\.aria": "Search workspaces and tasks"/);
    assert.match(text, /"search\.placeholder": "Search workspaces and tasks"/);
  }
});
