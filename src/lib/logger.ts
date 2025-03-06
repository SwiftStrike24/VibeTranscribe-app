/**
 * VibeTranscribe Logger
 * A colorful, emoji-rich logger for tracking application flow
 */

// Log categories with their emojis
const LOG_CATEGORIES = {
  APP: '🚀',
  MIC: '🎤',
  RECORD: '⏺️',
  STOP: '⏹️',
  TRANSCRIBE: '📝',
  API: '🌐',
  ERROR: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
  INFO: '📌',
  DEBUG: '🔍',
  ELECTRON: '⚡',
  ENV: '🔐',
  AUDIO: '🔊',
  AUDIO_LEVEL: '📊', // Added for tracking audio level detection
  PROCESS: '⚙️',
  UI: '🖥️',
  CLIPBOARD: '📋',
  HOTKEY: '⌨️',
  INIT: '🔄',
  DONE: '🏁',
  MOUSE: '🖱️',
  SILENCE: '🔇' // Added for tracking silence detection
};

// Category-specific log levels
const categoryLogLevels: Partial<Record<keyof typeof LOG_CATEGORIES, LogLevel>> = {};

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
  NONE = 4
}

// Current log level - can be changed at runtime
let currentLogLevel = LogLevel.INFO;

// Set the global log level
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
  log('APP', `Log level set to ${LogLevel[level]}`, LogLevel.INFO);
}

// Set log level for a specific category
export function setCategoryLogLevel(category: keyof typeof LOG_CATEGORIES, level: LogLevel): void {
  categoryLogLevels[category] = level;
  log('APP', `Log level for ${category} set to ${LogLevel[level]}`, LogLevel.INFO);
}

// Silence a category completely
export function silenceCategory(category: keyof typeof LOG_CATEGORIES): void {
  setCategoryLogLevel(category, LogLevel.NONE);
}

// Main log function
export function log(category: keyof typeof LOG_CATEGORIES, message: string, level: LogLevel = LogLevel.INFO): void {
  // Check category-specific log level first, then fall back to global level
  const effectiveLogLevel = categoryLogLevels[category] !== undefined 
    ? categoryLogLevels[category] 
    : currentLogLevel;
    
  if (level < effectiveLogLevel) return;
  
  const emoji = LOG_CATEGORIES[category] || '📋';
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = `${emoji} [${timestamp}] [${category}]`;
  
  // Different styling based on log level
  try {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`${prefix} ${message}`);
        break;
      case LogLevel.INFO:
        console.info(`${prefix} ${message}`);
        break;
      case LogLevel.WARNING:
        console.warn(`${prefix} ${message}`);
        break;
      case LogLevel.ERROR:
        console.error(`${prefix} ${message}`);
        break;
    }
  } catch (err) {
    // Fall back to a basic console.log if the preferred method fails
    console.log(`${prefix} ${message}`);
    if (err && err instanceof Error) {
      console.log(`Failed to log with preferred method: ${err.message}`);
    }
  }
}

// Helper function to safely handle errors in operations that might fail
export function safeOperation<T>(operation: () => T, fallback: T, errorMessage?: string, category: keyof typeof LOG_CATEGORIES = 'ERROR'): T {
  try {
    return operation();
  } catch (err) {
    // Only log if we have an error message
    if (errorMessage) {
      const fullMessage = err instanceof Error 
        ? `${errorMessage}: ${err.name}: ${err.message}`
        : `${errorMessage}: Unknown error`;
      log(category, fullMessage, LogLevel.ERROR);
    }
    return fallback;
  }
}

// Convenience methods for different log levels
export const debug = (category: keyof typeof LOG_CATEGORIES, message: string) => 
  log(category, message, LogLevel.DEBUG);

export const info = (category: keyof typeof LOG_CATEGORIES, message: string) => 
  log(category, message, LogLevel.INFO);

export const warn = (category: keyof typeof LOG_CATEGORIES, message: string) => 
  log(category, message, LogLevel.WARNING);

export const error = (category: keyof typeof LOG_CATEGORIES, message: string) => 
  log(category, message, LogLevel.ERROR);

// Special logger for tracking app flow
export function flow(step: string, details?: string): void {
  const message = details ? `${step} - ${details}` : step;
  log('APP', `FLOW: ${message}`, LogLevel.DEBUG);
}

// Log with data (objects, arrays, etc.)
export function logData<T>(category: keyof typeof LOG_CATEGORIES, message: string, data: T, level: LogLevel = LogLevel.DEBUG): void {
  if (level < currentLogLevel) return;
  
  log(category, message, level);
  console.group(`${LOG_CATEGORIES[category]} Data:`);
  console.dir(data);
  console.groupEnd();
}

// Initialize logger
log('INIT', 'Logger initialized', LogLevel.INFO);

export default {
  log,
  debug,
  info,
  warn,
  error,
  flow,
  logData,
  setLogLevel,
  setCategoryLogLevel,
  silenceCategory,
  safeOperation,
  LogLevel
};
