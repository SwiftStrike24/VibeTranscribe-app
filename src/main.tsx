import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import logger from './lib/logger'
import { validateRequiredEnv } from './lib/env'
import { validateApiKey } from './lib/openai'

// Configure logger - set specific categories to higher log levels to reduce spam
logger.setCategoryLogLevel('UI', logger.LogLevel.INFO);
logger.setCategoryLogLevel('AUDIO', logger.LogLevel.INFO);
logger.setCategoryLogLevel('ELECTRON', logger.LogLevel.WARNING);

// Completely silence some categories that are too noisy during development
logger.silenceCategory('DEBUG');

// Set global log level
logger.setLogLevel(logger.LogLevel.INFO);

// Log application startup
logger.info('APP', 'VibeTranscribe starting up');

// Validate environment variables 
// This runs asynchronously and doesn't block app startup
validateRequiredEnv().then(async (envValid) => {
  if (envValid) {
    logger.info('APP', 'Environment variables loaded successfully');
    
    // If environment variables are valid, also validate the API key
    const apiKeyValid = await validateApiKey();
    if (apiKeyValid) {
      logger.info('APP', 'OpenAI API key validated successfully');
    } else {
      logger.error('APP', 'OpenAI API key validation failed. Transcription may not work.');
    }
  } else {
    logger.error('APP', 'Failed to load required environment variables. Transcription will not work.');
  }
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
