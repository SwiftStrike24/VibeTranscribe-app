/**
 * ClipboardManager Service
 * 
 * A robust service for handling clipboard operations with:
 * - Queue-based system to manage clipboard operations
 * - Prioritized Electron clipboard API usage for focus-independent operation
 * - Automatic retry mechanism with exponential backoff
 * - Focus state detection and recovery
 * - Session-based isolation with strict boundaries for multiple recording contexts
 * - Operation verification and validation
 * - Improved fallback mechanisms with clear priority
 */
import logger from '../lib/logger';
import type { ElectronAPI } from '../types/electron';

// Type guard to check if electron is available
function isElectronAvailable(): boolean {
  const isAvailable = typeof window !== 'undefined' && 'electron' in window;
  return isAvailable;
}

// Helper function to get the electron object with proper typing
function getElectron(): ElectronAPI | undefined {
  if (isElectronAvailable()) {
    // Use unknown as an intermediate step for type safety
    return (window as unknown as { electron: ElectronAPI }).electron;
  }
  return undefined;
}

interface ClipboardOperation {
  id: string;
  text: string;
  attempts: number;
  maxAttempts: number;
  backoffDelay: number;
  timestamp: number;
  sessionId: string; // Track which recording session this belongs to
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

interface StoredClipboardData {
  text: string;
  sessionId: string;
  timestamp: number;
}

class ClipboardManager {
  private static instance: ClipboardManager;
  private operationQueue: ClipboardOperation[] = [];
  private isProcessing = false;
  private isFocused = document.hasFocus();
  private unloadHandled = false;
  private lastOperation: ClipboardOperation | null = null;
  private currentSessionId: string = crypto.randomUUID(); // Initialize with a default session ID
  
  // Singleton pattern
  public static getInstance(): ClipboardManager {
    if (!ClipboardManager.instance) {
      ClipboardManager.instance = new ClipboardManager();
    }
    return ClipboardManager.instance;
  }
  
  private constructor() {
    logger.info('CLIPBOARD', 'ClipboardManager service initialized');
    
    // Set up focus detection
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    
    // Handle page unload to save pending operations
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    
    // Process any pending operations from a previous session
    this.recoverSavedOperations();
    
    // Start the queue processor
    this.processQueue();
  }
  
  /**
   * Start a new clipboard session
   * This ensures old clipboard operations are isolated from new ones
   * Should be called when starting a new recording
   */
  public startNewSession(): string {
    logger.info('CLIPBOARD', 'Starting new clipboard session');
    
    // First, aggressively clear data from the previous session
    if (this.currentSessionId) {
      this.clearClipboardData(this.currentSessionId);
    }
    
    // Clear all existing operations from the queue that haven't been processed yet
    // This is more aggressive than the previous version which only cleared current session
    this.operationQueue = [];
    
    // Explicitly try to clear the system clipboard regardless of content matching
    // This ensures a clean slate for the new session
    this.forceEmptySystemClipboard();
    
    // Generate a new session ID
    const newSessionId = crypto.randomUUID();
    this.currentSessionId = newSessionId;
    
    // Clear the last operation reference to prevent recovery of old content
    this.lastOperation = null;
    
    // Clear any localStorage data that might not be associated with a specific session
    try {
      localStorage.removeItem('lastTranscription');
      const data = localStorage.getItem('lastTranscriptionData');
      if (data) {
        const parsed = JSON.parse(data) as StoredClipboardData;
        // If the data is more than 5 minutes old, remove it
        if (Date.now() - parsed.timestamp > 5 * 60 * 1000) {
          localStorage.removeItem('lastTranscriptionData');
        }
      }
    } catch (err) {
      logger.warn('CLIPBOARD', `Failed to clean localStorage during session start: ${err}`);
    }
    
    logger.info('CLIPBOARD', `Started fresh clipboard session: ${newSessionId}`);
    return newSessionId;
  }
  
