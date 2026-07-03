/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Flame, Sparkles, CheckCircle2 } from 'lucide-react';

export const StudyDayTracker: React.FC = () => {
  const [studiedDays, setStudiedDays] = useState<string[]>([]);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('study_hub_studied_days');
    let days: string[] = [];
    const todayStr = getFormattedDateStr(new Date());
    
    if (saved) {
      try {
        days = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse studied days', e);
      }
    }
    
    // Automatically check today on launch
    if (!days.includes(todayStr)) {
      days.push(todayStr);
      localStorage.setItem('study_hub_studied_days', JSON.stringify(days));
    }
    
    setStudiedDays(days);
  }, []);

  const getFormattedDateStr = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toggleDay = (dayNum: number) => {
    const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNum);
    const today = new Date();
    
    // Only allow toggling today's date
    const isToday = today.getFullYear() === targetDate.getFullYear() && 
                    today.getMonth() === targetDate.getMonth() && 
                    today.getDate() === targetDate.getDate();
                    
    if (!isToday) return; // Do not allow checking/unchecking past or future dates
    
    const dateStr = getFormattedDateStr(targetDate);
    
    let updated: string[];
    if (studiedDays.includes(dateStr)) {
      updated = studiedDays.filter(d => d !== dateStr);
    } else {
      updated = [...studiedDays, dateStr];
    }
    
    setStudiedDays(updated);
    localStorage.setItem('study_hub_studied_days', JSON.stringify(updated));
  };

  // Month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Streak calculation
  const calculateStreak = (): number => {
    if (studiedDays.length === 0) return 0;
    
    const sortedDays = [...studiedDays].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    let streak = 0;
    let checkDate = new Date();
    
    // Normalize to midnight
    checkDate.setHours(0, 0, 0, 0);
    
    // Check if we studied today or yesterday to continue the streak
    const todayStr = getFormattedDateStr(checkDate);
    const yesterday = new Date(checkDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getFormattedDateStr(yesterday);
    
    if (!studiedDays.includes(todayStr) && !studiedDays.includes(yesterdayStr)) {
      return 0; // Streak broken
    }
    
    // Start tracing back from the most recent studied day (today or yesterday)
    let startCheck = studiedDays.includes(todayStr) ? checkDate : yesterday;
    
    while (true) {
      const checkStr = getFormattedDateStr(startCheck);
      if (studiedDays.includes(checkStr)) {
        streak++;
        // Go to previous day
        startCheck.setDate(startCheck.getDate() - 1);
      } else {
        break;
      }
    }
    
    return streak;
  };

  const streak = calculateStreak();
  const totalDaysStudied = studiedDays.length;

  return (
    <div className="bg-white p-5 rounded-2xl border-2 border-slate-300 space-y-3.5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <h3 className="font-sans font-extrabold text-slate-900 text-sm flex items-center gap-2">
          <Calendar size={16} className="text-indigo-600" />
          Study Calendar Tracker
        </h3>
        
        {/* Streak Indicator */}
        <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full" title="Consecutive days studied">
          <Flame size={13} className="text-amber-600 fill-amber-500 animate-pulse" />
          <span className="font-sans font-extrabold text-[10px] text-amber-700">
            {streak} day streak
          </span>
        </div>
      </div>

      {/* Month Selection Bar */}
      <div className="flex items-center justify-between">
        <button 
          onClick={prevMonth}
          className="p-1 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-sans font-bold text-xs text-slate-800">
          {monthNames[month]} {year}
        </span>
        <button 
          onClick={nextMonth}
          className="p-1 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors text-slate-500 hover:text-slate-800"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {/* Days of Week Header */}
        {daysOfWeek.map((day, i) => (
          <span key={i} className="font-sans font-black text-[9px] text-slate-400 py-1">
            {day}
          </span>
        ))}

        {/* Empty Padding Slots */}
        {Array.from({ length: firstDayIndex }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* Calendar Days */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1;
          const targetDate = new Date(year, month, dayNum);
          const dateStr = getFormattedDateStr(targetDate);
          const isStudied = studiedDays.includes(dateStr);
          
          const today = new Date();
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNum;

          return (
            <button
              key={`day-${dayNum}`}
              onClick={() => toggleDay(dayNum)}
              disabled={!isToday}
              className={`h-7 w-7 text-[10px] font-sans font-bold rounded-lg transition-all flex items-center justify-center relative ${
                isToday
                  ? isStudied
                    ? 'bg-indigo-600 text-white font-extrabold shadow-sm shadow-indigo-100 border border-indigo-700 cursor-pointer hover:bg-indigo-700'
                    : 'bg-white text-indigo-700 border-2 border-indigo-500 cursor-pointer hover:bg-slate-50'
                  : isStudied
                    ? 'bg-indigo-100 text-indigo-800 font-semibold border border-indigo-200 cursor-default'
                    : 'bg-slate-50 text-slate-400 border border-slate-200 cursor-default'
              }`}
              title={
                isToday
                  ? `Click to toggle today's studied status`
                  : isStudied
                    ? `${monthNames[month]} ${dayNum} - Studied (Read-only)`
                    : `${monthNames[month]} ${dayNum} - Not studied (Read-only)`
              }
            >
              <span>{dayNum}</span>
              {isStudied && (
                <span className={`absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ${isToday ? 'bg-white' : 'bg-indigo-600'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Summary Stats Footer */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-center">
        <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
          <span className="font-sans text-[9px] text-slate-400 font-bold block uppercase tracking-wider">
            Total Studied
          </span>
          <span className="font-sans text-xs font-black text-slate-800">
            {totalDaysStudied} Day{totalDaysStudied !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
          <span className="font-sans text-[9px] text-slate-400 font-bold block uppercase tracking-wider">
            Today's Target
          </span>
          <span className="font-sans text-xs font-black flex items-center justify-center gap-1">
            {studiedDays.includes(getFormattedDateStr(new Date())) ? (
              <span className="text-emerald-600 flex items-center gap-0.5">
                <CheckCircle2 size={11} className="fill-emerald-50" /> Done
              </span>
            ) : (
              <span className="text-amber-600 animate-pulse">Pending</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
