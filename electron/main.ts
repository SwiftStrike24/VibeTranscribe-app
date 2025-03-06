import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import { config } from 'dotenv';
import fs from 'fs';

// Simple logger for main process
function logMain(category: string, message: string, emoji = '⚡') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`${emoji} [${timestamp}] [MAIN:${category}] ${message}`);
}

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to get application icon with proper path resolution
function getAppIcon() {
  const iconPath = path.join(__dirname, '../src/assets/icon.ico');
  
  // Check if icon exists
  if (fs.existsSync(iconPath)) {
    return iconPath;
  }
  
  // Fall back to packaged app location if running in production
  const prodIconPath = path.join(process.resourcesPath, 'src/assets/icon.ico');
  if (!isDev && fs.existsSync(prodIconPath)) {
    return prodIconPath;
  }
  
  // Log warning and return undefined (compatible with Electron's type system)
  logMain('ICON', 'Failed to find app icon', '⚠️');
  return undefined;
}

logMain('INIT', 'Starting VibeTranscribe main process', '🚀');

// Determine the path to the .env file - try multiple locations
const possibleEnvPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(app.getAppPath(), '.env')
];

// Find the first valid .env file
let envPath = '';
for (const p of possibleEnvPaths) {
  if (fs.existsSync(p)) {
    envPath = p;
    break;
  }
}

// Load environment variables from .env file
if (envPath) {
  logMain('ENV', `Loading .env from: ${envPath}`, '🔐');
  const result = config({ path: envPath });
  logMain('ENV', `Dotenv config result: ${result.parsed ? 'Loaded successfully' : 'Failed to load'}`, result.parsed ? '✅' : '❌');
} else {
  logMain('ENV', 'No .env file found. Transcription will not work.', '⚠️');
}

// Log initial environment variable status
logMain('ENV', `Initial direct OPENAI_API_KEY check: ${!!process.env.OPENAI_API_KEY}`, process.env.OPENAI_API_KEY ? '✅' : '📝');
if (process.env.OPENAI_API_KEY) {
  logMain('ENV', `OPENAI_API_KEY length: ${process.env.OPENAI_API_KEY.length}`, '🔢');
} else {
  logMain('ENV', 'Checking for alternative API key sources...', '🔍');
}

// Check for MAIN_VITE_ prefixed variables first (specific to main process)
if (process.env.MAIN_VITE_OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
  logMain('ENV', 'Detected MAIN_VITE_OPENAI_API_KEY but not OPENAI_API_KEY, copying value', '🔄');
  process.env.OPENAI_API_KEY = process.env.MAIN_VITE_OPENAI_API_KEY;
  logMain('ENV', `OPENAI_API_KEY now available: ${!!process.env.OPENAI_API_KEY}`, '✅');
}

// Then check for VITE_ prefixed variables as fallback
if (!process.env.OPENAI_API_KEY && process.env.VITE_OPENAI_API_KEY) {
  logMain('ENV', 'Detected VITE_OPENAI_API_KEY but not OPENAI_API_KEY, copying value', '🔄');
  process.env.OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY;
  logMain('ENV', `OPENAI_API_KEY now available: ${!!process.env.OPENAI_API_KEY}`, '✅');
}

// Do the same for other environment variables - check MAIN_VITE_ first, then VITE_
if (process.env.MAIN_VITE_OPENAI_API_BASE_URL && !process.env.OPENAI_API_BASE_URL) {
  process.env.OPENAI_API_BASE_URL = process.env.MAIN_VITE_OPENAI_API_BASE_URL;
} else if (process.env.VITE_OPENAI_API_BASE_URL && !process.env.OPENAI_API_BASE_URL) {
  process.env.OPENAI_API_BASE_URL = process.env.VITE_OPENAI_API_BASE_URL;
}