  /**
   * Get the current session ID
   */
  public getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Clear clipboard data from current or specified session
   * @param sessionId Optional session ID to clear (defaults to current session)
   */
  public clearClipboardData(sessionId?: string): void {
    const targetSessionId = sessionId || this.currentSessionId;
    
    logger.info('CLIPBOARD', `Clearing clipboard data for session ${targetSessionId}`);
    
    // Remove operations for this session from the queue
    this.operationQueue = this.operationQueue.filter(op => op.sessionId !== targetSessionId);
    
    // Clear the last operation if it belongs to this session
    if (this.lastOperation && this.lastOperation.sessionId === targetSessionId) {
      this.lastOperation = null;
    }
    
    // Clear localStorage only if it belongs to this session
    try {
      const savedData = localStorage.getItem('lastTranscriptionData');
      if (savedData) {
        const data = JSON.parse(savedData) as StoredClipboardData;
        if (data.sessionId === targetSessionId) {
          localStorage.removeItem('lastTranscriptionData');
          localStorage.removeItem('lastTranscription');
          logger.debug('CLIPBOARD', 'Cleared localStorage data for this session');
        }
      }
    } catch (err) {
      logger.warn('CLIPBOARD', `Failed to clear localStorage: ${err}`);
    }
    
    // Also try clearing the system clipboard if it belongs to this session
    this.clearSystemClipboardIfMatches(targetSessionId);
  }

  /**
   * Forces the system clipboard to be emptied
   * This is a more aggressive approach than just clearing if content matches
   */
  private async forceEmptySystemClipboard(): Promise<void> {
    try {
      // Try to clear using Electron clipboard API
      const electron = getElectron();
      if (electron?.writeToClipboard) {
        await electron.writeToClipboard('');
        
        // Verify the clipboard was actually cleared
        const result = await electron.readFromClipboard();
        if (result.success && result.text && result.text.trim() !== '') {
          logger.warn('CLIPBOARD', 'System clipboard was not cleared properly, content still exists');
          
          // Try one more time with delay
          setTimeout(async () => {
            try {
              await electron.writeToClipboard('');
              logger.info('CLIPBOARD', 'Retry clearing system clipboard succeeded');
            } catch (e) {
              logger.warn('CLIPBOARD', `Retry clearing system clipboard failed: ${e}`);
            }
          }, 100);
        } else {
          logger.info('CLIPBOARD', 'System clipboard cleared successfully');
        }
      } else if (this.isFocused) {
        // Fallback to browser API if focused and Electron is not available
        try {
          await navigator.clipboard.writeText('');
          logger.info('CLIPBOARD', 'System clipboard cleared via browser API');
        } catch (err) {
          logger.warn('CLIPBOARD', `Failed to clear via browser API: ${err}`);
        }
      }
    } catch (error) {
      // Non-critical operation, don't throw
      logger.warn('CLIPBOARD', `Failed to clear system clipboard: ${error}`);
    }
  }
  
  /**
   * Attempts to clear the system clipboard if it contains text from the specified session
   * @param sessionId The session ID to check against
   */
  private async clearSystemClipboardIfMatches(sessionId: string): Promise<void> {
    try {
      // Try to read from system clipboard
      const electron = getElectron();
      if (electron?.readFromClipboard) {
        const result = await electron.readFromClipboard();
        if (result.success && result.text) {
          // Check if clipboard content matches any saved content for this session
          const savedText = this.getFromLocalStorage(sessionId);
          if (savedText && result.text.trim() === savedText.trim()) {
            // Clear the system clipboard to avoid content from previous sessions
            await electron.writeToClipboard('');
            logger.info('CLIPBOARD', `Cleared system clipboard for session ${sessionId}`);
          }
        }
      }
    } catch (error) {
      // Non-critical operation, don't throw
      logger.warn('CLIPBOARD', `Failed to clear system clipboard: ${error}`);
    }
  }

