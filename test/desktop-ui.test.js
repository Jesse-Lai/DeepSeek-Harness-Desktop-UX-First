import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopPatchPath = join(root, "src", "dsh-desktop.patch.yml");
const pluginDirectory = join(root, "plugins", "@jesse-lai", "dsh-desktop-ui");
const pluginManifestPath = join(pluginDirectory, "package.json");
const pluginPatchPath = join(pluginDirectory, "cordis.patch.yml");
const hostPluginPath = join(root, "plugins", "@jesse-lai", "dsh-desktop-ui", "lib", "index.js");
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
const productPath = join(root, "src", "product.js");
const preloadPath = join(root, "src", "preload.cjs");
const syncIconsPath = join(root, "scripts", "sync-lucide-animated-icons.js");
const loadingPath = join(root, "src", "loading.html");
const deepseekModulesPath = join(root, "node_modules", "@deepseek-ai");
const primitivesSourcePath = join(
  deepseekModulesPath,
  "dsh-client-ui-primitives",
  "lib",
  "index.js",
);
const trajectorySourcePath = join(
  deepseekModulesPath,
  "dsh-client-ui-trajectory",
  "lib",
  "client.js",
);
const workspaceSourcePath = join(
  deepseekModulesPath,
  "dsh-client-ui-workspace",
  "lib",
  "client.js",
);
const layoutSourcePath = join(
  deepseekModulesPath,
  "dsh-client-ui-layout",
  "lib",
  "client.js",
);
const sidebarSourcePath = join(
  deepseekModulesPath,
  "dsh-client-ui-sidebar",
  "lib",
  "client.js",
);
const slotRendererPath = join(
  root,
  "node_modules",
  "@deepseek-ai",
  "dsh-client-web-react",
  "lib",
  "index.js",
);

async function installTheme(
  platform,
  userAgent = "",
  {
    desktopHost = true,
    includeIcon = false,
    includeShell = false,
    includeSidebarSessions = false,
    includeAffordances = false,
    includeComposer = false,
    includeHiddenStateIcons = false,
    includeProgressFlow = false,
    includeFinalDividerFlow = false,
    includeFeedback = false,
    includeHeroHeadline = false,
    includeOnboarding = false,
    includeSteerSession = false,
    steerSessionRunning = false,
    language = "",
    workspaceItems,
    themePreference = "system",
    colorScheme = "light",
  } = {},
) {
  const source = await readFile(clientPath, "utf8");
  let registration;
  let appendedStyle;
  let cleanup;
  let mutationCallback;
  let mutationObserverConnected = false;
  let mutationObserverObserveCount = 0;
  let mutationObserverDisconnectCount = 0;
  let mutationObserverOptions;
  let mutationObserverObservedWriteCount = 0;
  const documentListeners = new Map();
  const timeoutCallbacks = new Map();
  let nextTimeoutId = 1;
  const storageValues = new Map();
  const steerPrompts = [];
  let steerCancelCalls = 0;
  const nativeThemeSources = [];
  const themeChangeListeners = new Set();
  const workspaceListListeners = new Set();
  let workspaceSnapshot = workspaceItems === undefined
    ? null
    : { items: workspaceItems, phase: "ready" };
  let themeSnapshot = {
    preference: themePreference,
    active: { colorScheme },
  };

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
      this.eventListeners = new Map();
      this.isConnected = false;
      this.disabled = false;
      this.textContent = "";
      this.value = "";
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
        const connect = (node) => {
          node.isConnected = this.isConnected;
          for (const descendant of node.children ?? []) connect(descendant);
        };
        connect(child);
        this.children.push(child);
      }
      if (children.length > 0) recordObservedMutation("childList");
    }

    addEventListener(type, listener) {
      const listeners = this.eventListeners.get(type) ?? new Set();
      listeners.add(listener);
      this.eventListeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.eventListeners.get(type)?.delete(listener);
    }

    dispatchEvent(event) {
      event.target ??= this;
      for (const listener of this.eventListeners.get(event.type) ?? []) listener(event);
      return true;
    }

    click() {
      this.dispatchEvent({ type: "click", target: this });
    }

    focus() {
      document.activeElement = this;
    }

    replaceChildren(...children) {
      for (const child of this.children) {
        child.parentElement = null;
        child.parentNode = null;
        const disconnect = (node) => {
          node.isConnected = false;
          for (const descendant of node.children ?? []) disconnect(descendant);
        };
        disconnect(child);
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
      const disconnect = (node) => {
        node.isConnected = false;
        for (const descendant of node.children ?? []) disconnect(descendant);
      };
      disconnect(this);
      recordObservedMutation("childList");
    }

    get firstElementChild() {
      return this.children[0] ?? null;
    }

    get lastElementChild() {
      return this.children.at(-1) ?? null;
    }

    get previousElementSibling() {
      if (this.parentElement === null) return null;
      const index = this.parentElement.children.indexOf(this);
      return index > 0 ? this.parentElement.children[index - 1] : null;
    }

    get nextElementSibling() {
      if (this.parentElement === null) return null;
      const index = this.parentElement.children.indexOf(this);
      return index >= 0 ? this.parentElement.children[index + 1] ?? null : null;
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
      return selector.split(",").some((part) => {
        let candidate = part.trim();
        let requiresEnabled = false;
        if (candidate.endsWith(":not([disabled])")) {
          candidate = candidate.slice(0, -":not([disabled])".length);
          requiresEnabled = true;
        }
        const tag = /^([a-z][a-z0-9-]*)/i.exec(candidate)?.[1];
        if (tag !== undefined && this.tagName !== tag.toUpperCase()) return false;
        if (requiresEnabled && (this.disabled || this.hasAttribute("disabled"))) return false;

        for (const match of candidate.matchAll(
          /\[([^\]=*]+)(?:(\*=|=)"([^"]*)")?\]/g,
        )) {
          const [, attribute, operator, expected] = match;
          if (!this.hasAttribute(attribute)) return false;
          const actual = this.getAttribute(attribute) ?? "";
          if (operator === "=" && actual !== expected) return false;
          if (operator === "*=" && !actual.includes(expected)) return false;
        }
        return !/[ >:+~]/.test(candidate.replace(/\[[^\]]+\]/g, ""));
      });
    }

    closest(selector) {
      let candidate = this;
      while (candidate !== null) {
        if (candidate.matches(selector)) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    }

    querySelector(selector) {
      const directDataMatch = /^:scope > \[([^\]]+)\]$/.exec(selector);
      if (directDataMatch !== null) {
        return this.children.find((child) => child.hasAttribute(directDataMatch[1])) ?? null;
      }
      return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
      const descendants = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (child.matches(selector)) descendants.push(child);
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
      if (name.startsWith("data-")) return super.getAttribute(name);
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
      if (name.startsWith("data-")) return super.hasAttribute(name);
      return this.attributes.has(name);
    }

    setAttribute(name, value) {
      if (name.startsWith("data-")) {
        super.setAttribute(name, value);
        return;
      }
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
  const composerFixture = includeComposer
    ? createComposerFixture(FakeHTMLElement, FakeSVGElement)
    : null;
  const heroHeadlineFixture = includeHeroHeadline
    ? (() => {
        const headline = new FakeHTMLElement("span");
        headline.isConnected = true;
        headline.setAttribute("class", "pXSMma_headlineText");
        headline.textContent = "Into the Unknown";
        return { headline };
      })()
    : null;
  const onboardingFixture = includeOnboarding
    ? (() => {
        const dialog = new FakeHTMLElement("div");
        dialog.isConnected = true;
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        const title = new FakeHTMLElement("h2");
        title.textContent = "Add an API key to get started";
        const description = new FakeHTMLElement("p");
        description.textContent =
          "Configure the official DeepSeek provider to start building.";
        const body = new FakeHTMLElement("div");
        const editor = new FakeHTMLElement("div");
        const field = new FakeHTMLElement("div");
        const fieldLabel = new FakeHTMLElement("span");
        fieldLabel.setAttribute("class", "zGbnIq_fieldLabel");
        fieldLabel.textContent = "API key";
        const input = new FakeHTMLElement("input");
        input.setAttribute("type", "password");
        input.setAttribute("placeholder", "Enter your API key");
        input.setAttribute("aria-label", "API key");
        field.append(fieldLabel, input);
        const later = new FakeHTMLElement("button");
        later.textContent = "Configure later";
        const save = new FakeHTMLElement("button");
        save.textContent = "Save and continue";
        editor.append(field, later, save);
        body.append(description, editor);
        dialog.append(title, body);
        return { body, description, dialog, editor, fieldLabel, input, later, save, title };
      })()
    : null;
  const progressFixture = includeProgressFlow
    ? createProgressFixture(FakeHTMLElement)
    : includeFinalDividerFlow
      ? createFinalDividerFixture(FakeHTMLElement)
      : null;
  if (shellFixture !== null && includeSidebarSessions) {
    const pendingSession = new FakeHTMLElement();
    pendingSession.querySelector = () => null;
    const durableSession = new FakeHTMLElement();
    const durableTime = new FakeHTMLElement("span");
    durableSession.querySelector = (selector) =>
      selector === '[class*="_time"]' ? durableTime : null;
    const searchResult = new FakeHTMLElement("button");
    searchResult.querySelector = () => null;
    shellFixture.region.append(pendingSession, durableSession, searchResult);
    shellFixture.pendingSession = pendingSession;
    shellFixture.durableSession = durableSession;
    shellFixture.searchResult = searchResult;
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
  const feedbackFixture = includeFeedback
    ? (() => {
        const actionRow = new FakeHTMLElement("div");
        actionRow.isConnected = true;
        const copy = new FakeHTMLElement("button");
        const dislike = new FakeHTMLElement("button");
        dislike.setAttribute("aria-pressed", "false");
        const dislikeIcon = new FakeSVGElement("svg", { "aria-hidden": "true" });
        dislikeIcon.dataset.lucideAnimatedIcon = "downvote";
        dislike.append(dislikeIcon);
        actionRow.append(copy, dislike);

        const noteOpen = new FakeHTMLElement("button");
        noteOpen.setAttribute("class", "_8_XoUG_noteOpen");
        const editor = new FakeHTMLElement("span");
        editor.setAttribute("class", "_8_XoUG_noteEditor");
        const textarea = new FakeHTMLElement("textarea");
        textarea.setAttribute(
          "placeholder",
          "What was good, or what went wrong? (optional)",
        );
        const save = new FakeHTMLElement("button");
        save.setAttribute("class", "_8_XoUG_noteSave");
        save.textContent = "Save";
        const cancel = new FakeHTMLElement("button");
        cancel.setAttribute("class", "_8_XoUG_noteCancel");
        cancel.textContent = "Cancel";
        editor.append(textarea, save, cancel);

        let noteOpenClicks = 0;
        let inputEvents = 0;
        let saveClicks = 0;
        let cancelClicks = 0;
        const closeEditor = () => {
          editor.remove();
          if (!noteOpen.isConnected) actionRow.append(noteOpen);
        };
        noteOpen.addEventListener("click", () => {
          noteOpenClicks += 1;
          noteOpen.remove();
          if (!editor.isConnected) actionRow.append(editor);
        });
        textarea.addEventListener("input", () => {
          inputEvents += 1;
        });
        cancel.addEventListener("click", () => {
          cancelClicks += 1;
          closeEditor();
        });
        save.addEventListener("click", () => {
          saveClicks += 1;
          closeEditor();
        });

        return {
          actionRow,
          cancel,
          cancelClicks: () => cancelClicks,
          commitNegative() {
            dislike.setAttribute("aria-pressed", "true");
            if (!noteOpen.isConnected && !editor.isConnected) actionRow.append(noteOpen);
          },
          copy,
          dislike,
          dislikeIcon,
          editor,
          inputEvents: () => inputEvents,
          noteOpen,
          noteOpenClicks: () => noteOpenClicks,
          save,
          saveClicks: () => saveClicks,
          textarea,
        };
      })()
    : null;
  const hiddenStateFixture = includeHiddenStateIcons
    ? (() => {
        const connected = (tagName) => {
          const element = new FakeHTMLElement(tagName);
          element.isConnected = true;
          return element;
        };
        const stateDots = {};
        for (const state of ["done", "warning", "error"]) {
          const host = connected("span");
          host.setAttribute("aria-hidden", "true");
          host.setAttribute("data-state", state);
          stateDots[state] = host;
        }

        const ongoing = new FakeSVGElement("svg", {
          width: "10",
          height: "10",
          viewBox: "0 0 10 10",
          "shape-rendering": "crispEdges",
          "aria-hidden": "true",
        });
        ongoing.dataset.state = "ongoing";
        for (const [x, y] of [
          [0, 0], [4, 0], [8, 0], [8, 4],
          [8, 8], [4, 8], [0, 8], [0, 4],
        ]) {
          ongoing.append(
            new FakeSVGElement("rect", {
              x: String(x),
              y: String(y),
              width: "2",
              height: "2",
            }),
          );
        }
        ongoing.isConnected = true;

        const trajectorySpinners = [connected("span"), connected("span")];
        for (const spinner of trajectorySpinners) {
          spinner.setAttribute("class", "Y0dWHa_historyLoadingSpinner");
          spinner.setAttribute("aria-hidden", "true");
        }

        const pluginStatuses = {};
        for (const phase of [
          "pending", "loading", "active", "failed", "unloading", "unobserved",
        ]) {
          const host = connected("span");
          host.setAttribute("class", "qSYn7G_statusDot");
          host.setAttribute("role", "img");
          host.setAttribute("data-phase", phase);
          pluginStatuses[phase] = host;
        }

        const credentialConfigured = connected("span");
        credentialConfigured.setAttribute(
          "class",
          "zGbnIq_credentialDot zGbnIq_credentialDotConfigured",
        );
        credentialConfigured.setAttribute("role", "img");
        const credentialMissing = connected("span");
        credentialMissing.setAttribute(
          "class",
          "zGbnIq_credentialDot zGbnIq_credentialDotMissing",
        );
        credentialMissing.setAttribute("role", "img");
        const credentialStatuses = { configured: credentialConfigured, missing: credentialMissing };

        return {
          credentialStatuses,
          ongoing,
          pluginStatuses,
          stateDots,
          trajectorySpinners,
        };
      })()
    : null;
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
  const allFixtureElements = [
    ...(shellFixture === null ? [] : collectElements(shellFixture.shell)),
    ...(composerFixture?.elements ?? []),
    ...(progressFixture === null ? [] : collectElements(progressFixture.flow)),
    ...(feedbackFixture === null ? [] : collectElements(feedbackFixture.actionRow)),
    ...(heroHeadlineFixture === null ? [] : [heroHeadlineFixture.headline]),
    ...(onboardingFixture === null ? [] : collectElements(onboardingFixture.dialog)),
  ];
  const body = new FakeHTMLElement("body");
  body.isConnected = true;
  const documentElement = { dataset: {}, lang: language };
  const document = {
    activeElement: body,
    body,
    documentElement,
    addEventListener(type, callback) {
      const listeners = documentListeners.get(type) ?? new Set();
      listeners.add(callback);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, callback) {
      documentListeners.get(type)?.delete(callback);
    },
    head: {
      append(style) {
        appendedStyle = style;
      },
    },
    querySelector(selector) {
      if (selector === "[data-shell-overlay]") return shellFixture?.overlay ?? null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-chat-flow]") {
        return progressFixture === null ? [] : [progressFixture.flow];
      }
      if (selector === '[data-variant="think"]') {
        return progressFixture?.reasoningBlocks ?? [];
      }
      if (selector === "[data-chat-flow-kind]") {
        return progressFixture?.rows ?? [];
      }
      if (selector === "[data-composer-card]") {
        return composerFixture === null ? [] : [composerFixture.card];
      }
      if (selector === '[role="listbox"]') {
        return composerFixture === null ? [] : [composerFixture.commandMenu];
      }
      if (selector === '[class*="_headlineText"]') {
        return heroHeadlineFixture === null ? [] : [heroHeadlineFixture.headline];
      }
      if (selector === '[role="dialog"][aria-modal="true"]') {
        return onboardingFixture === null ? [] : [onboardingFixture.dialog];
      }
      if (feedbackFixture !== null) {
        if (selector === 'span[class*="_noteEditor"]') {
          return feedbackFixture.editor.isConnected ? [feedbackFixture.editor] : [];
        }
        if (selector === "button[data-dsh-feedback-dialog-pending]") {
          return feedbackFixture.dislike.isConnected &&
            feedbackFixture.dislike.dataset.dshFeedbackDialogPending !== undefined
            ? [feedbackFixture.dislike]
            : [];
        }
      }
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
      if (hiddenStateFixture !== null) {
        const hiddenStateSelectors = {
          'span[aria-hidden="true"][data-state]': Object.values(
            hiddenStateFixture.stateDots,
          ),
          'span[class*="_historyLoadingSpinner"]':
            hiddenStateFixture.trajectorySpinners,
          'span[role="img"][data-phase][class*="_statusDot"]': Object.values(
            hiddenStateFixture.pluginStatuses,
          ),
          'span[role="img"][class*="_credentialDot"]': Object.values(
            hiddenStateFixture.credentialStatuses,
          ),
        };
        if (Object.hasOwn(hiddenStateSelectors, selector)) {
          return hiddenStateSelectors[selector];
        }
      }
      if (
        selector ===
        '[data-dsh-desktop-sidebar-region] [class*="_sessionRow"][role="treeitem"][aria-selected]'
      ) {
        return shellFixture?.pendingSession === undefined
          ? []
          : [shellFixture.pendingSession, shellFixture.durableSession];
      }
      if (
        selector ===
        '[data-dsh-desktop-sidebar-region] [role="treeitem"][aria-selected]'
      ) {
        return shellFixture?.pendingSession === undefined
          ? []
          : [
              shellFixture.pendingSession,
              shellFixture.durableSession,
              shellFixture.searchResult,
            ];
      }
      if (selector.startsWith("svg:not([data-lucide-animated-icon])")) {
        return [sourceIcon, hiddenStateFixture?.ongoing, composerFixture?.primaryIcon].filter(
          (icon) => icon?.isConnected === true,
        );
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
      if (["a", "button", "div", "h2", "input", "p", "span", "textarea"].includes(tagName)) {
        return new FakeHTMLElement(tagName);
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
      ...(desktopHost
        ? {
            desktop: {
              restart() {},
              setThemeSource(themeSource) {
                nativeThemeSources.push(themeSource);
              },
            },
          }
        : {}),
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
    URL,
    MutationObserver: FakeMutationObserver,
    HTMLElement: FakeHTMLElement,
    SVGElement: FakeSVGElement,
    localStorage: {
      getItem(key) {
        return storageValues.get(key) ?? null;
      },
      setItem(key, value) {
        storageValues.set(key, String(value));
      },
    },
    clearTimeout(timeoutId) {
      timeoutCallbacks.delete(timeoutId);
    },
    setTimeout(callback) {
      const timeoutId = nextTimeoutId;
      nextTimeoutId += 1;
      timeoutCallbacks.set(timeoutId, callback);
      return timeoutId;
    },
  };

  vm.runInNewContext(source, sandbox, { filename: clientPath });
  assert.equal(registration.id, "@jesse-lai/dsh-desktop-ui");
  const plugin = registration.factory();
  const steerSession = includeSteerSession
    ? {
        async cancel() {
          steerCancelCalls += 1;
        },
        getSnapshot() {
          return {
            running: steerSessionRunning,
            chat: {
              nodes: new Map([
                ["assistant:1", { data: { finalNode: { seq: 7 } } }],
              ]),
            },
          };
        },
        async prompt(parts, mode) {
          steerPrompts.push({ mode, parts });
          return { ok: true, value: { accepted: true } };
        },
      }
    : null;
  plugin.apply({
    effect(callback) {
      cleanup = callback();
    },
    on(name, listener) {
      assert.equal(name, "theme/change");
      themeChangeListeners.add(listener);
      return () => themeChangeListeners.delete(listener);
    },
    theme: {
      getTheme() {
        return themeSnapshot;
      },
    },
    sessions: includeSteerSession
      ? {
          binding() {
            return { session: steerSession };
          },
          list: {
            getSnapshot() {
              return { current: "session:1" };
            },
          },
        }
      : undefined,
    workspaces: workspaceSnapshot === null
      ? undefined
      : {
          list: {
            getSnapshot() {
              return workspaceSnapshot;
            },
            subscribe(listener) {
              workspaceListListeners.add(listener);
              return () => workspaceListListeners.delete(listener);
            },
          },
        },
  });

  return {
    activeElement() {
      return document.activeElement;
    },
    appendedStyle,
    cleanup,
    composerFixture,
    createFixtureElement(tagName = "div") {
      return new FakeHTMLElement(tagName);
    },
    dispatchClick(target) {
      const event = {
        target,
        preventDefault() {},
        stopPropagation() {},
      };
      for (const listener of documentListeners.get("click") ?? []) listener(event);
    },
    dispatchInput(target) {
      for (const listener of documentListeners.get("input") ?? []) {
        listener({ target });
      }
    },
    dispatchKeydown(key, { shiftKey = false, target } = {}) {
      const event = {
        isComposing: false,
        key,
        preventDefault() {},
        shiftKey,
        stopPropagation() {},
        target,
      };
      for (const listener of documentListeners.get("keydown") ?? []) listener(event);
    },
    dispatchScroll(target = document) {
      for (const listener of documentListeners.get("scroll") ?? []) {
        listener({ target });
      }
    },
    documentBody: body,
    documentElement,
    affordanceFixture,
    feedbackFixture,
    flushTimeouts() {
      const callbacks = [...timeoutCallbacks.values()];
      timeoutCallbacks.clear();
      for (const callback of callbacks) callback();
    },
    hiddenStateFixture,
    heroHeadlineFixture,
    onboardingFixture,
    plugin,
    progressFixture,
    shellFixture,
    sourceIcon,
    steerSession: includeSteerSession
      ? {
          cancelCalls: () => steerCancelCalls,
          prompts: steerPrompts,
          storageValues,
        }
      : null,
    scrollListenerCount() {
      return documentListeners.get("scroll")?.size ?? 0;
    },
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
    nativeThemeSources,
    setTheme(preference, activeColorScheme) {
      themeSnapshot = {
        preference,
        active: { colorScheme: activeColorScheme },
      };
      for (const listener of themeChangeListeners) listener(themeSnapshot);
    },
    setWorkspaces(items, phase = "ready") {
      assert.notEqual(workspaceSnapshot, null);
      workspaceSnapshot = { items, phase };
      for (const listener of workspaceListListeners) listener();
    },
    workspaceSubscriberCount() {
      return workspaceListListeners.size;
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
    "正在阅读文件，正在搜索内容",
  );
  assert.equal(
    plugin.progress.summarizeActivity(
      { tools: ["edit_file", "bash"], running: false, errors: 1 },
      "zh",
    ),
    "修改了文件，执行了命令；其中 1 项需要注意",
  );
  assert.equal(
    plugin.progress.summarizeActivity(
      { tools: ["read_file", "bash", "read_file"], running: false, errors: 0 },
      "zh",
    ),
    "阅读了文件，执行了命令",
  );
  assert.equal(
    plugin.progress.summarizeActivity(
      { tools: ["read_file", "bash", "read_file"], running: false, errors: 0 },
      "en",
    ),
    "Read files, ran commands",
  );
  assert.equal(
    plugin.progress.summarizeActivity(
      { tools: ["edit_file", "read_file", "edit_file"], running: false, errors: 0 },
      "en",
    ),
    "Edited files, read files",
  );
  assert.equal(plugin.progress.toolFamily("cordis_research"), "delegate");
  assert.equal(
    plugin.progress.liveStatusCopy(
      { stage: "operation", family: "run", detail: "open DeepSeek Harness UX First Dev.app" },
      "zh",
    ),
    "正在执行 open DeepSeek Harness UX First Dev.app",
  );
  assert.equal(
    plugin.progress.liveStatusCopy({ stage: "working" }, "zh"),
    "正在整理结果…",
  );
  assert.equal(
    plugin.progress.goalFromProgressText(
      "收到，我会按短版来做。接下来我先搭一版页面结构和文案，再生成网页文件。",
      "zh",
    ),
    "搭一版页面结构和文案",
  );
  assert.equal(
    plugin.progress.liveStatusCopy(
      { stage: "goal", detail: "搭一版页面结构和文案" },
      "zh",
    ),
    "正在搭一版页面结构和文案",
  );
  assert.equal(
    plugin.progress.goalFromTodoSummary("1/4 completed · Build the comparison deck"),
    "Build the comparison deck",
  );
  assert.equal(
    plugin.progress.liveStatusCopy({ stage: "initial" }, "en"),
    "Understanding the request…",
  );
  assert.match(appendedStyle.textContent, /data-dsh-activity-summary/);
  assert.match(appendedStyle.textContent, /data-dsh-live-status/);
  assert.doesNotMatch(appendedStyle.textContent, /data-dsh-progress-update\]::before/);
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
    /data-dsh-activity-row\]\[data-dsh-activity-expanded="true"\][^{]*\{[^}]*margin-top: -16px;[^}]*padding: 4px 12px;[^}]*background:/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-activity-head\]\[aria-expanded="true"\][^{]*\{[^}]*padding: 4px 12px;[^}]*border-radius: 8px 8px 0 0;[^}]*background:/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-activity-head\]\[aria-expanded="true"\][\s\S]*?data-dsh-activity-disclosure\]\s*\{[^}]*top: 10px;[^}]*left: 12px/,
  );
  assert.match(appendedStyle.textContent, /data-dsh-activity-tail/);
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