if (process.env.MAIN_VITE_OPENAI_API_TIMEOUT && !process.env.OPENAI_API_TIMEOUT) {
  process.env.OPENAI_API_TIMEOUT = process.env.MAIN_VITE_OPENAI_API_TIMEOUT;
} else if (process.env.VITE_OPENAI_API_TIMEOUT && !process.env.OPENAI_API_TIMEOUT) {
  process.env.OPENAI_API_TIMEOUT = process.env.VITE_OPENAI_API_TIMEOUT;
}

if (process.env.MAIN_VITE_OPENAI_WHISPER_MODEL && !process.env.OPENAI_WHISPER_MODEL) {
  process.env.OPENAI_WHISPER_MODEL = process.env.MAIN_VITE_OPENAI_WHISPER_MODEL;
} else if (process.env.VITE_OPENAI_WHISPER_MODEL && !process.env.OPENAI_WHISPER_MODEL) {
  process.env.OPENAI_WHISPER_MODEL = process.env.VITE_OPENAI_WHISPER_MODEL;
}

// Log final environment variable status after all mappings
logMain('ENV', `Final OPENAI_API_KEY available: ${!!process.env.OPENAI_API_KEY}`, process.env.OPENAI_API_KEY ? '✅' : '❌');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  logMain('WINDOW', 'Creating main application window', '🖥️');
  
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 400,
    height: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    },
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    icon: getAppIcon(),
    transparent: true,
    frame: false,
  });

  // Position window at bottom center of primary display
  const { width, height } = mainWindow.getBounds();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(
    Math.floor(screenWidth / 2 - width / 2),
    Math.floor(screenHeight - height - -10), // -10px from bottom
  );
  
  // Set up pixel-level click-through handling
  let clickThroughTimer: NodeJS.Timeout | null = null;
  
  // Start monitoring mouse position for pixel-level click-through
  const startClickThroughMonitoring = () => {
    if (clickThroughTimer !== null || !mainWindow) return;
    
    logMain('MOUSE', 'Starting pixel-level click-through monitoring', '🖱️');
    clickThroughTimer = setInterval(() => {
      if (!mainWindow) {
        if (clickThroughTimer) {
          clearInterval(clickThroughTimer);
          clickThroughTimer = null;
        }
        return;
      }
      
      const point = screen.getCursorScreenPoint();
      const [winX, winY] = mainWindow.getPosition();
      const bounds = mainWindow.getBounds();
      
      // Check if cursor is within window bounds
      if (
        point.x >= winX && 
        point.x < winX + bounds.width && 
        point.y >= winY && 
        point.y < winY + bounds.height
      ) {
        // Get relative coordinates within the window
        const relX = point.x - winX;
        const relY = point.y - winY;
        
        // Capture a 1x1 pixel image at cursor position to check transparency
        mainWindow.webContents.capturePage({
          x: relX,
          y: relY,
          width: 1,
          height: 1
        }).then(image => {
          const buffer = image.getBitmap();
          // Check the alpha channel (4th byte, index 3)
          // If alpha is below threshold, make window click-through at that point
          const isTransparent = buffer[3] < 20; // Almost fully transparent
          mainWindow?.setIgnoreMouseEvents(isTransparent, { forward: true });
        }).catch(err => {
          logMain('ERROR', `Error capturing pixel for click-through: ${err}`, '❌');
        });
      }
    }, 50); // Check every 50ms - balance between responsiveness and performance
  };
  
  // Stop monitoring when window is closed
  if (mainWindow) {
    mainWindow.on('close', () => {
      if (clickThroughTimer) {
        clearInterval(clickThroughTimer);
        clickThroughTimer = null;
      }
    });
  }
  
  // Start monitoring when window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    startClickThroughMonitoring();
  });
  
  logMain('WINDOW', `Window positioned at bottom center: ${Math.floor(screenWidth / 2 - width / 2)}, ${Math.floor(screenHeight - height - 20)}`, '📏');

  // Load the index.html from a url with multiple fallback options
  let startUrl = '';
  
  if (isDev) {
    startUrl = 'http://localhost:5173'; // Vite dev server URL
    logMain('WINDOW', 'Using development server URL', '🔗');
  } else {
    // Try multiple possible paths for the index.html file
    const possiblePaths = [
      path.join(__dirname, '../dist/index.html'),
      path.join(app.getAppPath(), 'dist/index.html'),
      path.join(process.resourcesPath, 'app/dist/index.html'),
      path.join(process.resourcesPath, 'dist/index.html')
    ];
    
    logMain('WINDOW', 'Searching for index.html in production mode', '🔍');
    
    // Find the first path that exists
    let foundPath = '';
    for (const p of possiblePaths) {
      logMain('WINDOW', `Checking path: ${p}`, '🔍');
      if (fs.existsSync(p)) {
        foundPath = p;
        logMain('WINDOW', `Found index.html at: ${p}`, '✅');
        break;
      }
    }
    
    if (foundPath) {
      startUrl = new URL(`file://${foundPath}`).toString();
    } else {
      // Fallback to the default path
      logMain('WINDOW', 'Could not find index.html, using default path', '⚠️');
      startUrl = new URL(path.join(__dirname, '../dist/index.html'), 'file:').toString();
    }
    
    // Log path information for debugging
    logMain('WINDOW', `__dirname: ${__dirname}`, '📂');
    logMain('WINDOW', `app.isPackaged: ${app.isPackaged}`, '📦');
    logMain('WINDOW', `app.getAppPath(): ${app.getAppPath()}`, '📁');
    logMain('WINDOW', `process.resourcesPath: ${process.resourcesPath}`, '📁');
    logMain('WINDOW', `Resolved startUrl: ${startUrl}`, '🔗');
  }

  logMain('WINDOW', `Loading URL: ${startUrl}`, '🔗');
  mainWindow.loadURL(startUrl);

  // Register global shortcuts
  logMain('HOTKEY', 'Registering global shortcuts', '⌨️');
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (mainWindow) {
      logMain('HOTKEY', 'Global hotkey triggered: CommandOrControl+Shift+R (Start Recording)', '🎤');
      mainWindow.webContents.send('start-recording');
    }
  });

  // Open the DevTools in development mode
  if (isDev) {
    logMain('DEV', 'Opening DevTools in development mode', '🛠️');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    logMain('WINDOW', 'Main window closed', '🚪');
    mainWindow = null;
    // Unregister shortcuts when window is closed
    globalShortcut.unregisterAll();
    logMain('HOTKEY', 'Global shortcuts unregistered', '⌨️');
  });
}

