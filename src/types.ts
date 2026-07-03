/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
}

export interface AdminSettings {
  driveFolderUrl: string;
  appsScriptUrl?: string;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  hint?: string;
}

export interface StudyStats {
  correctCount: number;
  incorrectCount: number;
  currentStreak: number;
  maxStreak: number;
  startTime: number;
  endTime?: number;
  wrongCards: string[]; // Keep track of cards that need practice
}

export interface DocHeader {
  id: string;
  text: string;
  level: number; // 1 for H1, 2 for H2, 3 for H3, etc.
}

export interface DocRun {
  text: string;
  linkUrl?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface DocElement {
  type: 'paragraph' | 'heading' | 'list_item' | 'table' | 'image';
  id?: string; // Optional element ID for direct navigation
  text?: string;
  level?: number; // Heading level or list indentation level
  tableRows?: string[][]; // Multi-dimensional array for simple cell text
  runs?: DocRun[];
  imageUrl?: string; // Support inline image URLs
}

export interface DocContent {
  title: string;
  headers: DocHeader[];
  elements: DocElement[];
}
