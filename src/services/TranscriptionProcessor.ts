/**
 * TranscriptionProcessor Service
 * 
 * A robust service to manage the audio transcription process:
 * - Separate from UI components
 * - Resilient to interruptions 
 * - Handles errors gracefully with retries
 * - Manages state and provides progress updates
 */
import { transcribeAudio } from '../lib/openai';
import logger from '../lib/logger';
import clipboardManager from './ClipboardManager';
import errorHandler, { ErrorType } from './ErrorHandler';

export enum TranscriptionStatus {
  IDLE = 'idle',
  PROCESSING = 'processing',
  TRANSCRIBING = 'transcribing',
  COPYING = 'copying',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface TranscriptionResult {
  text: string;
  clipboardSuccess: boolean;
  processingTimeMs: number;
}

export interface TranscriptionOptions {
  maxRetries?: number;
  sessionId?: string; // Add session ID to track which recording this belongs to
  onProgress?: (status: TranscriptionStatus, progress: number) => void;
  onComplete?: (result: TranscriptionResult) => void;
  onError?: (error: Error) => void;
}

interface TranscriptionJob {
  id: string;
  audioBlob: Blob;
  options: TranscriptionOptions;
  startTime: number;
  status: TranscriptionStatus;
  attempts: number;
  sessionId: string; // Add session ID for clipboard operations
  result?: TranscriptionResult;
  error?: Error;
}

class TranscriptionProcessor {
  private static instance: TranscriptionProcessor;
  private currentJob: TranscriptionJob | null = null;
  private isProcessing = false;
  private currentSessionId: string = ''; // Track the current session ID
  
  // Statistics for monitoring
  private stats = {
    totalJobs: 0,
    successfulJobs: 0,
    failedJobs: 0,
    totalProcessingTimeMs: 0,
    averageProcessingTimeMs: 0
  };
  
  // Singleton pattern
  public static getInstance(): TranscriptionProcessor {
    if (!TranscriptionProcessor.instance) {
      TranscriptionProcessor.instance = new TranscriptionProcessor();
    }
    return TranscriptionProcessor.instance;
  }
  
  private constructor() {
    logger.info('PROCESS', 'TranscriptionProcessor service initialized');
    // Create an initial session ID
    this.startNewSession();
  }
  
  /**
   * Start a new transcription session
   * This ensures proper isolation between different recordings
   */
  public startNewSession(): string {
    // First aggressively clear any previous state
    if (this.currentJob) {
      logger.warn('PROCESS', `Clearing unfinished job from previous session: ${this.currentJob.id}`);
      
      // Cancel the current job
      this.currentJob.status = TranscriptionStatus.FAILED;
      this.currentJob.error = new Error('Session terminated for new recording');
      
      // Notify error handler if there's a callback
      this.currentJob.options.onError?.(this.currentJob.error);
      
      // Reset processing flag
      this.isProcessing = false;
    }
    
    // Clear clipboard data from previous session if exists
    if (this.currentSessionId) {
      // Clear clipboard data aggressively
      clipboardManager.clearClipboardData(this.currentSessionId);
      logger.info('PROCESS', `Cleared previous session data: ${this.currentSessionId}`);
    }
    
    // Start a new session in the clipboard manager
    // This will also clear the system clipboard and ensure no old content remains
    this.currentSessionId = clipboardManager.startNewSession();
    
    // Reset the current job reference
    this.currentJob = null;
    
    logger.info('PROCESS', `Started new transcription session: ${this.currentSessionId}`);
    return this.currentSessionId;
  }
  
  /**
   * Get the current session ID
   */
  public getCurrentSessionId(): string {
    return this.currentSessionId;
  }
  
