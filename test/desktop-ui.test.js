import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientPath = join(root, "plugins", "@jesse-lai", "dsh-desktop-ui", "lib", "client.js");
const iconTypesPath = join(
  root,
  "node_modules",
  "@deepseek-ai",
  "dsh-client-ui-primitives",
  "lib",
  "types",
  "icons",
  "index.d.ts",
);
const mainPath = join(root, "src", "main.js");
const preloadPath = join(root, "src", "preload.cjs");
const nativeGlassPath = join(root, "native", "macos-composer-glass.mm");
const syncIconsPath = join(root, "scripts", "sync-lucide-animated-icons.js");
const loadingPath = join(root, "src", "loading.html");

async function installTheme(
  platform,
  userAgent = "",
  {
    includeIcon = false,
    includeShell = false,
    includeSidebarSessions = false,
    composerOverlay = false,
    includeModal = false,
    includeAffordances = false,
  } = {},
) {
  const source = await readFile(clientPath, "utf8");
  let registration;
  let appendedStyle;
  let cleanup;
  let trafficLightSyncCount = 0;
  let composerSessionListener;
  let composerSessionRequestCount = 0;
  let mutationCallback;
  let mutationObserverConnected = false;
  let mutationObserverObserveCount = 0;
  let mutationObserverDisconnectCount = 0;
  let mutationObserverOptions;
  let mutationObserverObservedWriteCount = 0;
  const publishedComposerSessions = [];
  const modalOverlayUpdates = [];

  const createStore = (initial) => {
    let snapshot = initial;
    const listeners = new Set();
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(next) {
        snapshot = next;
        for (const listener of [...listeners]) listener();
      },
    };
  };
  const sessionsList = createStore({
    ids: ["session-a", "session-b"],
    current: "session-a",
  });
  const workspacesList = createStore({
    items: [{
      workspaceId: "workspace-a",
      sessionIds: ["session-a", "session-b"],
    }],
  });
  const sessions = {
    list: sessionsList,
    create({ sessionId }) {
      sessionsList.set({
        ...sessionsList.getSnapshot(),
        ids: [...sessionsList.getSnapshot().ids, sessionId],
      });
      return Promise.resolve(sessionId);
    },
    open(sessionId) {
      sessionsList.set({ ...sessionsList.getSnapshot(), current: sessionId });
    },
    clear() {
      sessionsList.set({ ...sessionsList.getSnapshot(), current: undefined });
    },
  };
  const workspaces = { list: workspacesList };

  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe(_target, options) {
      mutationObserverConnected = true;
      mutationObserverOptions = options;
      mutationObserverObserveCount += 1;
    }

    disconnect() {
      mutationObserverConnected = false;
      mutationObserverDisconnectCount += 1;
    }
  }

  const recordObservedMutation = (type, attributeName) => {
    if (!mutationObserverConnected) return;
    if (type === "childList" && mutationObserverOptions?.childList === true) {
      mutationObserverObservedWriteCount += 1;
      return;
    }
    if (
      type === "attributes" &&
      mutationObserverOptions?.attributes === true &&
      mutationObserverOptions.attributeFilter?.includes(attributeName)
    ) {
      mutationObserverObservedWriteCount += 1;
    }
  };

  class FakeHTMLElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.parentElement = null;
      this.parentNode = null;
      this.attributes = new Map();
      this.isConnected = false;
      const properties = new Map();
      this.style = {
        getPropertyPriority(name) {
          return properties.get(name)?.priority ?? "";
        },
        getPropertyValue(name) {
          return properties.get(name)?.value ?? "";
        },
        removeProperty(name) {
          properties.delete(name);
        },
        setProperty(name, value, priority = "") {
          properties.set(name, { value, priority });
        },
      };
    }

    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        child.parentNode = this;
        child.isConnected = this.isConnected;
        this.children.push(child);
      }
      if (children.length > 0) recordObservedMutation("childList");
    }

    replaceChildren(...children) {
      for (const child of this.children) {
        child.parentElement = null;
        child.parentNode = null;
        child.isConnected = false;
      }
      this.children = [];
      this.append(...children);
      if (children.length === 0) recordObservedMutation("childList");
    }

    remove() {
      if (this.parentElement === null) return;
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
      this.parentNode = null;
      this.isConnected = false;
      recordObservedMutation("childList");
    }

    get firstElementChild() {
      return this.children[0] ?? null;
    }

    get previousElementSibling() {
      if (this.parentElement === null) return null;
      const index = this.parentElement.children.indexOf(this);
      return index > 0 ? this.parentElement.children[index - 1] : null;
    }

    get childNodes() {
      return this.children;
    }

    getAttribute(attribute) {
      if (attribute.startsWith("data-")) {
        return this.dataset[dataAttributeKey(attribute)] ?? null;
      }
      return this.attributes.get(attribute) ?? null;
    }

    hasAttribute(attribute) {
      if (attribute.startsWith("data-")) {
        return Object.hasOwn(this.dataset, dataAttributeKey(attribute));
      }
      return this.attributes.has(attribute);
    }

    setAttribute(attribute, value) {
      if (attribute.startsWith("data-")) {
        this.dataset[dataAttributeKey(attribute)] = String(value);
        return;
      }
      this.attributes.set(attribute, String(value));
      recordObservedMutation("attributes", attribute);
    }

    matches(selector) {
      return selector === "button" && this.tagName === "BUTTON";
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
      const descendants = [];
      const visit = (node) => {
        for (const child of node.children) {
          if ((selector === "div" && child.tagName === "DIV") ||
              (selector === "button" && child.tagName === "BUTTON")) {
            descendants.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return descendants;
    }

    removeAttribute(attribute) {
      if (attribute.startsWith("data-")) {
        delete this.dataset[dataAttributeKey(attribute)];
        return;
      }
      this.attributes.delete(attribute);
      recordObservedMutation("attributes", attribute);
    }
  }

  class FakeSVGElement extends FakeHTMLElement {
    constructor(tagName = "svg", attributes = {}) {
      super(tagName);
      this.localName = tagName;
      this.attributes = new Map(Object.entries(attributes));
      this.classList = { add: (name) => this.attributes.set("class", name) };
      this.isConnected = false;
      this.replacedWith = null;
    }

    cloneNode() {
      const clone = new FakeSVGElement(this.localName, Object.fromEntries(this.attributes));
      clone.children = this.children.map((child) => child.cloneNode());
      return clone;
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    querySelectorAll(selector) {
      if (selector === "circle, ellipse, g, line, path, polygon, polyline, rect") {
        return this.children;
      }
      return [];
    }

    replaceWith(replacement) {
      this.isConnected = false;
      this.replacedWith = replacement;
      replacement.isConnected = true;
    }
  }

  const shellFixture = includeShell ? createShellFixture(FakeHTMLElement) : null;
  if (shellFixture !== null && includeSidebarSessions) {
    const pendingSession = new FakeHTMLElement();
    pendingSession.querySelector = () => null;
    const durableSession = new FakeHTMLElement();
    const durableTime = new FakeHTMLElement("span");
    durableSession.querySelector = (selector) =>
      selector === '[class*="_time"]' ? durableTime : null;
    shellFixture.region.append(pendingSession, durableSession);
    shellFixture.pendingSession = pendingSession;
    shellFixture.durableSession = durableSession;
  }
  const sourceIcon = includeIcon
    ? new FakeSVGElement("svg", { width: "16", height: "16", "aria-hidden": "true" })
    : null;
  if (sourceIcon !== null) {
    sourceIcon.append(
      new FakeSVGElement("rect", { x: "3", y: "3", width: "10", height: "10", rx: "3" }),
    );
    sourceIcon.isConnected = true;
  }
  const affordanceFixture = includeAffordances
    ? (() => {
        const connected = (tagName) => {
          const element = new FakeHTMLElement(tagName);
          element.isConnected = true;
          return element;
        };
        const expander = connected("span");
        expander.setAttribute("aria-expanded", "false");

        const settingsDetails = connected("details");
        const settingsSummary = connected("summary");
        settingsDetails.append(settingsSummary);

        const retryDetails = connected("details");
        const retrySummary = connected("summary");
        retryDetails.append(retrySummary);

        const collapseHost = connected("span");
        collapseHost.textContent = "⊞";
        const closeHost = connected("span");
        closeHost.textContent = "×";
        const historyHost = connected("button");
        historyHost.textContent = "…";

        const jsonButton = connected("button");
        const jsonText = {
          isConnected: true,
          nodeType: 3,
          nodeValue: "▸ JSON",
          parentNode: jsonButton,
        };
        Object.defineProperty(jsonButton, "childNodes", {
          get() {
            return [jsonText, ...jsonButton.children];
          },
        });
        return {
          expander,
          settingsDetails,
          settingsSummary,
          retryDetails,
          retrySummary,
          collapseHost,
          closeHost,
          historyHost,
          jsonButton,
          jsonText,
        };
      })()
    : null;
  const allFixtureElements = shellFixture === null ? [] : collectElements(shellFixture.shell);
  const modalDialog = includeModal ? new FakeHTMLElement() : null;
  const documentElement = { dataset: {} };
  const document = {
    body: {},
    documentElement,
    addEventListener() {},
    removeEventListener() {},
    head: {
      append(style) {
        appendedStyle = style;
      },
    },
    querySelector(selector) {
      if (selector === "[data-shell-overlay]") return shellFixture?.overlay ?? null;
      if (selector === '[role="dialog"][aria-modal="true"]') return modalDialog;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-composer-card]") return [];
      if (affordanceFixture !== null) {
        const affordanceSelectors = {
          "[data-json-expander]": [affordanceFixture.expander],
          'summary[class*="_customizedSummary"]': [affordanceFixture.settingsSummary],
          'summary[class*="_retrySummary"]': [affordanceFixture.retrySummary],
          'button[aria-pressed] > span[aria-hidden="true"][class*="_actionIcon"]': [
            affordanceFixture.collapseHost,
          ],
          'button[aria-label="Close details"] > span[aria-hidden="true"]': [
            affordanceFixture.closeHost,
          ],
          "button[data-earlier-history]": [affordanceFixture.historyHost],
          button: [affordanceFixture.jsonButton],
        };
        if (Object.hasOwn(affordanceSelectors, selector)) {
          return affordanceSelectors[selector];
        }
      }
      if (
        selector ===
        '[data-dsh-desktop-sidebar-region] [role="treeitem"][aria-selected]'
      ) {
        return shellFixture?.pendingSession === undefined
          ? []
          : [shellFixture.pendingSession, shellFixture.durableSession];
      }
      if (selector.startsWith("svg:not([data-lucide-animated-icon])")) {
        return sourceIcon?.isConnected ? [sourceIcon] : [];
      }
      const match = /^\[([^\]]+)\]$/.exec(selector);
      if (match !== null) {
        const key = dataAttributeKey(match[1]);
        return allFixtureElements.filter((element) => Object.hasOwn(element.dataset, key));
      }
      return [];
    },
    createElement(tagName) {
      if (tagName === "template") {
        const template = { content: { firstElementChild: null } };
        Object.defineProperty(template, "innerHTML", {
          set() {
            template.content.firstElementChild = new FakeSVGElement("svg");
          },
        });
        return template;
      }
      assert.equal(tagName, "style");
      return {
        dataset: {},
        textContent: "",
        removed: false,
        remove() {
          this.removed = true;
        },
      };
    },
    createElementNS(namespace, tagName) {
      assert.equal(namespace, "http://www.w3.org/2000/svg");
      return new FakeSVGElement(tagName);
    },
  };
  const sandbox = {
    window: {
      desktop: {
        composerOverlay,
        syncTrafficLightPosition() {
          trafficLightSyncCount += 1;
        },
        setModalOverlayVisible(visible, maskAlpha) {
          modalOverlayUpdates.push({ visible, maskAlpha });
        },
        publishComposerSessionContext(context) {
          publishedComposerSessions.push(context);
        },
        onComposerSessionContext(listener) {
          composerSessionListener = listener;
          return () => {
            if (composerSessionListener === listener) composerSessionListener = undefined;
          };
        },
        requestComposerSessionContext() {
          composerSessionRequestCount += 1;
        },
      },
      requestAnimationFrame(callback) {
        callback();
      },
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: {
        load(value) {
          registration = value;
        },
      },
    },
    document,
    navigator: { platform, userAgent },
    MutationObserver: FakeMutationObserver,
    HTMLElement: FakeHTMLElement,
    SVGElement: FakeSVGElement,
  };

  vm.runInNewContext(source, sandbox, { filename: clientPath });
  assert.equal(registration.id, "@jesse-lai/dsh-desktop-ui");
  const plugin = registration.factory();
  plugin.apply({
    sessions,
    workspaces,
    effect(callback) {
      cleanup = callback();
    },
  });

  return {
    appendedStyle,
    cleanup,
    documentElement,
    affordanceFixture,
    plugin,
    shellFixture,
    sourceIcon,
    trafficLightSyncCount,
    publishedComposerSessions,
    composerSessionRequestCount,
    modalOverlayUpdates,
    sessions,
    mutationObserverState() {
      return {
        connected: mutationObserverConnected,
        disconnectCount: mutationObserverDisconnectCount,
        observedWriteCount: mutationObserverObservedWriteCount,
        observeCount: mutationObserverObserveCount,
      };
    },
    resetMutationObserverWrites() {
      mutationObserverObservedWriteCount = 0;
    },
    flushMutations() {
      mutationCallback?.();
    },
    emitComposerSessionContext(context) {
      composerSessionListener?.(context);
    },
  };
}

