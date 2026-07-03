/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FileSpreadsheet, 
  FileText, 
  ChevronRight, 
  ArrowLeft, 
  Star, 
  Clock, 
  Sparkles, 
  RefreshCw,
  List,
  Wifi,
  WifiOff,
  CloudLightning,
  Trash2,
  FolderDown,
  CheckCircle2
} from 'lucide-react';
import { DriveFile, Breadcrumb } from '../types';
import { listDriveFiles, getDocFileContent, appsScriptRequest, getSpreadsheetData } from '../lib/appsScriptClient';
import { StudyDayTracker } from './StudyDayTracker';
import { isFolderSynced, syncFolderForOffline, removeOfflineFolder } from '../lib/offlineStorage';

interface DriveExplorerProps {
  onFileSelect: (file: DriveFile, customBreadcrumbs?: Breadcrumb[]) => void;
  onOpenConsolidatedFlashcards?: (folderName: string, rows: string[][]) => void;
  currentFolder: Breadcrumb;
  breadcrumbs: Breadcrumb[];
  onNavigate: (folder: Breadcrumb, clearSearch?: boolean) => void;
  onNavigateBack: () => void;
  onFilesLoaded?: (files: DriveFile[]) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSearchingGlobal: boolean;
  setIsSearchingGlobal: (global: boolean) => void;
}

