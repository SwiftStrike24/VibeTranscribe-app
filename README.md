# VibeTranscribe

<p align="center">
  <img src="./src/assets/icon.ico" width="120" height="120" alt="VibeTranscribe Logo" style="filter: drop-shadow(0 0 10px rgba(138, 43, 226, 0.6));" />
</p>

<h3 align="center">Voice to Text, Instantly</h3>
<p align="center">A lightweight, non-intrusive desktop app that converts your voice to text with a simple keyboard shortcut and automatically copies it to your clipboard.</p>

<p align="center">
  <img src="https://img.shields.io/badge/VibeTranscribe-Voice%20to%20Text-8A2BE2" alt="VibeTranscribe" />
  <img src="https://img.shields.io/badge/Vite-6.2.0-646CFF" alt="Vite" />
  <img src="https://img.shields.io/badge/React-19.0.0-61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Electron-35.0.0-47848F" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.7.2-3178C6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/OpenAI-Whisper%20API-00A67E" alt="OpenAI" />
</p>

## ✨ Features

- **Floating UI** - Always appears at the bottom center of the screen
- **Click-Through Transparency** - Interact with windows underneath while the app remains visible
- **Global Hotkeys** - Press `Ctrl+Shift+R` to start recording, `Esc` to stop
- **Live Audio Visualization** - See your voice as you speak
- **Clipboard Auto-Copy** - Transcribed text is automatically copied to clipboard
- **Microphone Selection** - Choose your preferred input device
- **Microphone Persistence** - Your selected microphone is remembered between sessions
- **Pixel-Level Detection** - Smart click-through technology that analyzes transparency
- **Silence Detection** - Automatically detects if no speech is present to save API usage

## 🚀 Demo

The application appears as a sleek status indicator at the bottom of your screen. When recording, an elegant audio visualizer appears. After transcription, the text is automatically copied to your clipboard for immediate use anywhere.

## 🛠️ Tech Stack

- **Electron** - For Windows desktop application functionality
- **Vite + React + TypeScript** - For fast UI rendering and type safety
- **Tailwind CSS** - For styling & animations
- **MediaRecorder API** - To capture microphone input
- **OpenAI Whisper API** - For AI-powered speech transcription
- **Pixel-Level Detection** - Smart click-through technology that analyzes transparency

## 🏗️ Development

### Prerequisites

- Node.js (v18+)
- pnpm

### API Key Setup

This app requires an OpenAI API key to use the Whisper speech-to-text service:

1. Get an API key from [OpenAI's platform](https://platform.openai.com/api-keys)
2. Create a `.env` file in the project root based on `.env.example`
3. Add your OpenAI API key to the `.env` file:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm electron:dev
```

### Build

```bash
# Build for production
pnpm electron:build
```

This will generate an installer in the `dist` folder.

## 🔍 How It Works

VibeTranscribe combines several technologies:

1. **Electron**: Creates a desktop application wrapper
2. **Vite & React**: Powers the UI and application logic
3. **MediaRecorder API**: Captures audio from your microphone
4. **OpenAI Whisper API**: Transcribes audio to text
5. **Global Keyboard Shortcuts**: Enables system-wide control

The application flow:
1. User selects their preferred microphone (selection is saved for future sessions)
2. User activates recording with keyboard shortcut (`Ctrl+Shift+R`)
3. UI shows recording status with animated visualizer
4. Upon stopping (press `Esc`), audio is sent to OpenAI's Whisper API
5. Transcribed text is automatically copied to clipboard for immediate use
6. If clipboard access fails, the text is saved to localStorage as a backup

## 🔧 Production Build Notes

The app uses electron-builder for packaging and distribution. Key configuration:

- Assets are loaded with relative paths using Vite's `base: './'` setting
- The app includes robust path resolution to find resources in the packaged app
- Required fields in package.json: `homepage`, `author`, and `description`
- Environment variables are properly handled in both development and production

### Troubleshooting

If you encounter a blank/invisible window after building:

1. Check the logs for path resolution issues
2. Ensure Vite's `base` path is set to `./`
3. Verify the electron main process is correctly finding the index.html file

## ⌨️ Global Keyboard Shortcuts

- `Ctrl + Shift + R` - Start Recording
  - Works system-wide, even when the app is in the background
  - Will bring the app to focus if it's minimized
- `Esc` - Stop Recording & Transcribe
  - Only works when the app is focused

## 🔍 Project Structure

```
VibeTranscribe/
├── electron/
│   ├── main.ts                # Electron main process
│   ├── preload.ts             # Preload script for IPC
│   ├── tsconfig.json          # TypeScript config for Electron
├── src/
│   ├── assets/                # Static assets
│   │   ├── icon.ico           # App icon
│   ├── components/            # React components
│   │   ├── AudioVisualizer.tsx    # Audio visualization component
│   │   ├── MicrophoneDropdown.tsx # Microphone selection UI
│   │   ├── TranscriptionPopup.tsx # Transcription results display
│   ├── hooks/                 # Custom React hooks
│   │   ├── useAudioRecorder.ts    # Audio recording logic
│   ├── lib/                   # Utility libraries
│   │   ├── openai.ts          # OpenAI API integration
│   │   ├── utils.ts           # Helper functions
│   ├── services/              # Service modules
│   │   ├── ClipboardManager.ts    # Clipboard operations
│   │   ├── TranscriptionProcessor.ts # Audio transcription
│   │   ├── ErrorHandler.ts    # Error handling and reporting
│   ├── types/                 # TypeScript type definitions
│   ├── App.tsx                # Main React component
│   ├── main.tsx               # Entry point
├── dist/                      # Built application
├── dist-electron/             # Compiled Electron files
├── .env                       # Environment variables
├── vite.config.ts             # Vite configuration
```

## 📋 Troubleshooting

- **Microphone Access**: Ensure you've granted microphone permissions
- **No Audio Detected**: Check if your microphone is muted or working properly
- **API Key**: Verify your OpenAI API key is correctly set in the `.env` file
- **Keyboard Shortcuts**: Make sure no other application is using the same keyboard shortcuts
- **Blank Screen After Build**: See the Production Build Notes section for solutions
- **Keyboard Shortcut Not Working**: Try restarting the app or check if another app is capturing the shortcut

## 📄 License

MIT