test("generating progress exposes the milestone contract and human activity summaries", async () => {
  const { cleanup, plugin, appendedStyle } = await installTheme("MacIntel");

  assert.deepEqual(
    Array.from(plugin.progress.schema.kinds),
    ["progress_update", "activity_group", "retry", "blocker", "question", "approval"],
  );
  assert.equal(
    plugin.progress.summarizeActivity(
      { tools: ["read_file", "web_search", "grep"], running: true, errors: 0 },
      "zh",
    ),
    "正在检查 3 项",
  );
  assert.equal(
    plugin.progress.summarizeActivity(
      { tools: ["edit_file", "bash"], running: false, errors: 1 },
      "zh",
    ),
    "处理了 2 项操作，其中 1 项需要注意",
  );
  assert.equal(plugin.progress.toolFamily("cordis_research"), "delegate");
  assert.match(appendedStyle.textContent, /data-dsh-activity-summary/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-activity-head\]::before\s*\{[^}]*padding: 2px 8px 2px 22px/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-activity-disclosure\]\s*\{[^}]*left: 0/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-activity-row\]\[data-dsh-activity-expanded="true"\][^{]*\{[^}]*padding-left: 0/,
  );
  assert.match(appendedStyle.textContent, /data-dsh-retry-active/);
  assert.match(appendedStyle.textContent, /data-dsh-blocker/);

  const blockerRule = appendedStyle.textContent.match(/\[data-dsh-blocker\]\s*\{([^}]*)\}/)?.[1];
  assert.ok(blockerRule);
  assert.match(blockerRule, /grid-template-columns: 16px minmax\(0, 1fr\)/);
  assert.match(blockerRule, /gap: 12px/);
  assert.match(blockerRule, /padding: 8px 8px 8px 12px/);
  assert.match(blockerRule, /border: 1px solid/);
  assert.match(blockerRule, /border-radius: 12px/);
  assert.doesNotMatch(blockerRule, /border-left/);

  cleanup();
});

test("desktop decoration observer cannot react to its own DOM writes", async () => {
  const theme = await installTheme("MacIntel", "", { includeAffordances: true });

  assert.deepEqual(theme.mutationObserverState(), {
    connected: true,
    disconnectCount: 0,
    observedWriteCount: 0,
    observeCount: 1,
  });

  theme.affordanceFixture.expander.setAttribute("aria-expanded", "true");
  theme.resetMutationObserverWrites();
  theme.flushMutations();
  assert.deepEqual(theme.mutationObserverState(), {
    connected: true,
    disconnectCount: 1,
    observedWriteCount: 0,
    observeCount: 2,
  });

  theme.cleanup();
});

test("Todo dock stays compact when collapsed and expanded", async () => {
  const source = await readFile(clientPath, "utf8");

  assert.match(
    source,
    /\[data-testid="todo-panel"\]:has\(> div > button\[aria-expanded="false"\]\)\s*\{[^}]*width: fit-content !important;[^}]*border-radius: 999px/,
  );
  assert.match(
    source,
    /\[data-testid="todo-panel"\][\s\S]*?max-width: min\(480px,/,
  );
  assert.match(
    source,
    /button\[aria-expanded="true"\][\s\S]*?> div > ul\s*\{[^}]*gap: 4px;[^}]*max-height: 144px/,
  );
});

