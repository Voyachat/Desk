import { contextBridge, ipcRenderer } from 'electron'
import {
  STARTUP_CHANNELS,
  type StartupApi,
  type StartupIntent,
  type StartupState,
} from './startup-ipc.js'

const api: StartupApi = {
  getIntent: () => ipcRenderer.invoke(STARTUP_CHANNELS.getIntent) as Promise<StartupIntent | null>,
  setIntent: intent => ipcRenderer.invoke(STARTUP_CHANNELS.setIntent, intent) as Promise<StartupIntent>,
  acknowledge: () => ipcRenderer.invoke(STARTUP_CHANNELS.acknowledge) as Promise<void>,
  getState: () => ipcRenderer.invoke(STARTUP_CHANNELS.getState) as Promise<StartupState>,
  retry: () => ipcRenderer.invoke(STARTUP_CHANNELS.retry) as Promise<StartupState>,
  onState: (listener) => {
    const handleState = (_event: Electron.IpcRendererEvent, state: StartupState): void => { listener(state) }
    ipcRenderer.on(STARTUP_CHANNELS.stateChanged, handleState)
    return () => { ipcRenderer.removeListener(STARTUP_CHANNELS.stateChanged, handleState) }
  },
}

contextBridge.exposeInMainWorld('voyaseekStartup', api)
