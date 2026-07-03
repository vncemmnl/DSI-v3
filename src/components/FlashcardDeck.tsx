/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Sparkles, 
  RotateCcw, 
  Shuffle, 
  Check, 
  X, 
  HelpCircle, 
  Columns, 
  Layers, 
  Award, 
  Flame, 
  Clock, 
  BookOpen,
  Volume2,
  Folder,
  FileSpreadsheet,
  FileText,
  Menu,
  Search,
  Eye,
  EyeOff,
  Play,
  SlidersHorizontal
} from 'lucide-react';
import { DriveFile, Flashcard, StudyStats, Breadcrumb } from '../types';
import { getSpreadsheetData, appsScriptRequest } from '../lib/appsScriptClient';

export const LEITNER_BOX_NAMES: Record<number, string> = {
  1: "New / Unfamiliar",
  2: "Just Learning",
  3: "Growing / Familiar",
  4: "Proficient / Strong",
  5: "Fully Mastered"
};

// Robust RFC 4180 compliant CSV parser
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuote) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"';
          i++; // Skip the second quote
        } else {
          insideQuote = false;
        }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') {
        insideQuote = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n' || char === '\r') {
        row.push(cell);
        cell = '';
        if (row.length > 0 || cell !== '') {
          lines.push(row);
        }
        row = [];
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip the \n part of \r\n
        }
      } else {
        cell += char;
      }
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    lines.push(row);
  }

  return lines.filter(r => r.some(c => c.trim() !== ''));
}