// App initialization
app.whenReady().then(() => {
  logMain('APP', 'VibeTranscribe starting up', '🚀');
  
  // Register enhanced clipboard system for improved reliability
  logMain('CLIPBOARD', 'Initializing enhanced clipboard handling system', '📋');
  
  // Set app icon in the dock/taskbar
  const iconPath = getAppIcon();
  if (iconPath) {
    if (process.platform === 'darwin') {
      app.dock.setIcon(iconPath);
    }
  }
  
  // Create the main window
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logMain('APP', 'App activated with no windows, creating new window', '🔄');
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logMain('APP', 'All windows closed, quitting app', '👋');
    app.quit();
  }
});

// Handle IPC messages from renderer
ipcMain.on('stop-recording', () => {
  logMain('IPC', 'Stop recording command received', '⏹️');
});

// Listen for escape key from BrowserWindow
ipcMain.on('escape-pressed', () => {
  logMain('HOTKEY', 'Escape key pressed, stopping recording', '⏹️');
  if (mainWindow) {
    mainWindow.webContents.send('stop-recording');
  }
});

// Update microphone settings
ipcMain.on('set-microphone', (_, deviceId: string) => {
  logMain('MIC', `Microphone set to: ${deviceId}`, '🎤');
  // Save to app settings if needed
});

