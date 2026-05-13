import type { BrowserWindow } from 'electron'

interface WhiteboardState {
  elements: unknown[]
  latestScreenshot: string | null
}

const state: WhiteboardState = {
  elements: [],
  latestScreenshot: null,
}

export function handleUserElements(elements: unknown[], mainWindow: BrowserWindow): void {
  state.elements = elements
  // TODO: Wire into gatekeeper/renderer pipeline (port from proxy.mjs lines 450+)
  // For now, the whiteboard agent pipeline is only available in browser-mode (dev:web)
  void mainWindow
}

export function handleScreenshot(imageDataUrl: string): void {
  state.latestScreenshot = imageDataUrl
}

export function getWhiteboardState(): WhiteboardState {
  return state
}
