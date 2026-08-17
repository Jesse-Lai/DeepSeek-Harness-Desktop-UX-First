const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  restart: () => ipcRenderer.send("desktop:restart"),
  setThemeSource: (themeSource) => {
    if (themeSource !== "light" && themeSource !== "dark" && themeSource !== "system") return;
    ipcRenderer.send("desktop:set-theme-source", themeSource);
  },
});