test("desktop host asks the model for concise user-facing progress updates", async () => {
  const plugin = await import(`${pathToFileURL(hostPluginPath).href}?progress-prompt-test`);
  let section;

  plugin.apply({
    systemPrompt: {
      section(value) {
        section = value;
      },
    },
  });

  assert.deepEqual(plugin.inject, ["systemPrompt"]);
  assert.equal(section.name, "ui:desktop-progress-updates");
  assert.equal(section.order, 180);
  assert.match(section.text, /before the first tool call and between meaningful phases/);
  assert.match(section.text, /what was achieved or learned/);
  assert.match(section.text, /state the immediate next objective explicitly/);
  assert.match(section.text, /Do not narrate every tool call/);
  assert.match(section.text, /Do not .*expose private chain-of-thought/);
  assert.match(section.text, /Use the user's language/);
});

test("desktop UI package is an installable Harness profile bundle", async () => {
  const [manifestSource, pluginPatch, desktopPatch] = await Promise.all([
    readFile(pluginManifestPath, "utf8"),
    readFile(pluginPatchPath, "utf8"),
    readFile(desktopPatchPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.name, "@jesse-lai/dsh-desktop-ui");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(manifest.exports["./cordis.patch.yml"], "./cordis.patch.yml");
  assert.ok(manifest.files.includes("lib"));
  assert.ok(manifest.files.includes("cordis.patch.yml"));
  assert.ok(desktopPatch.trim().startsWith(pluginPatch.trim()));
  assert.match(desktopPatch, /@jesse-lai\/dsh-desktop-ui\/companion/);
  assert.doesNotMatch(pluginPatch, /dsh-desktop-companion/);
  assert.match(pluginPatch, /id: dsh-desktop-ui/);
  assert.match(pluginPatch, /name: '@jesse-lai\/dsh-desktop-ui'/);
});

test("live shimmer stays last and follows the latest running operation", async () => {
  const theme = await installTheme("MacIntel", "", { includeProgressFlow: true });
  const { flow, status, statusText, toolRoot } = theme.progressFixture;

  assert.equal(flow.lastElementChild, status);
  assert.equal(status.dataset.dshLiveStatus, "");
  assert.equal(status.dataset.dshLiveStatusSource, "operation");
  assert.equal(status.style.getPropertyValue("display"), "");
  assert.equal(statusText.nodeValue, "Running open DeepSeek Harness UX First Dev.app");

  toolRoot.dataset.state = "ok";
  theme.flushMutations();
  assert.equal(status.dataset.dshLiveStatusSource, "goal");
  assert.equal(status.style.getPropertyValue("display"), "");
  assert.equal(statusText.nodeValue, "Working on: prepare the release package");

  theme.cleanup();
  assert.equal(status.dataset.dshLiveStatus, undefined);
  assert.equal(statusText.nodeValue, "Deep diving...");
});

test("failed operations stay in activity disclosure instead of rendering empty blockers", async () => {
  const theme = await installTheme("MacIntel", "", { includeProgressFlow: true });
  const { secondToolRoot, secondToolRow, toolRoot, toolRow } = theme.progressFixture;

  toolRoot.dataset.state = "error";
  secondToolRoot.dataset.state = "error";
  theme.flushMutations();

  assert.equal(toolRow.dataset.dshBlocker, undefined);
  assert.equal(secondToolRow.dataset.dshBlocker, undefined);
  assert.equal(toolRow.dataset.dshActivityHead, "");
  assert.equal(toolRow.dataset.dshActivityTail, undefined);
  assert.equal(secondToolRow.dataset.dshActivityRow, "");
  assert.equal(secondToolRow.dataset.dshActivityTail, "");
  assert.equal(toolRow.dataset.dshActivityExpanded, "false");
  assert.equal(secondToolRow.dataset.dshActivityExpanded, "false");
  assert.equal(
    [toolRow, secondToolRow].some((row) =>
      row.children.some((child) => child.dataset.dshBlockerIcon !== undefined)),
    false,
  );

  toolRow.dispatchEvent({ type: "click", target: toolRow });
  assert.equal(toolRow.getAttribute("aria-expanded"), "true");
  assert.equal(toolRow.dataset.dshActivityExpanded, "true");
  assert.equal(secondToolRow.dataset.dshActivityExpanded, "true");

  theme.cleanup();
});

test("Steer from here opens inline, closes outside, and discards only on submit", async () => {
  const theme = await installTheme("MacIntel", "", {
    includeProgressFlow: true,
    includeSteerSession: true,
  });
  const { flow, progressRow, status, toolRow, secondToolRow } = theme.progressFixture;
  const action = progressRow.querySelector("[data-dsh-steer-action]");
  const trigger = action?.querySelector("[data-dsh-steer-trigger]");

  assert.ok(action);
  assert.equal(trigger?.textContent, "Steer from here");
  assert.equal(action.querySelectorAll("button").length, 1);
  assert.match(theme.appendedStyle.textContent, /data-dsh-steer-discarded/);
  assert.match(
    theme.appendedStyle.textContent,
    /data-dsh-progress-update\]:has\(\[data-dsh-steer-action\]\):hover,[\s\S]*?data-dsh-progress-update\]:has\(\[data-dsh-steer-action\]\):focus-within,[\s\S]*?background: color-mix\([\s\S]*?interactive-bg-hover\) 55%/,
  );
  assert.doesNotMatch(
    theme.appendedStyle.textContent,
    /\[data-dsh-progress-update\]:hover,\s*\[data-dsh-progress-update\]:focus-within,\s*\[data-dsh-progress-update\]\[data-dsh-steer-open\]\s*\{/,
  );
  const toolbarRule = theme.appendedStyle.textContent.match(
    /\[data-dsh-steer-action\]\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(toolbarRule);
  assert.match(toolbarRule, /position: absolute/);
  assert.match(toolbarRule, /z-index: 2147482900/);
  assert.match(toolbarRule, /bottom: calc\(100% \+ 8px\)/);
  assert.match(toolbarRule, /right: auto/);
  assert.match(toolbarRule, /left: 50%/);
  assert.match(toolbarRule, /width: max-content/);
  assert.match(toolbarRule, /border-radius: 999px/);
  assert.match(toolbarRule, /pointer-events: none/);
  assert.match(toolbarRule, /transform: translateX\(-50%\)/);
  assert.match(toolbarRule, /transition: background-color 120ms ease/);
  assert.doesNotMatch(toolbarRule, /translate\([^)]*,/);
  assert.doesNotMatch(toolbarRule, /margin|min-height/);
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-steer-action\]::after\s*\{[^}]*content: "";[^}]*position: absolute;[^}]*top: 100%;[^}]*right: 0;[^}]*left: 0;[^}]*height: 8px;/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /:is\([\s\S]*?data-dsh-scroll-button[\s\S]*?data-dsh-steer-action[\s\S]*?\)\s*\{[^}]*border: 1px solid var\(--dsw-alias-border-l2\);[^}]*background: var\(--dsw-alias-button-floating-fill\);[^}]*box-shadow: var\(--dsw-shadow-lv2\);/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /data-dsh-steer-action\]:hover,[\s\S]*?data-dsh-steer-action\]:focus-within[^{]*\{[^}]*opacity: 1;[^}]*pointer-events: auto;[^}]*transform: translateX\(-50%\)/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-steer-action\]:hover,\s*\[data-dsh-steer-action\]:focus-within\s*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover-solid\)/,
  );
  const triggerRule = theme.appendedStyle.textContent.match(
    /\[data-dsh-steer-trigger\],[\s\S]*?\[data-dsh-steer-submit\]\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(triggerRule);
  assert.match(triggerRule, /border: 0/);
  assert.match(triggerRule, /border-radius: 999px/);
  assert.match(triggerRule, /font-size: 14px/);
  assert.match(triggerRule, /background: transparent/);
  assert.match(triggerRule, /box-shadow: none/);
  assert.match(triggerRule, /color: var\(--dsw-alias-label-primary\)/);
  const triggerHoverRule = theme.appendedStyle.textContent.match(
    /\[data-dsh-steer-trigger\]:hover,\s*\[data-dsh-steer-trigger\]:focus-visible\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(triggerHoverRule);
  assert.match(triggerHoverRule, /background: transparent/);
  assert.doesNotMatch(triggerHoverRule, /interactive-bg-hover/);
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-steer-submit\]\s*\{[^}]*border-radius: 999px;[^}]*background: var\(--dsw-alias-button-primary-fill\);[^}]*color: var\(--dsw-alias-label-primary-foreground\)/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-steer-input\]\s*\{[^}]*min-height: 32px;[^}]*padding: 5px 0;/,
  );

  theme.dispatchClick(trigger);
  let editor = action.querySelector("[data-dsh-steer-editor]");
  let input = editor?.querySelector("[data-dsh-steer-input]");
  let submit = editor?.querySelector("[data-dsh-steer-submit]");
  assert.ok(editor);
  assert.equal(input?.getAttribute("placeholder"), "What should change?");
  assert.equal(submit?.textContent, "Steer");
  assert.equal(submit?.disabled, true);
  assert.equal(action.querySelectorAll("button").some((button) => button.textContent === "Cancel"), false);
  assert.equal(toolRow.dataset.dshSteerDiscarded, undefined);

  theme.dispatchClick(theme.documentBody);
  assert.equal(action.querySelector("[data-dsh-steer-editor]"), null);
  assert.equal(toolRow.dataset.dshSteerDiscarded, undefined);

  theme.dispatchClick(trigger);
  editor = action.querySelector("[data-dsh-steer-editor]");
  input = editor.querySelector("[data-dsh-steer-input]");
  submit = editor.querySelector("[data-dsh-steer-submit]");
  input.value = "Keep the earlier diagnosis, but use the signed package.";
  theme.dispatchInput(input);
  assert.equal(submit.disabled, false);
  theme.dispatchClick(submit);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(theme.steerSession.cancelCalls(), 0);
  assert.equal(theme.steerSession.prompts.length, 1);
  assert.equal(theme.steerSession.prompts[0].mode, "queue");
  const prompt = theme.steerSession.prompts[0].parts[0].text;
  assert.match(prompt, /Keep the earlier diagnosis, but use the signed package/);
  assert.match(prompt, /assistant:1 \(sequence 7\)/);
  assert.match(prompt, /Files or other residual state/);
  assert.match(prompt, /Treat that residual state as untrusted/);
  assert.equal(toolRow.dataset.dshSteerDiscarded, "");
  assert.equal(secondToolRow.dataset.dshSteerDiscarded, "");
  assert.equal(status.dataset.dshSteerNativeStatusHidden, "");
  assert.equal(
    flow.children.some((child) =>
      child.dataset.dshSteerStatus !== undefined && child.textContent === "正在重新思考…"),
    true,
  );
  const persisted = JSON.parse(
    theme.steerSession.storageValues.get("dsh-steer-cuts:v1:session:1"),
  );
  assert.deepEqual(persisted.discardedKeys, ["tool:1", "tool:2"]);

  const internalFollowup = theme.createFixtureElement();
  internalFollowup.dataset.chatFlowKind = "user";
  internalFollowup.dataset.chatAnchorKey = "user:steer";
  const continuation = theme.createFixtureElement();
  continuation.dataset.chatFlowKind = "command";
  continuation.dataset.chatAnchorKey = "command:steer";
  flow.append(internalFollowup, continuation);
  theme.flushMutations();
  assert.equal(internalFollowup.dataset.dshSteerInternal, "");
  assert.equal(
    flow.children.some((child) => child.dataset.dshSteerStatus !== undefined),
    false,
  );
  assert.equal(status.dataset.dshSteerNativeStatusHidden, undefined);
  const continuedRecord = JSON.parse(
    theme.steerSession.storageValues.get("dsh-steer-cuts:v1:session:1"),
  );
  assert.deepEqual(continuedRecord.internalKeys, ["user:steer"]);

  theme.cleanup();
});

test("Steer from here uses Chinese copy in Chinese mode", async () => {
  const theme = await installTheme("MacIntel", "", {
    includeProgressFlow: true,
    includeSteerSession: true,
    language: "zh-CN",
  });
  const trigger = theme.progressFixture.progressRow.querySelector("[data-dsh-steer-trigger]");

  assert.equal(trigger?.textContent, "从此处重新思考");
  theme.dispatchClick(trigger);
  const input = theme.progressFixture.progressRow.querySelector("[data-dsh-steer-input]");
  const submit = theme.progressFixture.progressRow.querySelector("[data-dsh-steer-submit]");
  assert.equal(input?.getAttribute("placeholder"), "请输入调整要求");
  assert.equal(input?.getAttribute("aria-label"), "请输入调整要求");
  assert.equal(submit?.textContent, "重新思考");

  theme.cleanup();
});

test("Steer is offered only in the latest query and interrupts a running turn", async () => {
  const theme = await installTheme("MacIntel", "", {
    includeProgressFlow: true,
    includeSteerSession: true,
    steerSessionRunning: true,
  });
  const { flow, progressRow } = theme.progressFixture;
  assert.ok(progressRow.querySelector("[data-dsh-steer-action]"));

  const latestUser = theme.createFixtureElement();
  latestUser.dataset.chatFlowKind = "user";
  latestUser.dataset.chatAnchorKey = "user:2";
  const latestProgress = theme.createFixtureElement();
  latestProgress.dataset.chatFlowKind = "assistant-step";
  latestProgress.dataset.chatAnchorKey = "assistant:2";
  const progressRoot = theme.createFixtureElement();
  const progressBody = theme.createFixtureElement();
  const progressCopy = theme.createFixtureElement();
  progressCopy.textContent = "I found the issue. Next, I'll apply and verify the fix.";
  progressBody.append(progressCopy);
  progressRoot.append(progressBody);
  latestProgress.append(progressRoot);
  const latestCommand = theme.createFixtureElement();
  latestCommand.dataset.chatFlowKind = "command";
  latestCommand.dataset.chatAnchorKey = "command:2";
  flow.append(latestUser, latestProgress, latestCommand);
  theme.flushMutations();

  assert.equal(progressRow.querySelector("[data-dsh-steer-action]"), null);
  const latestAction = latestProgress.querySelector("[data-dsh-steer-action]");
  const latestTrigger = latestAction?.querySelector("[data-dsh-steer-trigger]");
  assert.ok(latestAction);
  assert.ok(latestTrigger);

  theme.dispatchClick(latestTrigger);
  const editor = latestAction.querySelector("[data-dsh-steer-editor]");
  const input = editor?.querySelector("[data-dsh-steer-input]");
  const submit = editor?.querySelector("[data-dsh-steer-submit]");
  input.value = "Use the newer package.";
  theme.dispatchInput(input);
  theme.dispatchClick(submit);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(theme.steerSession.prompts.length, 1);
  assert.equal(theme.steerSession.prompts[0].mode, "steer");
  theme.cleanup();
});

