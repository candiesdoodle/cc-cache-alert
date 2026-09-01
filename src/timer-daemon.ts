import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { TIMERS_DIR, loadConfig, ensureDirs } from './config.js';
import { getTranscriptCacheState, extractSessionName, findActiveClaudeTranscripts } from './transcript.js';
import { sendTelegramMessage, formatCacheAlertMessage } from './telegram.js';
import type { TimerMetadata } from './types.js';

function getTimerFilePath(sessionId: string): string {
  ensureDirs();
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TIMERS_DIR, `${safeId}.json`);
}

/**
 * Schedule a detached background timer for a Claude session.
 */
export function scheduleTimer(options: {
  sessionId: string;
  sessionName?: string;
  transcriptPath: string;
  projectName: string;
  delaySeconds: number;
  ttlSeconds: number;
}): void {
  const { sessionId, sessionName, transcriptPath, projectName, delaySeconds, ttlSeconds } = options;
  if (delaySeconds <= 0) return;

  // Cancel any existing timer for this session first
  cancelTimer(sessionId);

  const timerPath = getTimerFilePath(sessionId);
  const now = Date.now();
  const fireAt = now + delaySeconds * 1000;

  // Resolve the path to the CLI index entry point
  const currentFile = fileURLToPath(import.meta.url);
  const cliPath = path.resolve(path.dirname(currentFile), 'index.js');

  const child = spawn(process.execPath, [cliPath, 'internal-timer', sessionId, String(Math.round(delaySeconds))], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  const metadata: TimerMetadata = {
    sessionId,
    sessionName: sessionName || extractSessionName(transcriptPath, sessionId),
    transcriptPath,
    projectName,
    scheduledAt: now,
    fireAt,
    pid: child.pid || 0,
    ttlSeconds,
  };

  fs.writeFileSync(timerPath, JSON.stringify(metadata, null, 2), 'utf-8');
  child.unref();
}

/**
 * Cancel and remove an active timer for a session.
 */
export function cancelTimer(sessionId: string): boolean {
  const timerPath = getTimerFilePath(sessionId);
  if (!fs.existsSync(timerPath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(timerPath, 'utf-8')) as TimerMetadata;
    if (data.pid) {
      try {
        process.kill(data.pid, 'SIGTERM');
      } catch {
        // pid might already be dead
      }
    }
  } catch {
    // ignore
  }

  try {
    fs.unlinkSync(timerPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes when internal timer fires after delay.
 */
export async function executeTimer(sessionId: string): Promise<void> {
  const timerPath = getTimerFilePath(sessionId);
  if (!fs.existsSync(timerPath)) return;

  let metadata: TimerMetadata;
  try {
    metadata = JSON.parse(fs.readFileSync(timerPath, 'utf-8')) as TimerMetadata;
  } catch {
    return;
  }

  const config = loadConfig();
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    cancelTimer(sessionId);
    return;
  }

  // Check the current transcript state to ensure user hasn't replied or session hasn't closed
  const state = getTranscriptCacheState(
    metadata.transcriptPath,
    metadata.ttlSeconds,
    config.cache.alertThresholdPercent
  );

  // If Claude is working or the cache has already been refreshed after our scheduled turn, skip alert
  if (state.isWorking) {
    cancelTimer(sessionId);
    return;
  }

  if (state.lastAssistantTime && state.lastAssistantTime.getTime() > metadata.scheduledAt) {
    cancelTimer(sessionId);
    return;
  }

  // If cache is expiring soon or expired, send the Telegram notification
  if (state.remainingSeconds > 0) {
    const remainingMins = Math.round(state.remainingSeconds / 60);
    const ttlLabel = metadata.ttlSeconds >= 3600 ? `${metadata.ttlSeconds / 3600}h` : `${metadata.ttlSeconds / 60}m`;
    const resolvedSessionName = metadata.sessionName || extractSessionName(metadata.transcriptPath, metadata.sessionId);

    const message = formatCacheAlertMessage({
      project: config.notifications.includeProjectName ? metadata.projectName : undefined,
      sessionName: config.notifications.includeSessionName ? resolvedSessionName : undefined,
      remainingMinutes: remainingMins,
      remainingSeconds: state.remainingSeconds,
      ttlLabel,
    });

    await sendTelegramMessage({
      botToken: config.telegram.botToken,
      chatId: config.telegram.chatId,
      message,
      disableNotification: !config.notifications.sound,
    });
  }

  // Clean up timer record
  cancelTimer(sessionId);
}

/**
 * List all pending timers.
 */
export function listActiveTimers(): TimerMetadata[] {
  ensureDirs();
  const files = fs.readdirSync(TIMERS_DIR);
  const results: TimerMetadata[] = [];

  for (const f of files) {
    if (f.endsWith('.json')) {
      try {
        const full = path.join(TIMERS_DIR, f);
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as TimerMetadata;
        // Verify process is still alive
        if (data.pid) {
          try {
            process.kill(data.pid, 0); // test signal
            results.push(data);
          } catch {
            // dead timer file, clean it up
            fs.unlinkSync(full);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return results;
}

/**
 * Stops all running timers, cleans up timer files, and restarts timers for active sessions.
 */
export function restartAllTimers(): { stoppedCount: number; restartedSessions: string[] } {
  const activeTimers = listActiveTimers();
  let stoppedCount = 0;

  for (const t of activeTimers) {
    cancelTimer(t.sessionId);
    stoppedCount++;
  }

  ensureDirs();
  const files = fs.readdirSync(TIMERS_DIR);
  for (const f of files) {
    if (f.endsWith('.json')) {
      try {
        fs.unlinkSync(path.join(TIMERS_DIR, f));
      } catch {
        // ignore
      }
    }
  }

  const config = loadConfig();
  const restartedSessions: string[] = [];

  if (config.telegram.enabled && config.telegram.botToken) {
    const recentTranscripts = findActiveClaudeTranscripts();
    for (const t of recentTranscripts) {
      const state = getTranscriptCacheState(
        t.transcriptPath,
        config.cache.ttlSeconds,
        config.cache.alertThresholdPercent
      );

      if (!state.isExpired && !state.isWorking && state.remainingSeconds > 0) {
        const thresholdSeconds = config.cache.ttlSeconds * (config.cache.alertThresholdPercent / 100);
        const delaySeconds = state.remainingSeconds - thresholdSeconds;

        if (delaySeconds > 0) {
          scheduleTimer({
            sessionId: t.sessionId,
            sessionName: t.sessionName,
            transcriptPath: t.transcriptPath,
            projectName: t.project,
            delaySeconds,
            ttlSeconds: config.cache.ttlSeconds,
          });
          restartedSessions.push(t.sessionName || t.sessionId.slice(0, 8));
        }
      }
    }
  }

  return { stoppedCount, restartedSessions };
}
