// Preload for the hidden `pf-inference` renderer. Exposes a minimal
// `pfBridge` — the only renderer ↔ main channels the inference window
// needs.

import { contextBridge, ipcRenderer } from 'electron'
import {
  PF_IPC,
  type PfReadyMessage,
  type PfFailedMessage,
  type PfAnalyzeRequest,
  type PfAnalyzeResult,
} from '../inference/types.js'

contextBridge.exposeInMainWorld('pfBridge', {
  ready: (payload: PfReadyMessage) => ipcRenderer.send(PF_IPC.READY, payload),
  failed: (payload: PfFailedMessage) => ipcRenderer.send(PF_IPC.FAILED, payload),
  onAnalyzeRequest: (handler: (req: PfAnalyzeRequest) => void) => {
    const listener = (_: Electron.IpcRendererEvent, req: PfAnalyzeRequest) => handler(req)
    ipcRenderer.on(PF_IPC.ANALYZE_REQUEST, listener)
    return () => ipcRenderer.removeListener(PF_IPC.ANALYZE_REQUEST, listener)
  },
  sendAnalyzeResult: (payload: PfAnalyzeResult) => ipcRenderer.send(PF_IPC.ANALYZE_RESULT, payload),
})