  /**
   * Copy text to clipboard with resilience
   * @param text Text to copy
   * @param options Configuration options
   * @returns Promise that resolves when the operation completes
   */
  public copyToClipboard(
    text: string, 
    options: {
      maxAttempts?: number;
      initialDelay?: number;
      sessionId?: string; // Allow specifying a session ID
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    } = {}
  ): Promise<boolean> {
    const {
      maxAttempts = 5,
      initialDelay = 100,
      sessionId = this.currentSessionId, // Default to current session
      onSuccess,
      onError
    } = options;
    
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      
      const operation: ClipboardOperation = {
        id,
        text,
        attempts: 0,
        maxAttempts,
        backoffDelay: initialDelay,
        timestamp: Date.now(),
        sessionId, // Track which session this operation belongs to
        onSuccess: () => {
          onSuccess?.();
          resolve(true);
        },
        onError: (error) => {
          onError?.(error);
          
          // Always resolve the promise even on final failure
          // so the app can continue
          if (operation.attempts >= maxAttempts) {
            resolve(false);
          }
        }
      };
      
      // Save to localStorage immediately as backup with session information
      this.saveToLocalStorage(text, sessionId);
      
      logger.debug('CLIPBOARD', `Adding operation ${id} to queue for session ${sessionId}`);
      this.operationQueue.push(operation);
      
      // Remember the last operation for possible recovery
      this.lastOperation = operation;
      
      // Trigger queue processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }
  
  /**
   * Attempts to recover the last clipboard operation
   * Useful when the window regains focus
   * @param sessionId Optional session ID to recover for (defaults to current session)
   */
  public recoverLastOperation(sessionId?: string): void {
    const targetSessionId = sessionId || this.currentSessionId;
    
    // Only recover operations that match the requested session
    if (this.lastOperation && 
        this.lastOperation.sessionId === targetSessionId && 
        this.lastOperation.attempts < this.lastOperation.maxAttempts) {
      
      logger.info('CLIPBOARD', `Attempting to recover last clipboard operation for session ${targetSessionId}`);
      
      // Reset attempts to trigger a fresh try
      this.lastOperation.attempts = 0;
      
      // Make sure it's in the queue
      if (!this.operationQueue.some(op => op.id === this.lastOperation!.id)) {
        this.operationQueue.push(this.lastOperation);
      }
      
      // Trigger processing
      if (!this.isProcessing) {
        this.processQueue();
      }
    } else {
      // Try to recover from localStorage as a fallback
      const savedText = this.getFromLocalStorage(targetSessionId);
      if (savedText) {
        logger.info('CLIPBOARD', `Recovering clipboard content from localStorage for session ${targetSessionId}`);
        this.copyToClipboard(savedText, {
          sessionId: targetSessionId,
          onSuccess: () => logger.info('CLIPBOARD', 'Successfully recovered content from localStorage'),
          onError: () => logger.warn('CLIPBOARD', 'Failed to recover content from localStorage')
        });
      }
    }
  }
  
  /**
   * Gets any saved text from localStorage, validating it belongs to the given session
   * @param sessionId Optional session ID to validate against (defaults to current session)
   */
  public getFromLocalStorage(sessionId?: string): string | null {
    try {
      const targetSessionId = sessionId || this.currentSessionId;
      const savedData = localStorage.getItem('lastTranscriptionData');
      
      // If there's no saved data, try the old format for backward compatibility
      if (!savedData) {
        const legacyText = localStorage.getItem('lastTranscription');
        return legacyText;
      }
      
      // Parse the saved data
      const data = JSON.parse(savedData) as StoredClipboardData;
      
      // Only return the text if it belongs to the requested session
      if (data.sessionId === targetSessionId) {
        logger.debug('CLIPBOARD', `Found matching localStorage content for session ${targetSessionId}`);
        return data.text;
      }
      
      logger.debug('CLIPBOARD', `Ignoring localStorage content from different session (requested: ${targetSessionId}, found: ${data.sessionId})`);
      return null;
    } catch (err) {
      logger.warn('CLIPBOARD', `Failed to retrieve from localStorage: ${err}`);
      return null;
    }
  }
  
  /**
   * Save text to localStorage as a backup with session information
   */
  private saveToLocalStorage(text: string, sessionId: string): void {
    try {
      // Save the plain text for backward compatibility
      localStorage.setItem('lastTranscription', text);
      
      // Save the structured data with session information
      const data: StoredClipboardData = {
        text,
        sessionId,
        timestamp: Date.now()
      };
      localStorage.setItem('lastTranscriptionData', JSON.stringify(data));
      
      logger.debug('CLIPBOARD', `Text saved to localStorage for session ${sessionId}`);
    } catch (err) {
      logger.warn('CLIPBOARD', `Failed to save to localStorage: ${err}`);
    }
  }
  
  /**
   * Process the operation queue with enhanced error handling and verification
   */
  private processQueue = async (): Promise<void> => {
    // If already processing or queue is empty, exit early
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // Filter out operations from different sessions if they're too old (more than 10 minutes)
      const now = Date.now();
      this.operationQueue = this.operationQueue.filter(op => {
        if (op.sessionId !== this.currentSessionId && (now - op.timestamp > 10 * 60 * 1000)) {
          logger.debug('CLIPBOARD', `Removing stale operation ${op.id} from old session ${op.sessionId}`);
          return false;
        }
        return true;
      });
      
      // If we cleared all operations, exit
      if (this.operationQueue.length === 0) {
        this.isProcessing = false;
        return;
      }

      // Sort by newest operations first, but prioritize current session operations
      this.operationQueue.sort((a, b) => {
        // First prioritize by session
        if (a.sessionId === this.currentSessionId && b.sessionId !== this.currentSessionId) {
          return -1;
        }
        if (a.sessionId !== this.currentSessionId && b.sessionId === this.currentSessionId) {
          return 1;
        }
        // Then by timestamp
        return b.timestamp - a.timestamp;
      });
      
      // Get the next operation
      const operation = this.operationQueue[0];
      
      // Skip if we've exceeded max attempts
      if (operation.attempts >= operation.maxAttempts) {
        logger.warn('CLIPBOARD', `Operation ${operation.id} failed after ${operation.attempts} attempts`);
        operation.onError?.(new Error('Max attempts exceeded'));
        this.operationQueue.shift(); // Remove the operation
        this.isProcessing = false;
        this.processQueue(); // Continue with next operation
        return;
      }
      
      // Increment attempts
      operation.attempts++;
      
      // Check if this operation is for the current session or a stale one
      const isCurrentSession = operation.sessionId === this.currentSessionId;
      if (!isCurrentSession) {
        logger.debug('CLIPBOARD', `Processing operation ${operation.id} from different session ${operation.sessionId}`);
      }
      
      try {
        logger.debug('CLIPBOARD', `Attempting clipboard write (${operation.attempts}/${operation.maxAttempts}) for session ${operation.sessionId}`);
        
        // ALWAYS try to use Electron's clipboard API first (works when app isn't focused)
        const electron = getElectron();
        
        if (electron?.writeToClipboard) {
          // Using Electron clipboard API which works regardless of focus state
          try {
            // First try to clear the clipboard to ensure we're starting fresh
            await electron.writeToClipboard('');
            
            // Small delay to ensure clear operation completes
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Now write the actual content
            const result = await electron.writeToClipboard(operation.text);
            
            if (result.success) {
              logger.info('CLIPBOARD', `Successfully copied to clipboard via Electron (${operation.id})`);
              
              // Verification with retry: verify clipboard content matches what we wrote
              let verificationSuccess = false;
              let verificationAttempts = 0;
              const maxVerifyAttempts = 3;
              
              while (!verificationSuccess && verificationAttempts < maxVerifyAttempts) {
                try {
                  // Small delay before verification to ensure write has completed
                  await new Promise(resolve => setTimeout(resolve, verificationAttempts * 50 + 50));
                  
                  const clipboardContent = await electron.readFromClipboard();
                  
                  if (clipboardContent.success && 
                      clipboardContent.text && 
                      clipboardContent.text.trim() === operation.text.trim()) {
                    verificationSuccess = true;
                    logger.debug('CLIPBOARD', `Verified clipboard content (attempt ${verificationAttempts + 1})`);
                  } else {
                    logger.warn('CLIPBOARD', `Verification attempt ${verificationAttempts + 1} failed: content mismatch`);
                    
                    // Retry the write if verification failed
                    if (verificationAttempts < maxVerifyAttempts - 1) {
                      await electron.writeToClipboard(operation.text);
                    }
                  }
                } catch (verifyError) {
                  logger.warn('CLIPBOARD', `Verification attempt ${verificationAttempts + 1} failed: ${verifyError}`);
                }
                
                verificationAttempts++;
              }
              
              // Even if verification failed, we'll consider it success since Electron reported success
              // but log a warning
              if (!verificationSuccess) {
                logger.warn('CLIPBOARD', `Could not verify clipboard content after ${maxVerifyAttempts} attempts, proceeding anyway`);
              }
              
              // Operation succeeded, clean up
              operation.onSuccess?.();
              this.operationQueue.shift();
              
              // Store as last successful operation (even after removed from queue)
              this.lastOperation = operation;
              
              // Make a copy to localStorage as backup
              this.saveToLocalStorage(operation.text, operation.sessionId);
              
              return;
            } else {
              // Electron clipboard API failed
              throw new Error(result.error || 'Unknown Electron clipboard error');
            }
          } catch (electronError) {
            logger.warn('CLIPBOARD', `Electron clipboard API failed: ${electronError}, trying browser API fallback`);
            throw electronError; // Re-throw to trigger browser API fallback
          }
        }
        
        // If we get here, either Electron isn't available or it failed
        // Try browser API as fallback, but only if document is focused
        if (this.isFocused) {
          try {
            await navigator.clipboard.writeText(operation.text);
            logger.info('CLIPBOARD', `Successfully copied to clipboard via browser API (${operation.id})`);
            
            // Success with browser API
            operation.onSuccess?.();
            this.operationQueue.shift();
            this.lastOperation = operation;
            
            // Also save to localStorage as backup
            this.saveToLocalStorage(operation.text, operation.sessionId);
            
            return;
          } catch (browserError) {
            logger.warn('CLIPBOARD', `Browser clipboard API failed: ${browserError}`);
            throw browserError;
          }
        } else {
          // Document isn't focused, browser API won't work
          throw new DOMException('Document is not focused', 'NotAllowedError');
        }
      } catch (error) {
        // Handle all clipboard operation failures
        logger.warn('CLIPBOARD', `Clipboard write failed (${operation.attempts}/${operation.maxAttempts}): ${error}`);
        
        // Focus-related error with no Electron available
        // Get electron reference again since we might be in a different scope
        const electronApi = getElectron();
        const isFocusError = !this.isFocused && 
                             (!electronApi || !electronApi.writeToClipboard) && 
                             error instanceof DOMException && 
                             error.name === "NotAllowedError";
        
        if (isFocusError) {
          // Browser API failed due to focus, but we'll save to localStorage and report "success"
          logger.info('CLIPBOARD', `Browser clipboard API failed due to focus, text saved to localStorage (${operation.id})`);
          this.saveToLocalStorage(operation.text, operation.sessionId);
          
          // Mark as "success" even though we only saved to localStorage
          operation.onSuccess?.();
          this.operationQueue.shift();
          this.lastOperation = operation;
        }
        // If we have more attempts and this isn't a focus error, retry with backoff
        else if (operation.attempts < operation.maxAttempts) {
          // Calculate dynamic backoff delay based on attempt number
          const nextDelay = Math.min(operation.backoffDelay * 1.5, 5000);
          operation.backoffDelay = nextDelay;
          
          logger.debug('CLIPBOARD', `Will retry operation ${operation.id} in ${nextDelay}ms (attempt ${operation.attempts}/${operation.maxAttempts})`);
          
          setTimeout(() => {
            this.isProcessing = false;
            this.processQueue();
          }, nextDelay);
          return;
        } else {
          // No more attempts, call error handler and remove
          logger.error('CLIPBOARD', `Failed to copy to clipboard after ${operation.attempts} attempts`);
          operation.onError?.(error);
          this.operationQueue.shift();
          
          // Save to localStorage as last resort
          this.saveToLocalStorage(operation.text, operation.sessionId);
        }
      }
    } catch (err) {
      // Critical error in the queue processing itself
      logger.error('CLIPBOARD', `Critical queue processing error: ${err}`);
    } finally {
      this.isProcessing = false;
      
      // Continue processing if there are more operations
      if (this.operationQueue.length > 0) {
        setTimeout(() => this.processQueue(), 50);
      }
    }
  };
  
