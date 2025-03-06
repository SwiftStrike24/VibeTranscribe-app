/**
 * OpenAI API Utilities
 * Handles communication with the OpenAI Whisper API for audio transcription
 */

import logger from './logger';
import { getEnv } from './env';

// Environment variables will be loaded via main process and exposed to renderer

/**
 * Transcribes audio using OpenAI's Whisper API
 * @param audioBlob - The audio blob to transcribe
 * @returns Promise with the transcribed text
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  try {
    logger.flow('TRANSCRIBE_START', 'Beginning audio transcription with OpenAI Whisper API');
    
    // Get environment variables from our env utility
    const apiKey = await getEnv('OPENAI_API_KEY');
    const apiBaseUrl = await getEnv('OPENAI_API_BASE_URL');
    const apiTimeout = await getEnv('OPENAI_API_TIMEOUT') || 30000;
    const whisperModel = await getEnv('OPENAI_WHISPER_MODEL') || 'whisper-1';
    
    // Check if API key is available
    if (!apiKey) {
      const error = 'OpenAI API key not found. Please check your .env file.';
      logger.error('API', error);
      throw new Error(error);
    }
    
    // Create FormData with the audio file
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', whisperModel as string);
    formData.append('response_format', 'text');
    
    logger.info('API', `Sending ${audioBlob.size} bytes of audio data to OpenAI API`);
    
    // Make the API request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      logger.warn('API', `Request timed out after ${apiTimeout}ms`);
    }, apiTimeout);
    
    try {
      const response = await fetch(`${apiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData,
        signal: controller.signal
      });
      
      // Check if the request was successful
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
        logger.error('API', `OpenAI API error: ${errorData.error?.message || response.statusText}`);
        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
      }
      
      // Return the transcribed text
      const transcription = await response.text();
      logger.flow('TRANSCRIBE_SUCCESS', `Received ${transcription.length} characters of transcribed text`);
      return transcription;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    logger.error('API', `Transcription failed: ${error}`);
    throw new Error(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validates the OpenAI API key
 * @returns Promise<boolean> - Whether the API key is valid
 */
export async function validateApiKey(): Promise<boolean> {
  try {
    logger.debug('API', 'Validating OpenAI API key');
    
    // Get API key from environment variables using our env utility
    const apiKey = await getEnv('OPENAI_API_KEY');
    const apiBaseUrl = await getEnv('OPENAI_API_BASE_URL');
    
    // Check if API key is available
    if (!apiKey) {
      logger.error('API', 'OpenAI API key not found. Please check your .env file.');
      return false;
    }
    
    logger.debug('API', 'Making validation request to OpenAI API');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      logger.warn('API', 'API validation request timed out');
    }, 10000); // 10 second timeout
    
    try {
      const response = await fetch(`${apiBaseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      const isValid = response.ok;
      logger.info('API', `API key validation result: ${isValid ? 'Valid ✅' : 'Invalid ❌'}`);
      return isValid;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    logger.error('API', `API validation failed: ${error}`);
    return false;
  }
} 