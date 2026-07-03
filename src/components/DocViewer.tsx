/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  BookOpen, 
  Menu, 
  Settings, 
  Type, 
  Palette, 
  Maximize2, 
  Minimize2, 
  Check,
  Sparkles,
  FileText,
  ExternalLink,
  Folder,
  FileSpreadsheet
} from 'lucide-react';
import { DriveFile, DocContent, DocHeader, DocElement, Breadcrumb } from '../types';
import { getDocFileContent } from '../lib/appsScriptClient';

// Helper parser to extract links, buttons, and images from plain text or Markdown style annotations
export function parseTextWithLinks(text: string): { type: 'text' | 'link' | 'button' | 'image'; text: string; url?: string }[] {
  if (!text) return [];
  
  const segments: { type: 'text' | 'link' | 'button' | 'image'; text: string; url?: string }[] = [];
  
  // Regex to match Markdown images, Markdown links, name::link format, and plain URLs
  const regex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|([a-zA-Z0-9\s_\-()&!#?=%.]+)::(https?:\/\/[^\s]+)|(https?:\/\/[^\s/$.?#].[^\s]*)/gi;
  
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    
    // Add preceding text segment
    if (matchIndex > lastIndex) {
      segments.push({
        type: 'text',
        text: text.substring(lastIndex, matchIndex),
      });
    }
    
    if (match[1] !== undefined && match[2] !== undefined) {
      // Markdown Image
      segments.push({
        type: 'image',
        text: match[1].trim() || 'Image',
        url: match[2].trim(),
      });
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // Markdown link [Label](url)
      const label = match[3].trim();
      const url = match[4].trim();
      
      segments.push({
        type: 'button', // Force embedded links to show as buttons
        text: label,
        url: url,
      });
    } else if (match[5] !== undefined && match[6] !== undefined) {
      // name::link pattern
      const label = match[5].trim();
      const url = match[6].trim();
      
      segments.push({
        type: 'button',
        text: label,
        url: url,
      });
    } else if (match[7] !== undefined) {
      // Plain URL
      const url = match[7].trim().replace(/[.,;:!)]+$/, '');
      
      // Determine if this plain URL is an image
      const isImageUrl = /\.(png|jpg|jpeg|gif|webp|svg)/i.test(url) || 
                          url.includes('drive.google.com/thumbnail') || 
                          url.includes('googleusercontent.com');
                          
      if (isImageUrl) {
        segments.push({
          type: 'image',
          text: 'Image',
          url: url,
        });
      } else {
        segments.push({
          type: 'button', // Force plain URLs to show as buttons
          text: url,
          url: url,
        });
      }
    }
    
    lastIndex = regex.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      text: text.substring(lastIndex),
    });
  }
  
  return segments;
}

// Interactive component to display formatted runs with links, buttons, and images
export const RenderTextWithLinks: React.FC<{ text: string; isStandalone?: boolean }> = ({ text, isStandalone }) => {
  const segments = parseTextWithLinks(text);
  
  if (segments.length === 0) return null;
  
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return <span key={idx}>{seg.text}</span>;
        } else if (seg.type === 'image' && seg.url) {
          return (
            <span key={idx} className="block my-5 text-center clear-both">
              <img
                src={seg.url}
                alt={seg.text || "Study Illustration"}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[380px] rounded-2xl border-2 border-slate-300 shadow-md mx-auto object-contain bg-white p-1.5 hover:scale-[1.02] transition-transform duration-200"
              />
            </span>
          );
        } else if ((seg.type === 'button' || seg.type === 'link') && seg.url) {
          return (
            <a
              key={idx}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 mx-1 my-1 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-bold text-[11px] rounded-xl shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0 cursor-pointer align-middle border border-indigo-700/20"
            >
              <span>{seg.text}</span>
              <ExternalLink size={11} className="shrink-0" />
            </a>
          );
        }
        return null;
      })}
    </>
  );
};

interface DocViewerProps {
  accessToken?: string;
  file: DriveFile;
  breadcrumbs?: Breadcrumb[];
  onBack: () => void;
  folderFiles?: DriveFile[];
  onFileSelect?: (file: DriveFile) => void;
  showGlobalHeader?: boolean;
  onScrollDirection?: (direction: 'up' | 'down') => void;
}