  /**
   * Handle window focus events
   */
  private handleFocus = (): void => {
    logger.debug('CLIPBOARD', 'Window gained focus');
    this.isFocused = true;
    
    // Try to process the queue when focus is regained
    if (this.operationQueue.length > 0 && !this.isProcessing) {
      this.processQueue();
    } else {
      // If no operations in queue, try to recover the last one
      // But only for the current session
      this.recoverLastOperation(this.currentSessionId);
    }
  };
  
  /**
   * Handle window blur events
   */
  private handleBlur = (): void => {
    logger.debug('CLIPBOARD', 'Window lost focus');
    this.isFocused = false;
  };
  
  /**
   * Handle visibility change events
   */
  private handleVisibilityChange = (): void => {
    this.isFocused = document.visibilityState === 'visible';
    logger.debug('CLIPBOARD', `Visibility changed: ${this.isFocused ? 'visible' : 'hidden'}`);
    
    if (this.isFocused) {
      // Try to process the queue when visibility changes to visible
      if (this.operationQueue.length > 0 && !this.isProcessing) {
        this.processQueue();
      } else {
        // If no operations in queue, try to recover the last one
        // But only for the current session
        this.recoverLastOperation(this.currentSessionId);
      }
    }
  };
  
  /**
   * Handle page unload by saving state
   */
  private handleBeforeUnload = (): void => {
    if (this.unloadHandled) return;
    this.unloadHandled = true;
    
    // If we have operations in the queue, ensure newest is saved to localStorage
    if (this.operationQueue.length > 0) {
      // Sort by newest operations first, but prioritize current session
      this.operationQueue.sort((a, b) => {
        if (a.sessionId === this.currentSessionId && b.sessionId !== this.currentSessionId) {
          return -1;
        }
        if (a.sessionId !== this.currentSessionId && b.sessionId === this.currentSessionId) {
          return 1;
        }
        return b.timestamp - a.timestamp;
      });
      
      // Save the newest operation text
      this.saveToLocalStorage(this.operationQueue[0].text, this.operationQueue[0].sessionId);
      
      logger.debug('CLIPBOARD', 'Saved pending clipboard operation before unload');
    }
  };
  
  /**
   * Try to recover operations from a previous session
   */
  private recoverSavedOperations(): void {
    // We don't automatically recover from previous app sessions anymore
    // because that would mix content between different recording sessions
    
    // Instead, we start a fresh session each time
    this.startNewSession();
    
    logger.info('CLIPBOARD', `Started fresh clipboard session ${this.currentSessionId}`);
  }
  
  /**
   * Clean up listeners on shutdown 
   */
  public dispose(): void {
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    logger.info('CLIPBOARD', 'ClipboardManager service disposed');
  }
}

export default ClipboardManager.getInstance();
