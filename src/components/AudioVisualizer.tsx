import { useEffect, useRef } from 'react';
import logger from '../lib/logger';

interface AudioVisualizerProps {
  isRecording: boolean;
  audioData?: Uint8Array;
}

const AudioVisualizer = ({ isRecording, audioData }: AudioVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !isRecording || !audioData) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      logger.warn('UI', 'Failed to get canvas context for audio visualizer');
      return;
    }

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Set visualizer styling
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#a855f7'; // Purple color
    
    // Draw the waveform
    const sliceWidth = (canvas.width * 1.0) / audioData.length;
    let x = 0;
    
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    
    for (let i = 0; i < audioData.length; i++) {
      const v = audioData[i] / 128.0;
      const y = v * (canvas.height / 2);
      
      ctx.lineTo(x, canvas.height / 2 - y);
      x += sliceWidth;
    }
    
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }, [isRecording, audioData]);

  useEffect(() => {
    if (isRecording) {
      logger.info('UI', 'Audio visualizer activated');
    } else if (canvasRef.current) {
      logger.debug('UI', 'Audio visualizer deactivated');
    }
  }, [isRecording]);

  if (!isRecording) return null;

  return (
    <div className="audio-visualizer absolute bottom-full left-0 right-0 mb-4 w-full">
      <canvas
        ref={canvasRef}
        width={400}
        height={50}
        className="w-full h-[50px] bg-black/30 rounded-lg"
      />
    </div>
  );
};

export default AudioVisualizer; 