export const DocViewer: React.FC<DocViewerProps> = ({ 
  accessToken, 
  file, 
  breadcrumbs, 
  onBack,
  folderFiles = [],
  onFileSelect,
  showGlobalHeader = true,
  onScrollDirection
}) => {
  const [content, setContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedHeadings, setExpandedHeadings] = useState<Record<string, boolean>>({});
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'files'>('outline');
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollTop = useRef(0);

  const parentFolder = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null;

  // Reset sidebar tab to outline when the open file changes
  useEffect(() => {
    setSidebarTab('outline');
  }, [file.id]);

  // Reading Options State
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('md');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'mono'>('serif');
  const [theme, setTheme] = useState<'light' | 'sepia' | 'dark'>('light');
  const [zenMode, setZenMode] = useState(false);
  const [showTOC, setShowTOC] = useState(true);
  const [showDocOutline, setShowDocOutline] = useState(true);

  // Scroll Progress State
  const [scrollProgress, setScrollProgress] = useState(0);

  const contentRef = useRef<HTMLDivElement>(null);

  // Fetch document contents
  useEffect(() => {
    const fetchDoc = async () => {
      setLoading(true);
      setError(null);
      try {
        const docContent = await getDocFileContent(file.id);
        setContent(docContent);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Error parsing document.');
      } finally {
        setLoading(false);
      }
    };

    fetchDoc();
  }, [file.id]);

  // Load and configure MathJax
  useEffect(() => {
    // Setup MathJax config
    (window as any).MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']]
      },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      }
    };

    // Load MathJax script
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
    script.async = true;
    script.id = 'mathjax-script';
    document.head.appendChild(script);

    return () => {
      const existingScript = document.getElementById('mathjax-script');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

  // Re-run MathJax typesetting when content changes
  useEffect(() => {
    if (!loading && content) {
      const timer = setTimeout(() => {
        try {
          if ((window as any).MathJax && (window as any).MathJax.typeset) {
            (window as any).MathJax.typeset();
          }
        } catch (e) {
          console.warn('MathJax typesetting failed:', e);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [content, loading]);

  // Track scrolling progress and direction to hide/show headers
  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;
      const element = contentRef.current;
      const scrollTop = element.scrollTop;
      const totalHeight = element.scrollHeight - element.clientHeight;
      if (totalHeight > 0) {
        const progress = (scrollTop / totalHeight) * 100;
        setScrollProgress(progress);
      }

      // Hide headers on scroll down, show on scroll up
      if (scrollTop > lastScrollTop.current && scrollTop > 60) {
        setShowHeader(false);
        if (onScrollDirection) onScrollDirection('down');
      } else if (scrollTop < lastScrollTop.current) {
        setShowHeader(true);
        if (onScrollDirection) onScrollDirection('up');
      }
      lastScrollTop.current = scrollTop;
    };

    const element = contentRef.current;
    if (element) {
      element.addEventListener('scroll', handleScroll);
    }

    return () => {
      if (element) {
        element.removeEventListener('scroll', handleScroll);
      }
    };
  }, [content, onScrollDirection]);

  // Click handler to scroll to headings smoothly
  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Map theme variables
  const themeClasses = {
    light: 'bg-white text-slate-800 border-slate-100',
    sepia: 'bg-[#fbf0db] text-amber-950 border-[#ecdcb6]',
    dark: 'bg-[#1a1a1e] text-slate-200 border-zinc-800'
  };

  const wrapperThemeClasses = {
    light: 'bg-slate-50',
    sepia: 'bg-[#f4e4c1]',
    dark: 'bg-[#101012]'
  };

  const fontClasses = {
    sans: 'font-sans',
    serif: 'font-serif leading-relaxed tracking-wide',
    mono: 'font-mono text-xs'
  };

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg md:text-xl',
    xl: 'text-xl md:text-2xl'
  };

  const getEffectiveFile = (f: DriveFile) => {
    const isShortcut = f.mimeType === 'application/vnd.google-apps.shortcut';
    const targetId = isShortcut ? (f as any).shortcutDetails?.targetId || f.id : f.id;
    const targetMimeType = isShortcut ? (f as any).shortcutDetails?.targetMimeType || '' : f.mimeType;
    return { id: targetId, mimeType: targetMimeType };
  };

  const isFlashcardMime = (f: DriveFile) => {
    const eff = getEffectiveFile(f);
    const mime = eff.mimeType || '';
    const name = f.name || '';
    return (
      mime === 'application/vnd.google-apps.spreadsheet' ||
      mime === 'text/csv' ||
      mime === 'application/csv' ||
      name.toLowerCase().endsWith('.csv')
    );
  };

  const isPdfMime = (f: DriveFile) => {
    const eff = getEffectiveFile(f);
    return eff.mimeType === 'application/pdf';
  };

  const sidebarFiles = (folderFiles || []).filter(f => {
    const nameLower = f.name.toLowerCase();
    const eff = getEffectiveFile(f);
    const isInfoDoc = nameLower === 'info' && eff.mimeType === 'application/vnd.google-apps.document';
    const isInfoTxt = (nameLower === 'info' || nameLower === 'info.txt') && eff.mimeType === 'text/plain';
    const isPlainOtherTxt = eff.mimeType === 'text/plain';
    const isFolder = eff.mimeType === 'application/vnd.google-apps.folder';
    return !isInfoDoc && !isInfoTxt && !isPlainOtherTxt && !isFolder;
  });

  const toggleHeading = (id: string) => {
    setExpandedHeadings(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const hasSublevels = (index: number) => {
    if (!content) return false;
    const nextHeader = content.headers[index + 1];
    return nextHeader && nextHeader.level > 1;
  };

  const renderDocumentOutline = () => {
    if (!content || content.headers.length === 0) {
      return (
        <div className="pl-3 text-[11px] text-slate-400 italic">
          No heading outline found
        </div>
      );
    }

    return (
      <div className="pl-4 border-l-2 border-indigo-200 ml-2 space-y-2">
        {content.headers.map((h, idx) => {
          const indentClass = h.level === 1 ? '' : h.level === 2 ? 'pl-3.5' : 'pl-7';
          const textClass = h.level === 1 
            ? 'font-bold text-slate-800 hover:text-indigo-600 text-[13px] md:text-sm' 
            : h.level === 2 
              ? 'font-semibold text-slate-600 hover:text-indigo-600 text-[11px] md:text-xs' 
              : 'font-medium text-slate-500 hover:text-indigo-600 text-[10px] md:text-[11px]';
          
          return (
            <button
              key={`${h.id}-${idx}`}
              onClick={() => scrollToHeading(h.id)}
              className={`w-full text-left font-sans ${indentClass} ${textClass} hover:bg-slate-100/50 py-1.5 px-2 rounded-xl transition-all cursor-pointer truncate block`}
              title={h.text}
            >
              {h.level > 1 && <span className="text-slate-300 mr-1.5">•</span>}
              {h.text}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    /* Changed height, borders, and rounded edges to take up the full page */
    <div className={`flex flex-col ${showGlobalHeader ? 'h-[calc(100vh-73px)]' : 'h-screen'} border-none rounded-none overflow-hidden transition-all duration-300 shadow-none w-full ${wrapperThemeClasses[theme]}`}>
      
      {/* Scroll Progress Bar */}
      <div className="w-full h-1 bg-slate-100/50 shrink-0">
        <div 
          className="h-full bg-indigo-600 transition-all duration-100"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Viewer Header */}
      <div className={`transition-all duration-300 overflow-hidden ${
        showHeader ? 'h-auto py-4 border-b opacity-100' : 'h-0 py-0 border-none opacity-0 pointer-events-none'
      } flex flex-wrap items-center justify-between px-6 shrink-0 gap-3 ${
        theme === 'sepia' 
          ? 'bg-[#fbf0db] border-[#ecdcb6] text-amber-950' 
          : theme === 'dark'
            ? 'bg-[#1a1a1e] border-zinc-800 text-slate-100'
            : 'bg-white border-slate-100 text-slate-800'
      }`}>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-100 border-2 border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 cursor-pointer transition-all shrink-0"
            title="Go back to explorer"
          >
            <ArrowLeft size={15} />
          </button>
          
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="text-indigo-600 shrink-0" size={18} />
            <h2 className="font-sans font-extrabold text-sm truncate max-w-[200px] md:max-w-md">
              {content?.title || file.name}
            </h2>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2.5">
          {/* External Link to Doc */}
          {file.webViewLink && (
            <a
              href={file.webViewLink}
              target="_blank"
              referrerPolicy="no-referrer"
              className="p-2 rounded-xl border-2 border-slate-300 bg-white text-slate-600 hover:text-indigo-600 hover:border-indigo-600 cursor-pointer transition-colors flex items-center justify-center shadow-sm"
              title="Open in Google Drive"
            >
              <ExternalLink size={14} />
            </a>
          )}

          {/* Font Family selector */}
          <div className="flex items-center border-2 border-slate-300 rounded-xl overflow-hidden bg-slate-100 p-0.5">
            <button
              onClick={() => setFontFamily('sans')}
              className={`px-3 py-1 text-xs font-sans font-bold rounded-lg cursor-pointer transition-all ${
                fontFamily === 'sans' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Sans
            </button>
            <button
              onClick={() => setFontFamily('serif')}
              className={`px-3 py-1 text-xs font-serif font-bold rounded-lg cursor-pointer transition-all ${
                fontFamily === 'serif' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Serif
            </button>
          </div>

          {/* Font Size controls */}
          <div className="flex items-center border-2 border-slate-300 rounded-xl bg-slate-100 p-0.5">
            <button
              onClick={() => {
                if (fontSize === 'xl') setFontSize('lg');
                else if (fontSize === 'lg') setFontSize('md');
                else if (fontSize === 'md') setFontSize('sm');
              }}
              disabled={fontSize === 'sm'}
              className="px-2.5 py-1 text-xs font-extrabold text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
              title="Decrease Font"
            >
              A-
            </button>
            <span className="text-[10px] font-mono px-1 font-extrabold text-slate-600">
              {fontSize.toUpperCase()}
            </span>
            <button
              onClick={() => {
                if (fontSize === 'sm') setFontSize('md');
                else if (fontSize === 'md') setFontSize('lg');
                else if (fontSize === 'lg') setFontSize('xl');
              }}
              disabled={fontSize === 'xl'}
              className="px-2.5 py-1 text-xs font-extrabold text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
              title="Increase Font"
            >
              A+
            </button>
          </div>

          {/* Color Themes */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTheme('light')}
              className={`h-6 w-6 rounded-full border-2 border-slate-300 bg-white cursor-pointer relative flex items-center justify-center`}
              title="Light mode"
            >
              {theme === 'light' && <Check size={10} className="text-slate-800" />}
            </button>
            <button
              onClick={() => setTheme('sepia')}
              className={`h-6 w-6 rounded-full border-2 border-[#ecdcb6] bg-[#fbf0db] cursor-pointer relative flex items-center justify-center`}
              title="Warm Sepia"
            >
              {theme === 'sepia' && <Check size={10} className="text-amber-950" />}
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`h-6 w-6 rounded-full border-2 border-zinc-700 bg-[#1e1e24] cursor-pointer relative flex items-center justify-center`}
              title="Dark Mode"
            >
              {theme === 'dark' && <Check size={10} className="text-white" />}
            </button>
          </div>

          {/* Toggle TOC */}
          {content && (
            <button
              onClick={() => setShowTOC(!showTOC)}
              className={`p-2 rounded-xl border-2 cursor-pointer transition-colors ${
                showTOC 
                  ? 'bg-indigo-50 text-indigo-600 border-indigo-400' 
                  : 'bg-white text-slate-500 border-slate-300 hover:text-slate-700 hover:border-slate-400'
              }`}
              title="Toggle Table of Contents"
            >
              <Menu size={14} />
            </button>
          )}

          {/* Zen Toggle */}
          <button
            onClick={() => {
              setZenMode(!zenMode);
              if (!zenMode) {
                setShowTOC(false);
              } else {
                setShowTOC(true);
              }
            }}
            className={`p-2 rounded-xl border-2 cursor-pointer hover:bg-slate-50 ${
              zenMode ? 'bg-indigo-50 border-indigo-400 text-indigo-600' : 'bg-white text-slate-500 border-slate-300'
            }`}
            title="Toggle Zen focus mode"
          >
            {zenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* 1. Sidebar Table of Contents */}
        {showTOC && !loading && !error && (
          <div className="w-64 border-r-2 border-slate-200 bg-white shrink-0 overflow-y-auto p-5 hidden md:block text-slate-700 shadow-sm">
            <div className="mb-4">
              <button
                onClick={onBack}
                className="text-xs text-[#1d4ed8] hover:text-blue-800 font-extrabold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft size={12} /> Back to Repository
              </button>
            </div>

            {/* Elegant high-contrast tab controls inside Sidebar when file is open */}
            <div className="flex bg-slate-100 p-1 rounded-xl mb-4 border border-slate-200 select-none">
              <button
                type="button"
                onClick={() => setSidebarTab('outline')}
                className={`flex-1 text-center py-1.5 px-1.5 rounded-lg text-[11px] font-black font-sans transition-all cursor-pointer ${
                  sidebarTab === 'outline'
                    ? 'bg-white text-[#1d4ed8] shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Outline
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('files')}
                className={`flex-1 text-center py-1.5 px-1.5 rounded-lg text-[11px] font-black font-sans transition-all cursor-pointer ${
                  sidebarTab === 'files'
                    ? 'bg-white text-[#1d4ed8] shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Folder Files
              </button>
            </div>

            {sidebarTab === 'outline' ? (
              <div className="space-y-3">
                {renderDocumentOutline()}
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="font-sans font-black text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2" title={parentFolder?.name || 'Folder Contents'}>
                  <Folder size={14} className="text-[#2563eb]" /> {parentFolder?.name?.toUpperCase() || 'FOLDER CONTENTS'}
                </h3>
                
                <div className="space-y-1.5">
                  {sidebarFiles.length > 0 ? (
                    sidebarFiles.map(f => {
                      const isCurrent = f.id === file.id;
                      const isSheet = isFlashcardMime(f);
                      const isPdf = isPdfMime(f);

                      return (
                        <button
                          key={f.id}
                          onClick={() => {
                            if (!isCurrent && onFileSelect) {
                              onFileSelect(f);
                            }
                          }}
                          className={`w-full text-left font-sans text-xs flex items-center gap-2 transition-all cursor-pointer ${
                            isCurrent 
                              ? 'font-extrabold text-[#1d4ed8] bg-[#eff6ff] border border-[#dbeafe] px-4 py-2.5 rounded-full shadow-sm' 
                              : 'text-slate-700 hover:text-indigo-700 hover:bg-slate-100/50 px-2 py-1.5 rounded-lg'
                          }`}
                          title={f.name}
                        >
                          {isSheet ? (
                            <FileSpreadsheet size={14} className={isCurrent ? "text-[#1d4ed8] font-bold" : "text-emerald-600"} />
                          ) : isPdf ? (
                            <FileText size={14} className={isCurrent ? "text-[#1d4ed8]" : "text-rose-500"} />
                          ) : (
                            <FileText size={14} className={isCurrent ? "text-[#1d4ed8]" : "text-indigo-600"} />
                          )}
                          <span className="truncate">{f.name}</span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="space-y-1">
                      <button
                        onClick={() => setSidebarTab('outline')}
                        className="w-full text-left font-sans text-xs flex items-center gap-2 px-4 py-2.5 rounded-full font-extrabold text-[#1d4ed8] bg-[#eff6ff] border border-[#dbeafe] shadow-sm transition-all cursor-pointer"
                      >
                        <FileText size={14} className="text-[#1d4ed8] shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. Main Reader Document Container */}
        <div 
          ref={contentRef}
          className={`flex-1 overflow-y-auto px-6 py-10 md:px-16 md:py-16 transition-colors duration-200 ${themeClasses[theme]}`}
        >
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="h-8 w-8 border-3 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="font-sans text-xs text-slate-500 font-bold">Extracting study documents...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center gap-3">
              <div className="text-3xl">⚠️</div>
              <h4 className="font-sans font-bold text-sm text-red-500">Failed to render Doc</h4>
              <p className="font-sans text-xs text-slate-500">{error}</p>
              <button
                onClick={onBack}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-sans font-bold hover:bg-indigo-700 cursor-pointer"
              >
                Go Back
              </button>
            </div>
          )}

          {/* Rendered elements with full markdown hyperlinking & action button rendering support */}
          {!loading && !error && content && (
            <div className={`max-w-3xl mx-auto space-y-6 tex2jax_process ${fontClasses[fontFamily]} ${sizeClasses[fontSize]}`}>
              
              {/* Document Title header */}
              <div className={`border-b-2 border-dashed pb-5 mb-8 ${theme === 'dark' ? 'border-zinc-800' : 'border-slate-200'}`}>
                <span className="font-sans font-extrabold text-[10px] uppercase tracking-widest text-indigo-700 bg-indigo-100 rounded-full px-3 py-1 border border-indigo-200">
                  📚 STUDY DOCUMENT
                </span>
                <h1 className={`font-sans font-black text-3xl md:text-4xl tracking-tight mt-3 leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                  {content.title}
                </h1>
              </div>

              {content.elements.map((el, idx) => {
                switch (el.type) {
                  case 'heading':
                    if (el.level === 1) {
                      return (
                        <h2 
                          key={idx} 
                          id={el.id}
                          className={`font-sans font-black text-2xl tracking-tight mt-10 mb-4 border-b-2 pb-2 pt-4 ${
                            theme === 'dark' ? 'text-white border-zinc-800' : 'text-slate-900 border-slate-200'
                          }`}
                        >
                          <RenderTextWithLinks text={el.text || ''} />
                        </h2>
                      );
                    } else if (el.level === 2) {
                      return (
                        <h3 
                          key={idx} 
                          id={el.id}
                          className={`font-sans font-extrabold text-xl tracking-tight mt-8 mb-3 pt-2 ${
                            theme === 'dark' ? 'text-slate-100' : 'text-slate-900'
                          }`}
                        >
                          <RenderTextWithLinks text={el.text || ''} />
                        </h3>
                      );
                    } else {
                      return (
                        <h4 
                          key={idx} 
                          id={el.id}
                          className={`font-sans font-bold text-lg mt-6 mb-2 ${
                            theme === 'dark' ? 'text-slate-200' : 'text-slate-900'
                          }`}
                        >
                          <RenderTextWithLinks text={el.text || ''} />
                        </h4>
                      );
                    }

                  case 'list_item':
                    const indent = el.level || 0;
                    return (
                      <div 
                        key={idx} 
                        className={`flex items-start gap-2.5 my-2.5`}
                        style={{ paddingLeft: `${indent * 1.5}rem` }}
                      >
                        <span className="text-indigo-600 select-none mt-1.5 font-bold">•</span>
                        <p className={`flex-1 leading-relaxed ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                          <RenderTextWithLinks text={el.text || ''} />
                        </p>
                      </div>
                    );

                  case 'table':
                    return (
                      <div key={idx} className={`overflow-x-auto my-6 border-2 rounded-xl shadow-sm ${theme === 'dark' ? 'border-zinc-800' : 'border-slate-300'}`}>
                        <table className="min-w-full divide-y text-xs divide-slate-300">
                          <tbody className={`divide-y divide-slate-200 ${theme === 'dark' ? 'bg-[#222226]/40' : 'bg-white/40'}`}>
                            {el.tableRows?.map((row, rIdx) => (
                              <tr key={rIdx} className={rIdx % 2 === 0 ? (theme === 'dark' ? 'bg-zinc-900/30' : 'bg-slate-50/20') : ''}>
                                {row.map((cellText, cIdx) => (
                                  <td 
                                    key={cIdx} 
                                    className={`px-4 py-3 font-sans border-r last:border-r-0 max-w-xs break-words font-semibold ${
                                      theme === 'dark' ? 'text-slate-300 border-zinc-800' : 'text-slate-700 border-slate-200'
                                    }`}
                                  >
                                    <RenderTextWithLinks text={cellText || ''} />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );

                  case 'image':
                    return el.imageUrl ? (
                      <div key={idx} className="block my-5 text-center clear-both">
                        <img
                          src={el.imageUrl}
                          alt={el.text || "Study Illustration"}
                          referrerPolicy="no-referrer"
                          className={`max-w-full max-h-[420px] rounded-2xl border-2 shadow-md mx-auto object-contain bg-white p-1.5 hover:scale-[1.02] transition-transform duration-200 animate-fade-in ${
                            theme === 'dark' ? 'border-zinc-800' : 'border-slate-300'
                          }`}
                        />
                        {el.text && (
                          <p className="text-xs text-slate-400 mt-2 font-medium italic">
                            {el.text}
                          </p>
                        )}
                      </div>
                    ) : null;

                  case 'paragraph':
                  default:
                    return (
                      <p key={idx} className={`leading-relaxed my-4 text-justify ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                        <RenderTextWithLinks text={el.text || ''} isStandalone={true} />
                      </p>
                    );
                }
              })}

              <div className="pt-12 text-center text-xs text-slate-400 font-sans flex items-center justify-center gap-1 font-bold">
                <Sparkles size={13} className="text-amber-500" /> End of Study Document.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