test("completed turns divide visible work from the final answer only", async () => {
  const theme = await installTheme("MacIntel", "", { includeFinalDividerFlow: true });
  const { directFinal, reasonedAnswer, reasonedFinal, workedFinal } = theme.progressFixture;

  assert.equal(directFinal.dataset.dshFinalAnswer, "");
  assert.equal(directFinal.dataset.dshFinalDivider, undefined);
  assert.equal(workedFinal.dataset.dshFinalDivider, "");
  assert.equal(reasonedFinal.dataset.dshFinalDivider, undefined);
  assert.equal(reasonedAnswer.dataset.dshFinalContentDivider, "");
  assert.match(
    theme.appendedStyle.textContent,
    /data-dsh-final-divider\],[\s\S]*?data-dsh-final-content-divider\][^{]*\{[^}]*margin-top: 20px;[^}]*padding-top: 24px;[^}]*border-top: 1px solid var\(--dsw-alias-border-l1\)/,
  );

  theme.cleanup();
  assert.equal(workedFinal.dataset.dshFinalDivider, undefined);
  assert.equal(reasonedAnswer.dataset.dshFinalContentDivider, undefined);
});

test("user prompts, generating updates, and final answers share the 15px body scale", async () => {
  const { appendedStyle, cleanup } = await installTheme("MacIntel");

  assert.match(
    appendedStyle.textContent,
    /\[data-chat-flow-kind="user"\][\s\S]*?\[data-time-hover-root\][\s\S]*?> :first-child[\s\S]*?> :first-child\s*\{[^}]*font-size: 15px;[^}]*line-height: 22px;/,
  );
  assert.match(
    appendedStyle.textContent,
    /\[data-chat-flow-kind="assistant-step"\]\s*\{[^}]*--dsw-font-markdown-base: 15px\/26px var\(--dsw-font-family\);[^}]*--dsw-font-markdown-base-font-size: 15px;[^}]*--dsw-font-markdown-base-line-height: 26px;/,
  );
  assert.match(
    appendedStyle.textContent,
    /\[data-chat-flow-kind="assistant-step"\][\s\S]*?> \[data-slot="conversation\.chat\.node"\][\s\S]*?> :first-child\s*\{[^}]*font-size: 15px;[^}]*line-height: 26px;/,
  );
  assert.match(
    appendedStyle.textContent,
    /\[data-chat-flow-kind="assistant-step"\] li::marker\s*\{[^}]*line-height: 26px;/,
  );

  cleanup();
});

test("message action tooltips reuse the sidebar hover-card surface", async () => {
  const { appendedStyle, cleanup } = await installTheme("MacIntel");

  assert.match(
    appendedStyle.textContent,
    /body\s*\{[^}]*--dsh-desktop-floating-surface: var\(--dsw-alias-bg-layer-2\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /:is\([\s\S]*?body > \[class\*="_card_"\],[\s\S]*?\[data-chat-flow-kind\] :is\([\s\S]*?button\[aria-pressed\],[\s\S]*?data-lucide-animated-icon="copy"[\s\S]*?data-lucide-animated-icon="check"[\s\S]*?data-lucide-animated-icon="git-branch"[\s\S]*?\) \+ \[role="tooltip"\][\s\S]*?\)\s*\{[^}]*--dsw-hovercard-bg: var\(--dsh-desktop-floating-surface\) !important;[^}]*color: var\(--dsw-alias-label-primary\) !important;[^}]*background: var\(--dsh-desktop-floating-surface\) !important;[^}]*border-radius: 12px !important;[^}]*box-shadow: var\(--dsh-desktop-floating-surface-shadow\) !important/,
  );
  assert.doesNotMatch(appendedStyle.textContent, /\[role="tooltip"\]\s*\{/);
  assert.match(
    appendedStyle.textContent,
    /\[data-chat-flow-kind\][^{]*\{[^}]*animation: dsh-desktop-message-in 180ms var\(--dsh-desktop-ease\);/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /\[data-chat-flow-kind\][^{]*\{[^}]*animation:[^;}]*\bboth\b/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_hoverStatus"\][^{]*\{[^}]*color: var\(--dsw-alias-label-tertiary\) !important/,
  );

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

test("desktop hero headline uses sentence case", async () => {
  const theme = await installTheme("MacIntel", "", { includeHeroHeadline: true });
  const { headline } = theme.heroHeadlineFixture;

  assert.equal(headline.textContent, "Into the unknown");
  assert.equal(headline.dataset.dshHeroHeadline, "");

  headline.textContent = "Into the Unknown";
  theme.flushMutations();
  assert.equal(headline.textContent, "Into the unknown");

  theme.cleanup();
  assert.equal(headline.textContent, "Into the Unknown");
  assert.equal(headline.dataset.dshHeroHeadline, undefined);
});

test("DeepSeek onboarding uses the product copy and official API-key link", async () => {
  const theme = await installTheme("MacIntel", "", { includeOnboarding: true });
  const { body, description, dialog, editor, fieldLabel, input, later, save, title } =
    theme.onboardingFixture;

  assert.equal(title.textContent, "Add your DeepSeek API key to get started");
  assert.equal(description.dataset.dshOnboardingDescription, "");
  assert.equal(body.dataset.dshOnboardingBody, "");
  assert.equal(editor.dataset.dshOnboardingEditor, "");
  assert.equal(fieldLabel.textContent, "DeepSeek API key");
  assert.equal(input.getAttribute("placeholder"), "Enter your DeepSeek API key");
  assert.equal(input.getAttribute("aria-label"), "DeepSeek API key");
  assert.equal(later.textContent, "Later");
  assert.equal(save.textContent, "Save");
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-deepseek-onboarding\] \[data-dsh-onboarding-description\] \{[^}]*display: none !important;/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-deepseek-onboarding\] \[data-dsh-onboarding-body\] \{[^}]*margin-top: 12px !important;/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-deepseek-onboarding\] \[data-dsh-onboarding-editor\] \{[^}]*margin-top: 0 !important;/,
  );

  let links = dialog.querySelectorAll("[data-dsh-onboarding-api-link]");
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, "Get API key ↗");
  assert.equal(links[0].getAttribute("href"), "https://platform.deepseek.com/api_keys");
  assert.equal(links[0].getAttribute("target"), "_blank");
  assert.equal(links[0].getAttribute("rel"), "noreferrer");

  theme.flushMutations();
  links = dialog.querySelectorAll("[data-dsh-onboarding-api-link]");
  assert.equal(links.length, 1);

  theme.cleanup();
  assert.equal(title.textContent, "Add an API key to get started");
  assert.equal(description.dataset.dshOnboardingDescription, undefined);
  assert.equal(body.dataset.dshOnboardingBody, undefined);
  assert.equal(editor.dataset.dshOnboardingEditor, undefined);
  assert.equal(fieldLabel.textContent, "API key");
  assert.equal(dialog.querySelectorAll("[data-dsh-onboarding-api-link]").length, 0);
  assert.equal(input.getAttribute("placeholder"), "Enter your API key");
  assert.equal(input.getAttribute("aria-label"), "API key");
  assert.equal(later.textContent, "Configure later");
  assert.equal(save.textContent, "Save and continue");
  assert.equal(dialog.dataset.dshDeepseekOnboarding, undefined);
});

test("Composer tooltip cannot move Workspace Write above the input", async () => {
  const theme = await installTheme("MacIntel", "", { includeComposer: true });
  const { extra, modes, tooltip, tools } = theme.composerFixture;

  assert.equal(modes.dataset.dshComposerModes, "");
  assert.equal(modes.dataset.dshComposerExtra, undefined);
  assert.equal(extra.dataset.dshComposerExtra, "");

  tooltip.parentElement = tools;
  tooltip.parentNode = tools;
  tools.children.splice(1, 0, tooltip);
  theme.flushMutations();

  assert.equal(tooltip.dataset.dshComposerModes, undefined);
  assert.equal(tooltip.dataset.dshComposerExtra, undefined);
  assert.equal(modes.dataset.dshComposerModes, "");
  assert.equal(modes.dataset.dshComposerExtra, undefined);
  assert.equal(extra.dataset.dshComposerExtra, "");

  tooltip.remove();
  theme.flushMutations();
  assert.equal(modes.dataset.dshComposerModes, "");
  assert.equal(modes.dataset.dshComposerExtra, undefined);

  theme.cleanup();
});

test("Composer keeps Do anything across hero and active chat states", async () => {
  const theme = await installTheme("MacIntel", "", { includeComposer: true });
  const { textarea } = theme.composerFixture;

  assert.equal(textarea.getAttribute("placeholder"), "Do anything");

  const upstreamStates = [
    ["hero without a workspace", "Choose a workspace to start"],
    ["hero with a workspace", "Describe what you want to build"],
    ["active chat", "Message the agent"],
    ["active chat while running", ""],
  ];
  for (const [state, upstreamPlaceholder] of upstreamStates) {
    theme.resetMutationObserverWrites();
    textarea.setAttribute("placeholder", upstreamPlaceholder);
    assert.equal(theme.mutationObserverState().observedWriteCount, 1, state);
    theme.flushMutations();
    assert.equal(textarea.getAttribute("placeholder"), "Do anything", state);
  }

  theme.cleanup();
  assert.equal(textarea.getAttribute("placeholder"), "Message the agent");
});

test("active Composer hides the aggregate stats dock", async () => {
  const theme = await installTheme("MacIntel");
  const slotRendererSource = await readFile(slotRendererPath, "utf8");

  assert.match(slotRendererSource, /const ANCHOR_STYLE = \{ display: "contents" \};/);
  assert.doesNotMatch(theme.appendedStyle.textContent, /--dsh-desktop-composer-stats-height/);
  assert.match(
    theme.appendedStyle.textContent,
    /data-phase="active"\] \[data-composer-seat\][\s\S]*?data-slot="conversation\.composer\.dock"\][^{]*\{[^}]*display: none !important/,
  );
  assert.doesNotMatch(theme.appendedStyle.textContent, /\[data-composer-card\]:last-child/);

  theme.cleanup();
});

test("queued follow-up bar spans only the Composer's flat top edge", async () => {
  const theme = await installTheme("MacIntel");

  assert.match(
    theme.appendedStyle.textContent,
    /data-composer-seat\] \[data-queue-dock\][^{]*\{[^}]*width: calc\(\s*100% -\s*var\(--dsh-composer-side-clearance\) -\s*var\(--dsh-composer-side-clearance\) -\s*var\(--dsh-desktop-card-radius\) -\s*var\(--dsh-desktop-card-radius\)\s*\) !important;[^}]*max-width: calc\(\s*var\(--dsh-desktop-composer-width\) -\s*var\(--dsh-desktop-card-radius\) -\s*var\(--dsh-desktop-card-radius\)\s*\) !important;[^}]*margin-inline: auto !important;[^}]*padding-inline: 0 !important;/,
  );

  theme.cleanup();
});

test("new-query Composer paints directly in its fixed seat without entry motion", async () => {
  const theme = await installTheme("MacIntel");
  const source = await readFile(clientPath, "utf8");

  assert.match(
    theme.appendedStyle.textContent,
    /data-composer-seat\]\[data-dsh-composer-fixed\][^{]*\{[^}]*translate: none !important/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /data-phase="hero"\] \*[\s\S]*?transition: none !important/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /data-chat-flow-kind\][^{]*\{[^}]*animation: none !important/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /data-dsh-desktop-sidebar\]\[class\*="_railIn"\] \*[\s\S]*?animation: none !important/,
  );
  assert.doesNotMatch(source, /dshComposerEntering|composer-enter-[xy]|animateFixedComposerFromHero/);

  theme.cleanup();
});

test("Composer command menu matches the card width and gives every item a library icon", async () => {
  const theme = await installTheme("MacIntel", "", { includeComposer: true });
  const { commandMenu, commandMenuItems } = theme.composerFixture;

  assert.match(
    theme.appendedStyle.textContent,
    /data-composer-card\] \[data-dsh-composer-command-menu\][^{]*\{[^}]*width: 100% !important;[^}]*min-width: 100% !important;[^}]*max-width: 100% !important;[^}]*left: 0 !important;[^}]*right: 0 !important/,
  );
  assert.equal(commandMenu.dataset.dshComposerCommandMenu, "");

  const expected = {
    compact: "shrink",
    export: "download",
    feedback: "message-square-plus",
    goal: "circle-gauge",
    permission: "shield-check",
    plan: "file-pen-line",
    model: "brain",
    "custom-skill": "file-cog",
    "research-agent": "bot",
  };
  for (const item of commandMenuItems) {
    const slug = expected[item.name];
    assert.equal(item.button.dataset.dshComposerCommandMenuItem, "");
    assert.equal(item.button.dataset.dshCommandIcon, slug);
    assert.match(
      item.button.style.getPropertyValue("--dsh-desktop-command-icon"),
      /^url\("data:image\/svg\+xml,/,
    );
  }

  theme.cleanup();
  assert.equal(commandMenu.dataset.dshComposerCommandMenu, undefined);
  for (const item of commandMenuItems) {
    assert.equal(item.button.dataset.dshComposerCommandMenuItem, undefined);
    assert.equal(item.button.style.getPropertyValue("--dsh-desktop-command-icon"), "");
  }
});

test("scrollbars reveal only while their own scrollport is moving", async () => {
  const theme = await installTheme("MacIntel", "", { includeComposer: true });
  const { commandMenu } = theme.composerFixture;

  assert.match(
    theme.appendedStyle.textContent,
    /body \*::-webkit-scrollbar-thumb\s*\{[^}]*background-color: transparent;[^}]*transition: background-color 160ms/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /body \[data-dsh-scroll-active\]::-webkit-scrollbar-thumb\s*\{[^}]*background-color: var\(--dsh-scrollbar-thumb\)/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /@supports not selector\(::-webkit-scrollbar\)[\s\S]*scrollbar-color: transparent transparent;[\s\S]*scrollbar-color: var\(--dsh-scrollbar-thumb\) transparent;/,
  );
  assert.equal(theme.scrollListenerCount(), 1);
  assert.equal(commandMenu.dataset.dshScrollActive, undefined);

  theme.dispatchScroll(commandMenu);
  assert.equal(commandMenu.dataset.dshScrollActive, "");
  theme.dispatchScroll(commandMenu);
  theme.flushTimeouts();
  assert.equal(commandMenu.dataset.dshScrollActive, undefined);

  theme.dispatchScroll();
  assert.equal(theme.documentBody.dataset.dshScrollActive, "");
  theme.cleanup();
  assert.equal(theme.scrollListenerCount(), 0);
  assert.equal(theme.documentBody.dataset.dshScrollActive, undefined);

  theme.dispatchScroll(commandMenu);
  assert.equal(commandMenu.dataset.dshScrollActive, undefined);
});

test("Todo dock floats above the Composer without changing its reserved height", async () => {
  const source = await readFile(clientPath, "utf8");

  assert.match(
    source,
    /:is\(\s*\[data-testid="todo-panel"\],\s*\[data-dsh-scroll-button\],\s*\[data-dsh-steer-action\]\s*\)\s*\{[^}]*border: 1px solid var\(--dsw-alias-border-l2\);[^}]*background: var\(--dsw-alias-button-floating-fill\);[^}]*box-shadow: var\(--dsw-shadow-lv2\);/,
  );
  assert.match(
    source,
    /\[data-testid="todo-panel"\]\s*\{[^}]*display: none !important/,
  );
  assert.match(
    source,
    /\[data-phase="active"\]:has\(\[data-chat-flow\] > \[data-dsh-live-status\]\)[\s\S]*?\[data-testid="todo-panel"\]\s*\{[^}]*display: block !important/,
  );
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
  assert.match(
    source,
    /data-testid="todo-panel"\]\[data-dsh-todo-overlay\][^{]*\{[^}]*position: absolute !important;[^}]*--dsh-desktop-todo-top[^}]*--dsh-desktop-todo-left/,
  );
  assert.match(
    source,
    /const todoPanel = prepareTodoOverlay\(seat\);[\s\S]*?const seatHeight = seat\.offsetHeight/,
  );
  assert.match(
    source,
    /const top = cardRect\.top - seatRect\.top - panelRect\.height - 12;/,
  );
  assert.match(
    source,
    /const anchorTop =[\s\S]*?Math\.min\(cardRect\.top, todoRect\.top\)[\s\S]*?const top = anchorTop - 36 - 12;/,
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
  const search = element("button");
  search.setAttribute("class", "qDHVXG_searchButton");
  search.setAttribute("aria-label", "Search workspaces and tasks");
  region.append(search);
  const foot = element();
  sidebarRoot.append(logo, newSession, region, foot);
  sidebarSlotWrapper.append(sidebarRoot);
  sidebarColumn.append(sidebarSlotWrapper);
  const center = element();
  const details = element();
  const overlay = element();
  shell.append(sidebarColumn, center, details, overlay);
  return { shell, sidebarColumn, sidebarSlotWrapper, sidebarRoot, logo, newSession, region, search, foot, center, details, overlay };
}

function createComposerFixture(HTMLElementClass, SVGElementClass) {
  const element = (tagName = "div") => new HTMLElementClass(tagName);
  const svgElement = (tagName, attributes = {}) => new SVGElementClass(tagName, attributes);
  const card = element();
  card.dataset.composerCard = "";
  const input = element();
  input.dataset.inputScroll = "";
  const textarea = element("textarea");
  textarea.setAttribute("placeholder", "Message the agent");
  input.append(textarea);

  const row = element();
  const tools = element();
  const command = element("button");
  command.setAttribute("aria-haspopup", "listbox");
  const modes = element();
  const permission = element("button");
  permission.setAttribute("aria-haspopup", "menu");
  modes.append(permission);
  const extra = element();
  tools.append(command, modes, extra);
  const tooltip = element("span");
  tooltip.setAttribute("role", "tooltip");

  const trailing = element();
  const model = element("button");
  model.setAttribute("aria-haspopup", "menu");
  const primary = element("button");
  const primaryIcon = svgElement("svg", {
    "aria-hidden": "true",
    height: "16",
    viewBox: "0 0 16 16",
    width: "16",
  });
  const renderPrimarySend = () => {
    primaryIcon.replaceChildren(svgElement("path", {
      d: "M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z",
      fill: "currentColor",
    }));
  };
  const renderPrimaryStop = () => {
    primaryIcon.replaceChildren(svgElement("rect", {
      fill: "currentColor",
      height: "10",
      rx: "3",
      width: "10",
      x: "3",
      y: "3",
    }));
  };
  renderPrimarySend();
  primary.append(primaryIcon);
  trailing.append(model, primary);
  row.append(tools, trailing);
  card.append(input, row);
  primaryIcon.isConnected = true;

  const commandMenu = element();
  commandMenu.setAttribute("role", "listbox");
  const commandGroup = element();
  commandGroup.dataset.source = "command";
  const commandMenuItems = [
    ["compact", "command"],
    ["export", "command"],
    ["feedback", "command"],
    ["goal", "command"],
    ["permission", "command"],
    ["plan", "command"],
    ["model", "command"],
    ["custom-skill", "skill"],
    ["research-agent", "subagent"],
  ].map(([name, source], index) => {
    const button = element("button");
    button.id = `dsh-slash-option-${source}-${index}`;
    button.setAttribute("role", "option");
    const label = element("span");
    label.textContent = name;
    button.append(label);
    button.querySelector = (selector) => selector === '[class*="_itemName"]' ? label : null;
    return { button, label, name };
  });
  commandMenu.append(commandGroup, ...commandMenuItems.map((item) => item.button));
  commandMenu.querySelector = (selector) => selector === "[data-source]" ? commandGroup : null;
  commandMenu.querySelectorAll = (selector) =>
    selector === 'button[role="option"]'
      ? commandMenuItems.map((item) => item.button)
      : [];

  return {
    card,
    command,
    commandMenu,
    commandMenuItems,
    elements: [
      card,
      input,
      textarea,
      row,
      tools,
      command,
      modes,
      permission,
      extra,
      tooltip,
      trailing,
      model,
      primary,
      primaryIcon,
      commandMenu,
      commandGroup,
      ...commandMenuItems.flatMap((item) => [item.button, item.label]),
    ],
    extra,
    modes,
    primary,
    primaryIcon,
    renderPrimarySend,
    renderPrimaryStop,
    tooltip,
    textarea,
    tools,
  };
}

