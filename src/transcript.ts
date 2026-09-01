import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TranscriptEntry, ActiveCacheState } from './types.js';

const INITIAL_TAIL_BYTES = 32768; // 32KB
const SAFETY_MARGIN_SECONDS = 5;
const IN_FLIGHT_TURN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read the last N bytes of a file.
 */
export function readFileTail(filePath: string, bytes: number): { text: string; isComplete: boolean } | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const readSize = Math.min(bytes, size);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, size - readSize);
      return { text: buf.toString('utf-8'), isComplete: readSize === size };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Checks if the transcript entry touched the prompt cache.
 */
export function hasCacheActivity(entry: TranscriptEntry): boolean {
  const usage = entry.message?.usage;
  if (!usage) {
    return true; // assume yes for older formats without usage field
  }
  return (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > 0;
}

export interface ScannedState {
  isWorking: boolean;
  lastAssistant: Date | null;
}

/**
 * Scans the reverse lines of the transcript tail.
 */
export function scanTailForState(tail: string): ScannedState | null {
  const lines = tail.split('\n').reverse();
  let turnFinished = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed) as TranscriptEntry;
      if (entry.isSidechain === true) continue;

      if (entry.type === 'assistant') {
        turnFinished = true;
        if (entry.isApiErrorMessage !== true && hasCacheActivity(entry) && entry.timestamp) {
          const parsed = new Date(entry.timestamp);
          if (!Number.isNaN(parsed.getTime())) {
            return { isWorking: false, lastAssistant: parsed };
          }
        }
        continue;
      }

      if (entry.type === 'user' && !turnFinished) {
        // Check if this is a local slash command (e.g. /compact, /rename) that does not produce an LLM turn
        const rawContent = entry.message?.content;
        let isSlashCommand = false;
        if (typeof rawContent === 'string' && rawContent.trim().startsWith('/')) {
          isSlashCommand = true;
        }

        // Check if the user message is stale (> 5 mins old)
        let isStale = false;
        if (entry.timestamp) {
          const userTime = new Date(entry.timestamp);
          if (!Number.isNaN(userTime.getTime()) && Date.now() - userTime.getTime() > IN_FLIGHT_TURN_MAX_AGE_MS) {
            isStale = true;
          }
        }

        if (!isSlashCommand && !isStale) {
          return { isWorking: true, lastAssistant: null };
        }
        // Otherwise ignore this user record and continue looking for the last assistant turn
        continue;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Extracts the user-renamed session name (set via /rename) or the auto-generated session slug.
 */
export function extractSessionName(transcriptPath: string, fallbackId?: string): string {
  if (!fs.existsSync(transcriptPath)) {
    return fallbackId ? fallbackId.slice(0, 8) : 'unknown';
  }

  const tail = readFileTail(transcriptPath, 131072);
  if (!tail || !tail.text) {
    return fallbackId ? fallbackId.slice(0, 8) : 'unknown';
  }

  const lines = tail.text.split('\n').reverse();
  let foundSlug: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed) as TranscriptEntry;

      // 1. User-assigned custom title via /rename
      if (entry.type === 'custom-title' && entry.customTitle) {
        return entry.customTitle;
      }

      // 2. Auto-generated friendly slug (e.g. "magical-meandering-bird")
      if (!foundSlug && entry.slug) {
        foundSlug = entry.slug;
      }
    } catch {
      continue;
    }
  }

  if (foundSlug) {
    return foundSlug;
  }

  return fallbackId ? fallbackId.slice(0, 8) : 'unknown';
}

/**
 * Extracts the clean project directory name from the transcript's cwd field or raw project folder name.
 */
export function extractProjectName(transcriptPath: string, rawFolder?: string): string {
  if (fs.existsSync(transcriptPath)) {
    const tail = readFileTail(transcriptPath, 65536);
    if (tail && tail.text) {
      const lines = tail.text.split('\n').reverse();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as { cwd?: string };
          if (entry.cwd) {
            const base = path.basename(entry.cwd);
            if (base && base !== '/' && base !== '.') {
              return base;
            }
          }
        } catch {
          continue;
        }
      }
    }
  }

  if (rawFolder) {
    const cleaned = rawFolder.replace(/^[\\/-]+/, '');
    const parts = cleaned.split(/[-/\\]/);
    return parts[parts.length - 1] || rawFolder;
  }

  return 'project';
}

/**
 * Resolve the cache state for a specific transcript file.
 */
export function getTranscriptCacheState(
  transcriptPath: string,
  ttlSeconds: number,
  thresholdPercent: number
): ActiveCacheState {
  if (!fs.existsSync(transcriptPath)) {
    return {
      isWorking: false,
      lastAssistantTime: null,
      remainingSeconds: 0,
      remainingPercent: 0,
      isExpiringSoon: false,
      isExpired: true,
    };
  }

  let scanned: ScannedState | null = null;
  for (let bytes = INITIAL_TAIL_BYTES; bytes <= 524288; bytes *= 2) {
    const tail = readFileTail(transcriptPath, bytes);
    if (!tail || tail.text.length === 0) break;
    scanned = scanTailForState(tail.text);
    if (scanned || tail.isComplete) break;
  }

  if (!scanned) {
    return {
      isWorking: false,
      lastAssistantTime: null,
      remainingSeconds: 0,
      remainingPercent: 0,
      isExpiringSoon: false,
      isExpired: true,
    };
  }

  if (scanned.isWorking) {
    return {
      isWorking: true,
      lastAssistantTime: null,
      remainingSeconds: ttlSeconds,
      remainingPercent: 100,
      isExpiringSoon: false,
      isExpired: false,
    };
  }

  if (!scanned.lastAssistant) {
    return {
      isWorking: false,
      lastAssistantTime: null,
      remainingSeconds: 0,
      remainingPercent: 0,
      isExpiringSoon: false,
      isExpired: true,
    };
  }

  const elapsedSeconds = (Date.now() - scanned.lastAssistant.getTime()) / 1000;
  const remainingSeconds = Math.max(0, ttlSeconds - SAFETY_MARGIN_SECONDS - elapsedSeconds);
  const remainingPercent = Math.min(100, Math.max(0, (remainingSeconds / ttlSeconds) * 100));
  const isExpiringSoon = remainingPercent <= thresholdPercent && remainingSeconds > 0;
  const isExpired = remainingSeconds <= 0;

  return {
    isWorking: false,
    lastAssistantTime: scanned.lastAssistant,
    remainingSeconds: Math.round(remainingSeconds),
    remainingPercent: Math.round(remainingPercent),
    isExpiringSoon,
    isExpired,
  };
}

/**
 * Locate active Claude Code projects and their newest session transcript.
 */
export function findActiveClaudeTranscripts(): Array<{
  project: string;
  sessionId: string;
  sessionName: string;
  transcriptPath: string;
  mtime: Date;
}> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const results: Array<{
    project: string;
    sessionId: string;
    sessionName: string;
    transcriptPath: string;
    mtime: Date;
  }> = [];

  try {
    const projectDirs = fs.readdirSync(projectsDir);
    for (const p of projectDirs) {
      const pPath = path.join(projectsDir, p);
      if (!fs.statSync(pPath).isDirectory()) continue;

      const files = fs.readdirSync(pPath);
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const fullPath = path.join(pPath, file);
          try {
            const stat = fs.statSync(fullPath);
            const sessionId = path.basename(file, '.jsonl');
            results.push({
              project: extractProjectName(fullPath, p),
              sessionId,
              sessionName: extractSessionName(fullPath, sessionId),
              transcriptPath: fullPath,
              mtime: stat.mtime,
            });
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
