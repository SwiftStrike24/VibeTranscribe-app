/**
 * TypeScript declaration for Electron API exposed via preload script
 */

export interface ElectronAPI {
  onStartRecording: (callback: () => void) => () => void;
  onStopRecording: (callback: () => void) => () => void;
  stopRecording: () => void;
  writeToClipboard: (text: string) => Promise<{success: boolean, error?: string}>;
  readFromClipboard: () => Promise<{success: boolean, text?: string, error?: string}>;
  getEnv: (key: string) => Promise<string | undefined>;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
