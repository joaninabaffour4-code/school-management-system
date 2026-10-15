/**
 * apiConfig.js - Mobile App Backend Server Configuration
 *
 * HOW IT WORKS WITH EXPO:
 * 1. Physical Phone (Expo Go on Wi-Fi): Uses your computer's local Wi-Fi IP (e.g. http://172.25.157.111:3000).
 * 2. Android Emulator (Android Studio): Uses http://10.0.2.2:3000 (Android's loopback alias).
 * 3. Web Browser (expo start --web) or iOS Simulator: Uses http://localhost:3000.
 */

import { Platform } from 'react-native';

export const LOCAL_WIFI_IP = '172.25.157.111';
export const PORT = 3000;

export function getDefaultServerUrl() {
  if (Platform.OS === 'web') {
    return `http://localhost:${PORT}`;
  }
  if (Platform.OS === 'android') {
    // When using physical phone with Expo Go, use local Wi-Fi IP:
    return `http://${LOCAL_WIFI_IP}:${PORT}`;
  }
  // iOS / Default
  return `http://${LOCAL_WIFI_IP}:${PORT}`;
}

let serverUrl = getDefaultServerUrl();

export function getServerUrl() {
  return serverUrl;
}

export function setServerUrl(newUrl) {
  if (newUrl && typeof newUrl === 'string') {
    serverUrl = newUrl.trim().replace(/\/+$/, '');
  }
  return serverUrl;
}
