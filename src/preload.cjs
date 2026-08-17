const { contextBridge, ipcRenderer } = require("electron");

const composerOverlay = process.argv.includes("--dsh-composer-overlay");
const desktop = {
  composerOverlay,
  restart: () => ipcRenderer.send("desktop:restart"),
  syncTrafficLightPosition: () => ipcRenderer.send("desktop:sync-traffic-lights"),
};

if (composerOverlay) {
  const forwardedHoverAttribute = "data-dsh-forwarded-hover";
  const forwardedHoverSelector = [
    "[data-dsh-composer-command] button",
    "button[data-dsh-composer-command]",
    "[data-dsh-composer-modes] button",
    "[data-dsh-composer-modes] select",
    '[data-dsh-composer-trailing] button[data-dsh-composer-menu-trigger="model"]',
    '[data-dsh-hero-workspace-row] button[aria-haspopup="menu"]',
  ].join(",");
  let forwardedHoverTarget;

  const updateForwardedHover = (_event, point) => {
    let nextTarget;
    if (
      point !== null &&
      typeof point === "object" &&
      typeof point.x === "number" &&
      Number.isFinite(point.x) &&
      typeof point.y === "number" &&
      Number.isFinite(point.y)
    ) {
      const hit = document.elementFromPoint(point.x, point.y);
      const candidate = hit?.closest?.(forwardedHoverSelector);
      if (
        candidate instanceof HTMLElement &&
        (candidate.closest("[data-composer-card]") !== null ||
          candidate.closest("[data-dsh-hero-workspace-row]") !== null) &&
        !candidate.matches(":disabled")
      ) {
        nextTarget = candidate;
      }
    }

    if (nextTarget === forwardedHoverTarget) return;
    forwardedHoverTarget?.removeAttribute(forwardedHoverAttribute);
    forwardedHoverTarget = nextTarget;
    forwardedHoverTarget?.setAttribute(forwardedHoverAttribute, "");
  };

  ipcRenderer.on("desktop:composer-hover-point", updateForwardedHover);
  window.addEventListener("beforeunload", () => {
    ipcRenderer.removeListener(
      "desktop:composer-hover-point",
      updateForwardedHover,
    );
  });

  desktop.setComposerOverlayInteraction = (value) =>
    ipcRenderer.send("desktop:composer-overlay-interaction", value);
  desktop.onComposerSessionContext = (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, context) => listener(context);
    ipcRenderer.on("desktop:composer-session-context", handler);
    return () => ipcRenderer.removeListener("desktop:composer-session-context", handler);
  };
  desktop.requestComposerSessionContext = () =>
    ipcRenderer.send("desktop:composer-session-request");
} else {
  desktop.setModalOverlayVisible = (visible, maskAlpha) =>
    ipcRenderer.send("desktop:modal-overlay-visible", visible, maskAlpha);
  desktop.setComposerGlassFrame = (frame) =>
    ipcRenderer.send("desktop:composer-glass-frame", frame);
  desktop.setSidebarButtonGlassFrame = (frame) =>
    ipcRenderer.send("desktop:sidebar-button-glass-frame", frame);
  desktop.setScrollButtonGlassFrame = (frame) =>
    ipcRenderer.send("desktop:scroll-button-glass-frame", frame);
  desktop.publishComposerSessionContext = (context) =>
    ipcRenderer.send("desktop:composer-session-publish", context);
}

contextBridge.exposeInMainWorld("desktop", desktop);
