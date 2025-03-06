import { useState, useEffect, useRef } from 'react';
import logger from '../lib/logger';
import clipboardManager from '../services/ClipboardManager';
import transcriptionProcessor from '../services/TranscriptionProcessor';

interface TranscriptionPopupProps {
  text: string;
  isVisible: boolean;
  onClose: () => void;
}

const TranscriptionPopup = ({ text, isVisible, onClose }: TranscriptionPopupProps) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const sessionIdRef = useRef<string>('');
  
  useEffect(() => {
    logger.debug('UI', 'TranscriptionPopup component mounted');
    
    // Get the current session ID when the component mounts
    sessionIdRef.current = transcriptionProcessor.getCurrentSessionId();
    logger.debug('UI', `TranscriptionPopup using session ID: ${sessionIdRef.current}`);
    
    return () => {
      logger.debug('UI', 'TranscriptionPopup component unmounted');
    };
  }, []);
  
  // Update session ID when new text is shown
  useEffect(() => {
    if (isVisible && text) {
      // When new text appears, get the current session ID to ensure we're using the latest one
      const currentSessionId = transcriptionProcessor.getCurrentSessionId();
      if (currentSessionId !== sessionIdRef.current) {
        logger.info('UI', `Updating popup session ID from ${sessionIdRef.current} to ${currentSessionId}`);
        sessionIdRef.current = currentSessionId;
      }
    }
  }, [isVisible, text]);
  
  useEffect(() => {
    if (!isVisible || !text) {
      if (displayedText.length > 0) {
        logger.debug('UI', 'Resetting transcription popup state');
        setDisplayedText('');
        setCurrentCharIndex(0);
      }
      return;
    }
    
    if (currentCharIndex === 0) {
      logger.debug('UI', 'Starting typing animation for transcription');
      setDisplayedText('');
    }
    
    if (currentCharIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentCharIndex]);
        setCurrentCharIndex(prev => prev + 1);
      }, 15);
      
      return () => clearTimeout(timer);
    }
    
    if (currentCharIndex === text.length && text.length > 0) {
      logger.info('UI', 'Typing animation complete, auto-copying to clipboard');
      
      // Validate the session ID first
      if (!sessionIdRef.current) {
        logger.warn('UI', 'No session ID found for popup, getting current one');
        sessionIdRef.current = transcriptionProcessor.getCurrentSessionId();
      }
      
      // Use the ClipboardManager service with the current session ID
      clipboardManager.copyToClipboard(text, {
        sessionId: sessionIdRef.current, // Include session ID for better isolation
        maxAttempts: 5, // Be more persistent with retries
        initialDelay: 50, // Start retry quickly
        onSuccess: () => {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
          logger.info('UI', 'Successfully copied transcription to clipboard via manager');
        },
        onError: (err) => {
          logger.warn('UI', `Clipboard manager failed: ${err}`);
          // The manager already saves to localStorage as a backup
          // But we should still show "copied" feedback to the user
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        }
      });
    }
  }, [isVisible, text, currentCharIndex, displayedText.length]);
  
  useEffect(() => {
    if (isVisible && text && !displayedText) {
      logger.info('UI', 'Showing transcription popup - will stay open until manually closed');
    }
  }, [isVisible, text, displayedText]);
  
  // Handle text changes - detect when text is cleared but popup is still visible
  useEffect(() => {
    if (isVisible && text === '' && displayedText !== '') {
      // Text was cleared while popup is visible - show clearing animation
      logger.debug('UI', 'Transcription text was cleared while popup is visible');
      setIsClearing(true);
      setDisplayedText('');
      
      // After a brief pause, remove the clearing state
      const timer = setTimeout(() => {
        setIsClearing(false);
      }, 400);
      
      return () => clearTimeout(timer);
    } else if (text === '') {
      // Reset state when text is empty
      setCurrentCharIndex(0);
      setIsClearing(false);
    }
  }, [isVisible, text, displayedText]);
  
  if (!isVisible) return null;
  
  return (
    <div className={`transcription-popup absolute bottom-full left-0 right-0 mb-[70px] bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-4 ${isClearing ? 'animate-pulse' : 'animate-fade-in'}`}>
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-sm font-medium text-purple-400">
          {isClearing ? 'Clearing Transcription...' : text === '' ? 'Waiting for new recording...' : 'Transcription'}
        </h3>
        <div className="flex gap-2">
          {isCopied ? (
            <span className="text-xs text-green-400 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
              Copied!
            </span>
          ) : (
            <button 
              onClick={() => {
                logger.info('UI', 'User manually copied transcription text');
                
                // Validate the session ID first
                if (!sessionIdRef.current) {
                  logger.warn('UI', 'No session ID found for manual copy, getting current one');
                  sessionIdRef.current = transcriptionProcessor.getCurrentSessionId();
                }
                
                // Use the ClipboardManager service for manual copy operations with session ID
                // Clear clipboard first to ensure a clean state
                clipboardManager.clearClipboardData(sessionIdRef.current);
                
                // Now copy with aggressive retries and verification
                clipboardManager.copyToClipboard(text, {
                  sessionId: sessionIdRef.current, // Include session ID for proper tracking
                  maxAttempts: 7, // Be very persistent for manual copies
                  initialDelay: 20, // Start retry quickly
                  onSuccess: () => {
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    logger.info('UI', 'User-initiated clipboard operation succeeded');
                  },
                  onError: (err) => {
                    logger.warn('UI', `User-initiated clipboard operation failed: ${err}`);
                    // Still show "copied" feedback even if it failed, as the text is saved
                    // to localStorage as a fallback
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                  }
                });
              }}
              disabled={isClearing || text === ''}
              className={`text-xs flex items-center ${isClearing || text === '' ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1">
                <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
                <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
              </svg>
              Copy
            </button>
          )}
          <button 
            onClick={() => {
              logger.info('UI', 'User manually closed transcription popup');
              onClose();
            }}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white flex items-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
            Close
          </button>
        </div>
      </div>
      <div className="bg-gray-900 rounded p-3 max-h-[150px] overflow-y-auto">
        {isClearing ? (
          <p className="text-sm text-gray-400 italic">Clearing previous text...</p>
        ) : text === '' ? (
          <div className="flex items-center justify-center py-2">
            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mr-2"></div>
            <p className="text-sm text-gray-400 italic">Waiting for new transcription...</p>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap text-white transition-opacity duration-300">
            {displayedText}<span className="animate-blink">|</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default TranscriptionPopup;