  /**
   * Process audio data and get transcription text with enhanced session isolation
   */
  public async processAudio(
    audioBlob: Blob,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    // Always start a new session when processing audio to ensure clean state
    // This is more robust than using the option's sessionId or just checking if one exists
    const sessionId = this.startNewSession();
    const jobId = crypto.randomUUID();
    
    logger.info('PROCESS', `Processing audio with new session ID: ${sessionId}`);
    
    // Create a new transcription job
    const job: TranscriptionJob = {
      id: jobId,
      audioBlob,
      options: {
        maxRetries: options.maxRetries ?? 1,
        sessionId, // Store the session ID in options
        onProgress: options.onProgress,
        onComplete: options.onComplete,
        onError: options.onError
      },
      startTime: Date.now(),
      status: TranscriptionStatus.IDLE,
      attempts: 0,
      sessionId // Store the session ID directly in the job
    };
    
    // Track job stats
    this.stats.totalJobs++;
    
    // Set the current job
    this.currentJob = job;
    
    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.executeJob(job)
        .then(result => {
          resolve(result);
          this.currentJob = null;
          this.isProcessing = false;
        })
        .catch(error => {
          reject(error);
          this.currentJob = null;
          this.isProcessing = false;
        });
    });
  }
  
  /**
   * Execute a transcription job
   */
  private async executeJob(job: TranscriptionJob): Promise<TranscriptionResult> {
    try {
      // Start processing
      this.isProcessing = true;
      job.status = TranscriptionStatus.PROCESSING;
      job.options.onProgress?.(TranscriptionStatus.PROCESSING, 0.1);
      
      logger.info('PROCESS', `Starting transcription job ${job.id}`);
      logger.debug('PROCESS', `Audio blob size: ${job.audioBlob.size} bytes`);
      
      // Update attempt count
      job.attempts++;
      
      // Start transcription
      job.status = TranscriptionStatus.TRANSCRIBING;
      job.options.onProgress?.(TranscriptionStatus.TRANSCRIBING, 0.3);
      
      // Call the API to transcribe audio
      let transcribedText: string;
      try {
        transcribedText = await this.transcribeWithRetry(job);
      } catch (error) {
        // Handle API errors
        const appError = await errorHandler.captureError(
          ErrorType.API_REQUEST_FAILED,
          `Transcription API request failed: ${error}`,
          {
            operation: 'transcribe_audio',
            component: 'TranscriptionProcessor',
            data: { jobId: job.id, attempts: job.attempts },
            attemptsMade: job.attempts
          },
          error
        );
        
        // If the error handler couldn't recover, fail the job
        if (!appError) {
          throw error;
        }
        
        // If we've already tried too many times, fail
        if (job.attempts >= job.options.maxRetries!) {
          throw new Error(`Transcription failed after ${job.attempts} attempts: ${error}`);
        }
        
        // Otherwise, retry
        logger.info('PROCESS', `Retrying transcription job ${job.id} (attempt ${job.attempts + 1})`);
        return this.executeJob(job);
      }
      
      // Check if the job was canceled during transcription
      if (job.status as string === TranscriptionStatus.FAILED as string) {
        throw new Error('Transcription job was canceled');
      }
      
      // Log success
      const snippet = transcribedText!.length > 50 
        ? `${transcribedText!.substring(0, 50)}...` 
        : transcribedText;
      logger.info('TRANSCRIBE', `Transcription received: "${snippet}"`);
      
      // Copy to clipboard
      job.status = TranscriptionStatus.COPYING;
      job.options.onProgress?.(TranscriptionStatus.COPYING, 0.8);
      
      // Ensure no lingering clipboard operations from previous sessions
      clipboardManager.clearClipboardData(job.sessionId);
      
      // Use clipboard manager to reliably copy the text with the current session ID
      const clipboardSuccess = await clipboardManager.copyToClipboard(
        transcribedText!,
        {
          sessionId: job.sessionId, // Use the job's session ID
          maxAttempts: 5, // Increase retry attempts 
          onSuccess: () => logger.info('CLIPBOARD', 'Transcription copied to clipboard via processor'),
          onError: (err) => {
            logger.warn('CLIPBOARD', `Failed to copy in processor: ${err}`);
            
            // Report the error but don't fail the job
            errorHandler.captureError(
              ErrorType.CLIPBOARD_WRITE_FAILED,
              'Failed to copy transcription to clipboard',
              {
                operation: 'copy_to_clipboard',
                component: 'TranscriptionProcessor',
                data: { jobId: job.id, sessionId: job.sessionId }
              },
              err
            );
          }
        }
      );
      
      // Calculate processing time
      const processingTimeMs = Date.now() - job.startTime;
      
      // Update stats
      this.stats.successfulJobs++;
      this.stats.totalProcessingTimeMs += processingTimeMs;
      this.stats.averageProcessingTimeMs = this.stats.totalProcessingTimeMs / this.stats.successfulJobs;
      
      // Create result
      const result: TranscriptionResult = {
        text: transcribedText!,
        clipboardSuccess,
        processingTimeMs
      };
      
      // Update job status
      job.status = TranscriptionStatus.COMPLETED;
      job.result = result;
      job.options.onProgress?.(TranscriptionStatus.COMPLETED, 1.0);
      
      // Notify completion
      job.options.onComplete?.(result);
      
      logger.info('PROCESS', `Transcription job ${job.id} completed in ${processingTimeMs}ms`);
      
      return result;
    } catch (error) {
      // Handle general errors
      job.status = TranscriptionStatus.FAILED;
      job.error = error instanceof Error ? error : new Error(String(error));
      
      // Update stats
      this.stats.failedJobs++;
      
      // Notify error
      job.options.onError?.(job.error);
      
      logger.error('PROCESS', `Transcription job ${job.id} failed: ${job.error.message}`);
      
      // Report to error handler
      errorHandler.captureError(
        ErrorType.AUDIO_PROCESSING_FAILED,
        `Audio processing failed: ${job.error.message}`,
        {
          operation: 'process_audio',
          component: 'TranscriptionProcessor',
          data: {
            jobId: job.id,
            attempts: job.attempts,
            audioSize: job.audioBlob.size
          }
        },
        job.error,
        false // Mark as non-recoverable since we already tried
      );
      
      throw job.error;
    } finally {
      // Ensure isProcessing is reset
      this.isProcessing = false;
    }
  }
  
  /**
   * Transcribe audio with retry handling
   */
  private async transcribeWithRetry(job: TranscriptionJob): Promise<string> {
    try {
      return await transcribeAudio(job.audioBlob);
    } catch (error) {
      // Detect network errors or timeouts
      if (error instanceof Error) {
        if (
          error.message.includes('network') ||
          error.message.includes('timeout') ||
          error.message.includes('failed to fetch')
        ) {
          // For network errors, we retry automatically
          if (job.attempts < job.options.maxRetries!) {
            logger.warn('TRANSCRIBE', `Network error, retrying (${job.attempts}/${job.options.maxRetries})`);
            
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Update attempt count
            job.attempts++;
            
            // Retry
            return this.transcribeWithRetry(job);
          }
        }
      }
      
      // If we get here, either it's not a network error or we've exceeded retries
      throw error;
    }
  }
  
  /**
   * Get the current processing status
   */
  public getStatus(): {
    isProcessing: boolean;
    currentJob: Omit<TranscriptionJob, 'audioBlob'> | null;
    stats: typeof TranscriptionProcessor.prototype.stats;
  } {
    if (!this.currentJob) {
      return {
        isProcessing: this.isProcessing,
        currentJob: null,
        stats: { ...this.stats }
      };
    }
    
    // Create a copy without the audioBlob property by explicitly constructing a new object
    const currentJobWithoutBlob = Object.fromEntries(
      Object.entries(this.currentJob).filter(([key]) => key !== 'audioBlob')
    ) as Omit<TranscriptionJob, 'audioBlob'>;
    
    return {
      isProcessing: this.isProcessing,
      currentJob: currentJobWithoutBlob,
      stats: { ...this.stats }
    };
  }
  
  /**
   * Reset the service state
   */
  public reset(): void {
    // Clear clipboard data from the current session before resetting
    if (this.currentJob) {
      clipboardManager.clearClipboardData(this.currentJob.sessionId);
    }
    
    this.currentJob = null;
    this.isProcessing = false;
    
    // Start a new session to ensure clean state
    this.startNewSession();
    
    logger.info('PROCESS', 'TranscriptionProcessor service reset');
  }
}

export default TranscriptionProcessor.getInstance();
