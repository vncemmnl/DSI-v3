/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DriveFile, DocContent } from '../types';

/**
 * Retrieve the current administrative settings containing the Apps Script URL
 */
function getAppsScriptUrl(): string | null {
  const defaultUrl = 'https://script.google.com/macros/s/AKfycbwBhoucwgBX0hcuzpMVMPhs4nMzIa-CS5nz0OmcjSf8Os-hlnU6PPJlkceStBSPZneV/exec';
  const stored = localStorage.getItem('gdrive_reader_admin_settings');
  if (!stored) return defaultUrl;
  try {
    const parsed = JSON.parse(stored);
    return parsed.appsScriptUrl || defaultUrl;
  } catch (e) {
    return defaultUrl;
  }
}

/**
 * Extract resource ID from a Google Drive folder or spreadsheet URL.
 */
export function extractIdFromUrl(urlOrId: string): string {
  if (!urlOrId) return '';
  const trimmed = urlOrId.trim();
  
  // Try Drive Folder URL matching
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (folderMatch && folderMatch[1]) {
    return folderMatch[1];
  }

  // Try Spreadsheet URL matching
  const sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetMatch && sheetMatch[1]) {
    return sheetMatch[1];
  }

  // If it's already an ID
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

/**
 * Base generic request sender to the deployed Google Apps Script Web App.
 */
export async function appsScriptRequest(action: string, payload: Record<string, any> = {}): Promise<any> {
  const url = getAppsScriptUrl();
  if (!url) {
    throw new Error('Google Apps Script Web App URL is not configured. Please enter the master script URL in the admin settings panel first.');
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8', // Google Apps Script handles text/plain with POST content perfectly
      },
      body: JSON.stringify({ action, ...payload }),
    });

    if (!response.ok) {
      throw new Error(`Apps Script responded with HTTP status ${response.status}`);
    }

    const data = await response.json();
    if (data.status === 'error') {
      throw new Error(data.message || 'An error occurred inside the Apps Script execution.');
    }

    return data;
  } catch (err: any) {
    console.error('Apps Script Request Error:', err);
    let errorMsg = err.message || 'Network connection failed when communicating with Google Apps Script.';
    if (errorMsg.toLowerCase().includes('failed to fetch') || errorMsg === 'Failed to fetch' || errorMsg.includes('fetch')) {
      errorMsg = 'Connection to Google Apps Script Web App failed.\n\nThis usually means either:\n1. You did not set "Who has access" to "Anyone" when deploying the script, causing Google to block the connection.\n2. The Web App URL is incorrect or copy-pasted with a typo.\n3. The Apps Script is not authorized or not published as a Web App.\n\nTo fix this:\n- Open your script in Google Apps Script editor.\n- Click "Deploy" > "New deployment" > Select type "Web app".\n- Choose "Execute as: Me (your-email)" and "Who has access: Anyone".\n- Click "Deploy", copy the NEW Web App URL (must end in "/exec"), and paste it in the Admin settings.';
    }
    throw new Error(errorMsg);
  }
}

/**
 * List files and subfolders within a specific Google Drive Folder.
 */
export async function listDriveFiles(folderUrlOrId: string): Promise<DriveFile[]> {
  const folderId = extractIdFromUrl(folderUrlOrId);
  if (!folderId) {
    throw new Error('Invalid or empty Google Drive Folder specified.');
  }
  try {
    const data = await appsScriptRequest('listFiles', { folderId });
    // Cache current list automatically in case user wants basic offline backup
    const files = data.files || [];
    try {
      localStorage.setItem(`study_hub_offline_files_${folderId}`, JSON.stringify(files));
    } catch (e) {
      // Ignored
    }
    return files;
  } catch (err) {
    try {
      const stored = localStorage.getItem(`study_hub_offline_files_${folderId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log('Serving listDriveFiles from offline cache for', folderId);
          return parsed;
        }
      }
    } catch (e) {
      // Ignored
    }
    throw err;
  }
}

/**
 * Retrieve Google Doc JSON parsed structure or plain text content.
 */
export async function getDocFileContent(fileId: string): Promise<DocContent> {
  try {
    const data = await appsScriptRequest('getFileContent', { fileId });
    if (data && data.content) {
      try {
        localStorage.setItem(`study_hub_offline_content_${fileId}`, JSON.stringify({
          type: 'doc',
          data: data.content
        }));
      } catch (e) {
        console.warn('LocalStorage quota exceeded for caching Doc content.', e);
      }
    }
    return data.content;
  } catch (err) {
    try {
      const stored = localStorage.getItem(`study_hub_offline_content_${fileId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.type === 'doc' && parsed.data) {
          console.log('Serving getDocFileContent from offline cache for', fileId);
          return parsed.data;
        }
      }
    } catch (e) {
      // Ignored
    }
    throw err;
  }
}

/**
 * Fetch spreadsheet metadata tabs list and row values for flashcard compilers.
 */
export async function getSpreadsheetData(sheetUrlOrId: string, sheetName?: string): Promise<{ sheets: string[]; values: string[][] }> {
  const fileId = extractIdFromUrl(sheetUrlOrId);
  if (!fileId) {
    throw new Error('Invalid or empty Google Sheet specified.');
  }
  try {
    const data = await appsScriptRequest('getSheetData', { fileId, sheetName });
    const content = {
      sheets: data.sheets || [],
      values: data.values || [],
    };
    try {
      localStorage.setItem(`study_hub_offline_content_${fileId}`, JSON.stringify({
        type: 'sheet',
        data: content
      }));
    } catch (e) {
      console.warn('LocalStorage quota exceeded for caching Spreadsheet content.', e);
    }
    return content;
  } catch (err) {
    try {
      const stored = localStorage.getItem(`study_hub_offline_content_${fileId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.type === 'sheet' && parsed.data) {
          console.log('Serving getSpreadsheetData from offline cache for', fileId);
          return parsed.data;
        }
      }
    } catch (e) {
      // Ignored
    }
    throw err;
  }
}


