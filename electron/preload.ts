import { contextBridge, ipcRenderer } from 'electron';

// Simple logger for preload process
function logPreload(category: string, message: string, emoji = '⚡') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`${emoji} [${timestamp}] [PRELOAD:${category}] ${message}`);
}

logPreload('INIT', 'Starting VibeTranscribe preload script', '🔄');

// Check for environment variables
logPreload('ENV', `PRELOAD_VITE_OPENAI_API_KEY available: ${!!process.env.PRELOAD_VITE_OPENAI_API_KEY}`, process.env.PRELOAD_VITE_OPENAI_API_KEY ? '✅' : '❌');
logPreload('ENV', `VITE_OPENAI_API_KEY available: ${!!process.env.VITE_OPENAI_API_KEY}`, process.env.VITE_OPENAI_API_KEY ? '✅' : '❌');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
logPreload('BRIDGE', 'Setting up context bridge for renderer process', '🌉');

contextBridge.exposeInMainWorld('electron', {
  startRecording: () => {
    logPreload('IPC', 'Sending start-recording event', '⏺️');
    ipcRenderer.send('start-recording');
  },
  stopRecording: () => {
    logPreload('IPC', 'Sending stop-recording event', '⏹️');
    ipcRenderer.send('stop-recording');
  },
  escapePressed: () => {
    logPreload('IPC', 'Sending escape-pressed event', '⌨️');
    ipcRenderer.send('escape-pressed');
  },
  setMicrophone: (deviceId: string) => {
    logPreload('MIC', `Setting microphone to: ${deviceId}`, '🎤');
    ipcRenderer.send('set-microphone', deviceId);
  },
  // Mouse interaction for click-through transparency
  mouseInteraction: {
    setIgnoreMouseEvents: (ignore: boolean) => {
      logPreload('MOUSE', `Setting ignore mouse events: ${ignore}`, '🖱️');
      ipcRenderer.send('set-ignore-mouse-events', ignore);
    }
  },
  // Enhanced clipboard operations that use the main process implementation
  writeToClipboard: async (text: string) => {
    logPreload('CLIPBOARD', 'Writing to clipboard via Electron main process', '📋');
    try {
      // Use the IPC channel to call the main process handler
      // This ensures we get the enhanced implementation with verification and retries
      return await ipcRenderer.invoke('write-to-clipboard', text);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logPreload('CLIPBOARD', `Clipboard write failed: ${errorMessage}`, '❌');
      return { success: false, error: errorMessage };
    }
  },
  
  readFromClipboard: async () => {
    logPreload('CLIPBOARD', 'Reading from clipboard via Electron main process', '📋');
    try {
      // Use the IPC channel to call the main process handler
      return await ipcRenderer.invoke('read-from-clipboard');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logPreload('CLIPBOARD', `Clipboard read failed: ${errorMessage}`, '❌');
      return { success: false, error: errorMessage };
    }
  },
  
  // Event listeners
  onStartRecording: (callback: () => void) => {
    logPreload('IPC', 'Registering start-recording event listener', '👂');
    ipcRenderer.on('start-recording', () => {
      logPreload('IPC', 'Received start-recording event', '📥');
      callback();
    });
    return () => {
      logPreload('IPC', 'Removing start-recording event listener', '🗑️');
      ipcRenderer.removeListener('start-recording', callback);
    };
  },
  onStopRecording: (callback: () => void) => {
    logPreload('IPC', 'Registering stop-recording event listener', '👂');
    ipcRenderer.on('stop-recording', () => {
      logPreload('IPC', 'Received stop-recording event', '📥');
      callback();
    });
    return () => {
      logPreload('IPC', 'Removing stop-recording event listener', '🗑️');
      ipcRenderer.removeListener('stop-recording', callback);
    };
  },

  // Get environment variables (securely exposes env vars to renderer)
  getEnv: async (key: string) => {
    logPreload('ENV', `Getting env variable: ${key}`, '🔐');
    return await ipcRenderer.invoke('get-env', key);
  }
});

logPreload('DONE', 'Preload script completed successfully', '🏁');
