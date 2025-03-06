/**
 * ErrorHandler Service
 * 
 * A comprehensive error handling service that provides:
 * - Structured error types with meaningful codes
 * - Recovery strategies for different error scenarios
 * - Centralized error logging and monitoring
 * - Context-aware error reporting
 */
import logger from '../lib/logger';

// Define application error types
export enum ErrorType {
  // Audio related errors
  MICROPHONE_ACCESS_DENIED = 'microphone_access_denied',
  MICROPHONE_NOT_AVAILABLE = 'microphone_not_available',
  RECORDING_FAILED = 'recording_failed',
  AUDIO_PROCESSING_FAILED = 'audio_processing_failed',
  
  // API related errors
  API_REQUEST_FAILED = 'api_request_failed',
  API_KEY_MISSING = 'api_key_missing',
  API_RATE_LIMIT = 'api_rate_limit',
  API_TIMEOUT = 'api_timeout',
  
  // Clipboard related errors
  CLIPBOARD_PERMISSION_DENIED = 'clipboard_permission_denied',
  CLIPBOARD_WRITE_FAILED = 'clipboard_write_failed',
  
  // Environment related errors
  ENV_VARIABLES_MISSING = 'env_variables_missing',
  
  // General errors
  UNKNOWN_ERROR = 'unknown_error',
  NETWORK_ERROR = 'network_error',
  INTERNAL_ERROR = 'internal_error'
}

// Define error contexts to provide more metadata about errors
export interface ErrorContext {
  operation: string;
  component?: string;
  data?: Record<string, unknown>;
  timestamp: number;
  attemptsMade?: number;
}

// Define application error structure
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly context: ErrorContext;
  public readonly originalError?: unknown;
  public readonly recoverable: boolean;
  
  constructor(
    type: ErrorType,
    message: string,
    context: Partial<ErrorContext>,
    originalError?: unknown,
    recoverable = true
  ) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.context = {
      operation: context.operation || 'unknown_operation',
      component: context.component,
      data: context.data,
      timestamp: context.timestamp || Date.now(),
      attemptsMade: context.attemptsMade || 0
    };
    this.originalError = originalError;
    this.recoverable = recoverable;
    
    // Ensure stack trace captures the point of error creation
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

// Define recovery strategies for different error types
type RecoveryStrategy = (error: AppError) => Promise<boolean>;

class ErrorHandler {
  private static instance: ErrorHandler;
  private recoveryStrategies: Map<ErrorType, RecoveryStrategy> = new Map();
  private errorHistory: AppError[] = [];
  private readonly MAX_HISTORY_SIZE = 20;
  