// Enhanced clipboard operations with retry mechanism
ipcMain.handle('write-to-clipboard', async (_, text) => {
  try {
    logMain('CLIPBOARD', `Writing to clipboard: ${text.length} characters`, '📋');
    
    // First try to clear the clipboard to avoid conflicts
    try {
      clipboard.clear();
      logMain('CLIPBOARD', 'Clipboard cleared before writing', '🧹');
    } catch (clearError) {
      logMain('CLIPBOARD', `Warning: Failed to clear clipboard: ${clearError}`, '⚠️');
      // Continue anyway
    }
    
    // Write to clipboard with retry mechanism
    let success = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!success && retryCount < maxRetries) {
      try {
        clipboard.writeText(text);
        
        // Verify the content was written correctly
        const clipboardContent = clipboard.readText();
        if (clipboardContent === text) {
          success = true;
          logMain('CLIPBOARD', `Clipboard write verified successfully on attempt ${retryCount + 1}`, '✅');
        } else {
          // Content verification failed, try again
          logMain('CLIPBOARD', `Clipboard verification failed on attempt ${retryCount + 1}, content mismatch`, '⚠️');
          retryCount++;
          
          if (retryCount < maxRetries) {
            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      } catch (writeError) {
        logMain('CLIPBOARD', `Clipboard write failed on attempt ${retryCount + 1}: ${writeError}`, '⚠️');
        retryCount++;
        
        if (retryCount < maxRetries) {
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    
    if (success) {
      return { success: true };
    } else {
      throw new Error(`Failed to write to clipboard after ${maxRetries} attempts`);
    }
  } catch (error) {
    logMain('CLIPBOARD', `Error writing to clipboard: ${error}`, '❌');
    return { success: false, error: String(error) };
  }
});

// Read from clipboard with enhanced error handling
ipcMain.handle('read-from-clipboard', async () => {
  try {
    logMain('CLIPBOARD', 'Reading from clipboard', '📋');
    const text = clipboard.readText();
    return { success: true, text };
  } catch (error) {
    logMain('CLIPBOARD', `Error reading from clipboard: ${error}`, '❌');
    return { success: false, error: String(error) };
  }
});

// Handle request for env variables from renderer
ipcMain.handle('get-env', (_, key) => {
  // Only expose specific environment variables for security
  const allowedEnvVars = [
    'OPENAI_API_KEY',
    'OPENAI_API_BASE_URL', 
    'OPENAI_API_TIMEOUT',
    'OPENAI_WHISPER_MODEL',
    // Add new VITE_ prefixed variables
    'VITE_OPENAI_API_KEY',
    'VITE_OPENAI_API_BASE_URL',
    'VITE_OPENAI_API_TIMEOUT',
    'VITE_OPENAI_WHISPER_MODEL',
    // Add new MAIN_VITE_ prefixed variables
    'MAIN_VITE_OPENAI_API_KEY',
    'MAIN_VITE_OPENAI_API_BASE_URL',
    'MAIN_VITE_OPENAI_API_TIMEOUT',
    'MAIN_VITE_OPENAI_WHISPER_MODEL',
    // Add new PRELOAD_VITE_ prefixed variables
    'PRELOAD_VITE_OPENAI_API_KEY',
    'PRELOAD_VITE_OPENAI_API_BASE_URL',
    'PRELOAD_VITE_OPENAI_API_TIMEOUT',
    'PRELOAD_VITE_OPENAI_WHISPER_MODEL'
  ];
  
  logMain('ENV', `getEnv called for key: ${key}, value exists: ${!!process.env[key]}`, '🔐');
  
  // Special handling for VITE_ prefixed variables
  if (key.startsWith('VITE_') && !process.env[key]) {
    // Try to find a non-prefixed version
    const nonPrefixedKey = key.replace('VITE_', '');
    if (process.env[nonPrefixedKey]) {
      logMain('ENV', `Using ${nonPrefixedKey} as fallback for ${key}`, '🔄');
      return process.env[nonPrefixedKey];
    }
  }
  
  // Only return the value if it's in the allowed list
  return allowedEnvVars.includes(key) ? process.env[key] : undefined;
});