function dataAttributeKey(attribute) {
  return attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function collectElements(root) {
  return [root, ...root.querySelectorAll("div"), ...root.querySelectorAll("button")];
}

function createShellFixture(HTMLElementClass) {
  const element = (tagName = "div") => new HTMLElementClass(tagName);
  const shell = element();
  const sidebarColumn = element();
  const sidebarSlotWrapper = element();
  const sidebarRoot = element();
  const logo = element();
  logo.append(element("button"), element("button"));
  const newSession = element("button");
  const region = element();
  const foot = element();
  sidebarRoot.append(logo, newSession, region, foot);
  sidebarSlotWrapper.append(sidebarRoot);
  sidebarColumn.append(sidebarSlotWrapper);
  const center = element();
  const details = element();
  const overlay = element();
  shell.append(sidebarColumn, center, details, overlay);
  return { shell, sidebarColumn, sidebarSlotWrapper, sidebarRoot, logo, newSession, region, foot, center, details, overlay };
}

test("desktop UI installs the Jesse composer treatment without replacing Harness markup", async () => {
  const { appendedStyle, cleanup, documentElement } = await installTheme("MacIntel");
  const source = await readFile(clientPath, "utf8");

  assert.equal(documentElement.dataset.dshDesktopUi, "jesse-composer");
  assert.equal(documentElement.dataset.dshDesktopPlatform, "macos");
  assert.doesNotMatch(appendedStyle.textContent, /backdrop-filter: blur\(/);
  assert.doesNotMatch(appendedStyle.textContent, /saturate\(/);
  assert.match(appendedStyle.textContent, /--dsh-desktop-composer-width: 654px/);
  assert.match(
    appendedStyle.textContent,
    /\[class\*="_previewBadge"\]\s*\{\s*display: none !important;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-hero-workspace-row\][^{]*\{[^}]*width: min\(var\(--dsh-desktop-composer-width\), 100%\)[^}]*align-self: center[^}]*padding-left: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-composer-seat\] \[class\*="_heroWorkspaceRow"\]/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-hero-workspace-row\] button\[aria-haspopup="menu"\][\s\S]*?data-lucide-animated-icon="chevron-down"[\s\S]*?display: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-composer-card\] \[class\*="_chevron"\][^{]*\{[^}]*display: none !important/,
  );
  assert.match(appendedStyle.textContent, /@container dsh-desktop-composer \(max-width: 520px\)/);
  assert.match(appendedStyle.textContent, /corner-shape: squircle/);
  assert.match(appendedStyle.textContent, /padding: 8px 8px 8px 24px !important/);
  assert.match(appendedStyle.textContent, /border: 0 !important/);
  assert.match(
    appendedStyle.textContent,
    /1\.25px 0 0 -0\.75px var\(--dsh-desktop-composer-stroke\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /0 0 0 0\.5px var\(--dsh-desktop-composer-stroke\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /-1\.25px 0 0 -0\.75px var\(--dsh-desktop-composer-stroke\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /0 0 var\(--dsh-desktop-composer-shadow-blur\) 0\s*var\(--dsh-desktop-composer-shadow\)/,
  );
  assert.match(appendedStyle.textContent, /--dsh-desktop-composer-shadow: rgb\(63 156 255 \/ 30%\)/);
  assert.match(appendedStyle.textContent, /--dsh-desktop-composer-shadow-blur: 48px/);
  assert.match(
    appendedStyle.textContent,
    /data-phase="active"\] \[data-composer-card\][^{]*\{[^}]*--dsh-desktop-composer-shadow: rgb\(159 159 159 \/ 30%\);[^}]*--dsh-desktop-composer-shadow-blur: 24px/,
  );
  assert.doesNotMatch(appendedStyle.textContent, /drop-shadow\(8px 8px 54px/);
  assert.doesNotMatch(appendedStyle.textContent, /0 18px 54px/);
  assert.doesNotMatch(appendedStyle.textContent, /linear-gradient\(180deg, rgb\(255 255 255 \/ 46%\)/);
  assert.doesNotMatch(appendedStyle.textContent, /linear-gradient\(rgb\(255 255 255 \/ 30%\)/);
  assert.doesNotMatch(appendedStyle.textContent, /rgb\(63 156 255 \/ 9%\)/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\]\[data-dsh-composer-foreground\] \[data-composer-card\][^{]*\{[^}]*background: transparent !important[^}]*box-shadow: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\]\[data-dsh-composer-foreground\][\s\S]*?\[data-composer-card\]::before\s*\{[^}]*inset: 0;[^}]*border-radius: 48px;[^}]*corner-shape: squircle;[^}]*box-shadow:\s*0 0 var\(--dsh-desktop-composer-shadow-blur\) 0\s*var\(--dsh-desktop-composer-shadow\)/,
  );
  assert.match(appendedStyle.textContent, /data-dsh-composer-primary/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-modes\] button,[\s\S]*?data-dsh-composer-modes\] select[^{]*\{[^}]*background-color: transparent !important/,
  );
  assert.match(source, /setAttribute\("placeholder", "Do Anything"\)/);
  assert.match(source, /child\.dataset\.dshHeroWorkspaceRow = ""/);
  assert.match(source, /semanticRow\.dataset\.dshHeroWorkspaceRow = ""/);
  assert.doesNotMatch(source, /nativeSurfacePieceNames/);
  assert.doesNotMatch(source, /radial-gradient\(circle at/);
  assert.match(source, /"data-dsh-hero-workspace-row"/);
  assert.match(source, /data-lucide-animated-icon/);
  assert.match(source, /github\.com\/pqoqubbw\/icons/);
  assert.doesNotMatch(source, /source\.replaceWith\(/);
  assert.match(source, /source\.append\(libraryIcon\)/);
  assert.match(appendedStyle.textContent, /data-dsh-desktop-sidebar-region/);
  assert.match(appendedStyle.textContent, /data-dsh-desktop-center/);
  assert.match(
    appendedStyle.textContent,
    /data-conversation-scroll\][^{]*\{[^}]*scroll-behavior: auto/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-conversation-scroll\]\[data-dsh-composer-fixed-host\]::after[^{]*\{[^}]*flex: 0 0 var\(--dsh-desktop-composer-reserve[^}]*height: var\(--dsh-desktop-composer-reserve/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-phase="active"\] > \[data-conversation-scroll\][\s\S]*?> \[data-composer-seat\]\[data-dsh-composer-fixed\][^{]*\{[^}]*position: fixed !important;[^}]*var\(--dsh-desktop-composer-bottom[^}]*var\(--dsh-desktop-composer-left[^}]*width: var\(--dsh-desktop-composer-seat-width/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-composer-seat\]\[data-dsh-composer-fixed\][^{]*\{[^}]*border-radius: 0 0 0 var\(--dsh-desktop-panel-radius\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-details-collapsed\][\s\S]*?data-composer-seat\]\[data-dsh-composer-fixed\][^{]*\{[^}]*border-bottom-right-radius: var\(--dsh-desktop-panel-radius\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-composer-seat\]\[data-dsh-composer-fixed\][^{]*\{[^}]*border-radius: 0;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-scroll-button\][^{]*\{[^}]*width: 36px !important;[^}]*height: 36px !important;[^}]*border-radius: 50% !important;[^}]*corner-shape: round/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-scroll-button\][^{]*\{[^}]*position: fixed !important;[^}]*inset: var\(--dsh-desktop-scroll-top, 0px\) auto auto\s*var\(--dsh-desktop-scroll-left, 0px\) !important;[^}]*translate: none !important;[^}]*transform: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\] \[data-dsh-scroll-button\][^{]*\{[^}]*color: transparent !important[^}]*background: transparent !important[^}]*box-shadow: none !important/,
  );
  assert.match(
    source,
    /const left = cardRect\.left \+ cardRect\.width \/ 2 - 18;[\s\S]*const top = cardRect\.top - 36 - 12;/,
  );
  assert.doesNotMatch(source, /previousOffset|dshScrollButtonOffsetX/);
  assert.match(source, /for \(const flow of scrollport\.querySelectorAll\("\[data-chat-flow\]"\)\)/);
  assert.match(source, /slot\.querySelector\(":scope > button"\)/);
  assert.doesNotMatch(source, /const marked = document\.querySelector\("\[data-dsh-scroll-button\]"\)/);
  assert.match(source, /syncFixedComposerLayout\(\);[\s\S]*markScrollButton\(\);/);
  assert.match(source, /checkVisibility\(\{ checkOpacity: true, checkVisibilityCSS: true \}\)/);
  assert.doesNotMatch(
    appendedStyle.textContent,
    /data-conversation-scroll\][^{]*\{[^}]*scroll-behavior: smooth/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-center\][^{]*\{[^}]*margin-left: 0/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-new\][^{]*\{[^}]*height: 36px !important[^}]*border-radius: 12px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\][^{]*\{[^}]*width: 36px !important;[^}]*height: 36px !important;[^}]*margin: 0 0 12px !important;[^}]*padding: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\] svg[^{]*\{[^}]*width: 18px !important;[^}]*height: 18px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar\][^{]*\{[^}]*padding: 0 10px 6px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-logo\][^{]*\{[^}]*height: 84px !important;[^}]*margin: 0 !important;[^}]*padding: 32px 0 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-logo\] button:last-child > svg:first-of-type[^{]*\{[^}]*display: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-logo\] button:last-child > svg:last-of-type[^{]*\{[^}]*display: inline !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\] \[data-dsh-desktop-sidebar-new\][^{]*\{[^}]*color: transparent !important[^}]*background: transparent !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\][\s\S]*?data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\]:hover[^{]*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /--dsh-desktop-sidebar-content-inset: 14px/,
  );
  assert.match(appendedStyle.textContent, /--dsh-sidebar-inline-padding: 14px !important/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-logo\][^{]*\{[^}]*padding: 32px 14px 0 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-new\][^{]*\{[^}]*margin: 0 14px 12px 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-foot\][^{]*\{[^}]*padding-right: 14px/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\][^{]*\{[^}]*box-sizing: border-box;[^}]*width: calc\(100% \+ 8px\) !important;[^}]*margin: 4px 0 0 -8px !important;[^}]*padding-inline: 0 10px !important;[^}]*border-left: 8px solid transparent !important;[^}]*border-radius: 24px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\][^{]*\{[^}]*width: 36px !important;[^}]*height: 36px !important;[^}]*padding: 0 !important;[^}]*border-left: 0 !important;[^}]*border-radius: 50% !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\]:hover[^{]*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /padding: 0 0 8px var\(--dsh-desktop-sidebar-content-inset\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\][^{]*\{[^}]*margin: 0 0 0 -12px !important;[^}]*padding: 0 0 0 12px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\] \[role="treeitem"\],[\s\S]*?class\*="_projectRow"\],[\s\S]*?class\*="_sessionRow"\][^{]*\{[^}]*border-radius: 24px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\] \[class\*="_projectRow"\],[\s\S]*?data-dsh-desktop-sidebar-region\] \[class\*="_sessionRow"\][^{]*\{[^}]*box-sizing: border-box;[^}]*width: calc\(100% \+ 8px\);[^}]*margin-left: -8px;[^}]*border-left: 8px solid transparent/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\] \[role="treeitem"\]\[aria-expanded\][^{]*\{[^}]*padding-left: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_groupSection"\][\s\S]*?role="treeitem"\]\[aria-selected\] > \[class\*="_title"\][^{]*\{[^}]*margin-left: -2px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_groupSection"\] > \[class\*="_sessionOverflowButton"\][^{]*\{[^}]*padding-left: 22px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-logo\] button > svg\[viewBox="0 0 182 24"\][^{]*\{[^}]*margin-right: -27px[^}]*transform: translateX\(-27px\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /padding: 0 var\(--dsh-desktop-shell-gap\) 0 0/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-shell\]\[data-sidebar-collapsed\][^{]*\{[^}]*padding-right: 0;[^}]*background: var\(--dsw-alias-bg-base\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\] \[data-dsh-desktop-center\],[\s\S]*?data-sidebar-collapsed\] \[data-dsh-desktop-details\][^{]*\{[^}]*margin-block: 0;[^}]*border-radius: 0/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-shell\][^{]*\{[^}]*transition:[^}]*grid-template-columns[^}]*padding[^}]*background-color/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\][\s\S]*?data-dsh-desktop-shell\]\[data-sidebar-collapsed\][^{]*\{[^}]*background: transparent !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-native-glass\][\s\S]*?data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-column\][^{]*\{[^}]*background: var\(--dsw-alias-bg-base\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\] > \*::after[^{]*\{[^}]*background: transparent !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\] \[class\*="_treeBody"\] > \[class\*="_fade"\][^{]*\{[^}]*background: transparent !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\][\s\S]*?\[class\*="_treeBody"\] > \[role="tree"\][^{]*\{[^}]*margin-left: -12px !important;[^}]*padding-left: 12px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /role="treeitem"\]\[aria-expanded\] > :first-child[^{]*\{[^}]*display: inline-flex !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /role="treeitem"\]\[aria-expanded\] > :nth-child\(2\)[^{]*\{[^}]*display: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /role="treeitem"\]\[aria-selected\]\[data-dsh-pending-session\][^{]*\{[^}]*display: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /role="treeitem"\]\:hover,[\s\S]*?role="treeitem"\]\[aria-selected="true"\][^{]*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\) !important/,
  );
  assert.match(
    source,
    /function markPendingSidebarSessions\(\)[\s\S]*class\*="_time"[\s\S]*class\*="_rowActions"[\s\S]*row\.dataset\.dshPendingSession = ""/,
  );
  assert.match(source, /delete row\.dataset\.dshPendingSession/);
  assert.doesNotMatch(appendedStyle.textContent, /radial-gradient\(ellipse 112% 152%/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-platform="macos"[^}]*\[data-dsh-desktop-shell\]::before[^{]*\{[^}]*height: 44px;[^}]*app-region: drag;[^}]*-webkit-app-region: drag/,
  );

  cleanup();
  assert.equal(appendedStyle.removed, true);
  assert.equal(documentElement.dataset.dshDesktopUi, undefined);
  assert.equal(documentElement.dataset.dshDesktopPlatform, undefined);
});