  // Singleton pattern
  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }
  
  private constructor() {
    this.initializeRecoveryStrategies();
    logger.info('ERROR', 'ErrorHandler service initialized');
  }
  
  /**
   * Initialize default recovery strategies for known error types
   */
  private initializeRecoveryStrategies(): void {
    // Microphone access denied
    this.registerRecoveryStrategy(ErrorType.MICROPHONE_ACCESS_DENIED, async (error) => {
      logger.info('ERROR', `Attempting recovery for ${error.type}: requesting permissions again`);
      try {
        // Attempt to request permissions again
        await navigator.mediaDevices.getUserMedia({ audio: true });
        return true;
      } catch {
        return false;
      }
    });
    
    // API timeout errors can be retried
    this.registerRecoveryStrategy(ErrorType.API_TIMEOUT, async (error) => {
      const attempts = (error.context.attemptsMade || 0) + 1;
      
      // Only retry up to 3 times
      if (attempts <= 3) {
        logger.info('ERROR', `Attempting recovery for API timeout: retry ${attempts}/3`);
        
        // We don't perform the actual retry here - we just signal that
        // it's recoverable and let the caller handle the retry logic
        return true;
      }
      
      logger.warn('ERROR', `API timeout recovery failed after ${attempts} attempts`);
      return false;
    });
    
    // API rate limit - wait and retry
    this.registerRecoveryStrategy(ErrorType.API_RATE_LIMIT, async (error) => {
      const attempts = (error.context.attemptsMade || 0) + 1;
      
      // Only retry up to 2 times with exponential backoff
      if (attempts <= 2) {
        const delayMs = Math.pow(2, attempts) * 1000;
        
        logger.info('ERROR', `Rate limited, waiting ${delayMs}ms before retry ${attempts}/2`);
        
        // Wait for backoff period
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return true;
      }
      
      logger.warn('ERROR', `API rate limit recovery failed after ${attempts} attempts`);
      return false;
    });
    
    // Default recovery for unknown errors - just log and don't retry
    this.registerRecoveryStrategy(ErrorType.UNKNOWN_ERROR, async () => {
      logger.warn('ERROR', 'No recovery strategy for unknown error');
      return false;
    });
  }
  
  /**
   * Register a custom recovery strategy for an error type
   */
  public registerRecoveryStrategy(type: ErrorType, strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(type, strategy);
    logger.debug('ERROR', `Registered recovery strategy for ${type}`);
  }
  
  /**
   * Handle an error with the appropriate recovery strategy
   * @returns true if recovery was successful, false otherwise
   */
  public async handleError(error: AppError): Promise<boolean> {
    // Add to error history for analysis
    this.addToErrorHistory(error);
    
    // Log the error
    this.logError(error);
    
    // Skip recovery for non-recoverable errors
    if (!error.recoverable) {
      logger.warn('ERROR', `Error ${error.type} marked as non-recoverable`);
      return false;
    }
    
    // Get the appropriate recovery strategy
    const strategy = this.recoveryStrategies.get(error.type) ||
                    this.recoveryStrategies.get(ErrorType.UNKNOWN_ERROR);
    
    if (!strategy) {
      logger.warn('ERROR', `No recovery strategy found for ${error.type}`);
      return false;
    }
    
    // Attempt recovery
    try {
      const success = await strategy(error);
      
      if (success) {
        logger.info('ERROR', `Successfully recovered from ${error.type}`);
      } else {
        logger.warn('ERROR', `Failed to recover from ${error.type}`);
      }
      
      return success;
    } catch (recoveryError) {
      logger.error('ERROR', `Recovery attempt failed: ${recoveryError}`);
      return false;
    }
  }
  
  /**
   * Create and handle an error in one step
   * @returns true if recovery was successful, false otherwise
   */
  public async captureError(
    type: ErrorType,
    message: string,
    context: Partial<ErrorContext>,
    originalError?: unknown,
    recoverable = true
  ): Promise<boolean> {
    const error = new AppError(type, message, context, originalError, recoverable);
    return this.handleError(error);
  }
  
  /**
   * Add an error to the history for tracking patterns
   */
  private addToErrorHistory(error: AppError): void {
    this.errorHistory.unshift(error);
    
    // Limit the history size
    if (this.errorHistory.length > this.MAX_HISTORY_SIZE) {
      this.errorHistory.pop();
    }
  }
  
  /**
   * Log an error with appropriate detail level
   */
  private logError(error: AppError): void {
    const errorInfo = {
      type: error.type,
      message: error.message,
      context: error.context,
      stack: error.stack,
      originalError: error.originalError
    };
    
    // Critical errors are logged at ERROR level
    const criticalErrorTypes = [
      ErrorType.API_KEY_MISSING,
      ErrorType.ENV_VARIABLES_MISSING,
      ErrorType.MICROPHONE_NOT_AVAILABLE
    ];
    
    if (criticalErrorTypes.includes(error.type)) {
      logger.error('ERROR', `Critical error: ${error.message}`);
      logger.logData('ERROR', 'Error details:', errorInfo);
    } else {
      // Regular errors are logged at WARNING level
      logger.warn('ERROR', `Error occurred: ${error.message}`);
      logger.logData('ERROR', 'Error details:', errorInfo, logger.LogLevel.DEBUG);
    }
  }
  
  /**
   * Get recent errors for analysis
   */
  public getRecentErrors(): AppError[] {
    return [...this.errorHistory];
  }
  
  /**
   * Check if we've seen a particular error type recently
   */
  public hasRecentError(type: ErrorType, withinMs = 60000): boolean {
    const cutoffTime = Date.now() - withinMs;
    return this.errorHistory.some(
      err => err.type === type && err.context.timestamp >= cutoffTime
    );
  }
  
  /**
   * Clear error history
   */
  public clearErrorHistory(): void {
    this.errorHistory = [];
    logger.debug('ERROR', 'Error history cleared');
  }
}

export default ErrorHandler.getInstance();
