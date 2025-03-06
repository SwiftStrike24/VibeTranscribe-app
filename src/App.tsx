import { useState, useCallback, useEffect, useRef } from 'react';
import './App.css';
import AudioVisualizer from './components/AudioVisualizer';
import MicrophoneDropdown from './components/MicrophoneDropdown';
import TranscriptionPopup from './components/TranscriptionPopup';
import useAudioRecorder from './hooks/useAudioRecorder';
import logger from './lib/logger';
import { validateRequiredEnv } from './lib/env';
import clipboardManager from './services/ClipboardManager';
import transcriptionProcessor from './services/TranscriptionProcessor';


function App() {
  // Remove flow log from component body
  
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | null>(null);
  const [transcriptionText, setTranscriptionText] = useState('');
  const [showTranscription, setShowTranscription] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  
  // Track current session ID for clipboard operations
  const currentSessionIdRef = useRef<string>('');
  
  // Log app initialization only once
  useEffect(() => {
    logger.flow('APP_INIT', 'VibeTranscribe application starting');
    
    // Initialize a clean session for the app's startup
    currentSessionIdRef.current = transcriptionProcessor.startNewSession();
    logger.info('APP', `Initialized app with fresh clipboard session: ${currentSessionIdRef.current}`);
    
    // Check environment variables on component mount
    validateRequiredEnv().then(valid => {
      if (!valid) {
        setEnvError('API key not found or invalid. Transcription will not work.');
        logger.error('APP', 'Environment validation failed in App component');
      }
    });
  }, []);

  // Handle transcription completion
  const handleTranscriptionComplete = useCallback((text: string, clipboardSuccess: boolean = true) => {
    logger.info('UI', 'Transcription completed, updating UI');
    setTranscriptionText(text);
    setShowTranscription(true);
    
    // Track if clipboard operation failed
    setClipboardFailed(!clipboardSuccess);
    
    // If clipboard failed, show a notification to the user that they can use Ctrl+V
    if (!clipboardSuccess) {
      // Get the current session ID to make sure we're getting the right content
      const sessionId = transcriptionProcessor.getCurrentSessionId();
      currentSessionIdRef.current = sessionId;
      
      // Check if we have this session's content in localStorage
      const savedText = clipboardManager.getFromLocalStorage(sessionId);
      
      if (savedText) {
        // We could show a notification here or add UI to indicate backup is available
        logger.info('APP', `Clipboard operation failed but transcription is available in localStorage for session ${sessionId}`);
      }
    }
  }, []);

  // Audio recorder hook
  const {
    isRecording,
    startRecording,
    stopRecording,
    audioData,
    isProcessing,
    error
  } = useAudioRecorder({
    selectedMicrophoneId,
    onTranscriptionComplete: handleTranscriptionComplete,
  });

  // Close the transcription popup
  const handleCloseTranscription = useCallback(() => {
    logger.debug('UI', 'Closing transcription popup');
    setShowTranscription(false);
  }, []);
  
  // Log app state changes, but only when there are actual changes worth logging
  useEffect(() => {
    if (error) {
      logger.error('UI', `Error state: ${error}`);
    }
  }, [error]);

  // Add separate effect for recording state changes
  useEffect(() => {
    if (isRecording) {
      logger.info('APP', 'Recording started');
    } else if (isProcessing) {
      logger.info('APP', 'Processing audio');
    }
  }, [isRecording, isProcessing]);
  
  // Log microphone selection
  const handleSelectMicrophone = useCallback((deviceId: string) => {
    logger.info('MIC', `User selected microphone: ${deviceId}`);
    setSelectedMicrophoneId(deviceId);
  }, []);

  // Determine which error to display to user (prioritize env error)
  const displayError = envError || error;

  return (
    <div className="app-container fixed bottom-0 left-1/2 transform -translate-x-1/2 mb-5 w-[400px] h-[60px] bg-gray-900 bg-opacity-90 backdrop-blur-md rounded-lg shadow-lg border border-gray-800 flex items-center justify-between px-4 transition-all duration-300 select-none">
      {/* Error message */}
      {displayError && (
        <div className="absolute top-0 left-0 right-0 transform -translate-y-full mb-2 bg-red-900 text-white p-2 rounded-t-lg text-sm">
          {displayError}
        </div>
      )}
      
      {/* Clipboard notification */}
      {clipboardFailed && clipboardManager.getFromLocalStorage(currentSessionIdRef.current) && (
        <div className="absolute top-0 left-0 right-0 transform -translate-y-full mb-2 bg-amber-700 text-white p-2 rounded-t-lg text-sm flex items-center justify-between">
          <span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="inline-block w-4 h-4 mr-1">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.75.75 0 00.736-.611A2.25 2.25 0 0112.75 7.5h.5a.75.75 0 000-1.5h-.5a3.75 3.75 0 00-3.667 3H9z" clipRule="evenodd" />
            </svg>
            Clipboard access failed. Transcription is saved but not copied.
          </span>
          <button 
            className="text-xs bg-amber-600 hover:bg-amber-500 px-2 py-1 rounded"
            onClick={() => {
              const sessionId = currentSessionIdRef.current;
              const savedText = clipboardManager.getFromLocalStorage(sessionId);
              
              if (savedText) {
                // Use the clipboard manager to retry with its robust retry mechanism and session ID
                clipboardManager.copyToClipboard(savedText, {
                  sessionId, // Ensure we're using the current session
                  onSuccess: () => {
                    setClipboardFailed(false);
                    logger.info('APP', `Successfully copied saved transcription to clipboard for session ${sessionId}`);
                  }
                });
              }
            }}
          >
            Try Again
          </button>
        </div>
      )}
      
      {/* Microphone selection dropdown */}
      <div className="relative">
        <MicrophoneDropdown
          onSelectMicrophone={handleSelectMicrophone}
          selectedDeviceId={selectedMicrophoneId}
          className="shadow-[0_0_15px_rgba(168,85,247,0.3)]"
        />
      </div>
      
      {/* Record button */}
      <button
        className={`record-button interactive w-12 h-12 rounded-full flex items-center justify-center focus:outline-none transition-all duration-300 ${
          isRecording
            ? 'bg-red-600 hover:bg-red-700'
            : isProcessing
            ? 'bg-gray-700 cursor-wait'
            : envError
            ? 'bg-gray-600 cursor-not-allowed opacity-60'
            : 'bg-purple-600 hover:bg-purple-700'
        }`}
        onClick={() => {
          if (isRecording) {
            logger.flow('UI_ACTION', 'User clicked stop recording button');
            stopRecording();
          } else {
            logger.flow('UI_ACTION', 'User clicked start recording button');
            // Clear any existing transcription when starting a new recording
            if (showTranscription) {
              logger.info('UI', 'Clearing previous transcription before starting new recording');
              setTranscriptionText('');
              // Keep the popup visible if it was already visible - it will show a transition animation
              // The typing animation will restart when new transcription arrives
            }
            startRecording();
          }
        }}
        disabled={isProcessing || !selectedMicrophoneId || !!envError}
      >
        {isProcessing ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : isRecording ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
            <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
          </svg>
        )}
      </button>
      
      {/* Keyboard shortcut hint */}
      <div className="keyboard-hint text-xs text-gray-400 px-2 py-1 bg-gray-800 rounded">
        {isRecording ? 'Press Esc to stop' : 'Ctrl+Shift+R'}
      </div>
      
      {/* Audio visualizer (shows during recording) */}
      {audioData && <AudioVisualizer isRecording={isRecording} audioData={audioData} />}
      
      {/* Transcription popup */}
      <TranscriptionPopup
        text={transcriptionText}
        isVisible={showTranscription}
        onClose={handleCloseTranscription}
      />
    </div>
  );
}

export default App;
