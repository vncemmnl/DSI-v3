/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdminSettings } from '../types';

// Default Administrator settings
const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  driveFolderUrl: 'https://drive.google.com/drive/folders/1KHP1O-Mx1BsSc8mTp1U1WtXrYw0QwBQw?usp=sharing',
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwBhoucwgBX0hcuzpMVMPhs4nMzIa-CS5nz0OmcjSf8Os-hlnU6PPJlkceStBSPZneV/exec',
};

// Retrieve administrative settings from localStorage
export function getAdminSettings(): AdminSettings {
  const stored = localStorage.getItem('gdrive_reader_admin_settings');
  if (!stored) {
    // Save default settings first if none exists
    saveAdminSettings(DEFAULT_ADMIN_SETTINGS);
    return DEFAULT_ADMIN_SETTINGS;
  }
  try {
    const parsed = JSON.parse(stored);
    return {
      driveFolderUrl: parsed.driveFolderUrl || DEFAULT_ADMIN_SETTINGS.driveFolderUrl,
      appsScriptUrl: parsed.appsScriptUrl || DEFAULT_ADMIN_SETTINGS.appsScriptUrl,
    };
  } catch (e) {
    console.error('Failed to parse admin settings, resetting to default:', e);
    return DEFAULT_ADMIN_SETTINGS;
  }
}

// Save administrative settings to localStorage
export function saveAdminSettings(settings: AdminSettings): void {
  localStorage.setItem('gdrive_reader_admin_settings', JSON.stringify(settings));
}
