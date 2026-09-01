import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { TIMERS_DIR, DAEMON_LOG_FILE, loadConfig, ensureDirs } from './config.js';
import { getTranscriptCacheState, extractSessionName, findActiveClaudeTranscripts } from './transcript.js';
import { sendTelegramMessage, formatCacheAlertMessage } from './telegram.js';
import type { TimerMetadata } from './types.js';

export function logDaemon(msg: string): void {
  ensureDirs();
  const time = new Date().toISOString();
  try {
    fs.appendFileSync(DAEMON_LOG_FILE, `[${time}] ${msg}\n`, 'utf-8');
  } catch {
    // ignore
  }
}

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
  const effectiveDelay = Math.max(1, Math.round(delaySeconds));

  // Cancel any existing timer for this session first
  cancelTimer(sessionId);

  const timerPath = getTimerFilePath(sessionId);
  const now = Date.now();
  const fireAt = now + effectiveDelay * 1000;

  // Resolve the path to the CLI index entry point
  const currentFile = fileURLToPath(import.meta.url);
  const cliPath = path.resolve(path.dirname(currentFile), 'index.js');

  const resolvedSessionName = sessionName || extractSessionName(transcriptPath, sessionId);

  ensureDirs();
  const logFd = fs.openSync(DAEMON_LOG_FILE, 'a');

  const child = spawn(process.execPath, [cliPath, 'internal-timer', sessionId, String(effectiveDelay)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });

  const metadata: TimerMetadata = {
    sessionId,
    sessionName: resolvedSessionName,
    transcriptPath,
    projectName,
    scheduledAt: now,
    fireAt,
    pid: child.pid || 0,
    ttlSeconds,
  };

  fs.writeFileSync(timerPath, JSON.stringify(metadata, null, 2), 'utf-8');
  child.unref();

  logDaemon(`[Schedule] Session '${resolvedSessionName}' (${sessionId.slice(0, 8)}) timer set for ${effectiveDelay}s (PID: ${child.pid})`);
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
        logDaemon(`[Cancel] Killed timer process PID ${data.pid} for session ${sessionId.slice(0, 8)}`);
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
  if (!fs.existsSync(timerPath)) {
    logDaemon(`[Trigger] No timer file found for ${sessionId.slice(0, 8)}`);
    return;
  }

  let metadata: TimerMetadata;
  try {
    metadata = JSON.parse(fs.readFileSync(timerPath, 'utf-8')) as TimerMetadata;
  } catch {
    return;
  }

  logDaemon(`[Trigger] Timer waking up for '${metadata.sessionName}' (${sessionId.slice(0, 8)})`);

  const config = loadConfig();
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    logDaemon(`[Trigger] Telegram not configured or disabled, skipping alert`);
    cancelTimer(sessionId);
    return;
  }

  // Check the current transcript state to ensure user hasn't started a NEW turn
  const state = getTranscriptCacheState(
    metadata.transcriptPath,
    metadata.ttlSeconds,
    config.cache.alertThresholdPercent
  );

  // If a newer assistant turn finished AFTER this timer was scheduled, skip alert
  if (state.lastAssistantTime && state.lastAssistantTime.getTime() > metadata.scheduledAt + 3000) {
    logDaemon(`[Trigger] Skipping alert: new turn finished at ${state.lastAssistantTime.toISOString()} after scheduledAt ${new Date(metadata.scheduledAt).toISOString()}`);
    cancelTimer(sessionId);
    return;
  }

  // Send the Telegram notification
  const remainingMins = Math.max(0, Math.round(state.remainingSeconds / 60));
  const ttlLabel = metadata.ttlSeconds >= 3600 ? `${metadata.ttlSeconds / 3600}h` : `${metadata.ttlSeconds / 60}m`;
  const resolvedSessionName = metadata.sessionName || extractSessionName(metadata.transcriptPath, metadata.sessionId);

  const message = formatCacheAlertMessage({
    project: config.notifications.includeProjectName ? metadata.projectName : undefined,
    sessionName: config.notifications.includeSessionName ? resolvedSessionName : undefined,
    remainingMinutes: remainingMins,
    remainingSeconds: Math.max(0, state.remainingSeconds),
    ttlLabel,
  });

  logDaemon(`[Trigger] Dispatching Telegram message for '${resolvedSessionName}'...`);

  const res = await sendTelegramMessage({
    botToken: config.telegram.botToken,
    chatId: config.telegram.chatId,
    message,
    disableNotification: !config.notifications.sound,
  });

  logDaemon(`[Trigger] Telegram API Response: ${JSON.stringify(res)}`);

  if (!res.ok) {
    logDaemon(`[Trigger] Telegram delivery failed (${res.description}). Rescheduling retry in 20s...`);
    scheduleTimer({
      sessionId: metadata.sessionId,
      sessionName: metadata.sessionName,
      transcriptPath: metadata.transcriptPath,
      projectName: metadata.projectName,
      delaySeconds: 20,
      ttlSeconds: metadata.ttlSeconds,
    });
    return;
  }

  // Clean up timer record only on successful delivery
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

      // If session is still warm (not expired and not actively in a fresh turn)
      if (!state.isExpired && !state.isWorking && state.remainingSeconds > 0) {
        const thresholdSeconds = config.cache.ttlSeconds * (config.cache.alertThresholdPercent / 100);
        const delaySeconds = state.remainingSeconds - thresholdSeconds;

        // If delay is positive, schedule countdown. If threshold already reached, schedule immediate 1s trigger.
        const effectiveDelay = Math.max(1, delaySeconds);

        scheduleTimer({
          sessionId: t.sessionId,
          sessionName: t.sessionName,
          transcriptPath: t.transcriptPath,
          projectName: t.project,
          delaySeconds: effectiveDelay,
          ttlSeconds: config.cache.ttlSeconds,
        });
        restartedSessions.push(t.sessionName || t.sessionId.slice(0, 8));
      }
    }
  }

  logDaemon(`[Restart] Stopped ${stoppedCount} timers. Rescheduled: ${restartedSessions.join(', ') || 'none'}`);
  return { stoppedCount, restartedSessions };
}