export const DriveExplorer: React.FC<DriveExplorerProps> = ({
  onFileSelect,
  onOpenConsolidatedFlashcards,
  currentFolder,
  breadcrumbs,
  onNavigate,
  onNavigateBack,
  onFilesLoaded,
  searchQuery,
  setSearchQuery,
  isSearchingGlobal,
  setIsSearchingGlobal
}) => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [allFolderFiles, setAllFolderFiles] = useState<DriveFile[]>([]); // Cache original folder files for local filtering
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinnedFiles, setPinnedFiles] = useState<DriveFile[]>([]);
  const [recentFiles, setRecentFiles] = useState<DriveFile[]>([]);
  const [overview, setOverview] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [expandedOutlines, setExpandedOutlines] = useState<Record<string, { headers: string[]; loading: boolean }>>({});

  // Offline states
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineSyncProgress, setOfflineSyncProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [isSynced, setIsSynced] = useState(false);

  const [consolidationState, setConsolidationState] = useState<{
    isActive: boolean;
    step: 'idle' | 'scanning' | 'loading_files' | 'merging' | 'success' | 'error';
    scannedFoldersCount: number;
    foundFilesCount: number;
    loadedFilesCount: number;
    totalFilesCount: number;
    message: string;
    errorMsg?: string;
  }>({
    isActive: false,
    step: 'idle',
    scannedFoldersCount: 0,
    foundFilesCount: 0,
    loadedFilesCount: 0,
    totalFilesCount: 0,
    message: '',
  });

  // Robust RFC 4180 compliant CSV parser for file explorer
  function parseCSV(text: string): string[][] {
    const lines: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let insideQuote = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (insideQuote && nextChar === '"') {
          cell += '"';
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        row.push(cell);
        cell = '';
      } else if ((char === '\r' || char === '\n') && !insideQuote) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        row.push(cell);
        lines.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    if (cell || row.length > 0) {
      row.push(cell);
      lines.push(row);
    }
    return lines.filter(r => r.some(c => c.trim() !== ''));
  }

  const startConsolidation = async (targetFolderId: string, targetFolderName: string) => {
    setConsolidationState({
      isActive: true,
      step: 'scanning',
      scannedFoldersCount: 0,
      foundFilesCount: 0,
      loadedFilesCount: 0,
      totalFilesCount: 0,
      message: 'Scanning folder structure recursively...',
    });

    try {
      const queue: string[] = [targetFolderId];
      const foundFiles: DriveFile[] = [];
      let scannedCount = 0;

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        setConsolidationState(prev => ({
          ...prev,
          message: `Scanning folder structures... (Scanned: ${scannedCount}, Found: ${foundFiles.length} decks)`
        }));

        const items = await listDriveFiles(currentId);
        
        // Add subfolders to queue
        const folders = items.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        for (const fold of folders) {
          queue.push(fold.id);
        }

        // Add flashcard files
        const cards = items.filter(f => {
          const isSpreadsheet = f.mimeType === 'application/vnd.google-apps.spreadsheet';
          const isCsv = f.mimeType === 'text/csv' || 
                        f.mimeType === 'application/csv' || 
                        f.name.toLowerCase().endsWith('.csv');
          return isSpreadsheet || isCsv;
        });

        foundFiles.push(...cards);
        scannedCount++;
      }

      if (foundFiles.length === 0) {
        throw new Error('No flashcard spreadsheets or CSV files found in this folder or its subfolders.');
      }

      setConsolidationState(prev => ({
        ...prev,
        step: 'loading_files',
        scannedFoldersCount: scannedCount,
        foundFilesCount: foundFiles.length,
        totalFilesCount: foundFiles.length,
        loadedFilesCount: 0,
        message: `Found ${foundFiles.length} card decks. Loading vocabulary items...`,
      }));

      const allMergedRows: string[][] = [];
      let masterHeader: string[] | null = null;

      for (let i = 0; i < foundFiles.length; i++) {
        const file = foundFiles[i];
        setConsolidationState(prev => ({
          ...prev,
          loadedFilesCount: i,
          message: `Reading deck: "${file.name}" (${i + 1} of ${foundFiles.length})...`
        }));

        let fileRows: string[][] = [];
        const isCsv = file.mimeType === 'text/csv' || 
                      file.mimeType === 'application/csv' || 
                      file.name.toLowerCase().endsWith('.csv');

        try {
          if (isCsv) {
            const res = await appsScriptRequest('getFileContent', { fileId: file.id });
            const text = res.text || '';
            fileRows = parseCSV(text);
          } else {
            const data = await getSpreadsheetData(file.id);
            fileRows = data.values || [];
          }
        } catch (fetchErr) {
          console.warn(`Could not load file "${file.name}":`, fetchErr);
          continue; // Skip individual file error so it doesn't break everything
        }

        if (fileRows.length === 0) continue;

        // Determine if first row is a header
        let hasHeader = false;
        const firstRowStr = fileRows[0].map(c => c.toLowerCase()).join(' ');
        if (
          firstRowStr.includes('term') || 
          firstRowStr.includes('definition') || 
          firstRowStr.includes('front') || 
          firstRowStr.includes('back') || 
          firstRowStr.includes('hint') || 
          firstRowStr.includes('word') || 
          firstRowStr.includes('vocab')
        ) {
          hasHeader = true;
        }

        const dataRows = hasHeader ? fileRows.slice(1) : fileRows;

        // Set master header if not set yet
        if (!masterHeader) {
          masterHeader = hasHeader ? fileRows[0] : ['Front / Term', 'Back / Definition', 'Hint'];
        }

        // Add valid rows (must have at least 2 non-empty elements)
        for (const r of dataRows) {
          const cleaned = r.filter(c => c !== undefined);
          if (cleaned.length >= 2 && cleaned[0].trim() !== '' && cleaned[1].trim() !== '') {
            const standardizedRow = [...cleaned];
            while (standardizedRow.length < masterHeader.length) {
              standardizedRow.push('');
            }
            allMergedRows.push(standardizedRow.slice(0, masterHeader.length));
          }
        }
      }

      if (allMergedRows.length === 0) {
        throw new Error('No valid flashcard rows were found in the listed decks.');
      }

      setConsolidationState(prev => ({
        ...prev,
        step: 'merging',
        message: `Merging ${allMergedRows.length} flashcards...`
      }));

      // Combine master header with data rows
      const finalConsolidatedRows = [masterHeader!, ...allMergedRows];

      setConsolidationState(prev => ({
        ...prev,
        step: 'success',
        message: `Successfully consolidated ${allMergedRows.length} flashcards from ${foundFiles.length} decks!`
      }));

      // Open virtual deck after a brief delay
      setTimeout(() => {
        if (onOpenConsolidatedFlashcards) {
          onOpenConsolidatedFlashcards(targetFolderName, finalConsolidatedRows);
        }
        setConsolidationState(prev => ({ ...prev, isActive: false }));
      }, 1500);

    } catch (err: any) {
      console.error('Consolidation error:', err);
      setConsolidationState(prev => ({
        ...prev,
        step: 'error',
        message: 'Consolidation failed',
        errorMsg: err.message || 'An unexpected error occurred during consolidation.'
      }));
    }
  };

  // Check sync status whenever currentFolder changes
  useEffect(() => {
    setIsSynced(isFolderSynced(currentFolder.id));
  }, [currentFolder, files]);

  const handleOfflineSync = async () => {
    if (offlineSyncing) return;
    
    if (isSynced) {
      if (confirm(`Remove offline downloaded files for "${currentFolder.name}"?`)) {
        removeOfflineFolder(currentFolder.id);
        setIsSynced(false);
      }
      return;
    }

    setOfflineSyncing(true);
    setOfflineSyncProgress({ current: 0, total: allFolderFiles.length, fileName: 'Connecting...' });

    try {
      await syncFolderForOffline(currentFolder.id, currentFolder.name, allFolderFiles, (current, total, name) => {
        setOfflineSyncProgress({ current, total, fileName: name });
      });
      setIsSynced(true);
    } catch (err) {
      console.error('Offline sync failed', err);
      alert('Failed to complete offline sync. Some files could not be cached.');
    } finally {
      setOfflineSyncing(false);
      setOfflineSyncProgress(null);
    }
  };

  const toggleOutline = async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (expandedOutlines[fileId]) {
      const updated = { ...expandedOutlines };
      delete updated[fileId];
      setExpandedOutlines(updated);
      return;
    }

    // Set loading
    setExpandedOutlines(prev => ({
      ...prev,
      [fileId]: { headers: [], loading: true }
    }));

    try {
      const docContent = await getDocFileContent(fileId);
      const headers = (docContent?.headers || []).map(h => h.text).filter(Boolean);
      setExpandedOutlines(prev => ({
        ...prev,
        [fileId]: { headers, loading: false }
      }));
    } catch (err) {
      console.error('Failed to load outline in explorer:', err);
      setExpandedOutlines(prev => ({
        ...prev,
        [fileId]: { headers: ['(Unable to load document outline)'], loading: false }
      }));
    }
  };

  // Load pinned and recent files from localStorage
  useEffect(() => {
    const savedPinned = localStorage.getItem('study_hub_pinned');
    if (savedPinned) {
      try {
        setPinnedFiles(JSON.parse(savedPinned));
      } catch (e) {
        console.error(e);
      }
    }
    const savedRecent = localStorage.getItem('study_hub_recent');
    if (savedRecent) {
      try {
        setRecentFiles(JSON.parse(savedRecent));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Background nested folder scanning to populate index cache and make the site snappy
  const scanNestedFoldersIndex = async (rootFiles: DriveFile[]) => {
    const foldersToScan = rootFiles.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    for (const folder of foldersToScan) {
      try {
        const subFiles = await listDriveFiles(folder.id);
        const subFolders = subFiles.filter(sf => sf.mimeType === 'application/vnd.google-apps.folder');
        for (const subFolder of subFolders) {
          try {
            await listDriveFiles(subFolder.id);
          } catch (err) {
            console.warn(`Background scan failed for sub-subfolder ${subFolder.name}:`, err);
          }
        }
      } catch (e) {
        console.warn(`Background scan failed for subfolder ${folder.name}:`, e);
      }
    }
  };

  // Fetch directory files
  const loadFolderFiles = async (folderId: string, forceRefresh = false) => {
    if (!folderId || folderId === 'root') {
      setError('Repository Folder is not yet linked. Please ask your administrator to configure the target Folder URL.');
      return;
    }

    // SNAPPY CACHE CHECK FOR SUBFOLDERS:
    // If we are in a subfolder, try to load from the index cache first
    if (breadcrumbs.length > 1 && !forceRefresh) {
      const cached = localStorage.getItem(`study_hub_offline_files_${folderId}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setFiles(parsed);
            setAllFolderFiles(parsed);
            if (onFilesLoaded) {
              onFilesLoaded(parsed);
            }
            
            // Try to find overview document named "info"
            const infoDoc = parsed.find((f: any) => 
              f.name.toLowerCase() === 'info' && f.mimeType === 'application/vnd.google-apps.document'
            );
            const infoTxt = parsed.find((f: any) => 
              (f.name.toLowerCase() === 'info.txt' || f.name.toLowerCase() === 'info') && f.mimeType === 'text/plain'
            );

            if (infoDoc) {
              const infoCached = localStorage.getItem(`study_hub_offline_content_${infoDoc.id}`);
              if (infoCached) {
                try {
                  const parsedContent = JSON.parse(infoCached);
                  if (parsedContent && parsedContent.data) {
                    let text = '';
                    if (parsedContent.data.elements) {
                      parsedContent.data.elements.forEach((el: any) => {
                        if (el.text) text += el.text + '\n';
                      });
                    } else if (typeof parsedContent.data === 'string') {
                      text = parsedContent.data;
                    }
                    setOverview(text.trim());
                  }
                } catch (e) {}
              }
            } else if (infoTxt) {
              const infoCached = localStorage.getItem(`study_hub_offline_content_${infoTxt.id}`);
              if (infoCached) {
                try {
                  const parsedContent = JSON.parse(infoCached);
                  if (parsedContent && parsedContent.data) {
                    setOverview(parsedContent.data.text || '');
                  }
                } catch (e) {}
              }
            }
            return; // Snappy return! No network loading or spinning!
          }
        } catch (e) {
          console.error('Failed to parse cached subfolder files:', e);
        }
      }
    }

    setLoading(true);
    setError(null);
    setOverview(null);
    try {
      const filesList = await listDriveFiles(folderId);
      setFiles(filesList);
      setAllFolderFiles(filesList);
      if (onFilesLoaded) {
        onFilesLoaded(filesList);
      }

      // If we are in the main level front page of the repository, run background scanning
      const hasScannedInSession = sessionStorage.getItem('study_hub_initial_scan_done') === 'true';
      if (breadcrumbs.length <= 1 && (forceRefresh || !hasScannedInSession)) {
        sessionStorage.setItem('study_hub_initial_scan_done', 'true');
        scanNestedFoldersIndex(filesList);
      }

      // Try to find overview document named "info"
      const infoDoc = filesList.find((f: any) => 
        f.name.toLowerCase() === 'info' && f.mimeType === 'application/vnd.google-apps.document'
      );
      const infoTxt = filesList.find((f: any) => 
        (f.name.toLowerCase() === 'info.txt' || f.name.toLowerCase() === 'info') && f.mimeType === 'text/plain'
      );

      if (infoDoc) {
        setLoadingOverview(true);
        try {
          const docData = await getDocFileContent(infoDoc.id);
          let text = '';
          if (docData && docData.elements) {
            docData.elements.forEach(el => {
              if (el.text) text += el.text + '\n';
            });
          }
          setOverview(text.trim());
        } catch (e) {
          console.error('Failed to load folder overview document:', e);
        } finally {
          setLoadingOverview(false);
        }
      } else if (infoTxt) {
        setLoadingOverview(true);
        try {
          const data = await appsScriptRequest('getFileContent', { fileId: infoTxt.id });
          setOverview(data.text || '');
        } catch (e) {
          console.error('Failed to load folder overview plain text:', e);
        } finally {
          setLoadingOverview(false);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading files. Please make sure your Apps Script Web App URL and Folder ID are configured in the Admin settings.');
    } finally {
      setLoading(false);
    }
  };

  // Perform Drive search
  const performSearch = async (query: string, global: boolean = false) => {
    if (!query.trim()) {
      setFiles(allFolderFiles);
      return;
    }

    setLoading(true);
    setError(null);
    setOverview(null);
    try {
      const queryLower = query.toLowerCase();
      if (!global) {
        // Search current folder files locally
        const filtered = allFolderFiles.filter(f => f.name.toLowerCase().includes(queryLower));
        setFiles(filtered);
      } else {
        // Global search - we fetch all folder files first or perform apps script list
        const filesList = await listDriveFiles(currentFolder.id);
        const filtered = filesList.filter(f => f.name.toLowerCase().includes(queryLower));
        setFiles(filtered);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Search encountered an error.');
    } finally {
      setLoading(false);
    }
  };

  // Reactive Instant search
  useEffect(() => {
    if (searchQuery) {
      performSearch(searchQuery, isSearchingGlobal);
    } else {
      loadFolderFiles(currentFolder.id);
    }
  }, [currentFolder.id, searchQuery, isSearchingGlobal]);

  const togglePin = (file: DriveFile, e: React.MouseEvent) => {
    e.stopPropagation();
    let updated: DriveFile[];
    const exists = pinnedFiles.some(f => f.id === file.id);
    if (exists) {
      updated = pinnedFiles.filter(f => f.id !== file.id);
    } else {
      // Attach original breadcrumbs to pin so it opens in its native folder structure!
      const fileWithBreadcrumbs = {
        ...file,
        breadcrumbs: [...breadcrumbs]
      };
      updated = [fileWithBreadcrumbs, ...pinnedFiles];
    }
    setPinnedFiles(updated);
    localStorage.setItem('study_hub_pinned', JSON.stringify(updated));
  };

  const getEffectiveFile = (file: DriveFile) => {
    const isShortcut = file.mimeType === 'application/vnd.google-apps.shortcut';
    const targetId = isShortcut ? (file as any).shortcutDetails?.targetId || file.id : file.id;
    const targetMimeType = isShortcut ? (file as any).shortcutDetails?.targetMimeType || '' : file.mimeType;
    return {
      id: targetId,
      mimeType: targetMimeType,
      isShortcut,
    };
  };

  const isFlashcardMime = (file: DriveFile) => {
    const eff = getEffectiveFile(file);
    const mime = eff.mimeType || '';
    const name = file.name || '';
    return (
      mime === 'application/vnd.google-apps.spreadsheet' ||
      mime === 'text/csv' ||
      mime === 'application/csv' ||
      name.toLowerCase().endsWith('.csv')
    );
  };
  const isDocMime = (file: DriveFile) => {
    const eff = getEffectiveFile(file);
    return eff.mimeType === 'application/vnd.google-apps.document';
  };
  const isPdfMime = (file: DriveFile) => {
    const eff = getEffectiveFile(file);
    return eff.mimeType === 'application/pdf';
  };
  const isFolderMime = (file: DriveFile) => {
    const eff = getEffectiveFile(file);
    return eff.mimeType === 'application/vnd.google-apps.folder';
  };

  const handleFileClick = (file: DriveFile) => {
    const eff = getEffectiveFile(file);
    
    if (eff.mimeType === 'application/vnd.google-apps.folder') {
      onNavigate({ id: eff.id, name: file.name }, true);
    } else {
      // It's a file, resolve target
      const resolvedFile: DriveFile = {
        ...file,
        id: eff.id,
        mimeType: eff.mimeType || file.mimeType,
      };

      // Add to recent files with current breadcrumbs so it can restore them later
      const fileBreadcrumbs = (file as any).breadcrumbs || [...breadcrumbs];
      const fileWithBreadcrumbs = {
        ...resolvedFile,
        breadcrumbs: fileBreadcrumbs
      };

      const filtered = recentFiles.filter(f => f.id !== resolvedFile.id);
      const updated = [fileWithBreadcrumbs, ...filtered].slice(0, 10); // Keep max 10
      setRecentFiles(updated);
      localStorage.setItem('study_hub_recent', JSON.stringify(updated));

      // Auto-track studied day in localStorage
      try {
        const savedDaysStr = localStorage.getItem('study_hub_studied_days');
        let savedDays: string[] = [];
        if (savedDaysStr) {
          savedDays = JSON.parse(savedDaysStr);
        }
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        if (!savedDays.includes(todayStr)) {
          savedDays.push(todayStr);
          localStorage.setItem('study_hub_studied_days', JSON.stringify(savedDays));
        }
      } catch (e) {
        console.error(e);
      }

      onFileSelect(resolvedFile, fileBreadcrumbs);
    }
  };

  const formatSize = (bytesStr?: string) => {
    if (!bytesStr) return '--';
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return '--';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '--';
    }
  };

  const formatBreadcrumbPath = (crumbs?: Breadcrumb[]) => {
    if (!crumbs || crumbs.length === 0) return 'Repository';
    return crumbs.map(c => c.name).join(' / ');
  };

  const displayFiles = files.filter(file => {
    const nameLower = file.name.toLowerCase();
    const eff = getEffectiveFile(file);
    const isInfoDoc = nameLower === 'info' && eff.mimeType === 'application/vnd.google-apps.document';
    const isInfoTxt = (nameLower === 'info' || nameLower === 'info.txt') && eff.mimeType === 'text/plain';
    const isPlainOtherTxt = eff.mimeType === 'text/plain';
    return !isInfoDoc && !isInfoTxt && !isPlainOtherTxt;
  });

  // Segregate folder items from other file types, sorted alphabetically by name
  const folderItems = displayFiles.filter(isFolderMime).sort((a, b) => a.name.localeCompare(b.name));
  const fileItems = displayFiles.filter(file => !isFolderMime(file)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      
      {/* Main Files Directory Card */}
      <div className="bg-white rounded-2xl border-2 border-slate-300 p-6 shadow-sm space-y-6 font-sans">
        
        {/* Hierarchy Address (Breadcrumbs) moved into this attached component replacing "Files & Folders" header */}
        <div className="flex flex-wrap justify-between items-center pb-3.5 border-b-2 border-slate-200 gap-3">
          {/* Breadcrumbs trail */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-hidden text-xs">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                {idx > 0 && <ChevronRight size={12} className="text-slate-400 shrink-0" />}
                <button
                  onClick={() => onNavigate(crumb, true)}
                  className={`font-sans font-extrabold hover:text-indigo-600 transition-colors truncate max-w-[120px] md:max-w-[200px] text-left cursor-pointer ${
                    idx === breadcrumbs.length - 1 ? 'text-slate-900 text-sm' : 'text-slate-400'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
            
            {/* Display files count badge next to hierarchy address */}
            {displayFiles.length > 0 && (
              <span className="bg-slate-100 text-slate-700 rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold border border-slate-200 shrink-0">
                {displayFiles.length} item{displayFiles.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Offline Sync Button - only displayed on subfolders (first level is excluded) */}
            {breadcrumbs.length > 1 && (
              <button
                type="button"
                onClick={handleOfflineSync}
                disabled={offlineSyncing}
                className={`p-1.5 rounded-xl border-2 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold font-sans ${
                  offlineSyncing
                    ? 'bg-amber-50 border-amber-300 text-amber-700 animate-pulse'
                    : isSynced
                      ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300 hover:border-blue-500'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 hover:border-blue-600'
                }`}
                title={isSynced ? "Folder is available offline. Click to remove." : "Sync folder files for offline review"}
              >
                {offlineSyncing ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : isSynced ? (
                  <CheckCircle2 size={13} className="text-blue-600" />
                ) : (
                  <FolderDown size={13} className="text-slate-400" />
                )}
                <span>{offlineSyncing ? 'Syncing...' : isSynced ? 'Offline Ready' : 'Download Offline'}</span>
              </button>
            )}

            {/* Consolidate Flashcards Button - displayed on second level folders or deeper */}
            {breadcrumbs.length >= 2 && (
              <button
                type="button"
                onClick={() => startConsolidation(currentFolder.id, currentFolder.name)}
                disabled={loading || consolidationState.isActive}
                className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-2 border-indigo-300 hover:border-indigo-500 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold font-sans"
                title="Consolidate all flashcards in this folder and its subfolders"
              >
                <Sparkles size={13} className="text-indigo-600 animate-pulse" />
                <span>Consolidate Decks</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => loadFolderFiles(currentFolder.id, true)}
              className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border-2 border-slate-300 hover:border-indigo-600 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold font-sans"
              title="Refresh Files"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Offline Syncing Progress Bar */}
        {offlineSyncing && offlineSyncProgress && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 text-blue-800 animate-pulse font-sans space-y-2">
            <div className="flex items-center justify-between text-xs font-black">
              <span className="flex items-center gap-1.5">
                <CloudLightning size={14} className="text-blue-600 animate-bounce" />
                DOWNLOADING OFFLINE STUDY PACK...
              </span>
              <span>
                {offlineSyncProgress.current} / {offlineSyncProgress.total} Files
              </span>
            </div>
            <div className="w-full bg-blue-200/50 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-blue-600 h-full transition-all duration-300"
                style={{ width: `${(offlineSyncProgress.current / (offlineSyncProgress.total || 1)) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-blue-600 font-bold truncate">
              Caching: {offlineSyncProgress.fileName}
            </p>
          </div>
        )}

        {/* Overview Statement block */}
        {!loading && !error && overview && (
          <div className="bg-indigo-50/40 border-2 border-indigo-200 rounded-2xl p-5 mb-2 text-slate-700 animate-fade-in relative overflow-hidden shadow-sm">
            <div className="absolute top-0 right-0 p-4 text-indigo-100 pointer-events-none">
              <Sparkles size={54} className="opacity-10" />
            </div>
            <div className="flex items-start gap-3.5">
              <div className="bg-indigo-600 text-white p-2 rounded-xl mt-0.5 shrink-0 shadow-sm shadow-indigo-100">
                <Sparkles size={16} />
              </div>
              <div className="flex-1 space-y-1.5">
                <h4 className="font-sans font-extrabold text-[11px] uppercase tracking-wider text-indigo-800">
                  Folder Overview
                </h4>
                <p className="font-sans text-xs leading-relaxed text-slate-700 whitespace-pre-wrap font-bold">
                  {overview}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-6 bg-red-50 border-2 border-red-200 text-red-700 rounded-2xl flex flex-col items-center justify-center gap-4 py-8 text-center font-sans max-w-2xl mx-auto">
            <div className="space-y-2 w-full">
              <span className="text-2xl block mb-1">⚠️</span>
              <h3 className="font-sans font-extrabold text-red-950 text-base">Connection Failed</h3>
              <p className="font-sans text-xs md:text-sm leading-relaxed text-slate-700 whitespace-pre-wrap text-left max-w-xl mx-auto bg-white p-4 rounded-xl border border-red-200/40 font-medium">
                {error}
              </p>
            </div>
            <button
              onClick={() => loadFolderFiles(currentFolder.id, true)}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-sans font-bold cursor-pointer transition-colors shadow-sm"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 font-sans">
            <div className="h-8 w-8 border-3 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
            <p className="font-sans text-xs text-slate-500 font-bold">Exploring Repository...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && displayFiles.length === 0 && (
          <div className="text-center py-20 max-w-sm mx-auto space-y-4 font-sans">
            <div className="text-3xl">📁</div>
            <h4 className="font-sans font-extrabold text-slate-800 text-sm">No study materials found</h4>
            <p className="font-sans text-xs text-slate-500 leading-normal font-medium">
              {overview 
                ? "This folder has an overview statement but doesn't contain any other study materials yet." 
                : "This folder doesn't contain any sub-folders, Google Docs, Google Sheets, or PDF files. Ask your administrator to upload some!"}
            </p>
            {breadcrumbs.length > 1 && (
              <button
                onClick={onNavigateBack}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-sans font-bold hover:bg-indigo-700 cursor-pointer transition-colors shadow-sm"
              >
                <ArrowLeft size={13} /> Back to parent
              </button>
            )}
          </div>
        )}

        {/* Folder Navigation - GRID Layout (High-Contrast) */}
        {!loading && !error && folderItems.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Subfolders</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {folderItems.map(file => {
                const isPinned = pinnedFiles.some(f => f.id === file.id);

                return (
                  <div
                    key={file.id}
                    onClick={() => handleFileClick(file)}
                    className="group relative p-4 bg-white border-2 border-slate-300 hover:border-indigo-600 rounded-2xl cursor-pointer hover:shadow-md transition-all flex items-center justify-between gap-2 h-18"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-300 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200 shrink-0">
                        <Folder size={18} className="fill-slate-300 group-hover:fill-indigo-100 text-slate-500 group-hover:text-indigo-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-sans font-extrabold text-xs text-slate-900 truncate group-hover:text-indigo-600 leading-snug" title={file.name}>
                          {file.name}
                        </h3>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mt-0.5">Folder</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Consolidate shortcut button for folders */}
                      {breadcrumbs.length >= 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startConsolidation(file.id, file.name);
                          }}
                          disabled={consolidationState.isActive}
                          className="p-1.5 hover:bg-indigo-50 text-indigo-500 hover:text-indigo-600 rounded-lg cursor-pointer shrink-0"
                          title="Consolidate all flashcards in this subfolder"
                        >
                          <Sparkles size={13} />
                        </button>
                      )}

                      <button
                        onClick={(e) => togglePin(file, e)}
                        className={`p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer shrink-0 ${
                          isPinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'
                        }`}
                      >
                        <Star size={13} className={isPinned ? "fill-amber-500" : ""} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files Directory - LIST Layout (High-Contrast) */}
        {!loading && !error && fileItems.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Documents and Files</h4>
            <div className="border-2 border-slate-300 rounded-2xl overflow-hidden divide-y divide-slate-300 font-sans bg-white shadow-sm">
              {fileItems.map(file => {
                const eff = getEffectiveFile(file);
                const isSheet = isFlashcardMime(file);
                const isDoc = isDocMime(file);
                const isPdf = isPdfMime(file);
                const isPinned = pinnedFiles.some(f => f.id === file.id);
                const outlineInfo = expandedOutlines[file.id];

                return (
                  <div key={file.id} className="flex flex-col divide-y divide-slate-100">
                    <div
                      onClick={() => handleFileClick(file)}
                      className="group flex items-center justify-between p-3.5 hover:bg-indigo-50/10 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className={`p-2 rounded-xl border shrink-0 ${
                          isSheet 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                            : isPdf
                              ? 'bg-rose-50 text-rose-600 border-rose-200'
                              : 'bg-indigo-50 text-indigo-600 border-indigo-200'
                        }`}>
                          {isSheet ? (
                            <FileSpreadsheet size={18} />
                          ) : (
                            <FileText size={18} />
                          )}
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <h3 className="font-sans font-extrabold text-sm text-slate-900 truncate group-hover:text-indigo-600 pr-2">
                            {file.name}
                          </h3>
                          <p className="font-sans text-[10px] text-slate-500 font-medium mt-0.5">
                            {isSheet ? 'Sheets Vocabulary / Flashcards' : isPdf ? 'PDF Resource' : 'Docs Study Notes'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0 pr-1">
                        {/* Shortcut/Type Badges */}
                        {eff.isShortcut && (
                          <span className="hidden sm:inline bg-slate-100 text-slate-700 border border-slate-300 font-sans text-[9px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded-full shadow-sm">
                            Shortcut
                          </span>
                        )}
                        {isSheet && (
                          <span className="hidden sm:inline bg-emerald-50 text-emerald-700 border border-emerald-200 font-sans text-[9px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded-full shadow-sm">
                            Decks
                          </span>
                        )}
                        {isDoc && (
                          <span className="hidden sm:inline bg-indigo-50 text-indigo-700 border border-indigo-200 font-sans text-[9px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded-full shadow-sm">
                            Doc
                          </span>
                        )}
                        {isPdf && (
                          <span className="hidden sm:inline bg-rose-50 text-rose-700 border border-rose-200 font-sans text-[9px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded-full shadow-sm">
                            PDF
                          </span>
                        )}

                        <span className="hidden md:inline font-mono text-[11px] font-bold w-20 text-right">{formatSize(file.size)}</span>
                        <span className="hidden sm:inline text-[11px] font-bold w-24 text-right">{formatDate(file.modifiedTime)}</span>
                        
                        {/* Outline Drawer Toggle button inside Explorer */}
                        {isDoc && (
                          <button
                            type="button"
                            onClick={(e) => toggleOutline(file.id, e)}
                            className={`p-1.5 hover:bg-indigo-100 rounded-lg cursor-pointer shrink-0 border-2 transition-all flex items-center gap-1.5 text-[10px] font-sans font-bold ${
                              outlineInfo 
                                ? 'bg-indigo-600 border-indigo-700 text-white shadow-sm' 
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                            }`}
                            title="Show document headings / outlines inline"
                          >
                            <List size={12} />
                            <span className="hidden xs:inline">Outline</span>
                          </button>
                        )}

                        <button
                          onClick={(e) => togglePin(file, e)}
                          className={`p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer shrink-0 ${
                            isPinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'
                          }`}
                        >
                          <Star size={14} className={isPinned ? "fill-amber-500" : ""} />
                        </button>
                      </div>
                    </div>

                    {/* Inline Document Outlines / Headings list */}
                    {outlineInfo && (
                      <div className="bg-slate-50/70 border-t border-slate-200 px-14 py-4 text-xs text-slate-700 animate-fade-in space-y-2 font-sans">
                        <div className="flex items-center gap-2 font-sans font-extrabold text-[10px] uppercase tracking-wider text-indigo-700">
                          <List size={12} />
                          Document Outline / Outline of Content
                        </div>
                        {outlineInfo.loading ? (
                          <div className="flex items-center gap-2 py-2">
                            <div className="h-4 w-4 border-2 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                            <span className="font-sans font-bold text-slate-400 text-xs">Extracting outlines from document...</span>
                          </div>
                        ) : outlineInfo.headers.length === 0 ? (
                          <p className="font-sans italic text-slate-400 text-xs pl-2">No structural headings (H1, H2, H3) found in this document.</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 pt-1">
                            {outlineInfo.headers.map((hdr, idx) => (
                              <div key={idx} className="flex items-start gap-1.5 py-0.5">
                                <span className="text-indigo-500 font-extrabold mt-0.5 shrink-0">•</span>
                                <span className="font-sans font-bold text-slate-700 text-xs truncate" title={hdr}>
                                  {hdr}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* Quick Access: Pinned, Recents, and Study Tracker with High-Contrast Layout and original hierarchy paths */}
      {!searchQuery && breadcrumbs.length === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          {/* Study Calendar Day Tracker */}
          <StudyDayTracker />

          {/* Pinned Files - High Contrast Grid Box */}
          <div className="bg-white p-5 rounded-2xl border-2 border-slate-300 shadow-sm flex flex-col h-full min-h-[350px]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 shrink-0 mb-3.5">
              <h3 className="font-sans font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Star size={16} className="text-amber-500 fill-amber-500" />
                Pinned Study Materials
              </h3>
              <span className="font-sans text-xs text-slate-500 font-extrabold bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                {pinnedFiles.length} item{pinnedFiles.length !== 1 ? 's' : ''}
              </span>
            </div>
            {pinnedFiles.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-4">
                <p className="font-sans text-xs text-slate-500 text-center font-medium">
                  Pin spreadsheets or doc files to study them quickly!
                </p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                {pinnedFiles.map(file => (
                  <div
                    key={`pinned-${file.id}`}
                    onClick={() => handleFileClick(file)}
                    className="flex items-center justify-between p-2.5 hover:bg-slate-50 border border-slate-100 rounded-xl cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {isFolderMime(file) ? (
                        <Folder size={16} className="text-slate-500 fill-slate-100 shrink-0" />
                      ) : isFlashcardMime(file) ? (
                        <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" />
                      ) : isPdfMime(file) ? (
                        <FileText size={16} className="text-rose-500 shrink-0" />
                      ) : (
                        <FileText size={16} className="text-indigo-600 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="font-sans text-xs font-bold text-slate-800 truncate group-hover:text-indigo-600 block">
                          {file.name}
                        </span>
                        <span className="font-sans text-[10px] text-slate-400 font-medium truncate block mt-0.5" title={formatBreadcrumbPath((file as any).breadcrumbs)}>
                          {formatBreadcrumbPath((file as any).breadcrumbs)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => togglePin(file, e)}
                      className="text-amber-500 hover:text-amber-600 cursor-pointer p-1.5 hover:bg-slate-100 rounded-lg shrink-0 ml-1"
                      title="Unpin"
                    >
                      <Star size={13} className="fill-amber-500 text-amber-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Files - High Contrast Grid Box */}
          <div className="bg-white p-5 rounded-2xl border-2 border-slate-300 shadow-sm flex flex-col h-full min-h-[350px]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 shrink-0 mb-3.5">
              <h3 className="font-sans font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Clock size={16} className="text-slate-700" />
                Recently Studied
              </h3>
              <span className="font-sans text-xs text-slate-500 font-extrabold bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                {recentFiles.length} item{recentFiles.length !== 1 ? 's' : ''}
              </span>
            </div>
            {recentFiles.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-4">
                <p className="font-sans text-xs text-slate-500 text-center font-medium">
                  Open spreadsheets or docs to list them here.
                </p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                {recentFiles.map(file => (
                  <div
                    key={`recent-${file.id}`}
                    onClick={() => handleFileClick(file)}
                    className="flex items-center justify-between p-2.5 hover:bg-slate-50 border border-slate-100 rounded-xl cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {isFolderMime(file) ? (
                        <Folder size={16} className="text-slate-500 fill-slate-100 shrink-0" />
                      ) : isFlashcardMime(file) ? (
                        <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" />
                      ) : isPdfMime(file) ? (
                        <FileText size={16} className="text-rose-500 shrink-0" />
                      ) : (
                        <FileText size={16} className="text-indigo-600 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="font-sans text-xs font-bold text-slate-800 truncate group-hover:text-indigo-600 block">
                          {file.name}
                        </span>
                        <span className="font-sans text-[10px] text-slate-400 font-medium truncate block mt-0.5" title={formatBreadcrumbPath((file as any).breadcrumbs)}>
                          {formatBreadcrumbPath((file as any).breadcrumbs)}
                        </span>
                      </div>
                    </div>
                    <span className="font-sans text-[9px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5 shrink-0 font-mono">
                      {isFolderMime(file) ? 'Folder' : isFlashcardMime(file) ? 'Flashcards' : isPdfMime(file) ? 'PDF' : 'Doc'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Consolidation Progress Modal */}
      {consolidationState.isActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 font-sans">
          <div className="bg-white rounded-3xl border-2 border-indigo-200 p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6 text-center animate-scale-in">
            <div className="flex flex-col items-center gap-4">
              {consolidationState.step === 'success' ? (
                <div className="h-16 w-16 bg-emerald-100 border border-emerald-300 text-emerald-600 rounded-2xl flex items-center justify-center animate-bounce shadow-sm">
                  <CheckCircle2 size={36} />
                </div>
              ) : consolidationState.step === 'error' ? (
                <div className="h-16 w-16 bg-rose-100 border border-rose-300 text-rose-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <span className="text-3xl">⚠️</span>
                </div>
              ) : (
                <div className="relative">
                  <div className="h-16 w-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                    <Sparkles size={20} className="animate-pulse" />
                  </div>
                </div>
              )}
              
              <div className="space-y-1.5">
                <h3 className="font-sans font-extrabold text-slate-900 text-lg">
                  {consolidationState.step === 'scanning' && 'Scanning Folder Structure'}
                  {consolidationState.step === 'loading_files' && 'Loading Flashcard Decks'}
                  {consolidationState.step === 'merging' && 'Merging Flashcards'}
                  {consolidationState.step === 'success' && 'Consolidation Complete!'}
                  {consolidationState.step === 'error' && 'Consolidation Failed'}
                </h3>
                <p className="text-xs font-semibold text-slate-500 leading-normal">
                  {consolidationState.message}
                </p>
              </div>
            </div>

            {/* Metrics Breakdown */}
            {(consolidationState.step === 'scanning' || consolidationState.step === 'loading_files') && (
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 grid grid-cols-2 gap-4 text-left font-sans">
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Folders Scanned</span>
                  <div className="text-base font-black text-slate-800">{consolidationState.scannedFoldersCount}</div>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Decks Discovered</span>
                  <div className="text-base font-black text-indigo-600">{consolidationState.foundFilesCount}</div>
                </div>
              </div>
            )}

            {/* Progress bar for loading files */}
            {consolidationState.step === 'loading_files' && (
              <div className="space-y-1 text-left font-sans">
                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                  <span>Loading decks...</span>
                  <span>{consolidationState.loadedFilesCount} / {consolidationState.totalFilesCount}</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${(consolidationState.loadedFilesCount / (consolidationState.totalFilesCount || 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {consolidationState.step === 'error' && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-left">
                <p className="text-xs font-semibold text-rose-800 whitespace-pre-wrap leading-relaxed">
                  {consolidationState.errorMsg}
                </p>
              </div>
            )}

            <div className="flex justify-center gap-3">
              {consolidationState.step === 'error' && (
                <button
                  onClick={() => setConsolidationState(prev => ({ ...prev, isActive: false }))}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-sans font-bold cursor-pointer transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
