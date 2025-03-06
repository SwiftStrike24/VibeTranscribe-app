import { useState, useEffect, useRef, useCallback } from 'react';
import type { ElectronAPI } from '../types/electron';
import logger from '../lib/logger';
import transcriptionProcessor from '../services/TranscriptionProcessor';
import errorHandler, { ErrorType } from '../services/ErrorHandler';

// Audio level detection constants
const AUDIO_LEVEL_THRESHOLD = 0.01; // Threshold for detecting actual speech (0-1 scale)
const MIN_AUDIO_ACTIVITY_RATIO = 0.05; // Minimum ratio of activity samples needed to consider valid audio
const ACTIVITY_CHECK_INTERVAL_MS = 500; // Check audio activity every 500ms

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

interface UseAudioRecorderProps {
  selectedMicrophoneId: string | null;
  onTranscriptionComplete: (text: string, clipboardSuccess?: boolean) => void;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  audioData: Uint8Array | null;
  isProcessing: boolean;
  error: string | null;
}

const useAudioRecorder = ({
  selectedMicrophoneId,
  onTranscriptionComplete,
}: UseAudioRecorderProps): UseAudioRecorderReturn => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioData, setAudioData] = useState<Uint8Array | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentSessionIdRef = useRef<string>(''); // Track the current recording session ID
  const audioActivityRef = useRef({
    activitySamples: 0,
    totalSamples: 0,
    lastCheckTime: 0,
    hasSignificantAudio: false
  }); // Track audio activity metrics
  
  logger.debug('AUDIO', 'useAudioRecorder hook initialized');
  
  // Cleanup function to stop all audio processes
  const cleanup = useCallback(() => {
    logger.debug('AUDIO', 'Cleaning up audio resources');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (mediaRecorderRef.current.state === 'recording') {
        logger.debug('AUDIO', 'Stopping media recorder');
      }
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    audioChunksRef.current = [];
    analyserRef.current = null;
    setAudioData(null);
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);
  
  // Update audio visualization and track audio levels
  const updateVisualization = useCallback(() => {
    if (analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteTimeDomainData(dataArray);
      
      // Track audio levels for silence detection
      // Audio data is normalized wave data where 128 is silence
      // We calculate average deviation from silence (128) normalized to 0-1 scale
      let sumDeviation = 0;
      const centerValue = 128;
      const maxDeviation = 128; // Max possible deviation from center
      
      for (let i = 0; i < dataArray.length; i++) {
        // Calculate absolute deviation from center (silence)
        const deviation = Math.abs(dataArray[i] - centerValue);
        sumDeviation += deviation;
      }
      
      // Calculate average level normalized to 0-1 scale
      const avgLevel = sumDeviation / (dataArray.length * maxDeviation);
      
      // Check for audio activity based on the threshold
      if (avgLevel > AUDIO_LEVEL_THRESHOLD) {
        audioActivityRef.current.activitySamples++;
      }
      audioActivityRef.current.totalSamples++;
      
      // Periodically check overall activity ratio
      const now = Date.now();
      if (now - audioActivityRef.current.lastCheckTime > ACTIVITY_CHECK_INTERVAL_MS) {
        const activityRatio = audioActivityRef.current.activitySamples / audioActivityRef.current.totalSamples;
        
        // If we have enough samples and the activity ratio exceeds our minimum,
        // mark as having significant audio
        if (audioActivityRef.current.totalSamples > 10 && activityRatio >= MIN_AUDIO_ACTIVITY_RATIO) {
          if (!audioActivityRef.current.hasSignificantAudio) {
            logger.info('AUDIO_LEVEL', `Significant audio activity detected: ${Math.round(activityRatio * 100)}%`);
            audioActivityRef.current.hasSignificantAudio = true;
          }
        }
        
        // Log activity levels periodically
        logger.debug('AUDIO_LEVEL', `Audio activity: ${Math.round(activityRatio * 100)}% (${audioActivityRef.current.activitySamples}/${audioActivityRef.current.totalSamples})`);
        
        // Reset for next interval, but keep the hasSignificantAudio flag
        audioActivityRef.current.lastCheckTime = now;
        const hadSignificantAudio = audioActivityRef.current.hasSignificantAudio;
        audioActivityRef.current = {
          activitySamples: 0,
          totalSamples: 0,
          lastCheckTime: now,
          hasSignificantAudio: hadSignificantAudio
        };
      }
      
      // Update visualization data
      setAudioData(dataArray);
      animationFrameRef.current = requestAnimationFrame(updateVisualization);
    }
  }, []);
  
  // Start recording audio with enhanced session handling
  const startRecording = useCallback(async () => {
    try {
      console.log('🔴 DIRECT DEBUG: startRecording function called in useAudioRecorder');
      
      if (isRecording) {
        logger.debug('RECORD', 'Already recording, ignoring start request');
        console.log('🔴 DIRECT DEBUG: Already recording, ignoring start request');
        return;
      }
      if (isProcessing) {
        logger.debug('RECORD', 'Currently processing, ignoring start request');
        console.log('🔴 DIRECT DEBUG: Currently processing, ignoring start request');
        return;
      }
      
      logger.flow('START_RECORDING', 'Beginning audio recording process');
      console.log('🔴 DIRECT DEBUG: Beginning audio recording process');
      
      // Clean up existing recording state first
      cleanup();
      setError(null);
      audioChunksRef.current = [];
      
      // Reset audio activity tracking for the new recording session
      audioActivityRef.current = {
        activitySamples: 0,
        totalSamples: 0,
        lastCheckTime: Date.now(),
        hasSignificantAudio: false
      };
      
      // Always explicitly start a new transcription session to ensure clean state
      // This also ensures the clipboard is properly cleared before starting a new recording
      const newSessionId = transcriptionProcessor.startNewSession();
      currentSessionIdRef.current = newSessionId;
      logger.info('RECORD', `Started new recording session: ${newSessionId}`);
      
      // Set up audio constraints
      const constraints: MediaStreamConstraints = {
        audio: selectedMicrophoneId
          ? { deviceId: { exact: selectedMicrophoneId } }
          : true,
      };
      
      logger.info('MIC', `Using microphone: ${selectedMicrophoneId || 'default'}`);
      
      // Get audio stream
      logger.debug('AUDIO', 'Requesting microphone access');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      logger.info('AUDIO', 'Microphone access granted');
      
      // Create audio context for visualization
      logger.debug('AUDIO', 'Setting up audio context for visualization');
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      // Create media recorder
      logger.debug('RECORD', 'Creating media recorder');
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm' // This format works well with Whisper API
      });
      mediaRecorderRef.current = mediaRecorder;
      
      // Event handlers
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        try {
          logger.flow('RECORDING_STOPPED', 'Processing recorded audio');
          setIsProcessing(true);
          
          // Capture the session ID immediately to ensure we use the correct one
          // even if it changes during processing
          const sessionId = currentSessionIdRef.current;
          
          if (audioChunksRef.current.length === 0) {
            logger.warn('AUDIO', 'No audio chunks detected');
            setError('No audio detected');
            setIsProcessing(false);
            return;
          }
          
          // Create a single Blob from all chunks
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          logger.info('AUDIO', `Audio blob created: ${audioBlob.size} bytes`);
          
          // Check if we detected significant audio during recording
          if (!audioActivityRef.current.hasSignificantAudio) {
            logger.warn('SILENCE', 'No significant audio activity detected during recording');
            
            // Alert the user via error state - this will show in the UI
            setError('No speech detected - please check your microphone');
            
            // Don't process silent audio to save API tokens
            logger.info('SILENCE', 'Skipping API call for silent recording to save API tokens');
            setIsProcessing(false);
            return;
          }
          
          // We have valid audio, proceed with transcription
          logger.info('AUDIO', 'Valid audio activity detected, proceeding with transcription');
          
          // Use the TranscriptionProcessor service for robust transcription handling
          try {
            logger.flow('TRANSCRIBING', 'Sending audio to TranscriptionProcessor service');
            
            // Verify the session is still valid before proceeding
            if (sessionId !== transcriptionProcessor.getCurrentSessionId()) {
              logger.warn('PROCESS', `Session ID mismatch - expected ${sessionId}, got ${transcriptionProcessor.getCurrentSessionId()}`);
              // Force reset to ensure consistency
              transcriptionProcessor.reset();
              currentSessionIdRef.current = transcriptionProcessor.getCurrentSessionId();
              logger.info('PROCESS', `Reset session to ${currentSessionIdRef.current}`);
            }
            
            // Process the audio with the service, passing the session ID
            const result = await transcriptionProcessor.processAudio(audioBlob, {
              maxRetries: 2,
              sessionId, // Pass the session ID to keep clipboard operations isolated
              onProgress: (status, progress) => {
                logger.debug('PROCESS', `Transcription progress: ${status} (${Math.round(progress * 100)}%)`);
              },
              onError: (err) => {
                // The service handles errors internally, but we can still log them here
                logger.warn('PROCESS', `Transcription service error event: ${err.message}`);
              }
            });
            
            // Handle successful transcription
            onTranscriptionComplete(result.text, result.clipboardSuccess);
            
            logger.flow('TRANSCRIPTION_COMPLETE', `Process completed successfully in ${result.processingTimeMs}ms`);
          } catch (err) {
            // Report the error to our error handler
            const recoverable = await errorHandler.captureError(
              ErrorType.AUDIO_PROCESSING_FAILED,
              `Transcription processing error: ${err instanceof Error ? err.message : String(err)}`,
              {
                operation: 'process_audio',
                component: 'useAudioRecorder'
              },
              err
            );
            
            // Set error state to display to user
            setError(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
            
            // If the error was recoverable, we still have some options
            if (recoverable) {
              logger.info('PROCESS', 'Error was recoverable, but we already handled recovery');
            }
          }
        } catch (err) {
          logger.error('PROCESS', `Error in recording stop handler: ${err}`);
          setError('Error processing audio recording');
        } finally {
          setIsProcessing(false);
          cleanup();
        }
      };
      
      // Start recording
      logger.info('RECORD', 'Starting media recorder');
      mediaRecorder.start();
      setIsRecording(true);
      logger.flow('RECORDING', 'Audio recording in progress');
      
      // Start visualization
      logger.debug('AUDIO', 'Starting audio visualization');
      animationFrameRef.current = requestAnimationFrame(updateVisualization);
      
    } catch (err) {
      logger.error('RECORD', `Error starting recording: ${err}`);
      setError('Error accessing microphone');
      cleanup();
    }
  }, [isRecording, isProcessing, selectedMicrophoneId, cleanup, updateVisualization, onTranscriptionComplete]);
  
  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording) {
      return;
    }
    
    logger.flow('STOP_RECORDING', 'Stopping audio recording');
    setIsRecording(false);
    
    // Before stopping recording, make sure we have a valid session
    if (!currentSessionIdRef.current) {
      // If we don't have a session ID for some reason, create one
      currentSessionIdRef.current = transcriptionProcessor.startNewSession();
      logger.info('RECORD', `Created new session ID before stopping: ${currentSessionIdRef.current}`);
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      logger.info('STOP', 'Stopping media recorder');
      mediaRecorderRef.current.stop();
    }
    
    // Use the helper function
    const electron = getElectron();
    if (electron) {
      electron.stopRecording();
    }
  }, [isRecording]);
  
  // Handle escape key - moved after stopRecording is defined
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRecording) {
        logger.info('HOTKEY', 'Escape key pressed, stopping recording');
        stopRecording();
      }
    };
    
    logger.debug('HOTKEY', 'Setting up keyboard event listener');
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, stopRecording]);
  
  // Set up electron event listeners
  useEffect(() => {
    // Use the helper function
    const electron = getElectron();
    if (electron) {
      logger.debug('ELECTRON', 'Setting up Electron event listeners');
      
      // Simple direct handler for start recording
      const removeStartListener = electron.onStartRecording(() => {
        logger.info('HOTKEY', 'Received start-recording event from Electron');
        console.log('🔴 DIRECT DEBUG: onStartRecording callback triggered in useAudioRecorder');
        
        // Only start recording if we have a microphone and aren't already recording
        if (!selectedMicrophoneId) {
          logger.warn('HOTKEY', 'Cannot start recording: No microphone selected');
          setError('Please select a microphone first');
          return;
        }
        
        if (isProcessing) {
          logger.warn('HOTKEY', 'Cannot start recording: Already processing audio');
          return;
        }
        
        if (isRecording) {
          logger.warn('HOTKEY', 'Already recording, ignoring start request');
          return;
        }
        
        // Start recording directly
        logger.info('HOTKEY', 'Starting recording via hotkey');
        startRecording();
      });
      
      const removeStopListener = electron.onStopRecording(() => {
        logger.info('HOTKEY', 'Received stop-recording event from Electron');
        stopRecording();
      });
      
      return () => {
        logger.debug('ELECTRON', 'Removing Electron event listeners');
        removeStartListener();
        removeStopListener();
      };
    }
    
    return undefined;
  }, [startRecording, stopRecording, selectedMicrophoneId, isRecording, isProcessing]);
  
  // Add direct event listener for custom event
  useEffect(() => {
    // Function to handle the custom event
    const handleCustomEvent = () => {
      console.log('🔴 DIRECT DEBUG: Custom event received in useAudioRecorder hook');
      logger.info('AUDIO', 'Custom start-recording event received');
      
      if (!selectedMicrophoneId) {
        logger.warn('AUDIO', 'Cannot start recording: No microphone selected');
        setError('Please select a microphone first');
        return;
      }
      
      if (isProcessing) {
        logger.warn('AUDIO', 'Cannot start recording: Already processing');
        return;
      }
      
      if (isRecording) {
        logger.warn('AUDIO', 'Already recording, ignoring start request');
        return;
      }
      
      logger.info('AUDIO', 'Starting recording via custom event');
      startRecording();
    };
    
    // Add the event listener
    window.addEventListener('vibe-start-recording', handleCustomEvent);
    
    // Clean up
    return () => {
      window.removeEventListener('vibe-start-recording', handleCustomEvent);
    };
  }, [startRecording, stopRecording, selectedMicrophoneId, isRecording, isProcessing]);
  
  return {
    isRecording,
    startRecording,
    stopRecording,
    audioData: audioData || null,
    isProcessing,
    error,
  };
};

export default useAudioRecorder;
