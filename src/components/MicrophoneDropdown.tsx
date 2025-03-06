import { useState, useEffect, useRef } from 'react';
import logger from '../lib/logger';

interface MicrophoneDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
  hardwareId?: string; // Added to identify unique hardware
}

interface MicrophoneDropdownProps {
  onSelectMicrophone: (deviceId: string) => void;
  selectedDeviceId: string | null;
  className?: string;
}

// Function to extract clean device name from label
const extractDeviceName = (label: string): string => {
  // Look for a name in parentheses like "Microphone (AVerMedia PW315)"
  const match = label.match(/\(([^)]+)\)/);
  
  if (match && match[1]) {
    // Remove any additional model IDs in parentheses at the end
    return match[1].replace(/\s*\([0-9a-f]+:[0-9a-f]+\)$/, '');
  }
  
  // If no match found, return the original label
  return label;
};

// Function to get hardware identifier
const getHardwareId = (label: string): string => {
  // Extract hardware IDs like (07ca:315a) from the end of the label
  const hwIdMatch = label.match(/\(([0-9a-f]+:[0-9a-f]+)\)$/);
  if (hwIdMatch && hwIdMatch[1]) {
    return hwIdMatch[1];
  }
  
  // If no hardware ID found, use the device name as fallback
  const deviceName = extractDeviceName(label);
  return deviceName;
};

const MicrophoneDropdown = ({ onSelectMicrophone, selectedDeviceId, className = '' }: MicrophoneDropdownProps) => {
  const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialized = useRef(false);
  
  // Log initialization only once
  useEffect(() => {
    logger.debug('UI', 'MicrophoneDropdown component mounted');
  }, []);
  
  // Get available microphones
  useEffect(() => {
    async function getMicrophones() {
      // Skip if we've already initialized and have devices
      if (hasInitialized.current && devices.length > 0) {
        return;
      }
      
      logger.debug('UI', 'Fetching available microphones');
      try {
        // Request permission to access audio devices
        logger.debug('UI', 'Requesting microphone permissions');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        logger.info('UI', 'Microphone permissions granted');
        
        // Get all available media devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Filter for audio input devices and add hardware ID
        const allMicrophones = devices
          .filter(device => device.kind === 'audioinput')
          .map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.slice(0, 5)}...`,
            isDefault: device.deviceId === 'default',
            hardwareId: getHardwareId(device.label || '')
          }));
        
        // Group by hardware ID and keep special devices (default, communications)
        const uniqueMicrophones: MicrophoneDevice[] = [];
        const hardwareIdMap = new Map<string, MicrophoneDevice[]>();
        
        // First, organize devices by hardware ID
        allMicrophones.forEach(device => {
          if (!hardwareIdMap.has(device.hardwareId!)) {
            hardwareIdMap.set(device.hardwareId!, []);
          }
          hardwareIdMap.get(device.hardwareId!)!.push(device);
        });
        
        // For each hardware ID, select only ONE device with priority order:
        // default > communications > regular
        hardwareIdMap.forEach(deviceGroup => {
          // Find the highest priority device for this hardware
          const defaultDevice = deviceGroup.find(d => d.deviceId === 'default');
          const communicationsDevice = deviceGroup.find(d => d.deviceId === 'communications');
          const regularDevice = deviceGroup.find(d => 
            d.deviceId !== 'default' && d.deviceId !== 'communications');
          
          // Add only ONE device from each hardware group, with priority
          if (defaultDevice) {
            uniqueMicrophones.push(defaultDevice);
          } else if (communicationsDevice) {
            uniqueMicrophones.push(communicationsDevice);
          } else if (regularDevice) {
            uniqueMicrophones.push(regularDevice);
          }
        });
        
        logger.info('UI', `Found ${uniqueMicrophones.length} unique microphone devices`);
        logger.logData('UI', 'Unique microphone devices', uniqueMicrophones);
        
        // Release the stream
        stream.getTracks().forEach(track => track.stop());
        logger.debug('UI', 'Released microphone stream');
        
        if (uniqueMicrophones.length === 0) {
          logger.warn('UI', 'No microphones found');
          setError('No microphones found');
        } else {
          setDevices(uniqueMicrophones);
          
          // Auto-select the default or first device if none is selected
          if (!selectedDeviceId && uniqueMicrophones.length > 0) {
            const defaultDevice = uniqueMicrophones.find(m => m.isDefault) || uniqueMicrophones[0];
            logger.info('UI', `Auto-selecting microphone: ${defaultDevice.label}`);
            onSelectMicrophone(defaultDevice.deviceId);
          }
          
          // Mark as initialized
          hasInitialized.current = true;
        }
      } catch (err) {
        logger.logData('UI', 'Error accessing microphone', err);
        setError('Error accessing microphone. Please ensure permissions are granted.');
      }
    }
    
    getMicrophones();
  }, [onSelectMicrophone, selectedDeviceId, devices.length]);
  
  const toggleDropdown = () => {
    logger.debug('UI', `${isOpen ? 'Closing' : 'Opening'} microphone dropdown`);
    setIsOpen(!isOpen);
  };
  
  const handleSelectDevice = (deviceId: string) => {
    const selectedDevice = devices.find(d => d.deviceId === deviceId);
    logger.info('UI', `User selected microphone: ${selectedDevice?.label || deviceId}`);
    onSelectMicrophone(deviceId);
    setIsOpen(false);
  };
  
  // Get label of selected device
  const selectedDeviceLabel = selectedDeviceId
    ? (devices.find(d => d.deviceId === selectedDeviceId)?.label || 'Unknown Device')
    : 'Select Microphone';
  
  if (error) {
    logger.warn('UI', `Displaying microphone error: ${error}`);
    return (
      <div className="text-red-500 text-sm flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-1">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        {error}
      </div>
    );
  }
  
  return (
    <div className={`relative w-[200px] ${className}`}>
      <button
        type="button"
        onClick={toggleDropdown}
        className={`flex items-center justify-between w-full px-3 py-2 text-sm bg-gray-800 border ${selectedDeviceId ? 'border-purple-500/50 shadow-sm shadow-purple-500/30' : 'border-gray-700'} rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-white hover:bg-gray-700 transition-all`}
      >
        <div className="flex items-center">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 20 20" 
            fill="currentColor" 
            className="w-4 h-4 mr-2 text-purple-500"
          >
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
          <span className="truncate max-w-[140px] font-medium">
            {extractDeviceName(selectedDeviceLabel)}
            {selectedDeviceLabel.includes('Default') && 
              <span className="text-xs text-gray-400 ml-2">(Default)</span>
            }
          </span>
        </div>
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 20 20" 
          fill="currentColor" 
          className={`w-4 h-4 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="absolute z-10 w-full bottom-full mb-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto origin-bottom animate-fade-in">
          <ul className="py-1">
            {devices.map(device => (
              <li 
                key={device.deviceId}
                onClick={() => handleSelectDevice(device.deviceId)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 flex items-center justify-between text-white ${
                  selectedDeviceId === device.deviceId ? 'bg-gray-700 text-purple-400' : ''
                }`}
              >
                <span className="truncate">
                  {extractDeviceName(device.label)}
                </span>
                {device.isDefault && (
                  <span className="text-xs text-gray-400 ml-2">(Default)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default MicrophoneDropdown; 