function createProgressFixture(HTMLElementClass) {
  const element = (tagName = "div") => new HTMLElementClass(tagName);
  const flow = element();
  flow.dataset.chatFlow = "";

  const userRow = element();
  userRow.dataset.chatFlowKind = "user";
  userRow.dataset.chatAnchorKey = "user:1";

  const progressRow = element();
  progressRow.dataset.chatFlowKind = "assistant-step";
  progressRow.dataset.chatAnchorKey = "assistant:1";
  const progressRoot = element();
  const progressBody = element();
  const progressCopy = element();
  progressCopy.textContent =
    "I checked the app. Next, I'll prepare the release package, then verify it.";
  progressBody.append(progressCopy);
  progressRoot.append(progressBody);
  progressRow.append(progressRoot);

  const toolCallRow = ({ anchor, name, state, summaryText }) => {
    const row = element();
    row.dataset.chatFlowKind = "tool-call";
    row.dataset.chatAnchorKey = anchor;
    const root = element();
    root.dataset.tool = name;
    root.dataset.state = state;
    const disclosure = element();
    disclosure.dataset.disclosureRow = "true";
    const leading = element("span");
    const title = element("span");
    title.textContent = name;
    const separator = element("span");
    const summary = element("span");
    summary.textContent = summaryText;
    disclosure.append(leading, title, separator, summary);
    root.append(disclosure);
    row.append(root);

    const baseToolQuery = root.querySelector.bind(root);
    root.querySelector = (selector) =>
      selector === "[data-disclosure-row]" ? disclosure : baseToolQuery(selector);
    const baseRowQueryAll = row.querySelectorAll.bind(row);
    row.querySelectorAll = (selector) => {
      if (selector === "[data-tool]") return [root];
      for (const candidate of ["running", "error", "ok"]) {
        if (selector === `[data-state="${candidate}"]`) {
          return root.dataset.state === candidate ? [root] : [];
        }
      }
      return baseRowQueryAll(selector);
    };
    row.querySelector = (selector) => row.querySelectorAll(selector)[0] ?? null;
    return { header: disclosure, root, row };
  };

  const firstTool = toolCallRow({
    anchor: "tool:1",
    name: "bash",
    state: "running",
    summaryText: "open DeepSeek Harness UX First Dev.app",
  });
  const secondTool = toolCallRow({
    anchor: "tool:2",
    name: "read",
    state: "ok",
    summaryText: "package.json",
  });
  const { header, root: toolRoot, row: toolRow } = firstTool;
  const { root: secondToolRoot, row: secondToolRow } = secondTool;

  const status = element();
  status.setAttribute("role", "status");
  const statusText = {
    nodeType: 3,
    nodeValue: "Deep diving...",
    parentNode: status,
    remove() {
      this.nodeValue = "";
    },
  };
  Object.defineProperty(status, "childNodes", {
    get() {
      return [statusText, ...status.children];
    },
  });

  flow.append(userRow, progressRow, toolRow, secondToolRow, status);
  return {
    flow,
    header,
    progressRow,
    reasoningBlocks: [],
    rows: [userRow, progressRow, toolRow, secondToolRow],
    secondToolRoot,
    secondToolRow,
    status,
    statusText,
    toolRoot,
    toolRow,
    userRow,
  };
}

function createFinalDividerFixture(HTMLElementClass) {
  const element = (tagName = "div") => new HTMLElementClass(tagName);
  const flow = element();
  flow.dataset.chatFlow = "";

  const userRow = () => {
    const row = element();
    row.dataset.chatFlowKind = "user";
    return row;
  };
  const assistantRow = (blocks) => {
    const row = element();
    row.dataset.chatFlowKind = "assistant-step";
    const root = element();
    const body = element();
    body.append(...blocks);
    root.append(body);
    row.append(root);
    return row;
  };
  const textBlock = (copy) => {
    const block = element();
    block.textContent = copy;
    return block;
  };

  const firstUser = userRow();
  const directFinal = assistantRow([textBlock("Direct answer")]);

  const secondUser = userRow();
  const progress = assistantRow([textBlock("I checked the current implementation.")]);
  const command = element();
  command.dataset.chatFlowKind = "command";
  const workedFinal = assistantRow([textBlock("Implemented the requested change.")]);

  const thirdUser = userRow();
  const reasoning = element();
  reasoning.dataset.variant = "think";
  reasoning.textContent = "Reasoning";
  const reasonedAnswer = textBlock("Final result");
  const reasonedFinal = assistantRow([reasoning, reasonedAnswer]);

  const rows = [
    firstUser,
    directFinal,
    secondUser,
    progress,
    command,
    workedFinal,
    thirdUser,
    reasonedFinal,
  ];
  flow.append(...rows);
  return {
    directFinal,
    flow,
    reasonedAnswer,
    reasonedFinal,
    reasoningBlocks: [reasoning],
    rows,
    toolRow: command,
    userRow: firstUser,
    workedFinal,
  };
}

test("desktop UI installs the Jesse composer treatment without replacing Harness markup", async () => {
  const { appendedStyle, cleanup, documentElement } = await installTheme("MacIntel");
  const source = await readFile(clientPath, "utf8");

  assert.equal(documentElement.dataset.dshDesktopUi, "jesse-composer");
  assert.equal(documentElement.dataset.dshDesktopHost, "macos");
  assert.equal(documentElement.dataset.dshDesktopPlatform, "macos");
  assert.equal(documentElement.dataset.dshWindowRole, "main");
  assert.doesNotMatch(appendedStyle.textContent, /backdrop-filter: blur\(/);
  assert.doesNotMatch(appendedStyle.textContent, /saturate\(/);
  assert.match(appendedStyle.textContent, /--dsh-desktop-composer-width: 654px/);
  assert.match(
    appendedStyle.textContent,
    /--dsh-desktop-composer-extra-clearance: 16px/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-phase="active"\] > \[data-conversation-scroll\]:has\(\s*\[data-conversation-composer-overlay\]\s*\) > \[data-composer-seat\][^{]*\{[^}]*display: none !important/,
  );
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
    /data-dsh-hero-workspace-row\]\s*button\[data-dsh-composer-menu-trigger\][^{]*\{[^}]*font-weight: 400 !important/,
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
  assert.match(
    appendedStyle.textContent,
    /\*,\s*\*::before,\s*\*::after\s*\{[^}]*corner-shape: superellipse\(1\.6\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-composer-card\][^{]*\{[^}]*corner-shape: superellipse\(1\.6\)/,
  );
  assert.match(appendedStyle.textContent, /padding: 8px 8px 8px 16px !important/);
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
  assert.match(appendedStyle.textContent, /--dsh-desktop-composer-active-shadow: rgb\(159 159 159 \/ 20%\)/);
  assert.match(appendedStyle.textContent, /--dsh-desktop-composer-shadow-blur: 48px/);
  assert.match(
    appendedStyle.textContent,
    /data-phase="active"\] \[data-composer-card\][^{]*\{[^}]*--dsh-desktop-composer-shadow: var\(--dsh-desktop-composer-active-shadow\);[^}]*--dsh-desktop-composer-shadow-blur: 16px/,
  );
  assert.match(
    appendedStyle.textContent,
    /transition:\s*box-shadow 160ms var\(--dsh-desktop-ease\)/,
  );
  assert.doesNotMatch(appendedStyle.textContent, /drop-shadow\(8px 8px 54px/);
  assert.doesNotMatch(appendedStyle.textContent, /0 18px 54px/);
  assert.doesNotMatch(appendedStyle.textContent, /linear-gradient\(180deg, rgb\(255 255 255 \/ 46%\)/);
  assert.doesNotMatch(appendedStyle.textContent, /linear-gradient\(rgb\(255 255 255 \/ 30%\)/);
  assert.doesNotMatch(appendedStyle.textContent, /rgb\(63 156 255 \/ 9%\)/);
  assert.match(appendedStyle.textContent, /data-dsh-composer-primary/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-modes\] button,[\s\S]*?data-dsh-composer-modes\] select[^{]*\{[^}]*background-color: transparent !important/,
  );
  assert.match(source, /setAttribute\("placeholder", "Do anything"\)/);
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
    source,
    /data-dsh-atom-pane\][^{]*\{[^}]*border-radius: var\(--dsh-desktop-panel-radius\)/,
  );
  assert.match(
    source,
    /data-dsh-atom-pane\][^{]*\{[^}]*overflow: hidden;[^}]*clip-path: inset\(0 round var\(--dsh-desktop-panel-radius\)\);[^}]*isolation: isolate;/,
  );
  assert.doesNotMatch(
    source,
    /\[data-dsh-atom-pane\]\[data-focused\][^{]*\{[^}]*border-color/,
  );
  assert.match(
    source,
    /html\[data-dsh-atom-frame-root\] \[data-dsh-desktop-center\][^\n]*border: 0 !important;[^\n]*outline: 0 !important;[^\n]*box-shadow: none !important/,
  );
  assert.match(source, /\[data-dsh-atom-frame\][^\n]*outline: 0;[^\n]*box-shadow: none/);
  assert.match(source, /const ATOM_DIVIDER_SIZE = 8;/);
  assert.match(
    source,
    /\[data-dsh-desktop-center\]:has\(> \[data-dsh-atom-host\]\)[^\n]*background: transparent !important/,
  );
  assert.match(
    source,
    /\[data-dsh-atom-divider\][^\n]*background: transparent/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-conversation-scroll\][^{]*\{[^}]*scroll-behavior: auto/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-conversation-scroll\]\[data-dsh-composer-fixed-host\]::after[^{]*\{[^}]*flex: 0 0 calc\([\s\S]*?var\(--dsh-desktop-composer-reserve[\s\S]*?var\(--dsh-desktop-composer-extra-clearance\)[\s\S]*?height: calc\([\s\S]*?var\(--dsh-desktop-composer-reserve[\s\S]*?var\(--dsh-desktop-composer-extra-clearance\)/,
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
    source,
    /const left = cardRect\.left \+ cardRect\.width \/ 2 - 18;[\s\S]*const anchorTop =[\s\S]*Math\.min\(cardRect\.top, todoRect\.top\)[\s\S]*const top = anchorTop - 36 - 12;/,
  );
  assert.doesNotMatch(source, /previousOffset|dshScrollButtonOffsetX/);
  assert.match(source, /for \(const flow of scrollport\.querySelectorAll\("\[data-chat-flow\]"\)\)/);
  assert.match(source, /slot\.querySelector\(":scope > button"\)/);
  assert.doesNotMatch(source, /const marked = document\.querySelector\("\[data-dsh-scroll-button\]"\)/);
  assert.match(source, /syncFixedComposerLayout\(\);[\s\S]*markScrollButton\(\);/);
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
    /data-dsh-session-header\][^{]*\{[^}]*padding-top: 6px !important;[^}]*padding-bottom: 6px !important;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-new\][^{]*\{[^}]*height: 34px !important[^}]*border-radius: 24px !important/,
  );
  const newSessionRule = appendedStyle.textContent.match(
    /\[data-dsh-desktop-sidebar-new\]\s*\{([^}]*)\}/,
  )?.[1];
  assert.match(newSessionRule ?? "", /align-self: stretch !important/);
  assert.match(newSessionRule ?? "", /justify-content: flex-start !important/);
  assert.match(newSessionRule ?? "", /width: auto !important/);
  assert.match(newSessionRule ?? "", /margin: 0 14px 2px -8px !important/);
  assert.match(newSessionRule ?? "", /padding: 0 8px 0 0 !important/);
  assert.match(newSessionRule ?? "", /gap: 6px !important/);
  assert.match(newSessionRule ?? "", /border: 0 !important/);
  assert.match(newSessionRule ?? "", /border-left: 8px solid transparent !important/);
  assert.match(newSessionRule ?? "", /background: transparent !important/);
  assert.match(newSessionRule ?? "", /font-weight: 400 !important/);
  assert.match(newSessionRule ?? "", /box-shadow: none !important/);
  assert.doesNotMatch(newSessionRule ?? "", /linear-gradient/);
  assert.match(
    appendedStyle.textContent,
    /\[data-dsh-desktop-sidebar-new\]:hover[^{]*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\][^{]*\{[^}]*justify-content: center !important;[^}]*width: 36px !important;[^}]*height: 36px !important;[^}]*margin: 0 0 2px !important;[^}]*padding: 0 !important;[^}]*gap: 0 !important;[^}]*border: 0 !important;[^}]*border-left-width: 0 !important;[^}]*border-radius: 50% !important;[^}]*background: transparent !important;[^}]*box-shadow: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\]:hover[^{]*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\]:active[^{]*\{[^}]*transform: none/,
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
    /--dsh-desktop-sidebar-content-inset: 14px/,
  );
  assert.match(appendedStyle.textContent, /--dsh-sidebar-inline-padding: 14px !important/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-logo\][^{]*\{[^}]*padding: 32px 14px 0 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-new\][^{]*\{[^}]*align-self: stretch !important;[^}]*justify-content: flex-start !important;[^}]*width: auto !important;[^}]*margin: 0 14px 2px -8px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-foot\][^{]*\{[^}]*padding-right: 14px/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\][^{]*\{[^}]*box-sizing: border-box;[^}]*justify-content: flex-start !important;[^}]*width: calc\(100% \+ 8px\) !important;[^}]*margin: 4px 0 0 -8px !important;[^}]*padding-inline: 0 10px !important;[^}]*border-left: 8px solid transparent !important;[^}]*border-radius: 24px !important;[^}]*overflow: hidden;[^}]*transition:[^}]*width[^}]*margin[^}]*padding[^}]*border-left-width[^}]*border-radius/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\][^{]*\{[^}]*justify-content: flex-start !important;[^}]*width: 36px !important;[^}]*height: 36px !important;[^}]*padding: 0 0 0 9px !important;[^}]*gap: 0 !important;[^}]*border-left-width: 0 !important;[^}]*border-radius: 50% !important/,
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
    /data-dsh-desktop-sidebar-region\] \[class\*="_sectionLabelHidden"\][^{]*\{[^}]*margin-right: -2px !important/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\] \[class\*="_searchExpanded"\][^{]*\{[^}]*margin-inline: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_treeBody"\] > \[role="tree"\] > \[class\*="_empty"\][^{]*\{[^}]*display: flex;[^}]*align-items: center;[^}]*height: 32px;[^}]*padding: 0 !important;[^}]*line-height: 20px;/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_root"\]:not\(\[class\*="_rail"\]\)[\s\S]*?> \[class\*="_sectionHeader"\]:first-child[^{]*\{[^}]*display: grid !important;[^}]*grid-template-rows: 34px 36px;[^}]*row-gap: 12px !important;[^}]*height: 82px !important;[^}]*margin: 0 0 4px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /> \[class\*="_searchSlot"\][^{]*\{[^}]*margin: 0 0 0 -8px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-search\]::after[^{]*\{[^}]*content: attr\(data-dsh-desktop-sidebar-search-label\);[^}]*max-width: var\(--dsh-desktop-sidebar-search-prefix-width, 100%\);[^}]*font-size: 14px;[^}]*font-weight: 400;[^}]*opacity: 1;[^}]*transition:[^}]*max-width[^}]*opacity/,
  );
  assert.match(
    appendedStyle.textContent,
    /> \[class\*="_searchSlot"\]\s*> \[class\*="_search"\][^{]*\{[^}]*position: relative;[^}]*width: 100% !important;[^}]*margin: 0 !important;[^}]*border-left: 8px solid transparent !important;[^}]*box-shadow: inset 0 0 0 0 transparent;[^}]*transition:[^}]*width[^}]*margin-left[^}]*padding-left[^}]*border-left-width[^}]*border-radius[^}]*box-shadow/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_sectionHeader"\]:first-child:has\(\[class\*="_searchExpanded"\]\)[^{]*\{[^}]*grid-template-rows: 34px 0;[^}]*height: 34px !important;[^}]*margin-bottom: 12px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-search\][^{]*\{[^}]*width: 100% !important;[^}]*color: var\(--dsw-alias-label-primary\) !important;[^}]*transition:[^}]*padding-right 240ms[^}]*color 160ms/,
  );
  assert.match(
    appendedStyle.textContent,
    /> \[class\*="_searchExpanded"\][^{]*\{[^}]*width: calc\(100% - 8px\) !important;[^}]*margin-left: 8px !important;[^}]*padding-left: 8px !important;[^}]*border-left-width: 0 !important;[^}]*border-radius: 24px !important;[^}]*box-shadow: inset 0 0 0 1px var\(--dsw-alias-border-l2\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /> \[class\*="_searchExpanded"\][\s\S]*?\[data-dsh-desktop-sidebar-search\][^{]*\{[^}]*justify-content: flex-start !important;[^}]*width: 100% !important;[^}]*height: 34px !important;[^}]*padding-right: 32px !important;[^}]*gap: 6px !important;[^}]*color: var\(--dsw-alias-label-tertiary\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-sidebar-search\]::after[^{]*\{[^}]*color: inherit;/,
  );
  assert.match(
    appendedStyle.textContent,
    /\[class\*="_searchInput"\][^{]*\{[^}]*position: absolute;[^}]*inset: 0 32px 0 30px;[^}]*width: auto !important;[^}]*margin: 0 !important;[^}]*opacity: 0;[^}]*pointer-events: none;[\s\S]*?> \[class\*="_searchExpanded"\][\s\S]*?\[class\*="_searchInput"\][^{]*\{[^}]*opacity: 1;[^}]*pointer-events: auto/,
  );
  assert.match(
    appendedStyle.textContent,
    /> \[class\*="_searchExpanded"\][\s\S]*?\[data-dsh-desktop-sidebar-search\]::after[^{]*\{[^}]*max-width: calc\(100% - 54px\)/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /\[data-dsh-desktop-sidebar-search\]::after\s*\{[^}]*content: none/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /\[data-dsh-desktop-sidebar-search\]::after\s*\{[^}]*text-overflow: ellipsis/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /> \[class\*="_searchExpanded"\]\s*\[data-dsh-desktop-sidebar-search\]::after[^{]*\{[^}]*opacity: 0/,
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
    /class\*="_groupSection"\]:has\(> \[class\*="_tasksSectionHeader"\]\)[\s\S]*?class\*="_sessionRow"\][^{]*\{[^}]*padding-left: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_groupSection"\]:has\(> \[class\*="_tasksSectionHeader"\]\)[\s\S]*?class\*="_flatSessionRowWithoutStatus"\] > \[class\*="_title"\][^{]*\{[^}]*margin-left: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_sessionRow"\]:has\([\s\S]*?> \[class\*="_slot"\] > \[data-state\][\s\S]*?\) > \[class\*="_slot"\][^{]*\{[^}]*order: 1/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_sessionRow"\]:has\([\s\S]*?> \[class\*="_slot"\] > \[data-state\][\s\S]*?\) > \[class\*="_time"\][^{]*\{[^}]*display: none/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_groupSection"\][\s\S]*?class\*="_sessionRow"\]:has\([\s\S]*?> \[class\*="_slot"\] > \[data-state\][\s\S]*?\) > \[class\*="_title"\][^{]*\{[^}]*margin-left: 14px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_sessionRow"\]:has\([\s\S]*?> \[class\*="_slot"\] > \[data-state\][\s\S]*?\):is\(:hover, \[class\*="_menuOpen"\]\) > \[class\*="_slot"\][^{]*\{[^}]*display: none/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_tasksSectionHeader"\][^{]*\{[^}]*justify-content: flex-start !important;[^}]*margin-right: 0 !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_groupSection"\] > \[class\*="_sessionOverflowButton"\][^{]*\{[^}]*padding-left: 22px !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /class\*="_groupSection"\]:has\(> \[class\*="_tasksSectionHeader"\]\)[\s\S]*?> \[class\*="_sessionOverflowButton"\][^{]*\{[^}]*padding-left: 0 !important/,
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
  assert.doesNotMatch(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-column\][^{]*\{[^}]*grid-column:/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-center\][^{]*\{[^}]*grid-column:/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-details\][^{]*\{[^}]*grid-column:/,
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
    /data-dsh-desktop-sidebar-column\][^{]*\{[^}]*background: transparent !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-center\],[\s\S]*?data-dsh-desktop-details\][^{]*\{[^}]*background: var\(--dsw-alias-bg-base\) !important/,
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
    /class\*="_sessionRow"\]\[role="treeitem"\]\[aria-selected\]\[data-dsh-pending-session\][^{]*\{[^}]*display: none !important/,
  );
  assert.doesNotMatch(
    appendedStyle.textContent,
    /sidebar-region\][\s\S]*?\n\s*\[role="treeitem"\]\[aria-selected\]\[data-dsh-pending-session\][^{]*\{[^}]*display: none !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /role="treeitem"\]\:hover[^{]*\{[^}]*color-mix[\s\S]*?role="treeitem"\]\[aria-selected="true"\][^{]*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\) !important/,
  );
  assert.match(
    source,
    /function markPendingSidebarSessions\(\)[\s\S]*class\*="_sessionRow"[\s\S]*class\*="_time"[\s\S]*class\*="_rowActions"[\s\S]*row\.dataset\.dshPendingSession = ""/,
  );
  assert.match(source, /delete row\.dataset\.dshPendingSession/);
  assert.doesNotMatch(appendedStyle.textContent, /radial-gradient\(ellipse 112% 152%/);
  assert.match(
    appendedStyle.textContent,
    /data-dsh-desktop-host="macos"[^}]*\[data-dsh-desktop-shell\]::before[^{]*\{[^}]*height: 44px;[^}]*app-region: drag;[^}]*-webkit-app-region: drag/,
  );

  cleanup();
  assert.equal(appendedStyle.removed, true);
  assert.equal(documentElement.dataset.dshDesktopUi, undefined);
  assert.equal(documentElement.dataset.dshDesktopHost, undefined);
  assert.equal(documentElement.dataset.dshDesktopPlatform, undefined);
  assert.equal(documentElement.dataset.dshWindowRole, undefined);
});