test("modal mask covers native glass without moving, hiding, or replacing buttons", async () => {
  const fixture = await installTheme("MacIntel", "", { includeModal: true });
  const mainSource = await readFile(mainPath, "utf8");
  const nativeSource = await readFile(nativeGlassPath, "utf8");
  const preloadSource = await readFile(preloadPath, "utf8");

  assert.equal(fixture.documentElement.dataset.dshModalOverlay, "");
  assert.deepEqual(
    JSON.parse(JSON.stringify(fixture.modalOverlayUpdates)),
    [{ visible: true, maskAlpha: 0.24 }],
  );
  assert.match(
    fixture.appendedStyle.textContent,
    /role="presentation"\]:has\(> \[role="dialog"\]\[aria-modal="true"\]\)[\s\S]*?> \[aria-hidden="true"\][^{]*\{[^}]*-webkit-backdrop-filter: none !important;[^}]*backdrop-filter: none !important;/,
  );
  assert.match(
    fixture.appendedStyle.textContent,
    /role="presentation"\]:has\(> \[role="dialog"\]\[aria-modal="true"\]\)[^{]*\{[^}]*position: fixed !important;[^}]*inset: 0 !important;[^}]*z-index: 2147483000 !important;/,
  );
  assert.doesNotMatch(
    fixture.appendedStyle.textContent,
    /data-dsh-native-glass\]\[data-dsh-modal-overlay\][\s\S]*?data-dsh-desktop-sidebar-new/,
  );
  assert.match(
    preloadSource,
    /desktop\.setModalOverlayVisible = \(visible, maskAlpha\)[\s\S]*?desktop:modal-overlay-visible/,
  );
  assert.match(nativeSource, /addSubview:glass positioned:NSWindowAbove relativeTo:relativeView/);
  assert.match(nativeSource, /DSHModalMaskState/);
  assert.match(nativeSource, /setModalMask/);
  const nativeModalSource = nativeSource.slice(
    nativeSource.indexOf("napi_value SetModalMask"),
    nativeSource.indexOf("napi_value RemoveComposerGlassPanel"),
  );
  assert.doesNotMatch(nativeModalSource, /sidebarGlass\.hidden|scrollGlass\.hidden/);
  assert.match(
    nativeSource,
    /state\.visible = visible && state\.alpha > 0\.0;[\s\S]*?sidebarGlass\.modalMaskView = UpdateModalMaskView[\s\S]*?scrollGlass\.modalMaskView = UpdateModalMaskView/,
  );
  assert.match(
    nativeSource,
    /maskView\.layer\.backgroundColor =[\s\S]*?colorWithWhite:0\.0 alpha:state\.alpha/,
  );
  assert.doesNotMatch(nativeSource, /glass\.hidden = glass\.baseHidden \|\| ModalMaskState/);
  const setModalSource = mainSource.slice(
    mainSource.indexOf("function setModalOverlayVisible"),
    mainSource.indexOf("function removeComposerGlassPanel"),
  );
  assert.doesNotMatch(
    setModalSource,
    /removeSidebarButtonGlass|removeScrollButtonGlass/,
  );
  assert.match(
    mainSource,
    /!modalOverlayStateKnown \|\|[\s\S]*?modalOverlayVisible \|\|[\s\S]*?frame === undefined/,
  );
  assert.match(
    mainSource,
    /const stateWasKnown = modalOverlayStateKnown;[\s\S]*?modalOverlayStateKnown = true;/,
  );
  assert.match(
    mainSource,
    /"did-start-navigation"[\s\S]*?modalOverlayStateKnown = false;[\s\S]*?updateComposerLayers\(\);/,
  );
  assert.match(
    mainSource,
    /function setModalOverlayVisible\(visible, maskAlpha = 0\)[\s\S]*?composerForegroundWindow\?\.hide\(\);[\s\S]*?removeComposerGlassPanel\(\);/,
  );
  assert.match(mainSource, /composerGlass\.setModalMask/);
  assert.match(mainSource, /ipcMain\.on\("desktop:modal-overlay-visible"/);

  fixture.cleanup();
  assert.deepEqual(
    JSON.parse(JSON.stringify(fixture.modalOverlayUpdates)),
    [
      { visible: true, maskAlpha: 0.24 },
      { visible: false, maskAlpha: 0 },
    ],
  );
  assert.equal(fixture.documentElement.dataset.dshModalOverlay, undefined);
});

