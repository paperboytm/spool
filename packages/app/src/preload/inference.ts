// Preload for the hidden `pf-inference` renderer. Exposes a minimal
// `pfBridge` — only the renderer → main channels the inference window
// needs. No `ipcRenderer.on` surface yet; future PRs will extend this
// when main pushes analyze requests in.

import { contextBridge, ipcRenderer } from 'electron'
import { PF_IPC, type PfReadyMessage, type PfFailedMessage } from '../inference/types.js'

contextBridge.exposeInMainWorld('pfBridge', {
  ready: (payload: PfReadyMessage) => ipcRenderer.send(PF_IPC.READY, payload),
  failed: (payload: PfFailedMessage) => ipcRenderer.send(PF_IPC.FAILED, payload),
})