test("standard macOS Harness plugin host always uses the opaque fallback", async () => {
  const fixture = await installTheme("MacIntel", "", { desktopHost: false });
  const css = fixture.appendedStyle.textContent;

  assert.equal(fixture.documentElement.dataset.dshDesktopPlatform, "macos");
  assert.equal(fixture.documentElement.dataset.dshDesktopHost, undefined);
  assert.equal(fixture.nativeThemeSources.length, 0);
  assert.match(
    css,
    /html:not\(\[data-dsh-desktop-host="macos"\]\),[\s\S]*?#root[^{]*\{[^}]*background: var\(--dsw-alias-bg-base\) !important/,
  );
  assert.match(
    css,
    /html:not\(\[data-dsh-desktop-host="macos"\]\) \[data-composer-card\][^{]*\{[^}]*backdrop-filter: none/,
  );
  assert.doesNotMatch(css, /data-dsh-desktop-platform="macos"[^}]*app-region: drag/);

  fixture.cleanup();
  assert.equal(fixture.documentElement.dataset.dshDesktopHost, undefined);
});

test("sidebar collapse aligns rail actions and omits compact search", async () => {
  const { appendedStyle, cleanup } = await installTheme("MacIntel");
  const css = appendedStyle.textContent;

  assert.match(
    css,
    /data-dsh-desktop-sidebar\][^{]*\{[^}]*width: 100% !important;[^}]*min-width: 0;[^}]*transition: padding/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar\] > \*[^{]*\{[^}]*opacity: 1 !important/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-logo\] button:last-child,[\s\S]*?data-dsh-desktop-sidebar-new\],[\s\S]*?data-dsh-desktop-sidebar-region\],[\s\S]*?data-dsh-desktop-sidebar-region\] button,[\s\S]*?data-dsh-desktop-sidebar-foot\][^{]*\{[^}]*animation: none !important/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-new\] > span[^{]*\{[^}]*max-width: 0 !important;[^}]*transform: translateX\(-8px\)/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?class\*="_rail"\][\s\S]*?> \[class\*="_sectionHeader"\][^{]*\{[^}]*justify-content: flex-start !important;[^}]*gap: 0 !important/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?class\*="_searchSlot"\],[\s\S]*?data-sidebar-collapsed\][\s\S]*?class\*="_rail"\][\s\S]*?> \[class\*="_search"\][^{]*\{[^}]*display: none !important/,
  );
  assert.doesNotMatch(css, /dsh-desktop-sidebar-search-settle/);
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?button\[class\*="_wide"\],[\s\S]*?class\*="_sectionLabel"\][^{]*\{[^}]*transform: translateX\(-100%\)/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?class\*="_listArea"\] > \*[^{]*\{[^}]*transform: translateX\(-100%\)/,
  );
  assert.match(
    css,
    /data-dsh-desktop-sidebar-foot\] > div[^{]*\{[^}]*justify-content: flex-start !important;[^}]*width: 100% !important;[^}]*min-width: 0/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\] > span[^{]*\{[^}]*max-width: 0 !important;[^}]*transform: translateX\(-8px\)/,
  );
  assert.match(
    css,
    /data-sidebar-collapsed\][\s\S]*?data-dsh-desktop-sidebar-foot\] button\[aria-haspopup="dialog"\] svg[^{]*\{[^}]*width: 18px !important;[^}]*height: 18px !important/,
  );

  cleanup();
});

test("New Task action stays quiet in light and dark themes", async () => {
  const { appendedStyle, cleanup } = await installTheme("MacIntel", "", {
    themePreference: "dark",
    colorScheme: "dark",
  });
  const css = appendedStyle.textContent;

  assert.doesNotMatch(css, /--dsh-desktop-sidebar-new-(?:rgb|alpha|hover-alpha)/);
  assert.match(
    css,
    /data-dsh-desktop-sidebar-new\][^{]*\{[^}]*background: transparent !important/,
  );
  assert.doesNotMatch(
    css,
    /body\[data-ds-dark-theme\] \[data-dsh-desktop-sidebar-new\]/,
  );

  cleanup();
});

test("Composer glass and native material follow the Harness theme source", async () => {
  const theme = await installTheme("MacIntel", "", {
    themePreference: "system",
    colorScheme: "dark",
  });
  const css = theme.appendedStyle.textContent;

  assert.deepEqual(Array.from(theme.plugin.inject), ["theme", "sessions", "workspaces", "layout"]);
  assert.deepEqual(theme.nativeThemeSources, ["system"]);
  assert.match(
    css,
    /body\s*\{[^}]*--dsh-desktop-composer-stroke: var\(--dsw-alias-border-l3\)/,
  );
  assert.match(
    css,
    /--dsh-desktop-placeholder: var\(--dsw-alias-label-caption\)/,
  );
  assert.match(
    css,
    /:root\s*\{[^}]*--dsh-desktop-send-disabled-bg: rgb\(235 238 242\)/,
  );
  assert.match(
    css,
    /body\[data-ds-dark-theme\][^{]*\{[^}]*--dsh-desktop-send-disabled-bg: rgb\(67 69 74\)/,
  );
  assert.match(
    css,
    /body\[data-ds-dark-theme\][^{]*\{[^}]*--dsh-desktop-composer-active-shadow: rgb\(0 0 0 \/ 48%\)/,
  );
  assert.match(
    css,
    /data-dsh-composer-primary\][^{]*\{[^}]*color: var\(--dsw-alias-label-primary-foreground\) !important;[^}]*background: var\(--dsw-alias-button-primary-fill\) !important/,
  );
  assert.match(
    css,
    /data-dsh-composer-primary\]:disabled\s*\{[^}]*background: var\(--dsh-desktop-send-disabled-bg\) !important;[^}]*opacity: 1 !important/,
  );
  assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\)/);

  theme.setTheme("dark", "dark");
  theme.setTheme("light", "light");
  theme.setTheme("system", "dark");
  assert.deepEqual(theme.nativeThemeSources, ["system", "dark", "light", "system"]);

  theme.cleanup();
  theme.setTheme("dark", "dark");
  assert.deepEqual(theme.nativeThemeSources, ["system", "dark", "light", "system"]);
});

test("workspace grouping and sorting control is removed from the desktop sidebar", async () => {
  const { appendedStyle, cleanup } = await installTheme("MacIntel");
  const css = appendedStyle.textContent;

  assert.match(
    css,
    /data-dsh-desktop-sidebar-region\] \[class\*="_sectionHeader"\][^{]*\{[^}]*gap: 2px !important/,
  );
  assert.match(
    css,
    /data-dsh-desktop-sidebar-region\] button\[aria-label="View options"\],[\s\S]*?data-dsh-desktop-sidebar-region\] button\[aria-label="视图选项"\],[\s\S]*?data-lucide-animated-icon="user-round-cog"\]\)[^{]*\{[^}]*display: none !important/,
  );

  cleanup();
});

test("inactive workspace icons inherit the workspace label color", async () => {
  const { appendedStyle, cleanup } = await installTheme("MacIntel");

  assert.match(
    appendedStyle.textContent,
    /class\*="_projectRow"\] > \[class\*="_folder"\]:not\(\[class\*="_folderActive"\]\)[^{]*\{[^}]*color: inherit;/,
  );

  cleanup();
});

test("sidebar leaves Tasks visible independently of the Workspace registry", async () => {
  const fixture = await installTheme("MacIntel", "", {
    includeShell: true,
    includeSidebarSessions: true,
    workspaceItems: [{ workspaceId: "workspace:1" }],
  });

  assert.equal(fixture.workspaceSubscriberCount(), 0);
  assert.doesNotMatch(
    fixture.appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\][\s\S]*?class\*="_groupSection"\]:has\([\s\S]*?> \[class\*="_projectRow"\]\[draggable="false"\][\s\S]*?\)[^{]*\{[^}]*display: none !important/,
  );
  assert.doesNotMatch(
    fixture.appendedStyle.textContent,
    /data-dsh-desktop-sidebar-region\]\[data-dsh-workspaces-empty\][\s\S]*?class\*="_listArea"\] > \*[^{]*\{[^}]*display: none !important/,
  );

  fixture.setWorkspaces([]);
  fixture.setWorkspaces([{ workspaceId: "workspace:2" }]);

  fixture.cleanup();
  assert.equal(fixture.workspaceSubscriberCount(), 0);
});

test("modal mask remains entirely inside the Chromium renderer", async () => {
  const fixture = await installTheme("MacIntel");
  const mainSource = await readFile(mainPath, "utf8");
  const preloadSource = await readFile(preloadPath, "utf8");

  assert.match(
    fixture.appendedStyle.textContent,
    /role="presentation"\]:has\(> \[role="dialog"\]\[aria-modal="true"\]\)[\s\S]*?> \[aria-hidden="true"\][^{]*\{[^}]*-webkit-backdrop-filter: none !important;[^}]*backdrop-filter: none !important;/,
  );
  assert.match(
    fixture.appendedStyle.textContent,
    /role="presentation"\]:has\(> \[role="dialog"\]\[aria-modal="true"\]\)[^{]*\{[^}]*position: fixed !important;[^}]*inset: 0 !important;[^}]*z-index: 2147483000 !important;/,
  );
  assert.doesNotMatch(mainSource, /modalOverlay|setModalMask|NSPanel|NSGlassEffectView/);
  assert.doesNotMatch(preloadSource, /modal-overlay|setModalOverlayVisible/);

  fixture.cleanup();
});

test("Windows keeps the Jesse composer geometry while disabling glass", async () => {
  const { appendedStyle, cleanup, documentElement } = await installTheme("Win32");

  assert.equal(documentElement.dataset.dshDesktopPlatform, "windows");
  assert.equal(documentElement.dataset.dshDesktopHost, undefined);
  assert.match(
    appendedStyle.textContent,
    /html:not\(\[data-dsh-desktop-host="macos"\]\) \[data-composer-card\][\s\S]*?backdrop-filter: none/,
  );
  assert.match(appendedStyle.textContent, /--dsh-desktop-card-radius: 28px/);
  assert.match(
    appendedStyle.textContent,
    /data-composer-card\][^{]*\{[^}]*min-height: 84px[^}]*corner-shape: superellipse\(1\.6\)/,
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
    /data-dsh-composer-command\][^{]*\{[^}]*justify-self: start;[^}]*width: 32px;[^}]*transform: translateX\(-8px\) !important/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-command\] button,[\s\S]*?button\[data-dsh-composer-command\][^{]*\{[^}]*width: 32px !important;[^}]*height: 32px !important/,
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
    /grid-template-columns:\s*24px minmax\(0, 1fr\) minmax\(0, max-content\)\s*minmax\(0, max-content\)/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-trailing\][^{]*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*justify-content: flex-end;[^}]*justify-self: end;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-trailing\][\s\S]*?> :has\(> button\[data-dsh-composer-menu-trigger="model"\]\)[^{]*\{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*max-width: 220px;/,
  );
  assert.match(
    appendedStyle.textContent,
    /button\[data-dsh-composer-menu-trigger="model"\][^{]*\{[^}]*width: 100% !important;[^}]*max-width: 220px;[^}]*padding-right: 0 !important;[^}]*overflow: hidden;/,
  );
  assert.match(
    appendedStyle.textContent,
    /data-dsh-composer-trailing\]:not\(:has\([\s\S]*?button\[aria-haspopup="dialog"\]:not\(\[data-dsh-composer-menu-trigger="model"\]\)[\s\S]*?button\[data-dsh-composer-menu-trigger="model"\][^{]*\{[^}]*padding-right: 7px !important;/,
  );
  assert.match(
    appendedStyle.textContent,
    /button\[data-dsh-composer-menu-trigger="model"\] > span:first-of-type[^{]*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;[^}]*overflow: hidden;/,
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
    /html:not\(\[data-dsh-desktop-host="macos"\]\) \[data-dsh-desktop-shell\][\s\S]*?backdrop-filter: none/,
  );

  cleanup();
});