test("Windows keeps the Jesse composer geometry while disabling glass", async () => {
  const { appendedStyle, cleanup, documentElement } = await installTheme("Win32");

  assert.equal(documentElement.dataset.dshDesktopPlatform, "windows");
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-platform="windows"\] \[data-composer-card\][\s\S]*?backdrop-filter: none/,
  );
  assert.match(appendedStyle.textContent, /--dsh-desktop-card-radius: 36px/);
  assert.match(
    appendedStyle.textContent,
    /data-composer-card\][^{]*\{[^}]*min-height: 84px[^}]*corner-shape: squircle/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-composer-card\]::after[^{]*\{[^}]*display: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-input\][^{]*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 16/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-command\],[\s\S]*?data-dsh-composer-trailing\][^{]*\{[^}]*grid-row: 17;[^}]*min-height: 32px/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-command\] button,[\s\S]*?button\[data-dsh-composer-command\][^{]*\{[^}]*width: 32px !important;[^}]*height: 32px !important;[^}]*transform: translateX\(-7px\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-lucide-animated-icon="plus"\][^{]*\{[^}]*transform: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-modes\] button,[\s\S]*?data-dsh-composer-modes\] select[^{]*\{[^}]*height: 32px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-trailing\] button\[data-dsh-composer-menu-trigger="model"\],[\s\S]*?height: 32px !important;[^}]*padding-inline: 12px !important;[^}]*font-size: 14px !important;[^}]*font-weight: 400 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /button\[data-dsh-composer-menu-trigger="model"\] :is\(span, strong\)[^{]*\{[^}]*color: inherit !important;[^}]*font-size: inherit !important;[^}]*font-weight: inherit !important;[^}]*opacity: 1 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /button\[data-dsh-composer-menu-trigger="model"\]:hover:not\(:disabled\)[\s\S]*?background-color: var\(--dsw-alias-interactive-bg-hover\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /0 0 var\(--dsh-desktop-composer-shadow-blur\) 0\s*var\(--dsh-desktop-composer-shadow\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-composer-card\] textarea::placeholder[^{]*\{[^}]*--dsh-desktop-placeholder/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-primary\][^{]*\{[^}]*width: 32px !important;[^}]*height: 32px !important;[^}]*border-radius: 999px !important;[^}]*corner-shape: round/,
  );
  assert.match(
    appendedStyle.textContent,
    /html:not\(\[data-dsh-desktop-platform="macos"\]\) \[data-dsh-desktop-shell\][\s\S]*?backdrop-filter: none/,
  );

  cleanup();
});

test("foreground Renderer keeps the Composer, hero controls, and DeepSeek menus stable", async () => {
  const main = await installTheme("MacIntel");
  assert.equal(main.documentElement.dataset.dshComposerOverlay, undefined);
  assert.equal(main.documentElement.dataset.dshNativeComposerMenus, undefined);
  main.cleanup();

  const { appendedStyle, cleanup, documentElement } = await installTheme(
    "MacIntel",
    "",
    { composerOverlay: true },
  );
  const clientSource = await readFile(clientPath, "utf8");

  assert.equal(documentElement.dataset.dshComposerOverlay, "");
  assert.equal(documentElement.dataset.dshNativeComposerMenus, undefined);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-overlay\] \[data-composer-card\][^{]*\{[^}]*border-radius: var\(--dsh-desktop-card-radius\) !important[^}]*background: transparent !important[^}]*box-shadow: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-overlay\]\[data-dsh-composer-overlay-has-layout\][\s\S]*?\[data-composer-card\][^{]*\{[^}]*position: fixed !important;[^}]*dsh-composer-overlay-card-bottom[^}]*dsh-composer-overlay-card-left[^}]*dsh-composer-overlay-card-width/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-overlay\]\[data-dsh-composer-overlay-has-layout\][\s\S]*?\[data-dsh-hero-workspace-row\][^{]*\{[^}]*position: fixed !important;[^}]*dsh-composer-overlay-hero-top[^}]*dsh-composer-overlay-hero-left[^}]*dsh-composer-overlay-hero-width/,
  );
  assert.match(
    appendedStyle.textContent,
    /\[role="menu"\],[\s\S]*?\[role="listbox"\],[\s\S]*?\[role="tooltip"\]/,
  );
  assert.match(
    appendedStyle.textContent,
    /html\[data-dsh-composer-overlay\][\s\S]*?:is\(\[role="menu"\], \[role="listbox"\]\)[^{]*\{[^}]*z-index: 2147482999 !important;[^}]*isolation: isolate/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /data-dsh-web-composer-menu/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-overlay\] \[data-dsh-composer-mirror-dialog\][\s\S]*?visibility: hidden !important;[\s\S]*?pointer-events: none !important;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-overlay\][\s\S]*?\[data-dsh-composer-mirror-dialog-host\][^{]*\{[^}]*display: none !important;[^}]*pointer-events: none !important;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-overlay\] \[data-dsh-composer-owned-dialog-host\][\s\S]*?visibility: visible !important/,
  );
  assert.match(
    clientSource,
    /const captureAll = \[\.\.\.document\.querySelectorAll\([\s\S]*?\[role="menu"\][\s\S]*?\[role="listbox"\][\s\S]*?\[role="dialog"\]/,
  );
  assert.match(
    clientSource,
    /setComposerOverlayInteraction\?\.\(interaction\)/,
  );
  assert.match(clientSource, /markComposerOverlayDialogs/);
  assert.match(clientSource, /data-dsh-composer-owned-dialog/);
  assert.match(
    clientSource,
    /hasMirrorDialog[\s\S]*?root\.removeAttribute\("inert"\)/,
  );
  assert.match(clientSource, /"inert",[\s\S]*?"open"/);

  cleanup();
  assert.equal(documentElement.dataset.dshComposerOverlay, undefined);
});

