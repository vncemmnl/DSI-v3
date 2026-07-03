/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Folder, 
  Layers, 
  FileText, 
  ChevronRight,
  GraduationCap,
  Search,
  Settings,
  X
} from 'lucide-react';

import { DriveFile, Breadcrumb } from './types';
import { DriveExplorer } from './components/DriveExplorer';
import { FlashcardDeck } from './components/FlashcardDeck';
import { DocViewer } from './components/DocViewer';
import { getAdminSettings, saveAdminSettings } from './lib/userRegistry';
import { listDriveFiles } from './lib/appsScriptClient';

// Helper function to extract folder ID from Google Drive URL
function extractFolderId(url: string): string {
  if (!url) return 'root';
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (folderMatch && folderMatch[1]) {
    return folderMatch[1];
  }
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (idMatch && idMatch[1]) {
    return idMatch[1];
  }
  if (url.match(/^[a-zA-Z0-9-_]+$/)) {
    return url;
  }
  return 'root';
}

export default function App() {
  // Drive Navigation State
  const [currentFolder, setCurrentFolder] = useState<Breadcrumb>(() => {
    const settings = getAdminSettings();
    const folderId = extractFolderId(settings.driveFolderUrl);
    const folderName = settings.driveFolderUrl ? 'Repository' : 'My Folder';
    return { id: folderId, name: folderName };
  });
  
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>(() => {
    const settings = getAdminSettings();
    const folderId = extractFolderId(settings.driveFolderUrl);
    const folderName = settings.driveFolderUrl ? 'Repository' : 'My Folder';
    return [{ id: folderId, name: folderName }];
  });

  const [activeFile, setActiveFile] = useState<DriveFile | null>(null);
  const [folderFiles, setFolderFiles] = useState<DriveFile[]>([]);
  const [consolidatedRows, setConsolidatedRows] = useState<string[][] | null>(null);

  const handleOpenConsolidatedFlashcards = (folderName: string, rows: string[][]) => {
    const virtualFile: DriveFile = {
      id: 'consolidated-virtual',
      name: `Consolidated Flashcards: ${folderName}`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    };
    setConsolidatedRows(rows);
    setActiveFile(virtualFile);
    setShowGlobalHeader(true);
  };

  // Lifted Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);

  // Internet Connection State
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Global Header Scroll-Hide State
  const [showGlobalHeader, setShowGlobalHeader] = useState(true);

  // Direct Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDriveUrl, setSettingsDriveUrl] = useState('');
  const [settingsScriptUrl, setSettingsScriptUrl] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isSettingsOpen) {
      const settings = getAdminSettings();
      setSettingsDriveUrl(settings.driveFolderUrl || '');
      setSettingsScriptUrl(settings.appsScriptUrl || '');
    }
  }, [isSettingsOpen]);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    saveAdminSettings({
      driveFolderUrl: settingsDriveUrl,
      appsScriptUrl: settingsScriptUrl
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      setIsSettingsOpen(false);
    }, 1200);
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Poll admin settings for automatic syncing of Drive destination folder
  const [adminFolderId, setAdminFolderId] = useState<string>(() => {
    const settings = getAdminSettings();
    return extractFolderId(settings.driveFolderUrl);
  });

  useEffect(() => {
    const checkSettings = () => {
      const settings = getAdminSettings();
      const folderId = extractFolderId(settings.driveFolderUrl);
      if (folderId !== adminFolderId) {
        setAdminFolderId(folderId);
        const folderName = settings.driveFolderUrl ? 'Repository' : 'My Folder';
        setCurrentFolder({ id: folderId, name: folderName });
        setBreadcrumbs([{ id: folderId, name: folderName }]);
        setActiveFile(null); // Clear active file to avoid stale viewing
      }
    };

    // Run immediately
    checkSettings();

    // Check periodically to support instant syncing
    const interval = setInterval(checkSettings, 2000);
    return () => clearInterval(interval);
  }, [adminFolderId]);

  // Navigating folder down or clicking breadcrumb
  const handleNavigate = (folder: Breadcrumb, clearSearch: boolean = true) => {
    setCurrentFolder(folder);
    setShowGlobalHeader(true);
    if (clearSearch) {
      setSearchQuery('');
    }
    
    // Manage breadcrumbs history
    const idx = breadcrumbs.findIndex(b => b.id === folder.id);
    if (idx !== -1) {
      // Breadcrumb clicked, slice up to this item
      setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
    } else {
      // Navigating into folder, append to list
      setBreadcrumbs([...breadcrumbs, folder]);
    }
  };

  // Navigate back one level
  const handleNavigateBack = () => {
    if (breadcrumbs.length > 1) {
      const parentFolder = breadcrumbs[breadcrumbs.length - 2];
      setCurrentFolder(parentFolder);
      setBreadcrumbs(breadcrumbs.slice(0, breadcrumbs.length - 1));
    }
  };

  const handleFileSelect = (file: DriveFile, customBreadcrumbs?: Breadcrumb[]) => {
    // If we have custom breadcrumbs (e.g. clicked on a pinned or recent file),
    // restore the folder hierarchy address so we show where it actually lives!
    if (customBreadcrumbs && customBreadcrumbs.length > 0) {
      setBreadcrumbs(customBreadcrumbs);
      const targetFolder = customBreadcrumbs[customBreadcrumbs.length - 1];
      setCurrentFolder(targetFolder);

      // Pre-fetch folder files so that sibling documents list is loaded even when entering from a shortcut
      listDriveFiles(targetFolder.id)
        .then(filesList => {
          setFolderFiles(filesList);
        })
        .catch(err => {
          console.error('Failed to pre-fetch folder siblings for shortcut:', err);
        });
    }

    if (file.mimeType === 'application/pdf') {
      const pdfUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    setShowGlobalHeader(true);
    setActiveFile(file);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      
      {/* Upper Global Navigation Header */}
      <header className={`bg-white border-b border-slate-100 px-6 py-4 sticky top-0 z-50 shadow-[0_1px_3px_rgba(0,0,0,0.01)] transition-all duration-300 ${
        showGlobalHeader ? 'translate-y-0' : '-translate-y-full h-0 py-0 border-b-0 opacity-0 overflow-hidden pointer-events-none'
      }`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          
          {/* Brand Logo & Indicator */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div 
              onClick={() => {
                setActiveFile(null);
                setSearchQuery('');
              }}
              className="h-9 w-9 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center shadow-sm cursor-pointer transition-colors"
              title="Return to Repository"
            >
              <GraduationCap size={18} />
            </div>
            
            <div className="min-w-0">
              <span className="font-sans font-bold tracking-tight text-slate-800 text-sm block leading-tight">
                Study Interface
              </span>
              {isOnline ? (
                <span className="font-sans text-[10px] text-emerald-600 font-medium tracking-wide uppercase flex items-center gap-1 leading-none">
                  <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  online
                </span>
              ) : (
                <span className="font-sans text-[10px] text-rose-500 font-bold tracking-wide uppercase flex items-center gap-1 leading-none">
                  <span className="h-1.5 w-1.5 bg-rose-500 rounded-full animate-pulse" />
                  offline
                </span>
              )}
            </div>
          </div>

          {/* Current Active Mode / Breadcrumbs details if in Study Mode */}
          {activeFile ? (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 select-none">
              <button 
                onClick={() => setActiveFile(null)}
                className="hover:text-blue-600 font-semibold cursor-pointer font-sans transition-colors"
                title="Go back to current repository location"
              >
                Repository
              </button>
              
              {breadcrumbs.map((b, idx) => {
                // If there are many breadcrumbs, truncate middle ones with '...'
                const total = breadcrumbs.length;
                if (total > 2 && idx > 0 && idx < total - 2) {
                  if (idx === 1) {
                    return (
                      <React.Fragment key="ellipsis">
                        <ChevronRight size={12} className="text-slate-300" />
                        <span 
                          onClick={() => {
                            setCurrentFolder(breadcrumbs[0]);
                            setBreadcrumbs(breadcrumbs.slice(0, 1));
                            setActiveFile(null);
                          }}
                          className="hover:text-blue-600 cursor-pointer font-medium font-sans text-slate-400"
                          title="Click to go to Repository root"
                        >
                          ...
                        </span>
                      </React.Fragment>
                    );
                  }
                  return null;
                }

                return (
                  <React.Fragment key={b.id}>
                    <ChevronRight size={12} className="text-slate-300" />
                    <button
                      onClick={() => {
                        setCurrentFolder(b);
                        setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
                        setActiveFile(null);
                      }}
                      className="hover:text-blue-600 font-medium cursor-pointer font-sans text-slate-500 max-w-[120px] truncate transition-colors"
                      title={`Go back to folder: ${b.name}`}
                    >
                      {b.name}
                    </button>
                  </React.Fragment>
                );
              })}

              <ChevronRight size={12} className="text-slate-300" />
              <span className="text-blue-600 font-extrabold truncate max-w-[250px] font-sans bg-blue-50/50 px-2 py-0.5 border border-blue-100 rounded-md">
                {activeFile.name}
              </span>
            </div>
          ) : (
            /* Search bar moved into the upper right of the global header */
            <div className="flex items-center gap-2 shrink-0 font-sans">
              <div className="relative w-48 sm:w-64 md:w-80">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input
                  type="text"
                  placeholder={isSearchingGlobal ? "Search entire repository..." : "Search current folder..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-8 py-2 bg-slate-50 border-2 border-slate-300 focus:border-indigo-600 focus:bg-white focus:ring-1 focus:ring-indigo-600 rounded-xl font-sans text-xs font-bold text-slate-800 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[10px] font-sans font-extrabold cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsSearchingGlobal(!isSearchingGlobal)}
                className={`px-3 py-2 rounded-xl text-[10px] font-sans font-extrabold border-2 shrink-0 cursor-pointer transition-colors ${
                  isSearchingGlobal 
                    ? 'bg-indigo-50 text-indigo-600 border-indigo-300' 
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
                title="Toggle local filtering vs deep repository search"
              >
                {isSearchingGlobal ? 'Global' : 'Local'}
              </button>
            </div>
          )}

          {/* Connection Settings Toggle */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 bg-white text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-2 border-slate-300 hover:border-indigo-400 rounded-xl transition-all cursor-pointer shrink-0"
            title="Configure Connection Settings"
          >
            <Settings size={16} />
          </button>

        </div>
      </header>

      {/* Main Workspace Body wrapper - edge-to-edge for readers, centered max-w-7xl for explorer */}
      <main className={`flex-1 w-full mx-auto transition-all duration-200 ${activeFile ? 'p-0 max-w-none bg-white' : 'max-w-7xl px-6 py-8'}`}>
        {activeFile ? (
          // Study Mode Active View (Flashcard player, PDF viewer, or Doc viewer)
          (activeFile.mimeType === 'application/vnd.google-apps.spreadsheet' ||
           activeFile.mimeType === 'text/csv' ||
           activeFile.mimeType === 'application/csv' ||
           activeFile.name.toLowerCase().endsWith('.csv')) ? (
            <FlashcardDeck 
              file={activeFile} 
              breadcrumbs={breadcrumbs}
              onBack={() => { setActiveFile(null); setConsolidatedRows(null); }} 
              folderFiles={folderFiles}
              onFileSelect={handleFileSelect}
              consolidatedRows={consolidatedRows || undefined}
            />
          ) : (
            <DocViewer 
              file={activeFile} 
              breadcrumbs={breadcrumbs}
              onBack={() => {
                setActiveFile(null);
                setShowGlobalHeader(true);
              }} 
              folderFiles={folderFiles}
              onFileSelect={handleFileSelect}
              showGlobalHeader={showGlobalHeader}
              onScrollDirection={(dir) => setShowGlobalHeader(dir === 'up')}
            />
          )
        ) : (
          // File & Folder Repository mode
          <DriveExplorer
            onFileSelect={handleFileSelect}
            onOpenConsolidatedFlashcards={handleOpenConsolidatedFlashcards}
            currentFolder={currentFolder}
            breadcrumbs={breadcrumbs}
            onNavigate={handleNavigate}
            onNavigateBack={handleNavigateBack}
            onFilesLoaded={setFolderFiles}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isSearchingGlobal={isSearchingGlobal}
            setIsSearchingGlobal={setIsSearchingGlobal}
          />
        )}
      </main>

      {/* Connection Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Settings size={18} />
                </div>
                <h2 className="font-sans font-black text-slate-800 text-base">
                  Repository Connection Settings
                </h2>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-6 overflow-y-auto space-y-5 font-sans">
              
              <div className="bg-indigo-50/30 border border-indigo-100 rounded-2xl p-4 text-xs leading-relaxed text-indigo-900 font-medium">
                <p>
                  This repository connects directly to your Google Drive via a secure, client-side connection. No registration or server accounts are required. Anyone with access to this link can study your materials.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                {/* Drive Folder URL */}
                <div className="space-y-1.5">
                  <label className="block text-xs uppercase font-extrabold tracking-wider text-slate-500">
                    Google Drive Folder URL or ID
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={settingsDriveUrl}
                    onChange={(e) => setSettingsDriveUrl(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-600 focus:bg-white focus:ring-1 focus:ring-indigo-600 rounded-xl font-sans text-xs font-bold text-slate-800 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium"
                  />
                  <p className="text-[10px] text-slate-400 font-semibold leading-normal">
                    Paste the shared Google Drive folder link containing your flashcards (.csv) and documents. Make sure folder sharing is set to "Anyone with the link can view".
                  </p>
                </div>

                {/* Apps Script Web App URL */}
                <div className="space-y-1.5">
                  <label className="block text-xs uppercase font-extrabold tracking-wider text-slate-500">
                    Google Apps Script Web App URL
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={settingsScriptUrl}
                    onChange={(e) => setSettingsScriptUrl(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-600 focus:bg-white focus:ring-1 focus:ring-indigo-600 rounded-xl font-sans text-xs font-bold text-slate-800 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium"
                  />
                  <p className="text-[10px] text-slate-400 font-semibold leading-normal">
                    Required to fetch files from Google Drive securely. Copy and paste your deployed Apps Script Web App URL ending in <code className="bg-slate-100 text-slate-600 px-1 rounded">/exec</code>.
                  </p>
                </div>

                {/* Form Actions */}
                <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    {saveSuccess ? 'Saved Successfully!' : 'Save Connection'}
                  </button>
                </div>
              </form>

              {/* Interactive Setup Guide */}
              <div className="border-t border-slate-100 pt-4">
                <details className="group border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
                  <summary className="flex items-center justify-between p-3.5 text-xs font-bold text-slate-700 cursor-pointer select-none group-open:bg-slate-50">
                    <span>How to set up your Google Apps Script</span>
                    <span className="transition-transform duration-200 group-open:rotate-180 text-slate-400 font-normal">▼</span>
                  </summary>
                  <div className="p-4 bg-white border-t border-slate-100 text-[11px] text-slate-600 space-y-3 leading-relaxed">
                    <p>
                      To read documents and spreadsheets securely, we use a simple Google Apps Script as a private gateway. Follow these steps to deploy yours:
                    </p>
                    <ol className="list-decimal list-inside space-y-2 font-medium">
                      <li>
                        Open <a href="https://script.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline font-bold">Google Apps Script</a> and click <span className="font-extrabold">"New Project"</span>.
                      </li>
                      <li>
                        Delete any placeholder code and paste the repository helper script code (which lists files and extracts contents).
                      </li>
                      <li>
                        Click <span className="font-extrabold">"Deploy"</span> &gt; <span className="font-extrabold">"New deployment"</span> in the upper right.
                      </li>
                      <li>
                        Select the <span className="font-extrabold">"Web app"</span> type (click the gear icon to choose).
                      </li>
                      <li>
                        Configure the settings exactly as follows:
                        <ul className="list-disc list-inside pl-4 mt-1 font-semibold space-y-0.5 text-slate-500 text-[10px]">
                          <li>Execute as: <span className="text-slate-800">Me (your-email@gmail.com)</span></li>
                          <li>Who has access: <span className="text-slate-800">Anyone</span></li>
                        </ul>
                      </li>
                      <li>
                        Click <span className="font-extrabold">"Deploy"</span>, complete any required Google authorization prompts, and <span className="font-extrabold">copy the Web App URL</span> (must end in <span className="bg-slate-100 px-1 rounded font-mono">/exec</span>).
                      </li>
                      <li>
                        Paste the URL in the field above and save!
                      </li>
                    </ol>
                  </div>
                </details>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}
