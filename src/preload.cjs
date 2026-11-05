const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  onCompanionOpen: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, sessionId) => listener(sessionId);
    ipcRenderer.on("desktop:companion-open", wrapped);
    ipcRenderer.send("desktop:companion-ready");
    return () => ipcRenderer.removeListener("desktop:companion-open", wrapped);
  },
  companionOpened: (sessionId) => ipcRenderer.send("desktop:companion-opened", sessionId),
  atomContext: () => ipcRenderer.invoke("desktop:atom-context"),
  closeAtomWindow: () => ipcRenderer.send("desktop:atom-close-window"),
  createAtomWindow: (payload) => ipcRenderer.invoke("desktop:atom-create-window", payload),
  detachAtomSession: (payload) => ipcRenderer.invoke("desktop:atom-detach-session", payload),
  createTaskScope: () => ipcRenderer.invoke("desktop:create-task-scope"),
  focusAtomWindow: (windowId) => ipcRenderer.send("desktop:atom-focus-window", windowId),
  onAtomEvent: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on("desktop:atom-event", wrapped);
    return () => ipcRenderer.removeListener("desktop:atom-event", wrapped);
  },
  publishAtomEvent: (type, detail) => ipcRenderer.send("desktop:atom-publish", { type, detail }),
  restart: () => ipcRenderer.send("desktop:restart"),
  setThemeSource: (themeSource) => {
    if (themeSource !== "light" && themeSource !== "dark" && themeSource !== "system") return;
    ipcRenderer.send("desktop:set-theme-source", themeSource);
  },
});