test("composer dropdowns preserve DeepSeek content without an AppKit popup bridge", async () => {
  const [clientSource, mainSource, preloadSource] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(mainPath, "utf8"),
    readFile(preloadPath, "utf8"),
  ]);

  for (const kind of ["workspace", "preset", "permission", "model"]) {
    assert.match(clientSource, new RegExp(`dshComposerMenuTrigger = "${kind}"`));
  }
  assert.doesNotMatch(clientSource, /installNativeComposerMenus|showNativeMenu/);
  assert.doesNotMatch(preloadSource, /nativeMenuCapabilities|desktop:show-native-menu/);
  assert.doesNotMatch(mainSource, /showNativeMenu|desktop:show-native-menu|nativeMenuTemplate/);
  assert.doesNotMatch(clientSource, /installWebComposerMenuBridge|requestComposerWebMenu/);
  assert.doesNotMatch(preloadSource, /desktop:composer-web-menu/);
  assert.doesNotMatch(mainSource, /desktop:composer-web-menu|composerWebMenuVisible/);
  assert.match(preloadSource, /desktop:composer-overlay-interaction/);
  assert.match(mainSource, /ipcMain\.on\("desktop:composer-overlay-interaction"/);
  assert.match(
    clientSource,
    /const regions = \[cardRegion, heroRegion\]\.filter\(Boolean\)/,
  );
  assert.match(
    mainSource,
    /composerForegroundWindow\.setBounds\(contentBounds\)/,
  );
  assert.match(mainSource, /composerOverlayInteraction\.card \?\? frame/);
  assert.match(
    mainSource,
    /const cardChanged = !composerFramesEqual[\s\S]*?if \(cardChanged\) updateComposerLayers\(\)/,
  );
  assert.match(mainSource, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(mainSource, /setIgnoreMouseEvents\(false\)/);
});

test("foreground Composer follows the main Renderer session before it can submit", async () => {
  const main = await installTheme("MacIntel");
  assert.deepEqual(JSON.parse(JSON.stringify(main.publishedComposerSessions)), [{
    sessionId: "session-a",
    workspaceId: "workspace-a",
  }]);

  main.sessions.open("session-b");
  assert.deepEqual(JSON.parse(JSON.stringify(main.publishedComposerSessions.at(-1))), {
    sessionId: "session-b",
    workspaceId: "workspace-a",
  });
  main.cleanup();

  const overlay = await installTheme("MacIntel", "", { composerOverlay: true });
  assert.equal(overlay.composerSessionRequestCount, 1);
  assert.equal(overlay.documentElement.dataset.dshComposerSessionPending, "");
  overlay.emitComposerSessionContext({
    sessionId: "session-b",
    workspaceId: "workspace-a",
    revision: 7,
  });
  assert.equal(overlay.sessions.list.getSnapshot().current, "session-b");
  assert.equal(overlay.documentElement.dataset.dshComposerSessionPending, undefined);
  assert.equal(overlay.documentElement.dataset.dshComposerSessionRevision, "7");

  overlay.emitComposerSessionContext({
    sessionId: "session-a",
    workspaceId: "workspace-a",
    revision: 6,
  });
  assert.equal(overlay.sessions.list.getSnapshot().current, "session-b");

  overlay.emitComposerSessionContext({
    sessionId: "session-c",
    workspaceId: "workspace-a",
    revision: 8,
  });
  await Promise.resolve();
  assert.equal(overlay.sessions.list.getSnapshot().current, "session-c");
  assert.equal(overlay.documentElement.dataset.dshComposerSessionPending, undefined);
  overlay.cleanup();
});

test("Composer preload marks the action under an inactive-window pointer", async () => {
  const source = await readFile(preloadPath, "utf8");
  const ipcListeners = new Map();
  const attributes = new Set();
  const composerCard = {};
  let disabled = false;

  class HoverTarget {
    closest(selector) {
      return selector === "[data-composer-card]" ? composerCard : null;
    }

    matches(selector) {
      return selector === ":disabled" && disabled;
    }

    setAttribute(name) {
      attributes.add(name);
    }

    removeAttribute(name) {
      attributes.delete(name);
    }
  }

  const target = new HoverTarget();
  const hit = {
    closest(selector) {
      return selector.includes("[data-dsh-composer-command]") ? target : null;
    },
  };
  const ipcRenderer = {
    invoke() {},
    on(channel, listener) {
      ipcListeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      if (ipcListeners.get(channel) === listener) ipcListeners.delete(channel);
    },
    send() {},
  };

  vm.runInNewContext(source, {
    HTMLElement: HoverTarget,
    document: {
      elementFromPoint(x, y) {
        assert.deepEqual([x, y], [24, 18]);
        return hit;
      },
    },
    process: {
      argv: ["electron", ".", "--dsh-composer-overlay"],
      platform: "darwin",
    },
    require(specifier) {
      assert.equal(specifier, "electron");
      return {
        contextBridge: { exposeInMainWorld() {} },
        ipcRenderer,
      };
    },
    window: { addEventListener() {} },
  }, { filename: preloadPath });

  const hover = ipcListeners.get("desktop:composer-hover-point");
  assert.equal(typeof hover, "function");
  hover({}, { x: 24, y: 18 });
  assert.equal(attributes.has("data-dsh-forwarded-hover"), true);
  hover({}, null);
  assert.equal(attributes.has("data-dsh-forwarded-hover"), false);

  disabled = true;
  hover({}, { x: 24, y: 18 });
  assert.equal(attributes.has("data-dsh-forwarded-hover"), false);
});

