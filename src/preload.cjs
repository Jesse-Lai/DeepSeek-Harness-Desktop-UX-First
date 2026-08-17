const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  restart: () => ipcRenderer.send("desktop:restart"),
});
