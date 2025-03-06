/**
 * Environment Variables Utility
 * 
 * This module provides a consistent way to access environment variables in both
 * development and production environments. It handles the differences between
 * Vite's VITE_ prefixed variables and standard environment variables.
 */

import logger from './logger';

/**
 * Type-safe environment variable config
 */
interface EnvConfig {
  OPENAI_API_KEY: string;
  OPENAI_API_BASE_URL: string;
  OPENAI_API_TIMEOUT: number;
  OPENAI_WHISPER_MODEL: string;
}

/**
 * Default values for environment variables
 */
const ENV_DEFAULTS: Partial<EnvConfig> = {
  OPENAI_API_BASE_URL: 'https://api.openai.com/v1',
  OPENAI_API_TIMEOUT: 30000,
  OPENAI_WHISPER_MODEL: 'whisper-1',
};

/**
 * Gets an environment variable, checking both Vite and standard versions
 * @param name The name of the environment variable (without VITE_ prefix)
 * @returns The value of the environment variable or undefined
 */
export async function getEnv<K extends keyof EnvConfig>(name: K): Promise<EnvConfig[K] | undefined> {
  // Use TypeScript type checking to ensure we only request valid env vars
  try {
    // First try to get from import.meta.env (Vite's way)
    const viteKey = `VITE_${name}`;
    
    // Check if we're in a browser environment with import.meta.env
    let viteValue: string | undefined;
    try {
      // TypeScript now knows about import.meta.env thanks to our vite-env.d.ts file
      viteValue = import.meta.env[viteKey];
      if (viteValue) {
        logger.debug('ENV', `Found ${viteKey} in import.meta.env: ${viteValue.substring(0, 5)}...`);
      }
    } catch (e) {
      logger.debug('ENV', `Error accessing import.meta.env: ${e}`);
    }
    
    // If we found a value in import.meta.env, use it
    if (viteValue) {
      if (typeof ENV_DEFAULTS[name] === 'number') {
        return Number(viteValue) as EnvConfig[K];
      }
      return viteValue as EnvConfig[K];
    }
    
    // Otherwise, try to get from window.electron.getEnv (IPC bridge)
    // Check both VITE_ prefixed and standard versions
    const value = await window.electron?.getEnv(viteKey) || await window.electron?.getEnv(name);
    
    // Convert to the right type if needed
    if (value !== undefined) {
      if (typeof ENV_DEFAULTS[name] === 'number') {
        return Number(value) as EnvConfig[K];
      }
      return value as EnvConfig[K];
    }
    
    // Return default value if available
    return ENV_DEFAULTS[name] as EnvConfig[K];
  } catch (error) {
    logger.error('ENV', `Error getting environment variable ${name}: ${error}`);
    return ENV_DEFAULTS[name] as EnvConfig[K];
  }
}

/**
 * Check if all required environment variables are available
 * @returns True if all required variables are available
 */
export async function validateRequiredEnv(): Promise<boolean> {
  try {
    const apiKey = await getEnv('OPENAI_API_KEY');
    
    if (!apiKey) {
      logger.error('ENV', 'OpenAI API key not found. Please check your .env file.');
      return false;
    }
    
    logger.info('ENV', 'All required environment variables are available');
    return true;
  } catch (error) {
    logger.error('ENV', `Error validating environment variables: ${error}`);
    return false;
  }
} 