test("macOS keeps one 36px glass panel between the app and Composer", async () => {
  const [source, nativeSource, preloadSource, clientSource] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(nativeGlassPath, "utf8"),
    readFile(preloadPath, "utf8"),
    readFile(clientPath, "utf8"),
  ]);

  assert.match(source, /const isMacOS = process\.platform === "darwin"/);
  assert.match(source, /titleBarStyle: "hiddenInset"/);
  assert.match(source, /macOSTrafficLightPosition = \{ x: 14, y: 14 \}/);
  assert.match(source, /trafficLightPosition: macOSTrafficLightPosition/);
  assert.match(
    source,
    /webContents\.on\("did-finish-load", syncTrafficLightPosition\)/,
  );
  assert.match(
    source,
    /setWindowButtonPosition\(macOSTrafficLightPosition\)/,
  );
  assert.match(source, /composerGlass\?\.setTrafficLightPosition/);
  assert.match(source, /getMacOSTrafficLightMetrics/);
  assert.match(source, /assertMacOSTrafficLightPosition\("Composer"/);
  assert.match(nativeSource, /ApplyTrafficLightPosition/);
  assert.match(nativeSource, /NSViewFrameDidChangeNotification/);
  assert.match(nativeSource, /NSWindowDidUpdateNotification/);
  assert.match(nativeSource, /TrafficLightPositionMatches/);
  assert.match(nativeSource, /getTrafficLightMetrics/);
  assert.match(nativeSource, /kTrafficLightCenterSpacing = 23\.0/);
  assert.match(preloadSource, /syncTrafficLightPosition:[\s\S]*desktop:sync-traffic-lights/);
  assert.match(preloadSource, /desktop:composer-session-publish/);
  assert.match(preloadSource, /desktop:composer-session-context/);
  assert.match(source, /ipcMain\.on\("desktop:sync-traffic-lights"/);
  assert.match(source, /roundedCorners: true/);
  assert.match(source, /vibrancy: "under-window"/);
  assert.match(source, /visualEffectState: "active"/);
  assert.match(source, /backgroundColor: isMacOS \? "#00000000" : "#eef2f6"/);
  assert.match(source, /svg\[data-lucide-animated-icon\]/);
  assert.match(source, /heroComposerAlignment\.rowLeft - heroComposerAlignment\.cardLeft/);
  assert.doesNotMatch(nativeSource, /kComposerCornerRadius/);
  assert.match(nativeSource, /kComposerGlassClipCornerRadius = 24\.0/);
  assert.match(nativeSource, /kComposerGlassMaterialCornerRadius = 20\.0/);
  assert.match(nativeSource, /glass\.cornerRadius = kComposerGlassMaterialCornerRadius/);
  assert.match(nativeSource, /DSHComposerGlassPanel : NSPanel/);
  assert.match(nativeSource, /NSWindowStyleMaskNonactivatingPanel/);
  assert.match(nativeSource, /canBecomeKeyWindow[\s\S]*return NO/);
  assert.match(nativeSource, /panel\.ignoresMouseEvents = YES/);
  assert.match(nativeSource, /addChildWindow:panel ordered:NSWindowAbove/);
  assert.match(nativeSource, /foregroundWindow\.acceptsMouseMovedEvents = YES/);
  assert.match(nativeSource, /foregroundWindow orderWindow:NSWindowAbove/);
  assert.match(nativeSource, /glass\.layer\.cornerRadius = kComposerGlassClipCornerRadius/);
  assert.match(nativeSource, /glass\.layer\.cornerCurve = kCACornerCurveContinuous/);
  assert.match(nativeSource, /glass\.layer\.masksToBounds = YES/);
  assert.match(nativeSource, /kComposerGlassStrokeWidth = 0\.5/);
  assert.match(nativeSource, /glass\.layer\.borderWidth = kComposerGlassStrokeWidth/);
  assert.match(
    nativeSource,
    /glass\.layer\.borderColor =[\s\S]*colorWithSRGBRed:\(219\.0 \/ 255\.0\)/,
  );
  assert.match(nativeSource, /glass\.tintColor = nil/);
  assert.match(
    nativeSource,
    /glassContent\.autoresizingMask = NSViewWidthSizable \| NSViewHeightSizable/,
  );
  assert.doesNotMatch(nativeSource, /glassContent\.layer\.cornerRadius/);
  assert.doesNotMatch(nativeSource, /glassContent\.layer\.cornerCurve/);
  assert.doesNotMatch(nativeSource, /glassContent\.layer\.masksToBounds/);
  assert.match(nativeSource, /glassView\.contentView\.frame = panel\.glassView\.bounds/);
  assert.match(
    nativeSource,
    /glassContent\.layer\.backgroundColor =[\s\S]*?colorWithWhite:1\.0 alpha:0\.60/,
  );
  assert.doesNotMatch(nativeSource, /shadowView/);
  assert.doesNotMatch(nativeSource, /shadow\.layer\.shadowOpacity/);
  assert.doesNotMatch(nativeSource, /shadow\.layer\.shadowRadius/);
  assert.doesNotMatch(nativeSource, /shadow\.layer\.shadowPath/);
  assert.doesNotMatch(nativeSource, /CGPathCreateWithRoundedRect/);
  assert.match(nativeSource, /\[root addSubview:glass\]/);
  assert.match(nativeSource, /panel\.glassView\.frame = cardFrame/);
  assert.match(nativeSource, /setComposerGlassPanelFrame/);
  assert.match(nativeSource, /removeComposerGlassPanel/);
  assert.match(nativeSource, /DSHSidebarButtonGlassView : NSGlassEffectView/);
  assert.match(nativeSource, /kSidebarButtonCornerRadius = 12\.0/);
  assert.match(nativeSource, /MessageSquarePlusLibraryImage/);
  assert.match(
    nativeSource,
    /systemFontOfSize:14\.0 weight:NSFontWeightRegular/,
  );
  assert.ok(
    nativeSource.includes(
      "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
    ),
  );
  assert.ok(nativeSource.includes("M12 8v6"));
  assert.ok(nativeSource.includes("M9 11h6"));
  assert.match(nativeSource, /\[image setTemplate:YES\]/);
  assert.doesNotMatch(nativeSource, /square\.and\.pencil/);
  assert.match(nativeSource, /glass\.titleLabel\.hidden = compact/);
  assert.match(nativeSource, /compact \? 18\.0 : 14\.0/);
  assert.match(
    nativeSource,
    /glass\.baseHidden = compact \|\| width <= 0 \|\| height <= 0;/,
  );
  assert.match(nativeSource, /setSidebarButtonGlassFrame/);
  assert.match(nativeSource, /DSHScrollButtonGlassView : NSGlassEffectView/);
  assert.match(nativeSource, /kScrollButtonDiameter = 36\.0/);
  assert.match(nativeSource, /ChevronDownLibraryImage/);
  assert.ok(nativeSource.includes('d=\\"m6 9 6 6 6-6\\"'));
  assert.match(nativeSource, /glass\.cornerRadius = radius/);
  assert.match(
    nativeSource,
    /depth\.layer\.backgroundColor =[\s\S]*colorWithWhite:1\.0 alpha:0\.40/,
  );
  assert.doesNotMatch(nativeSource, /pressed \? 0\.30 : hovered \? 0\.48 : 0\.40/);
  assert.match(nativeSource, /setScrollButtonGlassFrame/);
  assert.match(nativeSource, /removeScrollButtonGlass/);
  assert.match(source, /desktop:sidebar-button-glass-frame/);
  assert.match(source, /desktop:scroll-button-glass-frame/);
  assert.match(source, /hasAttribute\("data-sidebar-collapsed"\)/);
  assert.match(
    source,
    /additionalArguments: \["--dsh-composer-overlay"\]/,
  );
  assert.match(source, /parent: mainWindow/);
  assert.match(source, /acceptFirstMouse: true/);
  assert.match(source, /screen\.getCursorScreenPoint\(\)/);
  assert.match(
    source,
    /function forwardInactiveComposerMouseMove\(\)[\s\S]*?!overlay\.isVisible\(\)[\s\S]*?overlay\.isFocused\(\)[\s\S]*?!app\.isActive\(\)/,
  );
  assert.match(
    source,
    /overlay\.webContents\.send\("desktop:composer-hover-point", point\)/,
  );
  assert.match(source, /send\("desktop:composer-hover-point", null\)/);
  assert.match(
    preloadSource,
    /ipcRenderer\.on\("desktop:composer-hover-point", updateForwardedHover\)/,
  );
  assert.match(preloadSource, /document\.elementFromPoint\(point\.x, point\.y\)/);
  assert.match(preloadSource, /setAttribute\(forwardedHoverAttribute, ""\)/);
  assert.match(clientSource, /data-dsh-forwarded-hover/);
  assert.match(source, /setInterval\(forwardInactiveComposerMouseMove, 16\)/);
  assert.match(source, /stopComposerHoverForwarding\(\);[\s\S]*?composerForegroundReady = false/);
  assert.match(source, /dataset\.dshComposerForeground/);
  assert.match(source, /desktop:composer-overlay-interaction/);
  assert.match(source, /composerForegroundWindow\.setBounds\(contentBounds\)/);
  assert.match(source, /pointInsideComposerInteraction\(point\)/);
  assert.match(source, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(source, /setIgnoreMouseEvents\(false\)/);
  assert.match(source, /setComposerGlassPanelFrame/);
  assert.match(
    source,
    /frame\.width <= 0[\s\S]*?composerForegroundWindow\.hide\(\);[\s\S]*?setMainComposerForeground\(false\);[\s\S]*?removeComposerGlassPanel\(\);[\s\S]*?return;/,
  );
  assert.match(source, /dsh-composer-overlay-card-bottom/);
  assert.match(source, /dsh-composer-overlay-hero-top/);
  assert.match(preloadSource, /process\.argv\.includes\("--dsh-composer-overlay"\)/);
  assert.match(preloadSource, /desktop:composer-overlay-interaction/);
  assert.match(preloadSource, /desktop:composer-glass-frame/);
  assert.match(preloadSource, /desktop:sidebar-button-glass-frame/);
  assert.match(preloadSource, /desktop:scroll-button-glass-frame/);
});

test("lucide-animated mapping covers every DSH primitive icon export", async () => {
  const [iconTypes, syncSource] = await Promise.all([
    readFile(iconTypesPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
  ]);
  const names = [...iconTypes.matchAll(/export declare const (Icon[A-Za-z0-9]+)/g)].map(
    (match) => match[1],
  );

  assert.ok(names.length > 50);
  for (const name of names) {
    assert.match(syncSource, new RegExp(`\\b${name}:`), `${name} is not mapped`);
  }
});

test("non-primitive and hidden-state affordances also use the icon library", async () => {
  const [clientSource, syncSource, nativeSource] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
    readFile(nativeGlassPath, "utf8"),
  ]);

  assert.match(syncSource, /const runtimeIconSlugs = \["history"\]/);
  assert.ok(syncSource.includes("M14.7 6.3a1 1 0 0 0 0 1.4"));
  assert.match(clientSource, /2136747050,[\s\S]*?"wrench"/);
  assert.match(clientSource, /"history": "<svg/);

  assert.match(clientSource, /function syncLibraryAffordances\(decorations\)/);
  assert.match(clientSource, /expanded \? "chevron-down" : "chevron-right"/);
  assert.match(clientSource, /symbol === "⊞" \? "expand" : symbol === "⊟" \? "shrink"/);
  assert.match(clientSource, /symbol === "▾" \? "chevron-down" : "chevron-right"/);
  assert.match(clientSource, /syncInjectedLibraryIcon\(host, "x", "trajectory-close"/);
  assert.match(clientSource, /syncInjectedLibraryIcon\(host, "history", "trajectory-history"/);
  assert.match(clientSource, /summary\[class\*="_customizedSummary"\]::before/);
  assert.match(clientSource, /summary\[class\*="_retrySummary"\]::after/);
  assert.match(clientSource, /input\[type="search"\]::\-webkit-search-cancel-button/);
  assert.match(clientSource, /select\[class\*="_selectInput"\]/);
  assert.match(clientSource, /\[class\*="_versionPicker"\] select/);
  assert.match(clientSource, /\[data-composer-card\] select/);
  assert.match(clientSource, /"aria-expanded",[\s\S]*?"aria-pressed",[\s\S]*?"open"/);
  assert.match(clientSource, /clearInjectedLibraryIcons\(injectedIconDecorations\)/);

  assert.match(nativeSource, /ChevronDownLibraryImage/);
  assert.ok(nativeSource.includes('d=\\"m6 9 6 6 6-6\\"'));
  assert.doesNotMatch(nativeSource, /imageWithSystemSymbolName/);
});

test("injected library icons follow disclosure state and clean up safely", async () => {
  const { affordanceFixture: fixture, cleanup, flushMutations } = await installTheme(
    "MacIntel",
    "",
    { includeAffordances: true },
  );
  const slugOf = (host) => host.children.at(-1)?.dataset.lucideAnimatedIcon;

  assert.equal(slugOf(fixture.expander), "chevron-right");
  assert.equal(slugOf(fixture.settingsSummary), "chevron-right");
  assert.equal(slugOf(fixture.retrySummary), "chevron-right");
  assert.equal(slugOf(fixture.collapseHost), "expand");
  assert.equal(slugOf(fixture.closeHost), "x");
  assert.equal(slugOf(fixture.historyHost), "history");
  assert.equal(slugOf(fixture.jsonButton), "chevron-right");
  assert.equal(fixture.jsonText.nodeValue, " JSON");

  fixture.expander.setAttribute("aria-expanded", "true");
  fixture.settingsDetails.setAttribute("open", "");
  fixture.retryDetails.setAttribute("open", "");
  fixture.collapseHost.textContent = "⊟";
  fixture.jsonText.nodeValue = "▾ JSON";
  flushMutations();

  assert.equal(slugOf(fixture.expander), "chevron-down");
  assert.equal(slugOf(fixture.settingsSummary), "chevron-down");
  assert.equal(slugOf(fixture.retrySummary), "chevron-down");
  assert.equal(slugOf(fixture.collapseHost), "shrink");
  assert.equal(slugOf(fixture.jsonButton), "chevron-down");
  assert.equal(fixture.jsonText.nodeValue, " JSON");

  cleanup();
  assert.equal(fixture.jsonText.nodeValue, "▾ JSON");
  assert.equal(fixture.expander.children.length, 0);
  assert.equal(fixture.settingsSummary.children.length, 0);
  assert.equal(fixture.retrySummary.children.length, 0);
  assert.equal(fixture.collapseHost.children.length, 0);
  assert.equal(fixture.closeHost.children.length, 0);
  assert.equal(fixture.historyHost.children.length, 0);
  assert.equal(fixture.jsonButton.children.length, 0);
});

test("Composer send uses the lucide-animated arrow-up icon", async () => {
  const [clientSource, syncSource] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
  ]);

  assert.match(syncSource, /IconSendOutline14: "arrow-up"/);
  assert.match(syncSource, /IconSendOutline16: "arrow-up"/);
  assert.match(
    clientSource,
    /"arrow-up": "<svg[^\n]*<path d=\\"m5 12 7-7 7 7\\"\/><path d=\\"M12 19V5\\"\/><\/svg>"/,
  );
});

test("Composer command uses the lucide-animated plus icon", async () => {
  const clientSource = await readFile(clientPath, "utf8");

  assert.match(
    clientSource,
    /"plus": "<svg[^\n]*<path d=\\"M5 12h14\\"\/><path d=\\"M12 5v14\\"\/><\/svg>"/,
  );
  assert.match(clientSource, /728987158,[\s\S]*?"plus"/);
});

test("desktop UI paints lucide-animated on the existing React-owned SVG", async () => {
  const { cleanup, sourceIcon } = await installTheme("MacIntel", "", { includeIcon: true });

  assert.equal(sourceIcon.replacedWith, null);
  assert.equal(sourceIcon.isConnected, true);
  assert.equal(sourceIcon.dataset.lucideAnimatedIcon, "ban");
  assert.equal(sourceIcon.dataset.lucideMotion, undefined);
  assert.equal(sourceIcon.children.at(-1).dataset.lucideLibraryPaint, "");

  cleanup();
  assert.equal(sourceIcon.isConnected, true);
  assert.equal(sourceIcon.dataset.lucideAnimatedIcon, undefined);
  assert.equal(sourceIcon.children.some((child) => child.dataset.lucideLibraryPaint === ""), false);
});

test("desktop UI keeps all lucide icons static on hover", async () => {
  const source = await readFile(clientPath, "utf8");

  assert.doesNotMatch(source, /data-lucide-motion/);
  assert.doesNotMatch(source, /@keyframes dsh-lucide-/);
});

test("chat chrome uses library icons at one 16px size", async () => {
  const source = await readFile(clientPath, "utf8");

  assert.match(
    source,
    /:is\(\[data-chat-flow\], \[data-testid="todo-panel"\]\)[\s\S]*?svg\[data-lucide-animated-icon\][^{]*\{[^}]*width: 16px !important;[^}]*height: 16px !important/,
  );
  assert.match(source, /createActivityDisclosureIcon\(slug\)/);
  assert.match(source, /expanded \? "chevron-down" : "chevron-right"/);
  assert.match(source, /function createBlockerIcon\(\)/);
  assert.match(source, /icon\.dataset\.dshBlockerIcon = ""/);
  assert.match(source, /const slug = "badge-alert"/);
  assert.doesNotMatch(
    source,
    /data-dsh-activity-head\]::before\s*\{[^}]*linear-gradient\(currentColor, currentColor\)/,
  );
});

