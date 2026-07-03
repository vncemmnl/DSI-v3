/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DriveFile, DocContent } from '../types';
import { getDocFileContent, getSpreadsheetData, listDriveFiles } from './appsScriptClient';

// Key names for local storage
const OFFLINE_FOLDERS_KEY = 'study_hub_offline_folders_list';
const OFFLINE_FILES_PREFIX = 'study_hub_offline_files_';
const OFFLINE_CONTENT_PREFIX = 'study_hub_offline_content_';

export interface OfflineFolderMeta {
  id: string;
  name: string;
  syncedAt: string;
  fileCount: number;
}

/**
 * Get list of all folders synced for offline use
 */
export function getOfflineFolders(): OfflineFolderMeta[] {
  const stored = localStorage.getItem(OFFLINE_FOLDERS_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch (e) {
    return [];
  }
}

/**
 * Check if a folder is synced for offline use
 */
export function isFolderSynced(folderId: string): boolean {
  return getOfflineFolders().some(f => f.id === folderId);
}

/**
 * Save folder's files list for offline use
 */
export function saveOfflineFolderFiles(folderId: string, files: DriveFile[]): void {
  localStorage.setItem(`${OFFLINE_FILES_PREFIX}${folderId}`, JSON.stringify(files));
}

/**
 * Get cached offline files for a folder
 */
export function getOfflineFolderFiles(folderId: string): DriveFile[] {
  const stored = localStorage.getItem(`${OFFLINE_FILES_PREFIX}${folderId}`);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch (e) {
    return [];
  }
}

/**
 * Recursively fetch all files and subfolders within a given folder, caching their listings.
 */
export async function fetchAllNestedFiles(folderId: string, initialFiles: DriveFile[]): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [...initialFiles];
  const foldersToScan = initialFiles.filter(f => f.mimeType === 'application/vnd.google-apps.folder');

  for (const folder of foldersToScan) {
    try {
      // Fetch files within the subfolder (listDriveFiles handles saving listings to cache automatically)
      const subFiles = await listDriveFiles(folder.id);
      
      // Recursively fetch sub-subfolders
      const nested = await fetchAllNestedFiles(folder.id, subFiles);
      allFiles.push(...nested);
    } catch (e) {
      console.warn(`Failed to list subfolder ${folder.name} (${folder.id}) during offline sync:`, e);
    }
  }

  // De-duplicate files by ID
  const uniqueMap = new Map<string, DriveFile>();
  allFiles.forEach(f => uniqueMap.set(f.id, f));
  return Array.from(uniqueMap.values());
}

/**
 * Sync an entire folder's contents for offline access (including subfolders recursively)
 */
export async function syncFolderForOffline(
  folderId: string,
  folderName: string,
  files: DriveFile[],
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<void> {
  // 1. Save the list of files for the root folder
  saveOfflineFolderFiles(folderId, files);

  // 2. Recursively find and fetch all nested files (subfolder contents)
  let allNestedFiles: DriveFile[] = [];
  try {
    allNestedFiles = await fetchAllNestedFiles(folderId, files);
  } catch (err) {
    console.warn('Failed to retrieve subfolders during recursive offline sync, syncing top level files only:', err);
    allNestedFiles = files;
  }

  // 3. Filter non-folder files that we can download (Docs & Sheets)
  const syncableFiles = allNestedFiles.filter(f => {
    const mime = f.mimeType;
    return mime === 'application/vnd.google-apps.document' || 
           mime === 'application/vnd.google-apps.spreadsheet';
  });

  const total = syncableFiles.length;
  let current = 0;

  // 4. Download and cache each file's contents
  for (const file of syncableFiles) {
    current++;
    if (onProgress) {
      onProgress(current, total, file.name);
    }

    try {
      if (file.mimeType === 'application/vnd.google-apps.document') {
        const content = await getDocFileContent(file.id);
        if (content) {
          localStorage.setItem(`${OFFLINE_CONTENT_PREFIX}${file.id}`, JSON.stringify({
            type: 'doc',
            data: content
          }));
        }
      } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
        const content = await getSpreadsheetData(file.id);
        if (content) {
          localStorage.setItem(`${OFFLINE_CONTENT_PREFIX}${file.id}`, JSON.stringify({
            type: 'sheet',
            data: content
          }));
        }
      }
    } catch (err) {
      console.warn(`Failed to sync file ${file.name} (${file.id}) for offline:`, err);
    }
  }

  // 5. Update offline folders registry
  const folders = getOfflineFolders();
  const existingIndex = folders.findIndex(f => f.id === folderId);
  const meta: OfflineFolderMeta = {
    id: folderId,
    name: folderName,
    syncedAt: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fileCount: allNestedFiles.length
  };

  if (existingIndex !== -1) {
    folders[existingIndex] = meta;
  } else {
    folders.push(meta);
  }

  localStorage.setItem(OFFLINE_FOLDERS_KEY, JSON.stringify(folders));
}

/**
 * Recursively remove offline synced folder listings and files
 */
export function removeOfflineFolderRecursive(folderId: string): void {
  const files = getOfflineFolderFiles(folderId);
  
  files.forEach(f => {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      removeOfflineFolderRecursive(f.id);
    } else {
      localStorage.removeItem(`${OFFLINE_CONTENT_PREFIX}${f.id}`);
    }
  });

  localStorage.removeItem(`${OFFLINE_FILES_PREFIX}${folderId}`);
}

/**
 * Remove offline synced folder data recursively
 */
export function removeOfflineFolder(folderId: string): void {
  // 1. Recursively delete files and subfolder lists
  removeOfflineFolderRecursive(folderId);

  // 2. Update registry
  const folders = getOfflineFolders().filter(f => f.id !== folderId);
  localStorage.setItem(OFFLINE_FOLDERS_KEY, JSON.stringify(folders));
}

/**
 * Retrieve cached offline content for a document or spreadsheet
 */
export function getOfflineFileContent(fileId: string): { type: 'doc' | 'sheet'; data: any } | null {
  const stored = localStorage.getItem(`${OFFLINE_CONTENT_PREFIX}${fileId}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch (e) {
    return null;
  }
}