const cardVariants = {
  enter: (dir: 'left' | 'right' | 'none') => ({
    x: dir === 'right' ? -250 : dir === 'left' ? 250 : 0,
    opacity: 0,
    scale: 0.98
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: { duration: 0.22, ease: 'easeOut' }
  },
  exit: (dir: 'left' | 'right' | 'none') => ({
    x: dir === 'right' ? 250 : dir === 'left' ? -250 : 0,
    opacity: 0,
    scale: 0.98,
    transition: { duration: 0.18, ease: 'easeIn' }
  })
};

const MathJaxText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mj = (window as any).MathJax;
    if (containerRef.current) {
      containerRef.current.textContent = text;
      
      if (mj) {
        const timer = setTimeout(() => {
          try {
            if (mj.typesetClear) {
              mj.typesetClear([containerRef.current]);
            }
            if (mj.typesetPromise) {
              mj.typesetPromise([containerRef.current]).catch((err: any) => {
                console.warn('MathJaxText typesetting error:', err);
              });
            } else if (mj.typeset) {
              mj.typeset([containerRef.current]);
            }
          } catch (e) {
            console.warn('MathJaxText typesetting exception:', e);
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [text]);

  return (
    <div 
      ref={containerRef} 
      className={`tex2jax_process inline-block ${className || ''}`}
    />
  );
};

interface FlashcardDeckProps {
  file: DriveFile;
  breadcrumbs?: Breadcrumb[];
  onBack: () => void;
  folderFiles?: DriveFile[];
  onFileSelect?: (file: DriveFile) => void;
  consolidatedRows?: string[][];
}

export const FlashcardDeck: React.FC<FlashcardDeckProps> = ({ 
  file, 
  breadcrumbs, 
  onBack,
  folderFiles = [],
  onFileSelect,
  consolidatedRows
}) => {
  // Sheet state
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  
  // Mapping state
  const [hasHeader, setHasHeader] = useState(true);
  const [frontCol, setFrontCol] = useState<number>(0);
  const [backCol, setBackCol] = useState<number>(1);
  const [hintCol, setHintCol] = useState<number>(-1);
  const [isSetup, setIsSetup] = useState(false);

  // Studying state
  const [allParsedCards, setAllParsedCards] = useState<Flashcard[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [studyStats, setStudyStats] = useState<StudyStats>({
    correctCount: 0,
    incorrectCount: 0,
    currentStreak: 0,
    maxStreak: 0,
    startTime: Date.now(),
    wrongCards: []
  });
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const cardContentRef = useRef<HTMLDivElement>(null);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | 'none'>('none');

  // Spaced Repetition and View Mode states
  const [studyMode, setStudyMode] = useState<'flashcard' | 'table'>('flashcard');
  const [spacedRepActive, setSpacedRepActive] = useState<boolean>(true); // default to enabled!
  const [spacedRepRecords, setSpacedRepRecords] = useState<Record<string, { box: number; attempts: number; corrects: number; lastTime: number }>>({});
  const [studyFocus, setStudyFocus] = useState<string>('all');

  // Table View states
  const [tableSearch, setTableSearch] = useState('');
  const [revealedRows, setRevealedRows] = useState<Record<string, boolean>>({});
  const [revealAllAnswers, setRevealAllAnswers] = useState(false);
  const [tableBoxFilter, setTableBoxFilter] = useState<string>('all');

  // Load spaced repetition records
  useEffect(() => {
    const key = `study_hub_spaced_rep_${file.id}_${selectedSheet || 'default'}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        setSpacedRepRecords(JSON.parse(stored));
      } else {
        setSpacedRepRecords({});
      }
    } catch (e) {
      setSpacedRepRecords({});
    }
  }, [file.id, selectedSheet]);

  // Update spaced repetition records helper
  const updateSpacedRep = (front: string, back: string, correct: boolean) => {
    const key = `${front}||${back}`;
    const storageKey = `study_hub_spaced_rep_${file.id}_${selectedSheet || 'default'}`;
    
    setSpacedRepRecords(prev => {
      const current = prev[key] || { box: 1, attempts: 0, corrects: 0, lastTime: Date.now() };
      let newBox = current.box;
      if (correct) {
        newBox = Math.min(5, current.box + 1);
      } else {
        newBox = 1; // Drop to box 1 in Leitner
      }
      
      const updated = {
        ...prev,
        [key]: {
          box: newBox,
          attempts: current.attempts + 1,
          corrects: current.corrects + (correct ? 1 : 0),
          lastTime: Date.now()
        }
      };
      
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage quota exceeded for spaced repetition.', e);
      }
      
      return updated;
    });
  };

  // Set card box directly helper
  const setCardBoxDirectly = (front: string, back: string, box: number) => {
    const key = `${front}||${back}`;
    const storageKey = `study_hub_spaced_rep_${file.id}_${selectedSheet || 'default'}`;
    
    setSpacedRepRecords(prev => {
      const current = prev[key] || { box: 1, attempts: 0, corrects: 0, lastTime: Date.now() };
      const updated = {
        ...prev,
        [key]: {
          ...current,
          box: box,
          lastTime: Date.now()
        }
      };
      
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage quota exceeded for spaced repetition.', e);
      }
      
      return updated;
    });
  };

  // Apply study focus filter to current active cards
  const applyStudyFocus = (focus: string, active: boolean) => {
    setStudyFocus(focus);
    if (!active || focus === 'all') {
      setCards(allParsedCards);
      setCurrentIndex(0);
      setIsFlipped(false);
      setShowHint(false);
      return;
    }

    let filtered = [...allParsedCards];
    if (focus === 'weak') {
      filtered = allParsedCards.filter(c => {
        const key = `${c.front}||${c.back}`;
        const box = spacedRepRecords[key]?.box || 1;
        return box === 1 || box === 2;
      });
    } else if (focus.startsWith('box')) {
      const boxNum = parseInt(focus.replace('box', ''), 10);
      filtered = allParsedCards.filter(c => {
        const key = `${c.front}||${c.back}`;
        const box = spacedRepRecords[key]?.box || 1;
        return box === boxNum;
      });
    }

    setCards(filtered);
    setCurrentIndex(0);
    setIsFlipped(false);
    setShowHint(false);
  };

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'files'>('outline');

  // Reset sidebar tab to outline when the open file changes
  useEffect(() => {
    setSidebarTab('outline');
  }, [file.id]);

  // Timer reference
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch spreadsheet or CSV data
  useEffect(() => {
    const fetchSheetValues = async () => {
      setLoading(true);
      setError(null);
      try {
        if (consolidatedRows) {
          setSheets(['Consolidated']);
          setSelectedSheet('Consolidated');
          setRawRows(consolidatedRows);
          if (consolidatedRows.length > 0) {
            const colCount = Math.max(...consolidatedRows.map(r => r.length), 2);
            const colLetters: string[] = [];
            for (let i = 0; i < colCount; i++) {
              colLetters.push(String.fromCharCode(65 + i));
            }
            setColumns(colLetters);
            autoMapColumns(consolidatedRows);
          } else {
            throw new Error(`The consolidated card deck is empty.`);
          }
          return;
        }

        const isCsv = file.mimeType === 'text/csv' || 
                      file.mimeType === 'application/csv' || 
                      file.name.toLowerCase().endsWith('.csv');

        if (isCsv) {
          const res = await appsScriptRequest('getFileContent', { fileId: file.id });
          const text = res.text || '';
          const rows = parseCSV(text);
          setSheets(['Main']);
          setSelectedSheet('Main');
          setRawRows(rows);

          if (rows.length > 0) {
            const colCount = Math.max(...rows.map(r => r.length), 2);
            const colLetters: string[] = [];
            for (let i = 0; i < colCount; i++) {
              colLetters.push(String.fromCharCode(65 + i));
            }
            setColumns(colLetters);
            autoMapColumns(rows);
          } else {
            throw new Error(`The CSV file is empty.`);
          }
        } else {
          const data = await getSpreadsheetData(file.id, selectedSheet || undefined);
          
          // Save sheets list
          if (data.sheets && data.sheets.length > 0) {
            setSheets(data.sheets);
            if (!selectedSheet) {
              setSelectedSheet(data.sheets[0]);
            }
          }

          // Save sheet values
          const rows = data.values || [];
          setRawRows(rows);

          if (rows.length > 0) {
            const colCount = Math.max(...rows.map(r => r.length), 2);
            const colLetters: string[] = [];
            for (let i = 0; i < colCount; i++) {
              colLetters.push(String.fromCharCode(65 + i)); // A, B, C...
            }
            setColumns(colLetters);
            autoMapColumns(rows);
          } else if (selectedSheet) {
            throw new Error(`The sheet tab "${selectedSheet}" is empty.`);
          }
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to read spreadsheet or CSV cells.');
      } finally {
        setLoading(false);
      }
    };

    fetchSheetValues();
  }, [file.id, selectedSheet, consolidatedRows]);

  // 2. Timer for active study session
  useEffect(() => {
    if (isSetup && !sessionCompleted) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isSetup, sessionCompleted]);

  // Auto-mapping logic
  const autoMapColumns = (rows: string[][]) => {
    if (rows.length === 0) return;
    
    // Make column A the front of card, column B back of card, and column C hint if there is
    const derivedFront = 0;
    const derivedBack = 1;
    const maxCols = Math.max(...rows.map(r => r.length), 0);
    const derivedHint = maxCols >= 3 ? 2 : -1;

    setFrontCol(derivedFront);
    setBackCol(derivedBack);
    setHintCol(derivedHint);
  };

  // 1.5. Automatic Start Study Session on row loaded
  useEffect(() => {
    if (rawRows.length > 0 && !isSetup && !sessionCompleted) {
      // Determine columns to map: A (0), B (1), C (2) if exists
      const derivedFront = 0;
      const derivedBack = 1;
      const maxCols = Math.max(...rawRows.map(r => r.length), 0);
      const derivedHint = maxCols >= 3 ? 2 : -1;

      setFrontCol(derivedFront);
      setBackCol(derivedBack);
      setHintCol(derivedHint);

      // Check if first row is headers (e.g., contains "front", "back", "term", "word", etc.)
      const firstRow = rawRows[0];
      const isHeaderRow = firstRow && firstRow.some(cell => {
        const c = String(cell).toLowerCase().trim();
        return c === 'front' || c === 'back' || c === 'term' || c === 'word' || c === 'definition' || c === 'hint' || c === 'translation';
      });
      const startRowIdx = isHeaderRow ? 1 : 0;
      setHasHeader(isHeaderRow);

      const formattedCards: Flashcard[] = [];

      for (let i = startRowIdx; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const frontText = row[derivedFront] || '';
        const backText = row[derivedBack] || '';
        const hintText = derivedHint >= 0 ? row[derivedHint] : undefined;

        if (!frontText.trim() && !backText.trim()) continue;

        formattedCards.push({
          id: `card-${i}-${Date.now()}`,
          front: frontText,
          back: backText,
          hint: hintText
        });
      }

      if (formattedCards.length > 0) {
        setAllParsedCards(formattedCards);
        setCards(formattedCards);
        setCurrentIndex(0);
        setIsFlipped(false);
        setShowHint(false);
        setElapsedSeconds(0);
        setStudyStats({
          correctCount: 0,
          incorrectCount: 0,
          currentStreak: 0,
          maxStreak: 0,
          startTime: Date.now(),
          wrongCards: []
        });
        setSessionCompleted(false);
        setIsSetup(true);
      }
    }
  }, [rawRows]);

  // Convert raw sheets rows to flashcards
  const handleLaunchSession = () => {
    if (rawRows.length === 0) return;

    const startRowIdx = hasHeader ? 1 : 0;
    const formattedCards: Flashcard[] = [];

    for (let i = startRowIdx; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.length === 0) continue;

      const frontText = row[frontCol] || '';
      const backText = row[backCol] || '';
      const hintText = hintCol >= 0 ? row[hintCol] : undefined;

      if (!frontText.trim() && !backText.trim()) continue;

      formattedCards.push({
        id: `card-${i}-${Date.now()}`,
        front: frontText,
        back: backText,
        hint: hintText
      });
    }

    if (formattedCards.length === 0) {
      setError('Could not parse any valid flashcards. Make sure your columns contain text.');
      return;
    }

    setAllParsedCards(formattedCards);
    setCards(formattedCards);
    setCurrentIndex(0);
    setIsFlipped(false);
    setShowHint(false);
    setSlideDirection('none');
    setElapsedSeconds(0);
    setStudyStats({
      correctCount: 0,
      incorrectCount: 0,
      currentStreak: 0,
      maxStreak: 0,
      startTime: Date.now(),
      wrongCards: []
    });
    setSessionCompleted(false);
    setIsSetup(true);
  };

  // Keyboard shortcut listener for active deck sessions
  useEffect(() => {
    if (!isSetup || sessionCompleted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped(prev => !prev);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        handleResponse(true);
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        handleResponse(false);
      } else if (e.code === 'KeyH') {
        setShowHint(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSetup, currentIndex, isFlipped, cards, sessionCompleted]);

  // MathJax typesetting trigger effect
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj) {
      const timer = setTimeout(() => {
        try {
          const container = cardContentRef.current;
          if (container) {
            if (mj.typesetClear) {
              mj.typesetClear([container]);
            }
            if (mj.typesetPromise) {
              mj.typesetPromise([container]).catch((err: any) => {
                console.warn('MathJax container typesetPromise error:', err);
              });
            } else if (mj.typeset) {
              mj.typeset([container]);
            }
          } else {
            // Fallback to global typesetting if ref is not ready or in table mode
            if (mj.typesetClear) {
              mj.typesetClear();
            }
            if (mj.typesetPromise) {
              mj.typesetPromise().catch((err: any) => {
                console.warn('MathJax global typesetPromise error:', err);
              });
            } else if (mj.typeset) {
              mj.typeset();
            }
          }
        } catch (e) {
          console.warn('MathJax typesetting failed:', e);
        }
      }, 100);
      return () => clearTimeout(timer); 
    }
  }, [currentIndex, isFlipped, cards, showHint, isSetup, sessionCompleted, studyMode, tableSearch, tableBoxFilter]);

  const handleResponse = (correct: boolean) => {
    const currentCard = cards[currentIndex];
    if (!currentCard) return;

    if (spacedRepActive) {
      updateSpacedRep(currentCard.front, currentCard.back, correct);
    }
    
    setStudyStats(prev => {
      const nextStreak = correct ? prev.currentStreak + 1 : 0;
      const nextWrongCards = correct 
        ? prev.wrongCards.filter(id => id !== currentCard.id) 
        : prev.wrongCards.includes(currentCard.id) ? prev.wrongCards : [...prev.wrongCards, currentCard.id];
      
      return {
        ...prev,
        correctCount: prev.correctCount + (correct ? 1 : 0),
        incorrectCount: prev.incorrectCount + (correct ? 0 : 1),
        currentStreak: nextStreak,
        maxStreak: Math.max(prev.maxStreak, nextStreak),
        wrongCards: nextWrongCards
      };
    });

    // Set direction for slide-out animation
    setSlideDirection(correct ? 'right' : 'left');

    // Advance index or trigger completion report
    if (currentIndex < cards.length - 1) {
      setIsFlipped(false);
      setShowHint(false);
      setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
      }, 200);
    } else {
      setTimeout(() => {
        setSessionCompleted(true);
      }, 200);
    }
  };

  // Shuffle Cards Utility
  const handleShuffleDeck = () => {
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    setCards(shuffled);
    setCurrentIndex(0);
    setIsFlipped(false);
    setShowHint(false);
    setSlideDirection('none');
  };

  // Text to speech utility
  const speakWord = (text: string) => {
    if ('speechSynthesis' in window) {
      // Cancel previous utterances to avoid speech stacking
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Review trouble cards helper
  const handleReviewTroubleCards = () => {
    const troubleCards = cards.filter(c => studyStats.wrongCards.includes(c.id));
    if (troubleCards.length === 0) return;

    setCards(troubleCards);
    setCurrentIndex(0);
    setIsFlipped(false);
    setShowHint(false);
    setElapsedSeconds(0);
    setStudyStats({
      correctCount: 0,
      incorrectCount: 0,
      currentStreak: 0,
      maxStreak: 0,
      startTime: Date.now(),
      wrongCards: []
    });
    setSessionCompleted(false);
    setIsSetup(true);
  };

  const formatTimerValue = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Define parentFolder for outline mapping
  const parentFolder = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null;

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

  const renderSpacedRepOverview = () => {
    if (!spacedRepActive || allParsedCards.length === 0) return null;

    const boxCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    allParsedCards.forEach(card => {
      const key = `${card.front}||${card.back}`;
      const box = spacedRepRecords[key]?.box || 1;
      if (box >= 1 && box <= 5) {
        boxCounts[box as 1|2|3|4|5]++;
      }
    });

    return (
      <div className="mt-6 pt-5 border-t border-slate-200 font-sans space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-sans text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Leitner Mastery</span>
          <span className="text-[10px] font-bold text-indigo-500">{allParsedCards.length} Cards</span>
        </div>

        <div className="space-y-2">
          {([1, 2, 3, 4, 5] as const).map(boxNum => {
            const count = boxCounts[boxNum];
            const pct = Math.round((count / allParsedCards.length) * 100) || 0;

            let color = 'bg-rose-500';
            if (boxNum === 2) { color = 'bg-amber-500'; }
            if (boxNum === 3) { color = 'bg-yellow-400'; }
            if (boxNum === 4) { color = 'bg-sky-500'; }
            if (boxNum === 5) { color = 'bg-emerald-500'; }

            return (
              <div key={`sidebar-box-${boxNum}`} className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-semibold">
                  <span className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
                    <span className="text-slate-700 font-bold">{LEITNER_BOX_NAMES[boxNum]}</span>
                  </span>
                  <span className="text-slate-500">{count} ({pct}%)</span>
                </div>
                <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full transition-all duration-300`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSidebar = () => (
    <div className="w-64 border-r shrink-0 overflow-y-auto p-4 hidden md:block bg-slate-50/50 border-slate-100 text-slate-600 font-sans">
      <div className="mb-4">
        <button
          onClick={onBack}
          className="text-xs text-[#1d4ed8] hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
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
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <FileSpreadsheet size={13} className="text-blue-600 shrink-0" />
              <span className="font-sans text-[11px] font-black text-slate-800 truncate" title={file.name}>
                {file.name}
              </span>
            </div>
            <span className="font-sans text-[9px] text-blue-500 font-extrabold uppercase tracking-wide">
              Spreadsheet Tabs
            </span>
          </div>

          <div className="space-y-1">
            {sheets.length > 0 ? (
              sheets.map((s, idx) => {
                const isActive = selectedSheet === s;
                return (
                  <button
                    key={`${s}-${idx}`}
                    onClick={() => {
                      setSelectedSheet(s);
                      setIsSetup(false);
                      setSessionCompleted(false);
                    }}
                    className={`w-full text-left font-sans text-xs hover:text-indigo-600 hover:bg-slate-100/50 rounded-lg py-1.5 px-2 transition-colors cursor-pointer truncate block ${
                      isActive 
                        ? 'font-bold text-indigo-600 bg-indigo-100/30' 
                        : 'text-slate-500 font-medium'
                    }`}
                    title={`Switch to tab: ${s}`}
                  >
                    • {s}
                  </button>
                );
              })
            ) : (
              <div className="pl-3 text-[11px] text-slate-400 italic">
                No sheet tabs found
              </div>
            )}
          </div>
          
          {renderSpacedRepOverview()}
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
                      <FileSpreadsheet size={14} className={isCurrent ? "text-[#1d4ed8] font-bold" : "text-emerald-500"} />
                    ) : isPdf ? (
                      <FileText size={14} className={isCurrent ? "text-[#1d4ed8]" : "text-rose-500"} />
                    ) : (
                      <FileText size={14} className={isCurrent ? "text-[#1d4ed8]" : "text-indigo-500"} />
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
                  <FileSpreadsheet size={14} className="text-[#1d4ed8] shrink-0" />
                  <span className="truncate">{file.name}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Render Section 1: Loading and error handshakes
  if (loading && !selectedSheet) {
    return (
      <div className="flex flex-col md:flex-row h-[calc(100vh-73px)] border-none rounded-none overflow-hidden bg-slate-50 shadow-none font-sans w-full">
        {renderSidebar()}
        <div className="flex-1 overflow-y-auto bg-white flex flex-col min-h-0">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-white border-slate-100 text-slate-800">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-2 hover:bg-slate-100 border-2 border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 cursor-pointer transition-all shrink-0"
                title="Go back to explorer"
              >
                <ArrowLeft size={15} />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <div className="bg-emerald-50 text-emerald-600 p-1.5 rounded-lg border border-emerald-200">
                  <FileSpreadsheet size={16} />
                </div>
                <h2 className="font-sans font-extrabold text-sm truncate max-w-[200px] md:max-w-md">{file.name}</h2>
              </div>
            </div>
          </div>
          <div className="flex-1 p-16 text-center flex flex-col items-center justify-center gap-4">
            <div className="h-8 w-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="font-sans text-xs text-slate-400 font-medium">Extracting vocabulary sheet columns...</p>
          </div>
        </div>
      </div>
    );
  }

  // Render Section 2: Completion Report screen
  if (sessionCompleted) {
    const accuracy = Math.round((studyStats.correctCount / cards.length) * 100) || 0;
    return (
      <div className="flex flex-col md:flex-row h-[calc(100vh-73px)] border-none rounded-none overflow-hidden bg-slate-50 shadow-none font-sans w-full">
        {renderSidebar()}
        <div className="flex-1 overflow-y-auto bg-white flex flex-col min-h-0">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-white border-slate-100 text-slate-800">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-2 hover:bg-slate-100 border-2 border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 cursor-pointer transition-all shrink-0"
                title="Go back to explorer"
              >
                <ArrowLeft size={15} />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <div className="bg-emerald-50 text-emerald-600 p-1.5 rounded-lg border border-emerald-200">
                  <FileSpreadsheet size={16} />
                </div>
                <h2 className="font-sans font-extrabold text-sm truncate max-w-[200px] md:max-w-md">{file.name}</h2>
              </div>
            </div>
          </div>
          <div className="flex-1 p-6 md:p-8 overflow-y-auto">
            <div className="max-w-xl mx-auto bg-white border border-slate-100 rounded-3xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.03)] p-8 md:p-10 text-center space-y-8 animate-fade-in font-sans">
              <div className="space-y-2">
                <div className="h-12 w-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                  <Award size={24} />
                </div>
                <h2 className="font-sans font-black text-2xl text-slate-800 tracking-tight mt-3">Study Session Complete!</h2>
                <p className="font-sans text-xs text-slate-400">Great work studying "{file.name}"</p>
              </div>

              {/* Stats breakdown grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-100/50 rounded-2xl">
                  <span className="block font-sans text-[10px] uppercase font-bold text-slate-400 tracking-wider">Score</span>
                  <span className="block font-mono text-lg font-bold text-slate-700 mt-1">{studyStats.correctCount}/{cards.length}</span>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-100/50 rounded-2xl">
                  <span className="block font-sans text-[10px] uppercase font-bold text-slate-400 tracking-wider">Accuracy</span>
                  <span className="block font-mono text-lg font-bold text-indigo-600 mt-1">{accuracy}%</span>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-100/50 rounded-2xl">
                  <span className="block font-sans text-[10px] uppercase font-bold text-slate-400 tracking-wider">Max Streak</span>
                  <span className="block font-mono text-lg font-bold text-emerald-600 mt-1 flex items-center justify-center gap-0.5">
                    <Flame size={14} className="fill-emerald-100" />
                    {studyStats.maxStreak}
                  </span>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-100/50 rounded-2xl">
                  <span className="block font-sans text-[10px] uppercase font-bold text-slate-400 tracking-wider">Duration</span>
                  <span className="block font-mono text-lg font-bold text-slate-700 mt-1">{formatTimerValue(elapsedSeconds)}</span>
                </div>
              </div>

              {/* Action Controls */}
              <div className="space-y-3 pt-4 border-t border-slate-100 font-sans">
                {studyStats.wrongCards.length > 0 && (
                  <button
                    onClick={handleReviewTroubleCards}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-sans text-xs font-semibold cursor-pointer transition-colors shadow-sm shadow-indigo-100"
                  >
                    Practice Trouble Cards ({studyStats.wrongCards.length})
                  </button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleLaunchSession}
                    className="py-2.5 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 rounded-2xl font-sans text-xs font-semibold text-slate-600 transition-colors cursor-pointer"
                  >
                    Study Again
                  </button>
                  <button
                    onClick={() => setIsSetup(false)}
                    className="py-2.5 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 rounded-2xl font-sans text-xs font-semibold text-slate-600 transition-colors cursor-pointer"
                  >
                    Select Tab / Columns
                  </button>
                </div>

                <button
                  onClick={onBack}
                  className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline py-1 cursor-pointer"
                >
                  Return to Repository
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render Section 3: Active Card Study screen
  if (isSetup && allParsedCards.length > 0) {
    const currentCard = cards.length > 0 ? cards[currentIndex] : null;
    const progress = cards.length > 0 ? Math.round((currentIndex / cards.length) * 100) : 0;

    return (
      <div className="flex flex-col md:flex-row h-[calc(100vh-73px)] border-none rounded-none overflow-hidden bg-slate-50 shadow-none font-sans w-full">
        {renderSidebar()}
        <div className="flex-1 overflow-y-auto bg-white flex flex-col min-h-0">
          
          {/* Main Content Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-6 py-4 border-b gap-3 shrink-0 bg-white border-slate-100 text-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={onBack}
                className="p-2 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-700 hover:text-slate-900 cursor-pointer transition-all shrink-0"
                title="Go back to explorer"
              >
                <ArrowLeft size={15} />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <div className="bg-emerald-50 text-emerald-600 p-1.5 rounded-lg border border-emerald-200">
                  <FileSpreadsheet size={16} />
                </div>
                <h2 className="font-sans font-bold text-sm truncate max-w-[200px] md:max-w-md">
                  {file.name} {selectedSheet && <span className="text-slate-400 font-normal">({selectedSheet})</span>}
                </h2>
              </div>
            </div>

            {/* Mode Swapper & Clock */}
            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 select-none">
                <button
                  type="button"
                  onClick={() => setStudyMode('flashcard')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    studyMode === 'flashcard'
                      ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Layers size={13} />
                  <span>Flashcards</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStudyMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    studyMode === 'table'
                      ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Columns size={13} />
                  <span>Table View</span>
                </button>
              </div>

              <div className="flex items-center gap-1 text-slate-400 text-xs font-sans bg-slate-50 border border-slate-100 rounded-xl px-2.5 py-2">
                <Clock size={12} />
                <span>{formatTimerValue(elapsedSeconds)}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 p-6 md:p-8 overflow-y-auto">
            {studyMode === 'table' ? (
              /* DYNAMIC REVISION TABLE VIEW MODE */
              <div className="space-y-6 animate-fade-in font-sans max-w-5xl mx-auto">
                {/* Spaced repetition settings bar in Table View */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal size={15} className="text-indigo-600" />
                      <span className="text-xs font-bold text-slate-700">Spaced Repetition:</span>
                      <button
                        onClick={() => setSpacedRepActive(!spacedRepActive)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          spacedRepActive ? 'bg-indigo-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            spacedRepActive ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {spacedRepActive ? 'Active (Leitner Boxes)' : 'Inactive'}
                      </span>
                    </div>

                    {spacedRepActive && (
                      <div className="flex items-center gap-2 border-l border-slate-200 pl-0 md:pl-4">
                        <span className="text-xs font-bold text-slate-700">Study Focus:</span>
                        <select
                          value={studyFocus}
                          onChange={(e) => applyStudyFocus(e.target.value, spacedRepActive)}
                          className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 outline-none cursor-pointer"
                        >
                          <option value="all">All Cards</option>
                          <option value="weak">Unfamiliar / Learning (Needs Focus)</option>
                          <option value="box1">{LEITNER_BOX_NAMES[1]}</option>
                          <option value="box2">{LEITNER_BOX_NAMES[2]}</option>
                          <option value="box3">{LEITNER_BOX_NAMES[3]}</option>
                          <option value="box4">{LEITNER_BOX_NAMES[4]}</option>
                          <option value="box5">{LEITNER_BOX_NAMES[5]}</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setRevealAllAnswers(!revealAllAnswers)}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/10 rounded-xl text-xs font-bold text-slate-600 hover:text-indigo-600 flex items-center gap-1.5 cursor-pointer transition-all"
                    >
                      {revealAllAnswers ? <EyeOff size={13} /> : <Eye size={13} />}
                      <span>{revealAllAnswers ? 'Hide All Backs' : 'Reveal All Backs'}</span>
                    </button>
                  </div>
                </div>

                {/* Searching & Box Filters inside Table Mode */}
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search terms, definitions, or hints..."
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-indigo-500 rounded-2xl text-xs text-slate-800 outline-none transition-all placeholder:text-slate-400"
                    />
                    {tableSearch && (
                      <button
                        onClick={() => setTableSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold font-sans"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {spacedRepActive && (
                    <div className="flex items-center gap-1.5 overflow-x-auto py-1 shrink-0 select-none">
                      <span className="text-[11px] font-bold text-slate-400 mr-1 uppercase tracking-wide">Filter:</span>
                      {(['all', '1', '2', '3', '4', '5'] as const).map((boxKey) => {
                        const isActive = tableBoxFilter === boxKey;
                        const counts = allParsedCards.filter(c => {
                          const k = `${c.front}||${c.back}`;
                          const currentBox = spacedRepRecords[k]?.box || 1;
                          return boxKey === 'all' ? true : currentBox === parseInt(boxKey, 10);
                        }).length;

                        let colorClass = 'bg-slate-100 text-slate-600 border-slate-200';
                        if (isActive) {
                          if (boxKey === 'all') colorClass = 'bg-indigo-600 text-white border-indigo-600';
                          else if (boxKey === '1') colorClass = 'bg-rose-500 text-white border-rose-500';
                          else if (boxKey === '2') colorClass = 'bg-amber-500 text-white border-amber-500';
                          else if (boxKey === '3') colorClass = 'bg-yellow-500 text-slate-900 border-yellow-500';
                          else if (boxKey === '4') colorClass = 'bg-sky-500 text-white border-sky-500';
                          else if (boxKey === '5') colorClass = 'bg-emerald-500 text-white border-emerald-500';
                        } else {
                          if (boxKey === '1') colorClass = 'hover:bg-rose-50 text-rose-600 hover:border-rose-200';
                          else if (boxKey === '2') colorClass = 'hover:bg-amber-50 text-amber-600 hover:border-amber-200';
                          else if (boxKey === '3') colorClass = 'hover:bg-yellow-50 text-yellow-600 hover:border-yellow-200';
                          else if (boxKey === '4') colorClass = 'hover:bg-sky-50 text-sky-600 hover:border-sky-200';
                          else if (boxKey === '5') colorClass = 'hover:bg-emerald-50 text-emerald-600 hover:border-emerald-200';
                        }

                        return (
                          <button
                            key={`table-filter-${boxKey}`}
                            onClick={() => setTableBoxFilter(boxKey)}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-tight border transition-all cursor-pointer ${colorClass}`}
                          >
                            {boxKey === 'all' ? 'All' : LEITNER_BOX_NAMES[parseInt(boxKey, 10)]} ({counts})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Real Table Display */}
                <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-[0_4px_12px_-4px_rgba(0,0,0,0.02)] bg-white">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left border-collapse font-sans text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                          <th className="py-3 px-4 w-12 text-center">#</th>
                          <th className="py-3 px-4 w-1/3">Front / Term</th>
                          <th className="py-3 px-4 w-1/3">Back / Definition</th>
                          {hintCol >= 0 && <th className="py-3 px-4">Hint</th>}
                          {spacedRepActive && <th className="py-3 px-4 w-32">Mastery Box</th>}
                          <th className="py-3 px-4 w-24 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {(() => {
                          const filteredTableCards = allParsedCards.filter((card) => {
                            // 1. Box Filter
                            if (spacedRepActive && tableBoxFilter !== 'all') {
                              const k = `${card.front}||${card.back}`;
                              const currentBox = spacedRepRecords[k]?.box || 1;
                              if (currentBox !== parseInt(tableBoxFilter, 10)) return false;
                            }
                            // 2. Search Filter
                            if (tableSearch) {
                              const s = tableSearch.toLowerCase();
                              const matchFront = card.front.toLowerCase().includes(s);
                              const matchBack = card.back.toLowerCase().includes(s);
                              const matchHint = card.hint?.toLowerCase().includes(s);
                              return matchFront || matchBack || matchHint;
                            }
                            return true;
                          });

                          if (filteredTableCards.length === 0) {
                            return (
                              <tr>
                                <td colSpan={hintCol >= 0 ? 6 : 5} className="py-12 text-center text-slate-400 italic">
                                  No matching vocabulary items found.
                                </td>
                              </tr>
                            );
                          }

                          return filteredTableCards.map((card, idx) => {
                            const k = `${card.front}||${card.back}`;
                            const record = spacedRepRecords[k] || { box: 1, attempts: 0, corrects: 0 };
                            const isAnswerRevealed = revealAllAnswers || revealedRows[card.id];

                            // Box Colors
                            let boxColor = 'bg-rose-50 text-rose-700 border-rose-200';
                            let boxLabel = `Level 1: ${LEITNER_BOX_NAMES[1]}`;
                            if (record.box === 2) { boxColor = 'bg-amber-50 text-amber-700 border-amber-200'; boxLabel = `Level 2: ${LEITNER_BOX_NAMES[2]}`; }
                            else if (record.box === 3) { boxColor = 'bg-yellow-50 text-yellow-800 border-yellow-200'; boxLabel = `Level 3: ${LEITNER_BOX_NAMES[3]}`; }
                            else if (record.box === 4) { boxColor = 'bg-sky-50 text-sky-700 border-sky-200'; boxLabel = `Level 4: ${LEITNER_BOX_NAMES[4]}`; }
                            else if (record.box === 5) { boxColor = 'bg-emerald-50 text-emerald-700 border-emerald-200'; boxLabel = `Level 5: ${LEITNER_BOX_NAMES[5]}`; }

                            return (
                              <tr key={card.id} className="hover:bg-slate-50/40 transition-colors">
                                <td className="py-3 px-4 text-center font-mono font-medium text-slate-400">{idx + 1}</td>
                                <td className="py-3 px-4">
                                  <MathJaxText text={card.front} className="font-semibold text-slate-800" />
                                </td>
                                <td className="py-3 px-4">
                                  {isAnswerRevealed ? (
                                    <div className="flex items-center gap-2 group justify-between">
                                      <MathJaxText text={card.back} className="font-medium text-slate-700" />
                                      <button
                                        onClick={() => setRevealedRows(prev => ({ ...prev, [card.id]: false }))}
                                        className="text-[10px] text-slate-400 hover:text-slate-600 underline cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        Hide
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setRevealedRows(prev => ({ ...prev, [card.id]: true }))}
                                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-all animate-fade-in"
                                      title="Click to reveal"
                                    >
                                      <Eye size={12} className="text-slate-400" />
                                      <span>Reveal Answer</span>
                                    </button>
                                  )}
                                </td>
                                {hintCol >= 0 && (
                                  <td className="py-3 px-4">
                                    {card.hint ? (
                                      <MathJaxText text={card.hint} className="italic text-slate-400 text-[11px]" />
                                    ) : (
                                      <span className="text-slate-200">-</span>
                                    )}
                                  </td>
                                )}
                                {spacedRepActive && (
                                  <td className="py-3 px-4">
                                    <select
                                      value={record.box}
                                      onChange={(e) => setCardBoxDirectly(card.front, card.back, parseInt(e.target.value, 10))}
                                      className={`px-2 py-1 rounded-xl border text-[10px] font-extrabold outline-none cursor-pointer ${boxColor}`}
                                    >
                                      <option value={1}>Level 1: {LEITNER_BOX_NAMES[1]}</option>
                                      <option value={2}>Level 2: {LEITNER_BOX_NAMES[2]}</option>
                                      <option value={3}>Level 3: {LEITNER_BOX_NAMES[3]}</option>
                                      <option value={4}>Level 4: {LEITNER_BOX_NAMES[4]}</option>
                                      <option value={5}>Level 5: {LEITNER_BOX_NAMES[5]}</option>
                                    </select>
                                  </td>
                                )}
                                <td className="py-3 px-4 text-center flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => speakWord(card.front)}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                    title="Speak out loud"
                                  >
                                    <Volume2 size={13} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      // Find index in current cards list
                                      const foundIdx = cards.findIndex(c => c.front === card.front && c.back === card.back);
                                      if (foundIdx >= 0) {
                                        setCurrentIndex(foundIdx);
                                      } else {
                                        // Put back into cards queue
                                        setCards([card]);
                                        setCurrentIndex(0);
                                      }
                                      setIsFlipped(false);
                                      setShowHint(false);
                                      setStudyMode('flashcard');
                                    }}
                                    className="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                    title="Study this card in active flashcard"
                                  >
                                    <Play size={13} className="fill-indigo-500/10" />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE FLASHCARD DECK CARD VIEW MODE */
              <div className="max-w-2xl mx-auto space-y-6 animate-fade-in font-sans">
              
              {/* Upper Dashboard indicators */}
              <div className="flex items-center justify-between bg-white border border-slate-100 rounded-2xl px-5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to quit this study session? Your progress will be reset.')) {
                      setIsSetup(false);
                    }
                  }}
                  className="p-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title="Exit Session"
                >
                  <ArrowLeft size={14} />
                </button>

                <div className="flex items-center gap-5 text-xs text-slate-500 font-medium">
                  <span className="flex items-center gap-1">
                    <Clock size={13} />
                    {formatTimerValue(elapsedSeconds)}
                  </span>
                  <span className="flex items-center gap-0.5 text-emerald-600">
                    <Flame size={13} className="fill-emerald-100" />
                    Streak: {studyStats.currentStreak}
                  </span>
                  <span>
                    Card {currentIndex + 1} of {cards.length}
                  </span>
                </div>

                <button
                  onClick={handleShuffleDeck}
                  className="p-2 border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/20 text-slate-400 hover:text-indigo-600 rounded-xl transition-all cursor-pointer"
                  title="Shuffle Decks"
                >
                  <Shuffle size={14} />
                </button>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300" 
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Interactive Dual-Panel Flashcard Stage with slide-out animations */}
              <div ref={cardContentRef} className="relative w-full overflow-hidden min-h-[260px] py-1">
                <AnimatePresence mode="wait" custom={slideDirection}>
                  <motion.div
                    key={currentIndex}
                    custom={slideDirection}
                    variants={cardVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="w-full flex flex-col md:flex-row gap-5"
                  >
                    {/* Front Card Panel */}
                    <div className="flex-1 bg-white border border-slate-200 rounded-3xl p-6 md:p-8 flex flex-col justify-between shadow-sm relative min-h-[220px]">
                      <div className="flex justify-between items-center text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-4">
                        <span>Front / Question</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            speakWord(currentCard.front);
                          }}
                          className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-xl transition-all cursor-pointer"
                          title="Pronounce front side"
                        >
                          <Volume2 size={13} />
                        </button>
                      </div>

                      <div className="my-auto text-center py-4 flex flex-col items-center justify-center">
                        <MathJaxText 
                          text={currentCard.front} 
                          className={`font-sans font-bold leading-tight text-slate-800 break-words ${
                            currentCard.front.length > 60 
                              ? 'text-base md:text-lg' 
                              : 'text-xl md:text-2xl font-black'
                          }`}
                        />
                        
                        {currentCard.hint && (
                          <div className="mt-3 min-h-[30px] flex items-center justify-center">
                            {showHint ? (
                              <div className="font-sans text-xs italic text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100 animate-pulse flex items-center justify-center">
                                Hint:&nbsp;
                                <MathJaxText text={currentCard.hint} />
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowHint(true);
                                }}
                                className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold underline cursor-pointer"
                              >
                                Need a hint? (H)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="text-[9px] text-slate-400 font-sans tracking-wide text-center mt-4">
                        Study Term / Formula
                      </div>
                    </div>

                    {/* Back Card Panel */}
                    <div 
                      onClick={() => {
                        if (!isFlipped) {
                          setIsFlipped(true);
                        }
                      }}
                      className={`flex-1 border rounded-3xl p-6 md:p-8 flex flex-col justify-between shadow-sm relative min-h-[220px] transition-all duration-300 ${
                        isFlipped 
                          ? 'bg-indigo-50/10 border-indigo-100 text-slate-800' 
                          : 'bg-slate-50 border-slate-200 text-slate-700/30 select-none cursor-pointer hover:bg-slate-100/50'
                      }`}
                    >
                      <div className="flex justify-between items-center text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-4">
                        <span>Back / Answer</span>
                        {isFlipped && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              speakWord(currentCard.back);
                            }}
                            className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-xl transition-all cursor-pointer"
                            title="Pronounce answer side"
                          >
                            <Volume2 size={13} />
                          </button>
                        )}
                      </div>

                      <div className="my-auto text-center py-4 relative flex flex-col items-center justify-center">
                        {/* MathJax back text is ALWAYS in the DOM for reliable rendering! */}
                        <div className={`transition-all duration-300 w-full flex flex-col items-center justify-center ${isFlipped ? 'blur-0 opacity-100' : 'blur-md opacity-20 select-none pointer-events-none'}`}>
                          <MathJaxText 
                            text={currentCard.back} 
                            className={`font-sans font-bold leading-tight text-slate-800 break-words ${
                              currentCard.back.length > 60 
                                ? 'text-base md:text-lg' 
                                : 'text-xl md:text-2xl font-black'
                            }`}
                          />
                        </div>

                        {/* Overlay when NOT flipped */}
                        {!isFlipped && (
                          <div className="absolute inset-0 flex items-center justify-center bg-transparent z-10">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsFlipped(true);
                              }}
                              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold font-sans shadow-md flex items-center gap-2 transition-all transform hover:scale-105"
                            >
                              <Eye size={13} />
                              <span>Show Answer (Space)</span>
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="text-[9px] text-slate-400 font-sans tracking-wide text-center mt-4">
                        {isFlipped ? 'Answer Revealed' : 'Click to reveal'}
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* User response actions panel */}
              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                <button
                  onClick={() => handleResponse(false)}
                  className="py-3.5 px-6 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-2xl font-sans text-xs font-semibold cursor-pointer transition-colors shadow-sm flex items-center justify-center gap-2 group"
                >
                  <X size={16} />
                  Forgot (A)
                </button>
                
                <button
                  onClick={() => handleResponse(true)}
                  className="py-3.5 px-6 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-2xl font-sans text-xs font-semibold cursor-pointer transition-colors shadow-sm flex items-center justify-center gap-2 group"
                >
                  <Check size={16} />
                  Remembered (D)
                </button>
              </div>

              {/* Tactical controls instruction overlay */}
              <div className="hidden md:flex justify-center items-center gap-6 text-[10px] text-slate-400 font-sans border-t border-slate-100 pt-4">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">Space</kbd> Flip
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">←</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">A</kbd> Forgot
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">→</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">D</kbd> Remembered
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono">H</kbd> Hint
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    );
  }

  // Render Section 4: Spreadsheet mapping & configuration (the Admin/Setup mode)
  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-73px)] border-none rounded-none overflow-hidden bg-slate-50 shadow-none font-sans w-full">
      {renderSidebar()}
      <div className="flex-1 overflow-y-auto bg-white flex flex-col min-h-0">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-white border-slate-100 text-slate-800 font-sans">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 border-2 border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 cursor-pointer transition-all shrink-0"
              title="Go back to explorer"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="bg-emerald-50 text-emerald-600 p-1.5 rounded-lg border border-emerald-200">
                <FileSpreadsheet size={16} />
              </div>
              <h2 className="font-sans font-bold text-sm truncate max-w-[200px] md:max-w-md">
                {file.name} {selectedSheet && <span className="text-slate-400 font-normal">({selectedSheet})</span>}
              </h2>
            </div>
          </div>
        </div>
        <div className="flex-1 p-6 md:p-8 overflow-y-auto">
          <div className="max-w-2xl mx-auto bg-white border border-slate-100 rounded-3xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.03)] p-8 md:p-10 space-y-6 font-sans">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                  <Layers size={18} />
                </div>
                <div>
                  <h2 className="font-sans font-black text-slate-800 text-lg leading-none">Configure Study Deck</h2>
                  <p className="font-sans text-[11px] text-slate-400 mt-1">Select vocabulary sheet mappings</p>
                </div>
              </div>

              <button
                onClick={onBack}
                className="px-3 py-1.5 text-xs border border-slate-200 hover:border-slate-300 rounded-xl text-slate-500 font-medium cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl flex items-start gap-2.5 text-xs leading-normal">
                <HelpCircle size={16} className="shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {/* Tabs list select */}
            <div className="space-y-2">
              <label className="block text-[10px] uppercase font-sans font-bold text-slate-400 tracking-wider">
                Vocabulary Sheet Tab
              </label>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-sans text-xs text-slate-800 outline-none focus:border-indigo-500 transition-all cursor-pointer"
              >
                {sheets.map(sheet => (
                  <option key={sheet} value={sheet}>{sheet}</option>
                ))}
              </select>
            </div>

            {/* Grid columns mapper */}
            {rawRows.length > 0 && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] uppercase font-sans font-bold text-slate-400 tracking-wider">
                    Map Sheet Columns
                  </label>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      id="header-checkbox"
                      checked={hasHeader}
                      onChange={(e) => setHasHeader(e.target.checked)}
                      className="rounded text-indigo-600 cursor-pointer"
                    />
                    <label htmlFor="header-checkbox" className="cursor-pointer font-semibold">First row contains header labels</label>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  
                  {/* Front Card mapper */}
                  <div className="p-4 border border-slate-100 bg-slate-50/50 rounded-2xl space-y-1.5">
                    <span className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider">Front of Card</span>
                    <select
                      value={frontCol}
                      onChange={(e) => setFrontCol(parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl font-sans text-xs text-slate-700 outline-none"
                    >
                      {columns.map((letter, idx) => (
                        <option key={`front-${idx}`} value={idx}>
                          Col {letter} {hasHeader && rawRows[0]?.[idx] ? `(${rawRows[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Back Card mapper */}
                  <div className="p-4 border border-slate-100 bg-slate-50/50 rounded-2xl space-y-1.5">
                    <span className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider">Back of Card</span>
                    <select
                      value={backCol}
                      onChange={(e) => setBackCol(parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl font-sans text-xs text-slate-700 outline-none"
                    >
                      {columns.map((letter, idx) => (
                        <option key={`back-${idx}`} value={idx}>
                          Col {letter} {hasHeader && rawRows[0]?.[idx] ? `(${rawRows[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Optional Hint mapper */}
                  <div className="p-4 border border-slate-100 bg-slate-50/50 rounded-2xl space-y-1.5">
                    <span className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider">Optional Hint Col</span>
                    <select
                      value={hintCol}
                      onChange={(e) => setHintCol(parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl font-sans text-xs text-slate-700 outline-none"
                    >
                      <option value={-1}>None / No Hint</option>
                      {columns.map((letter, idx) => (
                        <option key={`hint-${idx}`} value={idx}>
                          Col {letter} {hasHeader && rawRows[0]?.[idx] ? `(${rawRows[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                </div>

                {/* Simple Data preview grid */}
                <div className="border border-slate-100 rounded-2xl overflow-hidden mt-4">
                  <span className="block bg-slate-50 px-4 py-2 text-[10px] uppercase font-bold text-slate-400 tracking-wider border-b border-slate-100">
                    Data Preview (First 3 Rows)
                  </span>
                  <div className="p-4 font-sans text-xs divide-y divide-slate-50 max-h-36 overflow-y-auto">
                    {rawRows.slice(hasHeader ? 1 : 0, 4).map((row, rIdx) => (
                      <div key={`row-preview-${rIdx}`} className="py-2 flex items-start gap-4 text-slate-600">
                        <span className="font-semibold text-indigo-600 shrink-0">Row {rIdx + (hasHeader ? 2 : 1)}:</span>
                        <div className="min-w-0 flex-1 grid grid-cols-2 gap-4">
                          <span className="truncate"><strong>Front:</strong> {row[frontCol] || '--'}</span>
                          <span className="truncate"><strong>Back:</strong> {row[backCol] || '--'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleLaunchSession}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-sans text-xs font-semibold cursor-pointer transition-colors shadow-sm shadow-indigo-100 flex items-center justify-center gap-2 group"
            >
              <BookOpen size={14} />
              Start Study Session
              <ArrowLeft size={13} className="rotate-180 group-hover:translate-x-0.5 transition-transform" />
            </button>

          </div>
        </div>
      </div>
    </div>
  );
};
