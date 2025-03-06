import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './', // Add base path for proper asset loading in production
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Define env variables to be exposed to the client
    define: {
      'process.env.VITE_OPENAI_API_KEY': JSON.stringify(env.VITE_OPENAI_API_KEY),
      'process.env.VITE_OPENAI_API_BASE_URL': JSON.stringify(env.VITE_OPENAI_API_BASE_URL),
      'process.env.VITE_OPENAI_API_TIMEOUT': JSON.stringify(env.VITE_OPENAI_API_TIMEOUT),
      'process.env.VITE_OPENAI_WHISPER_MODEL': JSON.stringify(env.VITE_OPENAI_WHISPER_MODEL),
    },
  }
})
