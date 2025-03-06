/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY: string;
  readonly VITE_OPENAI_API_BASE_URL: string;
  readonly VITE_OPENAI_API_TIMEOUT: string;
  readonly VITE_OPENAI_WHISPER_MODEL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Define window.electron for TypeScript
interface Window {
  electron?: {
    startRecording: () => void;
    stopRecording: () => void;
    escapePressed: () => void;
    setMicrophone: (deviceId: string) => void;
    mouseInteraction: {
      setIgnoreMouseEvents: (ignore: boolean) => void;
    };
    onStartRecording: (callback: () => void) => void;
    onStopRecording: (callback: () => void) => void;
    getEnv: (key: string) => Promise<string | undefined>;
  };
}