test("Electron shell provides a registered multi-window atom bridge", async () => {
  const [mainSource, preloadSource, clientSource, packageSource, workspaceSource] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(preloadPath, "utf8"),
    readFile(clientPath, "utf8"),
    readFile(join(root, "package.json"), "utf8"),
    readFile(workspaceSourcePath, "utf8"),
  ]);

  assert.equal((mainSource.match(/new BrowserWindow\(/g) ?? []).length, 1);
  assert.match(mainSource, /BrowserWindow\.getAllWindows\(\)/);
  assert.match(mainSource, /const atomWindows = new Map\(\)/);
  assert.match(mainSource, /const atomWindowZOrder = \[\]/);
  assert.match(mainSource, /const pendingAtomMerges = new Map\(\)/);
  assert.match(mainSource, /async function createAtomWindow/);
  assert.match(mainSource, /const partition = `dsh-atom-\$\{windowId\.replace/);
  assert.match(mainSource, /createWindow\(\{[\s\S]*?role: "atom",[\s\S]*?partition,/);
  assert.match(mainSource, /const width = Math\.min\(514, area\.width\)/);
  assert.match(mainSource, /const height = Math\.min\(532, area\.height\)/);
  assert.match(mainSource, /Math\.max\(420, bounds\.width \?\? 514\)/);
  assert.match(mainSource, /showOnReady: true,[\s\S]*?role: "atom"/);
  assert.doesNotMatch(mainSource, /dshAtomSessionReady[\s\S]*?data-phase=\"active\"/);
  assert.match(mainSource, /await window\.loadURL\(url\.href\);[\s\S]*?if \(!window\.isVisible\(\)\) window\.show\(\)/);
  assert.match(mainSource, /url\.searchParams\.set\("dshAtomWindow", windowId\)/);
  assert.doesNotMatch(mainSource, /url\.searchParams\.set\("dshAtomPane", "1"\)/);
  assert.match(mainSource, /screen\.getDisplayNearestPoint/);
  assert.match(mainSource, /desktop:atom-create-window/);
  assert.match(mainSource, /desktop:atom-detach-session/);
  assert.match(mainSource, /screen\.getCursorScreenPoint\(\)/);
  assert.match(mainSource, /const sourceBounds = source\.window\.getBounds\(\)[\s\S]*?return \{ detached: false, merged: false, moved: false, windowId: source\.id \}/);
  assert.match(mainSource, /function atomWindowAtPoint\(/);
  assert.match(mainSource, /function requestAtomMerge\(/);
  assert.ok(
    mainSource.indexOf("const target = atomWindowAtPoint(point, source.id)") <
      mainSource.indexOf("const sourceBounds = source.window.getBounds()"),
  );
  assert.match(mainSource, /type: "merge-pane"/);
  assert.match(mainSource, /message\.type === "merge-result"/);
  assert.match(mainSource, /target\.window\.getContentBounds\(\)/);
  assert.match(mainSource, /desktop:atom-publish/);
  assert.match(mainSource, /const persisted = persistedAtomWindows\.get\(entry\.id\)[\s\S]*?layout: persisted\?\.layout/);
  assert.match(mainSource, /atom-workbench\.json/);
  assert.match(mainSource, /screen\.getDisplayMatching/);
  assert.doesNotMatch(mainSource, /parent: mainWindow|additionalArguments|setIgnoreMouseEvents/);
  assert.doesNotMatch(mainSource, /composerForegroundWindow|composerOverlayInteraction/);
  assert.doesNotMatch(mainSource, /desktop:(?:composer|modal-overlay|sidebar-button|scroll-button)/);
  assert.match(mainSource, /if \(!atomEntryFor\(event\.sender\)\) return/);
  assert.match(mainSource, /nativeTheme\.themeSource = themeSource/);

  let exposed;
  const sent = [];
  vm.runInNewContext(preloadSource, {
    require(specifier) {
      assert.equal(specifier, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, "desktop");
            exposed = value;
          },
        },
        ipcRenderer: {
          invoke(...args) {
            sent.push(args);
            if (args[0] === "desktop:atom-detach-session") {
              return Promise.resolve({ detached: true, windowId: "atom:1" });
            }
            return Promise.resolve({ sessionId: "session-test", cwd: "/tmp/session-test" });
          },
          send(...args) {
            sent.push(args);
          },
          on() {},
          removeListener() {},
        },
      };
    },
  }, { filename: preloadPath });
  assert.deepEqual(Object.keys(exposed), [
    "onCompanionOpen",
    "companionOpened",
    "atomContext",
    "closeAtomWindow",
    "createAtomWindow",
    "detachAtomSession",
    "createTaskScope",
    "focusAtomWindow",
    "onAtomEvent",
    "publishAtomEvent",
    "restart",
    "setThemeSource",
  ]);
  await exposed.atomContext();
  exposed.closeAtomWindow();
  await exposed.createAtomWindow({ sessionId: "session-test" });
  await exposed.detachAtomSession({ sessionId: "session-test", layout: { root: { type: "pane" } } });
  await exposed.createTaskScope();
  exposed.focusAtomWindow("main");
  exposed.publishAtomEvent("focus-session", { sessionId: "session-test" });
  exposed.restart();
  exposed.setThemeSource("dark");
  exposed.setThemeSource("system");
  exposed.setThemeSource("sepia");
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    ["desktop:atom-context"],
    ["desktop:atom-close-window"],
    ["desktop:atom-create-window", { sessionId: "session-test" }],
    ["desktop:atom-detach-session", { sessionId: "session-test", layout: { root: { type: "pane" } } }],
    ["desktop:create-task-scope"],
    ["desktop:atom-focus-window", "main"],
    ["desktop:atom-publish", { type: "focus-session", detail: { sessionId: "session-test" } }],
    ["desktop:restart"],
    ["desktop:set-theme-source", "dark"],
    ["desktop:set-theme-source", "system"],
  ]);

  assert.doesNotMatch(clientSource, /composerOverlay|nativeGlass|setComposerGlassFrame/);
  assert.doesNotMatch(clientSource, /publishComposerSessionContext|forwardedHover/);
  assert.match(clientSource, /function atomInsert\(/);
  assert.match(clientSource, /function atomReplace\(/);
  assert.match(clientSource, /function atomRemove\(/);
  assert.match(clientSource, /function atomFirstPane\(/);
  assert.match(clientSource, /function atomPruneSessions\(/);
  assert.match(clientSource, /data-dsh-atom-zone=\"top\"/);
  assert.doesNotMatch(clientSource, /data-dsh-atom-zone=\"center\"/);
  assert.match(clientSource, /function atomDropDirectionAt\(/);
  assert.match(clientSource, /const ATOM_PANE_MIN_WIDTH = 320;/);
  assert.match(clientSource, /const ATOM_PANE_MIN_HEIGHT = 240;/);
  assert.match(clientSource, /function atomMinimumSize\(/);
  assert.match(clientSource, /\[data-dsh-atom-host\][^\n]*overflow: auto/);
  assert.match(clientSource, /\[data-dsh-atom-window-header\] \{ box-sizing: border-box; padding-left: 88px !important; \}/);
  assert.match(clientSource, /const needsWindowControlsInset = window\.self === window\.top/);
  assert.match(clientSource, /const markWindowHeader = \(\) => \{[\s\S]*?if \(!needsWindowControlsInset\) return/);
  assert.match(clientSource, /const markWindowHeader = \(\) => \{[\s\S]*?data-conversation-scroll[\s\S]*?dshAtomWindowHeader/);
  assert.match(clientSource, /header\.style\.setProperty\("padding-left", "88px", "important"\)/);
  assert.match(clientSource, /new MutationObserver\(markWindowHeader\)[\s\S]*?childList: true, subtree: true/);
  assert.match(clientSource, /const mountNode = \(parent, node, minimum = atomMinimumSize\(node\)\)/);
  assert.match(clientSource, /atomApplyMinimumSize\(splitElement, minimum\)/);
  assert.match(clientSource, /atomApplyMinimumSize\(first, minimum\.first\)/);
  assert.match(clientSource, /atomApplyMinimumSize\(second, minimum\.second\)/);
  assert.match(clientSource, /const syncRenderedNode = \(node, minimum = atomMinimumSize\(node\)\)/);
  assert.match(clientSource, /const paneRecords = new Map\(\)/);
  assert.match(clientSource, /data-dsh-atom-parking/);
  assert.match(clientSource, /typeof parent\.moveBefore === "function"[\s\S]*?parent\.moveBefore\(child, null\)/);
  assert.doesNotMatch(clientSource, /host\.replaceChildren\(renderNode/);
  assert.match(clientSource, /for \(const record of paneRecords\.values\(\)\)[\s\S]*?movePreservingState\(parking, record\.element\)/);
  assert.match(clientSource, /application\/x-dsh-session/);
  assert.match(clientSource, /if \(!globalThis\.location\?\.href\) return \(\) => \{\};[\s\S]*?const style = atomStyle\(\);[\s\S]*?if \(query\.get\("dshAtomPane"\) === "1"\)/);
  assert.match(clientSource, /if \(!window\.desktop\?\.atomContext\) \{[\s\S]*?style\.remove\(\)/);
  assert.match(clientSource, /const isAtomWindow = query\.has\("dshAtomWindow"\)/);
  assert.match(clientSource, /if \(isAtomWindow\) document\.documentElement\.dataset\.dshAtomFrameRoot = ""/);
  assert.match(clientSource, /const restoreWindowContext = \(\) => \{[\s\S]*?windowContext\.layout\?\.root[\s\S]*?atomPruneSessions\(windowContext\.layout\.root, validSessionIds\)/);
  assert.match(clientSource, /root = root \?\? restoreWindowContext\(\) \?\? restore\(current\)/);
  assert.match(clientSource, /sessionHeader\?\.toggleAttribute\("data-dsh-atom-window-header", windowHeader\)/);
  assert.match(clientSource, /delete document\.documentElement\.dataset\.dshAtomSessionReady;[\s\S]*?style\.remove\(\);/);
  assert.match(clientSource, /frameDocument\.documentElement\.dataset\.dshAtomFrameRoot = "";[\s\S]*?atomStyle\(frameDocument\)/);
  assert.doesNotMatch(clientSource, /document\.documentElement\.dataset\.dshAtomPane = ""/);
  assert.match(clientSource, /frame\.addEventListener\("load", prepareFrame\)/);
  assert.match(clientSource, /saved\.groups\.flatMap\([\s\S]*?atomPruneSessions\(group\.root, validSessionIds\)/);
  assert.match(clientSource, /atomPruneSessions\(legacy\.root, validSessionIds\)/);
  assert.match(clientSource, /const restorableEntries = entries\.filter\(\(entry\) => entry\.durable\)/);
  assert.match(clientSource, /blank: item\.blank === true/);
  assert.match(clientSource, /durable: item\.blank !== true/);
  assert.match(clientSource, /validSessionIds\.has\(fallbackSession\) \? fallbackSession : restorableEntries\[0\]\?\.id/);
  assert.match(clientSource, /function atomHasSessionDrag\(event\)[\s\S]*?event\.dataTransfer\?\.types/);
  assert.match(clientSource, /zones\.addEventListener\("dragenter", activateDropTarget\)/);
  assert.match(clientSource, /zones\.addEventListener\("dragover", activateDropTarget\)/);
  assert.match(clientSource, /const bounds = record\.element\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(clientSource, /const bounds = record\.zones\.getBoundingClientRect\(\)/);
  assert.match(clientSource, /setAtomDragCapture\(true, true, payload\)/);
  assert.match(clientSource, /document\.addEventListener\("dragend", finishDocumentDrag\)/);
  assert.match(clientSource, /const warmed = existing \? paneRecords\.get\(existing\.id\) : warmSessionPane\(sessionId, entry\.title\)/);
  assert.match(clientSource, /const warmed = existing \? paneRecords\.get\(existing\.id\) : warmSessionPane\(sessionId, entry\.title\);[\s\S]*?commit\(\);/);
  assert.match(clientSource, /data-dsh-atom-frame-state="loading"/);
  assert.match(clientSource, /revealPending = true;[\s\S]*?dshAtomFrameState = "ready";[\s\S]*?resolveReady\(\)/);
  assert.doesNotMatch(clientSource, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{[\s\S]*?dshAtomFrameState = "ready"/);
  assert.match(clientSource, /if \(entry\.blank\) \{[\s\S]*?groupForSession\(sessionId\)[\s\S]*?createSoloLayoutGroup\(entry, requestSequence\)/);
  assert.match(clientSource, /function atomSessions\([\s\S]*?syncAtomSidebarOpenState[\s\S]*?data-dsh-atom-open/);
  assert.match(clientSource, /const groupForSession = \(sessionId\) => layoutGroups\.find/);
  assert.match(clientSource, /const activateLayoutGroup = \(group, sessionId, requestSequence = sidebarOpenSequence\) => \{[\s\S]*?if \(requestSequence !== sidebarOpenSequence\) return;[\s\S]*?root = group\.root;[\s\S]*?render\(\);/);
  assert.match(clientSource, /focusedRecord\?\.isReady\(\)[\s\S]*?focusedRecord\?\.ready\.then/);
  assert.doesNotMatch(clientSource, /Promise\.all\(pending\.map\(\(record\) => record\.ready\)\)\.then\(commit\)/);
  assert.match(clientSource, /data-dsh-atom-frame-state="loading"\]\)::after[\s\S]*?dsh-atom-loading-spin/);
  assert.match(clientSource, /data-dsh-atom-frame-state="loading"\]\)::after[^}]*corner-shape: round/);
  assert.match(clientSource, /const createSoloLayoutGroup = \(entry, requestSequence = sidebarOpenSequence\) => \{[\s\S]*?syncActiveGroup\(\);[\s\S]*?layoutGroups\.push\(group\)[\s\S]*?activateLayoutGroup\(group, entry\.id, requestSequence\)/);
  assert.match(clientSource, /dsh-atom-layout-groups:v\$\{ATOM_LAYOUT_VERSION\}/);
  assert.match(clientSource, /const ATOM_LAYOUT_VERSION = 2;/);
  assert.match(clientSource, /legacy\?\.version === 1/);
  assert.match(clientSource, /\[\.\.\.new Set\(layoutGroups\.flatMap/);
  assert.match(clientSource, /\[data-composer-card\] textarea:not\(:disabled\)/);
  const resizeStart = clientSource.indexOf("      const resizeDivider =");
  const resizeEnd = clientSource.indexOf("      const openSidebarSession =", resizeStart);
  const resizeSource = clientSource.slice(resizeStart, resizeEnd);
  assert.match(resizeSource, /divider\.setPointerCapture\(event\.pointerId\)/);
  assert.match(resizeSource, /divider\.addEventListener\("pointerup", up\)/);
  assert.match(resizeSource, /divider\.addEventListener\("pointercancel", cancel\)/);
  assert.match(resizeSource, /first\.style\.flex = `\$\{nextRatio\} 0 0`/);
  assert.match(resizeSource, /node\.ratio = nextRatio;[\s\S]*?save\(\)/);
  assert.doesNotMatch(resizeSource, /render\(\)/);
  assert.doesNotMatch(clientSource, /data-dsh-atom-action/);
  assert.doesNotMatch(clientSource, /Maximize pane|Move to new window|Close view/);
  assert.match(clientSource, /const bindAtomHeaderDrag = \(header, getNode, options = \{\}\) => \{/);
  assert.match(clientSource, /header\.setPointerCapture\(pointerId\)/);
  assert.match(clientSource, /Math\.hypot\(point\.x - start\.x, point\.y - start\.y\) < 6/);
  assert.match(clientSource, /currentTarget = pointerDropTargetAt\(point\.x, point\.y\)/);
  assert.match(clientSource, /dragHandle\.dataset\.dshAtomNativeDragHandle = ""/);
  assert.match(clientSource, /const bindFrameHeaderDrag = \(\) => \{[\s\S]*?data-dsh-session-header[\s\S]*?\.dsh-session-header-menu[\s\S]*?menuBounds\.left - regionBounds\.left/);
  assert.match(clientSource, /bindAtomHeaderDrag\(dragHandle, \(\) => record\.node/);
  assert.doesNotMatch(clientSource, /bindAtomHeaderDrag\(header, \(\) => record\.node\)/);
  assert.match(clientSource, /const accepted = data \? acceptDrop\(data, record\.node\.id, direction\) : false/);
  assert.match(clientSource, /readAtomDrag\(event\) \?\? activeAtomDrag/);
  assert.match(clientSource, /const targetWorkspaceId = atomWorkspaceFor\(ctx, data\.sessionId\)\?\.workspaceId;/);
  assert.match(clientSource, /workspaceId !== targetWorkspaceId/);
  assert.doesNotMatch(clientSource, /workspaceId !== targetWorkspace\)/);
  assert.match(clientSource, /window\.desktop\.publishAtomEvent\("drag-pointer"/);
  assert.match(clientSource, /window\.desktop\.publishAtomEvent\("pane-transfer-committed", \{[\s\S]*?transferSourceWindowId: data\.sourceWindowId/);
  assert.match(clientSource, /message\?\.type === "pane-transfer-committed"[\s\S]*?transferSourceWindowId === windowContext\.windowId/);
  assert.match(clientSource, /message\?\.type === "merge-pane"/);
  assert.match(clientSource, /publishAtomEvent\("merge-result"/);
  assert.match(clientSource, /canCreateWindow: windowContext\.role === "main" \|\| root\.type !== "pane"/);
  assert.match(clientSource, /result\?\.detached \|\| result\?\.merged/);
  assert.match(clientSource, /if \(host\) host\.replaceChildren\(\);[\s\S]*?renderedStructure = undefined/);
  assert.doesNotMatch(clientSource, /element\.addEventListener\("pointerdown", \(\) => \{ focusedPaneId = node\.id; render\(\); \}\)/);
  assert.match(workspaceSource, /"data-dsh-session-id": node\.id/);
  assert.doesNotMatch(clientSource, /dragenter", \(event\) => \{ if \(readAtomDrag\(event\)\)/);
  assert.match(clientSource, /dsh-atom-layout-groups:v\$\{ATOM_LAYOUT_VERSION\}/);
  assert.doesNotMatch(packageSource, /build-macos-native|presmoke/);
  assert.equal(JSON.parse(packageSource).scripts.prestart, "node scripts/ensure-companion.js");

  const pointStart = mainSource.indexOf("function atomWindowAtPoint");
  const pointEnd = mainSource.indexOf("function broadcastAtomEvent", pointStart);
  const pointSandbox = { atomWindows: new Map(), atomWindowZOrder: ["main", "atom:1"] };
  vm.runInNewContext(
    `${mainSource.slice(pointStart, pointEnd)}\nthis.atomWindowAtPoint = atomWindowAtPoint;`,
    pointSandbox,
  );
  pointSandbox.atomWindows.set("main", {
    id: "main",
    window: {
      isDestroyed: () => false,
      isVisible: () => true,
      getBounds: () => ({ x: 100, y: 80, width: 900, height: 620 }),
    },
  });
  assert.equal(pointSandbox.atomWindowAtPoint({ x: 500, y: 400 }).id, "main");
  pointSandbox.atomWindows.set("atom:1", {
    id: "atom:1",
    role: "atom",
    window: {
      isDestroyed: () => false,
      isVisible: () => true,
      getBounds: () => ({ x: 300, y: 200, width: 500, height: 400 }),
    },
  });
  assert.equal(pointSandbox.atomWindowAtPoint({ x: 500, y: 400 }).id, "atom:1");
  assert.equal(pointSandbox.atomWindowAtPoint({ x: 500, y: 400 }, "atom:1").id, "main");
  assert.equal(pointSandbox.atomWindowAtPoint({ x: 50, y: 50 }), undefined);
});

test("Sidenav placement moves one mounted workbench between left, right, and top", async () => {
  const [layoutSource, sidebarSource, workspaceSource, clientSource] = await Promise.all([
    readFile(layoutSourcePath, "utf8"),
    readFile(sidebarSourcePath, "utf8"),
    readFile(workspaceSourcePath, "utf8"),
    readFile(clientPath, "utf8"),
  ]);

  assert.match(layoutSource, /const sidebarPlacements = \["left", "right", "top"\]/);
  assert.match(layoutSource, /setSidebarPlacement: \(d, placement\)/);
  assert.match(layoutSource, /gridTemplateAreas: '\"sidebar sidebar\" \"center details\"'/);
  assert.match(layoutSource, /gridTemplateAreas: '\"center details sidebar\"'/);
  assert.match(layoutSource, /placement === "right" \? -dx : dx/);
  assert.match(layoutSource, /placement !== "top" && !sidebarCollapsed/);
  assert.doesNotMatch(layoutSource, /key:\s*placement/);

  assert.match(sidebarSource, /data-dsh-sidebar-placement-handle/);
  assert.doesNotMatch(sidebarSource, /logoRow,\s*"data-dsh-sidebar-placement-handle"/);
  assert.match(sidebarSource, /className: clsx\(SidebarRoot_module_css_default\.brand[\s\S]{0,180}"data-dsh-sidebar-placement-handle": true/);
  assert.match(sidebarSource, /className: clsx\(SidebarRoot_module_css_default\.iconButton, SidebarRoot_module_css_default\.toggle\)[\s\S]{0,180}"data-dsh-sidebar-placement-handle": !wide \? true : void 0/);
  assert.match(sidebarSource, /orientation: placement === "top" \? "horizontal" : "vertical"/);
  assert.match(sidebarSource, /data-sidebar-placement=top/);

  assert.match(workspaceSource, /function rowHalf\(e, orientation = "vertical"\)/);
  assert.match(workspaceSource, /orientation === "horizontal" \? e\.clientX/);
  assert.match(workspaceSource, /data-orientation/);
  assert.match(workspaceSource, /width:clamp\(112px,14vw,220px\)/);
  assert.match(workspaceSource, /max-height:60vh/);
  assert.match(workspaceSource, /children: \[browseTree, searchResults !== null/);

  assert.match(clientSource, /dsh-sidebar-placement:v1:\$\{windowId\}/);
  assert.match(clientSource, /query\.get\("dshAtomPane"\) === "1"/);
  assert.match(clientSource, /Math\.hypot[\s\S]*?< 6/);
  assert.match(clientSource, /width \* 0\.2/);
  assert.match(clientSource, /height \* 0\.25/);
  assert.match(clientSource, /data-dsh-sidebar-placement-preview="left"[\s\S]*?width: var\(--dsh-sidebar-placement-preview-width, 280px\)/);
  assert.match(clientSource, /data-dsh-sidebar-placement-preview="right"[\s\S]*?width: var\(--dsh-sidebar-placement-preview-width, 280px\)/);
  assert.match(clientSource, /data-dsh-sidebar-placement-preview="top"[^}]*height: 52px/);
  assert.doesNotMatch(clientSource, /data-dsh-sidebar-placement-preview="(?:left|right|top)"[^}]*50%/);
  assert.match(clientSource, /sidebarColumn\.getBoundingClientRect\(\)\.width/);
  assert.match(clientSource, /window\.addEventListener\("blur", cancelDrag\)/);
  assert.match(clientSource, /event\.key === "Escape"/);
  assert.match(clientSource, /ctx\.layout\?\.setSidebarPlacement\?\./);
  assert.match(clientSource, /data-dsh-atom-focused/);
  assert.match(clientSource, /data-sidebar-placement="right"\]\[data-dsh-desktop-shell\] \{ padding: 0 0 0 var\(--dsh-desktop-shell-gap\); \}/);
  assert.doesNotMatch(clientSource, /data-sidebar-placement="right"\][^\n]*data-dsh-desktop-sidebar(?:-logo|-foot)?\]/);
  assert.match(clientSource, /data-sidebar-placement="top"\][^\n]*data-dsh-desktop-sidebar\][^{]*\{[\s\S]*?grid-template-columns: 166px auto minmax\(0, 1fr\) 36px !important/);
  assert.match(clientSource, /data-sidebar-placement="top"\][^\n]*data-dsh-desktop-sidebar-new\][^{]*\{[\s\S]*?justify-content: center !important;[\s\S]*?width: 34px !important;[\s\S]*?padding: 0 !important/);
  assert.match(clientSource, /data-sidebar-placement="top"\][^\n]*data-dsh-desktop-sidebar-new\] > span[^{]*\{[\s\S]*?position: absolute !important;[\s\S]*?clip: rect\(0 0 0 0\)/);
  assert.match(clientSource, /_listArea[\s\S]*?-webkit-mask-image: linear-gradient\([\s\S]*?transparent 0[\s\S]*?#000 28px[\s\S]*?#000 calc\(100% - 28px\)[\s\S]*?transparent 100%/);
  assert.match(clientSource, /_searchSlot[\s\S]*?align-self: center !important;[\s\S]*?_headerActions[\s\S]*?justify-content: center;[\s\S]*?_headerActions[\s\S]*?svg[\s\S]*?display: block;[\s\S]*?width: 20px !important/);
  assert.match(clientSource, /data-dsh-desktop-host="macos"[\s\S]*?data-sidebar-placement="top"[\s\S]*?padding-left: 80px !important/);
  assert.match(clientSource, /data-sidebar-placement="top"\]\[data-dsh-desktop-shell\]:has\(\[data-dsh-atom-host\]\)[\s\S]*?> \[data-dsh-desktop-sidebar-column\]::before[^{]*\{[\s\S]*?content: none;[\s\S]*?pointer-events: none;[\s\S]*?-webkit-app-region: no-drag;/);
  assert.match(clientSource, /data-sidebar-placement="top"\][^\n]*data-dsh-desktop-sidebar\] button,[\s\S]*?data-dsh-desktop-sidebar\] input,[\s\S]*?\[role="treeitem"\][^{]*\{[\s\S]*?-webkit-app-region: no-drag; app-region: no-drag;/);
  assert.match(clientSource, /data-dsh-desktop-shell\]:has\(\[data-dsh-atom-host\]\)[\s\S]*?> \[data-dsh-desktop-sidebar-column\]::before[^{]*\{[\s\S]*?height: 44px;[\s\S]*?-webkit-app-region: drag;/);
  assert.match(clientSource, /data-orientation="horizontal"[\s\S]*?_sectionHeader[\s\S]*?flex: 0 0 64px/);
  assert.match(clientSource, /--dsh-top-nav-group-fill: color-mix\([\s\S]*?var\(--dsw-alias-interactive-bg-hover\) 55%[\s\S]*?transparent/);
  assert.match(clientSource, /data-sidebar-placement="top"\]\[data-dsh-desktop-shell\][^{]*\{[\s\S]*?--dsh-top-nav-group-fill:/);
  assert.match(clientSource, /data-sidebar-placement="top"\][\s\S]*?_listArea[^{]*\{[^}]*margin: 0 0 0 12px !important;/);
  assert.match(clientSource, /data-sidebar-placement="top"\]\s+\[data-dsh-desktop-sidebar-region\]\s+\[data-orientation="horizontal"\] \[class\*="_groupSection"\][^{]*\{[\s\S]*?height: 44px;[\s\S]*?margin: 0 2px !important;[\s\S]*?padding: 0 4px;[\s\S]*?background: var\(--dsh-top-nav-group-fill\);/);
  assert.doesNotMatch(clientSource, /data-sidebar-placement="(?:left|right)"[^\n]*[\s\S]{0,220}_groupSection[\s\S]{0,220}(?:--dsh-top-nav-group-fill|height: 44px|background: var\(--dsh-top-nav-group-fill\))/);
  assert.match(clientSource, /data-orientation="horizontal"[\s\S]*?_sessionRow[\s\S]*?flex: 0 0 clamp\(112px, 14vw, 220px\)/);
  assert.match(clientSource, /data-sidebar-placement="top"[\s\S]*?data-dsh-desktop-sidebar-foot[\s\S]*?> div:first-child[^{]*\{[\s\S]*?display: none !important/);
  assert.match(clientSource, /data-sidebar-placement="top"[\s\S]*?button\[aria-haspopup="dialog"\][^{]*\{[\s\S]*?width: 34px !important[\s\S]*?height: 34px !important/);
  assert.match(clientSource, /button\[aria-haspopup="dialog"\] span[^{]*\{[\s\S]*?position: absolute !important/);
  assert.match(clientSource, /let mounting;[\s\S]*?let contextReady = false/);
  assert.match(clientSource, /if \(mounting\) return mounting/);
  assert.match(clientSource, /root = root \?\? restoreWindowContext\(\) \?\? restore\(current\)/);
  assert.match(clientSource, /const attachHost = \(\) => \{[\s\S]*?host\.dataset\.dshAtomHost = ""/);
  assert.match(clientSource, /const enrichSidebarDrag = \(event\) => \{[\s\S]*?if \(!root\)[\s\S]*?attachHost\(\)[\s\S]*?writeAtomDrag/);
});

test("product rename preserves the legacy user data and application identity", async () => {
  const [mainSource, product] = await Promise.all([
    readFile(mainPath, "utf8"),
    import(pathToFileURL(productPath)),
  ]);

  assert.equal(product.productName, "DeepSeek Harness UX First");
  assert.equal(product.legacyUserDataDirectoryName, "DSH Desktop");
  assert.equal(product.macOSBundleIdentifier, "com.jesselai.dsh-desktop");
  assert.match(
    mainSource,
    /app\.setName\(productName\);[\s\S]*?app\.setPath\("userData", join\(app\.getPath\("appData"\), legacyUserDataDirectoryName\)\);[\s\S]*?app\.requestSingleInstanceLock\(\)/,
  );
});

test("Atom session switching releases inactive iframe clients before the fourth open", async () => {
  const clientSource = await readFile(clientPath, "utf8");
  const lifecycleStart = clientSource.indexOf("    function atomSessions");
  const lifecycleEnd = clientSource.indexOf("    function atomFirstPane", lifecycleStart);
  assert.notEqual(lifecycleStart, -1);
  assert.notEqual(lifecycleEnd, -1);

  const sandbox = {};
  vm.runInNewContext(
    `${clientSource.slice(lifecycleStart, lifecycleEnd)}\nthis.disposeOutside = atomDisposePaneRecordsOutside;`,
    sandbox,
  );

  const records = new Map();
  const disposed = [];
  for (const id of ["pane:a", "pane:b", "pane:c", "pane:d"]) {
    const root = { type: "pane", id, sessionId: id.slice(5) };
    sandbox.disposeOutside(records, root);
    records.set(id, { dispose: () => disposed.push(id) });
    assert.equal(records.size, 1);
  }
  assert.deepEqual([...records.keys()], ["pane:d"]);
  assert.deepEqual(disposed, ["pane:a", "pane:b", "pane:c"]);

  records.set("pane:e", { dispose: () => disposed.push("pane:e") });
  sandbox.disposeOutside(records, {
    type: "split",
    first: { type: "pane", id: "pane:d", sessionId: "d" },
    second: { type: "pane", id: "pane:e", sessionId: "e" },
  });
  assert.deepEqual([...records.keys()], ["pane:d", "pane:e"]);

  const activateStart = clientSource.indexOf("      const activateLayoutGroup =");
  const activateEnd = clientSource.indexOf("      const createSoloLayoutGroup =", activateStart);
  const activateSource = clientSource.slice(activateStart, activateEnd);
  assert.match(
    activateSource,
    /syncActiveGroup\(\);[\s\S]*?atomDisposePaneRecordsOutside\(paneRecords, group\.root\);[\s\S]*?root = group\.root;[\s\S]*?render\(\);/,
  );
  assert.match(
    clientSource,
    /const dispose = \(\) => \{[\s\S]*?readyObserver\?\.disconnect\(\);[\s\S]*?frame\.removeEventListener\("load", prepareFrame\);[\s\S]*?element\.remove\(\);/,
  );
});

test("Session navigation uses official ids and pane selection waits for the catalog", async () => {
  const clientSource = await readFile(clientPath, "utf8");

  assert.match(clientSource, /getData\("text\/plain"\)/);
  assert.match(clientSource, /getSnapshot\?\.\(\)\.current/);
  assert.doesNotMatch(clientSource, /item\.title === title/);

  const dragStart = clientSource.indexOf("    const ATOM_DRAG_TYPE");
  const dragEnd = clientSource.indexOf("    function atomUuid", dragStart);
  const dragSandbox = {};
  vm.runInNewContext(
    `${clientSource.slice(dragStart, dragEnd)}\nthis.hasSessionDrag = atomHasSessionDrag; this.dropDirectionAt = atomDropDirectionAt; this.minimumSize = atomMinimumSize;`,
    dragSandbox,
  );
  assert.equal(
    dragSandbox.hasSessionDrag({ dataTransfer: { types: ["text/plain", "application/x-dsh-session"] } }),
    true,
  );
  assert.equal(dragSandbox.hasSessionDrag({ dataTransfer: { types: ["text/plain"] } }), false);
  const bounds = { left: 0, top: 0, width: 800, height: 400 };
  assert.equal(dragSandbox.dropDirectionAt(bounds, { x: 10, y: 200 }), "left");
  assert.equal(dragSandbox.dropDirectionAt(bounds, { x: 790, y: 200 }), "right");
  assert.equal(dragSandbox.dropDirectionAt(bounds, { x: 400, y: 10 }), "top");
  assert.equal(dragSandbox.dropDirectionAt(bounds, { x: 400, y: 390 }), "bottom");
  assert.equal(dragSandbox.dropDirectionAt(bounds, { x: 400, y: 200 }, "left"), "left");

  const pane = (id) => ({ type: "pane", id, sessionId: id });
  const horizontal = {
    type: "split",
    direction: "horizontal",
    first: pane("a"),
    second: pane("b"),
  };
  const vertical = {
    type: "split",
    direction: "vertical",
    first: pane("a"),
    second: pane("b"),
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(dragSandbox.minimumSize(pane("single")))),
    { width: 320, height: 240 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(dragSandbox.minimumSize(horizontal))),
    {
      width: 648,
      height: 240,
      first: { width: 320, height: 240 },
      second: { width: 320, height: 240 },
    },
  );
  assert.equal(dragSandbox.minimumSize(vertical).width, 320);
  assert.equal(dragSandbox.minimumSize(vertical).height, 488);
  assert.equal(
    dragSandbox.minimumSize({ type: "split", direction: "vertical", first: horizontal, second: pane("c") }).width,
    648,
  );
  assert.equal(
    dragSandbox.minimumSize({ type: "split", direction: "vertical", first: horizontal, second: pane("c") }).height,
    488,
  );

  const start = clientSource.indexOf("    function atomSessionIsListed");
  const end = clientSource.indexOf("    function atomWorkspaceFor", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const timers = new Map();
  let nextTimer = 1;
  const documentElement = { dataset: {} };
  const sandbox = {
    clearTimeout(id) {
      timers.delete(id);
    },
    document: { documentElement },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
  };
  vm.runInNewContext(
    `${clientSource.slice(start, end)}\nthis.openPaneSession = atomOpenPaneSession;`,
    sandbox,
  );

  let snapshot = { byId: {}, current: "session-b", phase: "pending" };
  let sessionState = { openState: "loading" };
  const listeners = new Set();
  const opened = [];
  let unsubscribed = false;
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            unsubscribed = true;
            listeners.delete(listener);
          };
        },
      },
      open(sessionId) {
        opened.push(sessionId);
      },
      binding() {
        return { session: { getSnapshot: () => sessionState } };
      },
    },
  };

  sandbox.openPaneSession(ctx, "session-b");
  assert.deepEqual(opened, []);
  snapshot = {
    byId: {
      "session-a": { id: "session-a", displayTitle: "Duplicate" },
      "session-b": { id: "session-b", displayTitle: "Duplicate" },
    },
    current: "session-a",
    phase: "ready",
  };
  for (const listener of [...listeners]) listener();
  assert.deepEqual(opened, ["session-b"]);
  snapshot = { ...snapshot, current: "session-b" };
  for (const listener of [...listeners]) listener();
  assert.equal(documentElement.dataset.dshAtomSessionReady, undefined);
  sessionState = { openState: "open" };
  for (const callback of [...timers.values()]) callback();
  assert.equal(documentElement.dataset.dshAtomSessionReady, "session-b");
  assert.equal(unsubscribed, true);
  assert.equal(timers.size, 0);
});

test("Atom panes defer visible conversation chrome to the native header", async () => {
  const clientSource = await readFile(clientPath, "utf8");
  const bindStart = clientSource.indexOf("          const bindFrameHeaderDrag =");
  const bindEnd = clientSource.indexOf("          const prepareFrame =", bindStart);
  const bindSource = clientSource.slice(bindStart, bindEnd);
  assert.match(clientSource, /header\.append\(title\);/);
  assert.match(clientSource, /\[data-dsh-atom-pane\][^\n]*grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(clientSource, /\[data-dsh-atom-header\] \{ display: none; \}/);
  assert.match(clientSource, /\[data-dsh-atom-zones\][^\n]*inset: 0;/);
  assert.match(clientSource, /data-dsh-atom-dragging\] \[data-dsh-atom-zones\][^\n]*pointer-events: auto/);
  assert.match(clientSource, /data-dsh-atom-drag-source\] > \[data-dsh-atom-zones\][^\n]*dsh-atom-drag-source-safe-top/);
  assert.match(clientSource, /pane\.toggleAttribute\("data-dsh-atom-drag-source", isLocalSource\)/);
  assert.match(clientSource, /\[data-dsh-atom-native-drag-handle\][^\n]*position: absolute;[^\n]*z-index: 10/);
  assert.match(clientSource, /\[data-dsh-atom-title\][^\n]*pointer-events: none/);
  assert.match(clientSource, /\[data-dsh-desktop-shell\]:has\(\[data-dsh-atom-host\]\)::before \{[\s\S]*?pointer-events: none;[\s\S]*?-webkit-app-region: no-drag;/);
  assert.match(clientSource, /data-dsh-atom-embedded[^\n]*app-region: no-drag/);
  assert.match(clientSource, /data-dsh-atom-drag-handle\] button:disabled \{ pointer-events: none; \}/);
  assert.match(clientSource, /frameDocument\.documentElement\.dataset\.dshAtomEmbedded = ""/);
  assert.match(clientSource, /frameDocument\?\.querySelector\("\[data-dsh-session-header\]"\)/);
  assert.match(clientSource, /const titleRegion = menu\?\.parentElement \?\? sessionHeader\?\.firstElementChild \?\? sessionHeader/);
  assert.match(clientSource, /!titleRegion \|\| typeof titleRegion\.getBoundingClientRect !== "function"/);
  assert.doesNotMatch(bindSource, /titleRegion instanceof HTMLElement/);
  assert.match(clientSource, /titleRegion\.dataset\.dshAtomDragHandle = ""/);
  assert.match(bindSource, /Math\.max\(0, frameBounds\.width - regionBounds\.left\)/);
  assert.match(bindSource, /--dsh-atom-drag-source-safe-top/);
  assert.match(clientSource, /element\.append\(header, frame, dragHandle, zones\)/);
  assert.doesNotMatch(bindSource, /scroll\?\.parentElement\?\.querySelector\(":scope > header"\)/);
  assert.match(clientSource, /data-dsh-atom-hide-traffic-light-header-context[\s\S]*?data-dsh-session-header[\s\S]*?_titleCluster[^{]*\{ display: none !important; \}/);
  assert.match(clientSource, /data-dsh-atom-hide-traffic-light-header-context[\s\S]*?data-dsh-session-header[\s\S]*?dsh-session-header-menu[^{]*\{ margin-left: auto; \}/);
  assert.match(clientSource, /const syncAtomTrafficLightHeaderContext = \(\) => \{[\s\S]*?windowContext\.role === "main"[\s\S]*?dshSidebarPlacement === "right"[\s\S]*?atomFirstPane\(root\)\?\.id/);
  assert.match(clientSource, /attributeFilter: \["data-dsh-sidebar-placement"\]/);
  assert.match(clientSource, /sidebarPlacementObserver\.disconnect\(\)/);
  assert.match(clientSource, /header\.setPointerCapture\(pointerId\)/);
  assert.doesNotMatch(clientSource, /header\.append\(title, /);
  assert.doesNotMatch(clientSource, /document\.createElement\("button"\)[\s\S]{0,180}dshAtomAction/);
  assert.match(clientSource, /\[data-dsh-atom-dismiss\][^{]*\{[^}]*width: 32px;[^}]*height: 32px/);
  assert.match(bindSource, /const showDismiss = atomSessions\(root\)\.length > 1/);
  assert.match(bindSource, /dismiss\.dataset\.dshAtomDismiss = ""/);
  assert.match(bindSource, /dismiss\.addEventListener\("click", \(event\) => \{[\s\S]*?closePane\(record\.node\.id\)/);
  assert.match(bindSource, /menu\.after\(dismiss\)/);
  assert.match(clientSource, /for \(const record of paneRecords\.values\(\)\) record\.bindFrameHeaderDrag\?\.\(\)/);
});

test("Atom pane pointer drag reorders locally and detaches only on pointer release", async () => {
  const clientSource = await readFile(clientPath, "utf8");
  const start = clientSource.indexOf("      const bindAtomHeaderDrag =");
  const end = clientSource.indexOf("      const renderPane =", start);
  const accepted = [];
  const detached = [];
  const closed = [];
  const dragStates = [];
  const published = [];
  const sandbox = {
    workspaceId: "workspace-a",
    windowContext: { windowId: "main", role: "main" },
    root: {
      type: "split",
      id: "split:test",
      direction: "horizontal",
      first: { type: "pane", id: "pane:a", sessionId: "session-a" },
      second: { type: "pane", id: "pane:b", sessionId: "session-b" },
    },
    atomUuid: () => "transfer:test",
    dropTarget: { paneId: "pane:b", direction: "right" },
    pointerDropTargetAt: (...point) => {
      sandbox.pointerPoints.push(point);
      return sandbox.dropTarget;
    },
    pointerPoints: [],
    setAtomDragCapture: (...args) => dragStates.push(args),
    acceptDrop: (...args) => accepted.push(args),
    closePane: (paneId) => closed.push(paneId),
    window: {
      screenX: 20,
      screenY: 30,
      desktop: {
        detachAtomSession(payload) {
          detached.push(payload);
          return Promise.resolve({ detached: true });
        },
        publishAtomEvent: (...args) => published.push(args),
      },
    },
  };
  vm.runInNewContext(
    `${clientSource.slice(start, end)}\nthis.bindAtomHeaderDrag = bindAtomHeaderDrag;`,
    sandbox,
  );

  const createHeader = () => ({
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    removeEventListener(type) { this.listeners.delete(type); },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
  });
  const pointer = (clientX, clientY) => ({
    button: 0,
    pointerId: 7,
    clientX,
    clientY,
    target: { closest: () => null },
    preventDefault() {},
  });
  const node = { id: "pane:a", sessionId: "session-a", title: "A" };
  const header = createHeader();
  let focused = 0;
  const dispose = sandbox.bindAtomHeaderDrag(header, () => node, {
    onPointerDown: () => { focused += 1; },
  });
  header.listeners.get("pointerdown")(pointer(0, 0));
  assert.equal(focused, 1);
  header.listeners.get("pointermove")(pointer(12, 0));
  assert.equal(detached.length, 0);
  header.listeners.get("pointerup")(pointer(12, 0));
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0][1], "pane:b");
  assert.equal(accepted[0][2], "right");
  assert.equal(detached.length, 0);
  assert.deepEqual(dragStates.map(([active]) => active), [true, false]);
  assert.equal(published.at(-1)[0], "drag-pointer");
  dispose();
  assert.equal(header.listeners.size, 0);

  sandbox.dropTarget = undefined;
  const outsideHeader = createHeader();
  sandbox.bindAtomHeaderDrag(outsideHeader, () => node);
  outsideHeader.listeners.get("pointerdown")(pointer(0, 0));
  outsideHeader.listeners.get("pointermove")(pointer(12, 0));
  assert.equal(detached.length, 0);
  outsideHeader.listeners.get("pointerup")(pointer(900, 700));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(detached.length, 1);
  assert.equal(detached[0].canCreateWindow, true);
  assert.deepEqual(closed, ["pane:a"]);
});

test("Composer controls and DeepSeek menus remain in the main React tree", async () => {
  const fixture = await installTheme("MacIntel");
  const clientSource = await readFile(clientPath, "utf8");

  assert.equal(fixture.documentElement.dataset.dshWindowRole, "main");
  for (const kind of ["workspace", "preset", "model"]) {
    assert.match(clientSource, new RegExp(`dshComposerMenuTrigger = "${kind}"`));
  }
  assert.doesNotMatch(clientSource, /dshComposerMenuTrigger = "permission"/);
  assert.match(clientSource, /document\.querySelectorAll\("\[data-composer-card\]"\)\.forEach\(markComposer\)/);
  assert.match(clientSource, /markHeroWorkspaceRows\(\)/);
  assert.doesNotMatch(clientSource, /installNativeComposerMenus|showNativeMenu/);
  assert.doesNotMatch(clientSource, /installWebComposerMenuBridge|requestComposerWebMenu/);
  assert.doesNotMatch(clientSource, /SessionBridge|SessionContext/);

  fixture.cleanup();
  assert.equal(fixture.documentElement.dataset.dshWindowRole, undefined);
});

test("macOS transparency exposes vibrancy only around opaque Web content", async () => {
  const [mainSource, clientSource] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(clientPath, "utf8"),
  ]);
  const fixture = await installTheme("MacIntel");
  const css = fixture.appendedStyle.textContent;

  assert.match(mainSource, /titleBarStyle: "hiddenInset"/);
  assert.match(mainSource, /trafficLightPosition: macOSTrafficLightPosition/);
  assert.match(mainSource, /transparent: true/);
  assert.match(mainSource, /vibrancy: "under-window"/);
  assert.match(mainSource, /visualEffectState: "active"/);
  assert.match(mainSource, /backgroundColor: isMacOS \? "#00000000" : "#eef2f6"/);
  assert.match(mainSource, /setWindowButtonPosition\(macOSTrafficLightPosition\)/);
  assert.match(mainSource, /getWindowButtonPosition\(\)/);

  assert.match(
    css,
    /data-dsh-desktop-host="macos"[\s\S]*?#root[^{]*\{[^}]*background: transparent !important/,
  );
  assert.match(
    css,
    /data-dsh-desktop-sidebar-column\][^{]*\{[^}]*background: transparent !important/,
  );
  assert.match(
    css,
    /data-dsh-desktop-center\],[\s\S]*?data-dsh-desktop-details\][^{]*\{[^}]*background: var\(--dsw-alias-bg-base\) !important/,
  );
  assert.doesNotMatch(clientSource, /NSGlassEffectView|NSPanel|data-dsh-native-glass/);

  fixture.cleanup();
});

test("desktop icon policy covers every DSH primitive icon export", async () => {
  const [iconTypes, syncSource, clientSource] = await Promise.all([
    readFile(iconTypesPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
    readFile(clientPath, "utf8"),
  ]);
  const names = [...iconTypes.matchAll(/export declare const (Icon[A-Za-z0-9]+)/g)].map(
    (match) => match[1],
  );

  assert.ok(names.length > 50);
  for (const name of names) {
    assert.match(syncSource, new RegExp(`\\b${name}(?::|\")`), `${name} is not covered`);
  }
  assert.match(
    syncSource,
    /const nativeIconNames = new Set\(\["IconEllipsisOutline16"\]\)/,
  );
  assert.doesNotMatch(syncSource, /IconEllipsisOutline16:\s*"menu"/);
  assert.doesNotMatch(clientSource, /"menu":\s*"<svg/);
  assert.doesNotMatch(clientSource, /\[\s*3537975236,\s*"menu"\s*\]/);
  assert.match(syncSource, /IconTrashOutline16:\s*"delete"/);
  assert.doesNotMatch(syncSource, /IconTrashOutline16:\s*"shredder"/);
  assert.match(clientSource, /"delete":\s*"<svg[\s\S]*?M3 6h18/);
  assert.doesNotMatch(clientSource, /"shredder":\s*"<svg/);
});

test("raw SVG audit allows only mapped icons and named artwork", async () => {
  const [iconTypes, syncSource, loadingSource] = await Promise.all([
    readFile(iconTypesPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
    readFile(loadingPath, "utf8"),
  ]);
  const iconNames = [...iconTypes.matchAll(/export declare const (Icon[A-Za-z0-9]+)/g)];
  const entries = await readdir(deepseekModulesPath, { recursive: true });
  const rawSvgFactoryPattern =
    /(?:\bjsx|\bjsxs)\("svg",|\breact_jsx_runtime\.(?:jsx|jsxs)\)\("svg",/g;
  const actual = [];
  const semanticCssIcons = [];
  const auditedSources = new Map();

  for (const entry of entries) {
    const relativePath = String(entry).replaceAll("\\", "/");
    if (!/\/lib\/(?:client|index)\.js$/.test(`/${relativePath}`)) continue;
    const source = await readFile(join(deepseekModulesPath, entry), "utf8");
    const semanticCssIconCount = source.match(/role:\s*"img"/g)?.length ?? 0;
    if (semanticCssIconCount > 0) {
      semanticCssIcons.push([relativePath, semanticCssIconCount]);
    }
    const count = source.match(rawSvgFactoryPattern)?.length ?? 0;
    if (count === 0) continue;
    actual.push([relativePath, count]);
    auditedSources.set(relativePath, source);
  }

  const expected = [
    ["dsh-client-ui-attachment/lib/index.js", 2],
    ["dsh-client-ui-conversation/lib/client.js", 12],
    ["dsh-client-ui-primitives/lib/index.js", iconNames.length + 3],
    ["dsh-client-ui-trajectory/lib/client.js", 6],
  ];
  assert.deepEqual(actual.sort(([left], [right]) => left.localeCompare(right)), expected);
  assert.deepEqual(
    semanticCssIcons.sort(([left], [right]) => left.localeCompare(right)),
    [
      ["dsh-client-ui-settings-models/lib/client.js", 3],
      ["dsh-client-ui-settings-plugin-inventory/lib/client.js", 1],
    ],
  );

  /* Explicit artwork/data-visualization exemptions. Every other factory in
     these bundles is a functional icon and therefore must keep its geometry
     in iconMap/inlineIconMap. A new raw SVG changes the inventory and fails
     this test until it is either mapped or deliberately named here. */
  assert.match(
    auditedSources.get("dsh-client-ui-primitives/lib/index.js"),
    /function StateDot\([\s\S]*?jsx\("svg"/,
  );
  assert.match(
    auditedSources.get("dsh-client-ui-primitives/lib/index.js"),
    /function FishLogo\([\s\S]*?jsx\("svg"/,
  );
  assert.match(
    auditedSources.get("dsh-client-ui-primitives/lib/index.js"),
    /function BrandWordmark\([\s\S]*?jsxs\("svg"/,
  );
  assert.match(
    auditedSources.get("dsh-client-ui-attachment/lib/index.js"),
    /const UploadIllustration[\s\S]*?const UploadDisabledIllustration/,
  );
  assert.match(
    auditedSources.get("dsh-client-ui-conversation/lib/client.js"),
    /function ContextMeter\([\s\S]*?function HeroGlow\(/,
  );

  const inlineMap = syncSource.match(
    /const inlineIconMap = \[([\s\S]*?)\n\];/,
  )?.[1];
  assert.ok(inlineMap);
  assert.equal(inlineMap.match(/^\s*\["[^"]+",/gm)?.length, 17);
  assert.match(inlineMap, /rect x="0" y="0" width="2" height="2"/);

  const startupSvgOpenings = [...loadingSource.matchAll(/<svg\b[^>]*>/g)].map(
    (match) => match[0],
  );
  assert.equal(startupSvgOpenings.length, 2);
  for (const opening of startupSvgOpenings) {
    assert.match(opening, /data-lucide-animated-icon=/);
  }
});

test("non-primitive and hidden-state affordances also use the icon library", async () => {
  const [clientSource, syncSource] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
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
  assert.match(syncSource, /rect x="0" y="0" width="2" height="2"/);
  assert.match(clientSource, /4127268700,[\s\S]*?"loader-circle"/);
  assert.match(syncSource, /icons\["circle-dashed"\] = '<svg/);
  assert.match(clientSource, /"circle-dashed": "<svg[^\n]*M10\.1 2\.182/);
  assert.doesNotMatch(clientSource, /"circle-dashed": "<svg[^\n]*<path\/>/);
  assert.match(clientSource, /const stateDotIconSlugs = \{/);
  assert.match(clientSource, /'span\[aria-hidden="true"\]\[data-state\]'/);
  assert.match(clientSource, /'span\[class\*="_historyLoadingSpinner"\]'/);
  assert.match(clientSource, /"loader-circle",\s*"trajectory-loading"/);
  assert.match(clientSource, /const pluginStatusIconSlugs = \{/);
  assert.match(clientSource, /'span\[role="img"\]\[data-phase\]\[class\*="_statusDot"\]'/);
  assert.match(clientSource, /'span\[role="img"\]\[class\*="_credentialDot"\]'/);
  assert.match(clientSource, /syncInjectedLibraryIcon\(host, slug, "plugin-status"/);
  assert.match(clientSource, /syncInjectedLibraryIcon\(host, slug, "credential-status"/);
  assert.match(clientSource, /summary\[class\*="_customizedSummary"\]::before/);
  assert.match(clientSource, /summary\[class\*="_retrySummary"\]::after/);
  assert.match(clientSource, /input\[type="search"\]::\-webkit-search-cancel-button/);
  assert.match(clientSource, /select\[class\*="_selectInput"\]/);
  assert.match(clientSource, /\[class\*="_versionPicker"\] select/);
  assert.match(clientSource, /\[data-composer-card\] select/);
  assert.match(clientSource, /"aria-expanded",[\s\S]*?"aria-pressed",[\s\S]*?"open"/);
  assert.match(clientSource, /clearInjectedLibraryIcons\(injectedIconDecorations\)/);

});

test("hidden state and loading branches use library icons", async () => {
  const theme = await installTheme("MacIntel", "", { includeHiddenStateIcons: true });
  const {
    credentialStatuses,
    ongoing,
    pluginStatuses,
    stateDots,
    trajectorySpinners,
  } = theme.hiddenStateFixture;
  const slugOf = (host) => host.children.at(-1)?.dataset.lucideAnimatedIcon;

  assert.equal(ongoing.dataset.lucideAnimatedIcon, "loader-circle");
  assert.equal(slugOf(stateDots.done), "circle-check");
  assert.equal(slugOf(stateDots.warning), "badge-alert");
  assert.equal(slugOf(stateDots.error), "badge-alert");
  for (const spinner of trajectorySpinners) {
    assert.equal(slugOf(spinner), "loader-circle");
    assert.equal(spinner.dataset.dshLibraryIconHost, "trajectory-loading");
  }
  const expectedPluginStatusSlugs = {
    pending: "circle-dashed",
    loading: "loader-circle",
    active: "circle-check",
    failed: "badge-alert",
    unloading: "loader-circle",
    unobserved: "circle-dashed",
  };
  for (const [phase, host] of Object.entries(pluginStatuses)) {
    assert.equal(slugOf(host), expectedPluginStatusSlugs[phase]);
    assert.equal(host.dataset.dshLibraryIconHost, "plugin-status");
  }
  assert.equal(slugOf(credentialStatuses.configured), "circle-check");
  assert.equal(slugOf(credentialStatuses.missing), "badge-alert");
  for (const host of Object.values(credentialStatuses)) {
    assert.equal(host.dataset.dshLibraryIconHost, "credential-status");
  }

  stateDots.done.setAttribute("data-state", "error");
  theme.flushMutations();
  assert.equal(slugOf(stateDots.done), "badge-alert");

  theme.cleanup();
  assert.equal(ongoing.dataset.lucideAnimatedIcon, undefined);
  assert.equal(ongoing.children.length, 8);
  for (const host of [
    ...Object.values(stateDots),
    ...trajectorySpinners,
    ...Object.values(pluginStatuses),
    ...Object.values(credentialStatuses),
  ]) {
    assert.equal(host.children.length, 0);
    assert.equal(host.dataset.dshLibraryIconHost, undefined);
  }
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

test("Composer primary icon follows Send and native Stop state changes", async () => {
  const theme = await installTheme("MacIntel", "", { includeComposer: true });
  const {
    primaryIcon,
    renderPrimarySend,
    renderPrimaryStop,
  } = theme.composerFixture;

  assert.equal(primaryIcon.dataset.lucideAnimatedIcon, "arrow-up");
  assert.equal(primaryIcon.children.at(-1).dataset.lucideLibraryPaint, "");

  renderPrimaryStop();
  theme.flushMutations();
  assert.equal(primaryIcon.dataset.lucideAnimatedIcon, undefined);
  assert.equal(primaryIcon.children.length, 1);
  assert.equal(primaryIcon.children[0].localName, "rect");

  renderPrimarySend();
  theme.flushMutations();
  assert.equal(primaryIcon.dataset.lucideAnimatedIcon, "arrow-up");
  assert.equal(primaryIcon.children.at(-1).dataset.lucideLibraryPaint, "");

  theme.cleanup();
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

test("feedback uses lucide-animated thumbs with a natural 20-unit span", async () => {
  const [source, syncSource] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(syncIconsPath, "utf8"),
  ]);

  assert.match(
    source,
    /"downvote": "<svg[^\n]*<path d=\\"M17 14V2\\"\/><path d=\\"M9 18\.12 10 14H4\.17[^\n]*L12 22/,
  );
  assert.match(
    source,
    /"upvote": "<svg[^\n]*<path d=\\"M7 10v12\\"\/><path d=\\"M15 5\.88 14 10h5\.83[^\n]*L12 2/,
  );
  assert.match(syncSource, /IconDislikeOutline16: "downvote"/);
  assert.match(syncSource, /IconLikeOutline16: "upvote"/);
  assert.doesNotMatch(source, /"arrow-big-(?:up|down)"/);
});

test("thumbs-down opens an accessible feedback modal instead of an inline note", async () => {
  const theme = await installTheme("MacIntel", "", { includeFeedback: true });
  const feedback = theme.feedbackFixture;
  const originalPlaceholder = feedback.textarea.getAttribute("placeholder");

  assert.match(
    theme.appendedStyle.textContent,
    /button\[class\*="_noteOpen"\]\s*\{[^}]*display: none !important/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-feedback-portal\][^{]*\{[^}]*position: fixed !important;[^}]*inset: 0 !important;[^}]*display: grid !important;[^}]*place-items: center !important/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /data-dsh-feedback-portal\] > \[data-dsh-feedback-backdrop\][^{]*\{[^}]*position: absolute !important;[^}]*inset: 0 !important;[^}]*background: var\(--dsw-alias-bg-mask-1\) !important/,
  );
  assert.match(
    theme.appendedStyle.textContent,
    /\[data-dsh-feedback-source\],[\s\S]*?\[data-dsh-feedback-source-status\][^{]*\{[^}]*display: none !important/,
  );

  theme.dispatchClick(feedback.dislike);
  assert.equal(feedback.dislike.dataset.dshFeedbackDialogPending, "");

  feedback.commitNegative();
  theme.flushMutations();

  assert.equal(feedback.noteOpenClicks(), 1);
  assert.equal(feedback.noteOpen.isConnected, false);
  assert.equal(feedback.editor.dataset.dshFeedbackSource, "");
  assert.equal(feedback.actionRow.getAttribute("role"), null);
  assert.equal(feedback.actionRow.getAttribute("aria-modal"), null);
  assert.equal(feedback.textarea.getAttribute("placeholder"), originalPlaceholder);

  const portal = theme.documentBody.querySelector(
    ":scope > [data-dsh-feedback-portal]",
  );
  assert.ok(portal);
  assert.equal(portal.parentElement, theme.documentBody);
  assert.equal(portal.getAttribute("role"), "presentation");
  const dialog = portal.querySelector("[data-dsh-feedback-dialog]");
  const input = portal.querySelector("[data-dsh-feedback-input]");
  const save = portal.querySelector("[data-dsh-feedback-save]");
  const cancel = portal.querySelector("[data-dsh-feedback-cancel]");
  assert.ok(dialog);
  assert.ok(input);
  assert.ok(save);
  assert.ok(cancel);
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(
    dialog.getAttribute("aria-label"),
    "Give feedback on this response",
  );
  assert.equal(input.getAttribute("placeholder"), "What went wrong? (optional)");
  assert.equal(theme.activeElement(), input);
  assert.equal(theme.documentBody.dataset.dshFeedbackModalOpen, "");

  save.focus();
  theme.dispatchKeydown("Tab");
  assert.equal(theme.activeElement(), input);
  theme.dispatchKeydown("Tab", { shiftKey: true });
  assert.equal(theme.activeElement(), save);

  input.value = "The answer needs verifiable citations.";
  input.dispatchEvent({ type: "input" });
  assert.equal(feedback.textarea.value, "The answer needs verifiable citations.");
  assert.equal(feedback.inputEvents(), 1);

  const backdrop = portal.querySelector("[data-dsh-feedback-backdrop]");
  assert.ok(backdrop);
  backdrop.click();
  assert.equal(feedback.cancelClicks(), 1);
  theme.flushMutations();

  assert.equal(feedback.editor.dataset.dshFeedbackSource, undefined);
  assert.equal(portal.isConnected, false);
  assert.equal(
    theme.documentBody.querySelector(":scope > [data-dsh-feedback-portal]"),
    null,
  );
  assert.equal(theme.documentBody.dataset.dshFeedbackModalOpen, undefined);
  assert.equal(feedback.noteOpen.isConnected, true);
  assert.equal(theme.activeElement(), feedback.dislike);

  feedback.noteOpen.click();
  theme.flushMutations();
  const savePortal = theme.documentBody.querySelector(
    ":scope > [data-dsh-feedback-portal]",
  );
  const saveInput = savePortal.querySelector("[data-dsh-feedback-input]");
  saveInput.value = "The conclusion is unsupported.";
  saveInput.dispatchEvent({ type: "input" });
  savePortal.querySelector("[data-dsh-feedback-save]").click();
  assert.equal(feedback.saveClicks(), 1);
  theme.flushMutations();
  assert.equal(savePortal.isConnected, false);
  assert.equal(theme.activeElement(), feedback.dislike);

  feedback.noteOpen.click();
  theme.flushMutations();
  const escapePortal = theme.documentBody.querySelector(
    ":scope > [data-dsh-feedback-portal]",
  );
  theme.dispatchKeydown("Escape");
  assert.equal(feedback.cancelClicks(), 2);
  theme.flushMutations();
  assert.equal(escapePortal.isConnected, false);
  assert.equal(theme.activeElement(), feedback.dislike);

  theme.dispatchClick(feedback.dislike);
  assert.equal(feedback.dislike.dataset.dshFeedbackDialogPending, undefined);
  theme.cleanup();
});

test("startup UI keeps circles round and renders rounded rectangles continuously", async () => {
  const source = await readFile(loadingPath, "utf8");

  assert.match(source, /\.mark\s*\{[\s\S]*?corner-shape: round/);
  assert.match(source, /data-lucide-animated-icon="loader-circle"/);
  assert.match(source, /data-lucide-animated-icon="badge-alert"/);
  assert.doesNotMatch(source, /\.mark::before|content:\s*"!"/);
  assert.match(source, /button\s*\{[\s\S]*?corner-shape: superellipse\(1\.6\)/);
  assert.match(
    source,
    /body::before\s*\{[^}]*height: 44px;[^}]*app-region: drag;[^}]*-webkit-app-region: drag/,
  );
});

test("sidebar markers pass through the slot wrapper and preserve the official root", async () => {
  const { cleanup, shellFixture } = await installTheme(
    "MacIntel",
    "",
    { includeShell: true },
  );

  assert.equal(shellFixture.sidebarSlotWrapper.dataset.dshDesktopSidebar, undefined);
  assert.equal(shellFixture.sidebarRoot.dataset.dshDesktopSidebar, "");
  assert.equal(shellFixture.logo.dataset.dshDesktopSidebarLogo, "");
  assert.equal(shellFixture.newSession.dataset.dshDesktopSidebarNew, "");
  assert.equal(shellFixture.region.dataset.dshDesktopSidebarRegion, "");
  assert.equal(shellFixture.search.dataset.dshDesktopSidebarSearch, "");
  assert.equal(
    shellFixture.search.dataset.dshDesktopSidebarSearchLabel,
    "Search workspaces and tasks",
  );
  assert.equal(shellFixture.search.dataset.dshDesktopSidebarSearchPrefix, "Search");
  assert.equal(shellFixture.foot.dataset.dshDesktopSidebarFoot, "");
  assert.equal(shellFixture.center.dataset.dshDesktopCenter, "");
  assert.equal(shellFixture.details.dataset.dshDesktopDetails, "");
  cleanup();
  assert.equal(shellFixture.search.dataset.dshDesktopSidebarSearch, undefined);
  assert.equal(shellFixture.search.dataset.dshDesktopSidebarSearchLabel, undefined);
  assert.equal(shellFixture.search.dataset.dshDesktopSidebarSearchPrefix, undefined);
});

test("sidebar hides only the provisional session before its first query", async () => {
  const { cleanup, shellFixture } = await installTheme(
    "MacIntel",
    "",
    { includeShell: true, includeSidebarSessions: true },
  );

  assert.equal(shellFixture.pendingSession.dataset.dshPendingSession, "");
  assert.equal(shellFixture.durableSession.dataset.dshPendingSession, undefined);
  assert.equal(shellFixture.searchResult.dataset.dshPendingSession, undefined);

  cleanup();
  assert.equal(shellFixture.pendingSession.dataset.dshPendingSession, undefined);
});