test("startup UI keeps circles round and renders rounded rectangles continuously", async () => {
  const source = await readFile(loadingPath, "utf8");

  assert.match(source, /\.mark\s*\{[\s\S]*?corner-shape: round/);
  assert.match(source, /button\s*\{[\s\S]*?corner-shape: squircle/);
  assert.match(
    source,
    /body::before\s*\{[^}]*height: 44px;[^}]*app-region: drag;[^}]*-webkit-app-region: drag/,
  );
});

test("sidebar markers pass through the slot wrapper and preserve the official root", async () => {
  const { cleanup, shellFixture, trafficLightSyncCount } = await installTheme(
    "MacIntel",
    "",
    { includeShell: true },
  );

  assert.equal(shellFixture.sidebarSlotWrapper.dataset.dshDesktopSidebar, undefined);
  assert.equal(shellFixture.sidebarRoot.dataset.dshDesktopSidebar, "");
  assert.equal(shellFixture.logo.dataset.dshDesktopSidebarLogo, "");
  assert.equal(shellFixture.newSession.dataset.dshDesktopSidebarNew, "");
  assert.equal(shellFixture.region.dataset.dshDesktopSidebarRegion, "");
  assert.equal(shellFixture.foot.dataset.dshDesktopSidebarFoot, "");
  assert.equal(shellFixture.center.dataset.dshDesktopCenter, "");
  assert.equal(shellFixture.details.dataset.dshDesktopDetails, "");
  assert.equal(trafficLightSyncCount, 1);

  cleanup();
});

test("sidebar hides only the provisional session before its first query", async () => {
  const { cleanup, shellFixture } = await installTheme(
    "MacIntel",
    "",
    { includeShell: true, includeSidebarSessions: true },
  );

  assert.equal(shellFixture.pendingSession.dataset.dshPendingSession, "");
  assert.equal(shellFixture.durableSession.dataset.dshPendingSession, undefined);

  cleanup();
  assert.equal(shellFixture.pendingSession.dataset.dshPendingSession, undefined);
});
