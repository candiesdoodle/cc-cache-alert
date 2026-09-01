import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import pc from 'picocolors';
import { loadConfig, TIMERS_DIR } from './config.js';
import { getTranscriptCacheState, findActiveClaudeTranscripts } from './transcript.js';
import type { TimerMetadata } from './types.js';

export interface StdinPayload {
  transcript_path?: string;
  transcriptPath?: string;
  session_id?: string;
  sessionId?: string;
  model?: { display_name?: string; id?: string };
  cost?: { total_cost_usd?: number };
  workspace?: { current_dir?: string };
  terminal_width?: number;
  [key: string]: unknown;
}

/**
 * Calculate the full threshold duration in minutes (e.g. 48m for 1h TTL with 20% alert threshold)
 */
export function getInitialAlertThresholdMinutes(ttlSeconds: number, alertThresholdPercent: number): number {
  const alertDelaySeconds = ttlSeconds * (1 - alertThresholdPercent / 100);
  return Math.max(1, Math.round(alertDelaySeconds / 60));
}

/**
 * Render compact widget string (for ccstatusline or other custom statusline injectors)
 */
export function renderWidget(payload?: StdinPayload): string {
  const config = loadConfig();
  if (!config.telegram.enabled || !config.telegram.botToken) {
    return '';
  }

  let sessionId = payload?.session_id || payload?.sessionId;
  let transcriptPath = payload?.transcript_path || payload?.transcriptPath;

  if (!transcriptPath || !sessionId) {
    const active = findActiveClaudeTranscripts();
    if (active.length > 0) {
      transcriptPath = active[0].transcriptPath;
      sessionId = active[0].sessionId;
    }
  }

  if (!sessionId || !transcriptPath) {
    return '';
  }

  const state = getTranscriptCacheState(
    transcriptPath,
    config.cache.ttlSeconds,
    config.cache.alertThresholdPercent
  );

  // 1. When cold (cache expired)
  if (state.isExpired) {
    return 'Alerted-Cold';
  }

  // 2. When hot (turn actively in flight): display "Cache 🔔 active"
  if (state.isWorking) {
    return 'Cache 🔔 active';
  }

  // 3. When idle: check if background timer exists
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timerPath = path.join(TIMERS_DIR, `${safeId}.json`);

  if (fs.existsSync(timerPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(timerPath, 'utf-8')) as TimerMetadata;
      const now = Date.now();
      const diffMs = data.fireAt - now;

      if (diffMs > 0) {
        const diffMins = Math.max(1, Math.round(diffMs / 60000));
        return `Cache 🔔 in ${diffMins} m`;
      } else {
        return 'Alerted';
      }
    } catch {
      // fallback
    }
  }

  // 4. Fallback calculation based on elapsed time from last assistant turn
  const thresholdSeconds = config.cache.ttlSeconds * (config.cache.alertThresholdPercent / 100);
  const remainingUntilAlert = state.remainingSeconds - thresholdSeconds;

  if (remainingUntilAlert > 0) {
    const mins = Math.max(1, Math.round(remainingUntilAlert / 60));
    return `Cache 🔔 in ${mins} m`;
  } else {
    return 'Alerted';
  }
}

/**
 * Render a standalone statusline sticking strictly to cache-related info
 */
export function renderStandaloneStatusline(payload?: StdinPayload): string {
  const config = loadConfig();

  let transcriptPath = payload?.transcript_path || payload?.transcriptPath;
  if (!transcriptPath) {
    const active = findActiveClaudeTranscripts();
    if (active.length > 0) {
      transcriptPath = active[0].transcriptPath;
    }
  }

  if (!transcriptPath) {
    return pc.gray('Cache: No active session');
  }

  const state = getTranscriptCacheState(
    transcriptPath,
    config.cache.ttlSeconds,
    config.cache.alertThresholdPercent
  );

  const parts: string[] = [];

  if (state.isExpired) {
    parts.push(pc.gray('❄️ Cache: Expired'));
    parts.push(pc.red('Alerted-Cold'));
  } else if (state.isWorking) {
    parts.push(pc.green('🔥 Cache: Hot (Refreshing)'));
    parts.push(pc.cyan('Cache 🔔 active'));
  } else {
    const remainingMins = Math.round(state.remainingSeconds / 60);
    const ttlLabel = config.cache.ttlSeconds >= 3600 ? `${config.cache.ttlSeconds / 3600}h` : `${config.cache.ttlSeconds / 60}m`;
    const widgetBadge = renderWidget(payload);

    if (state.isExpiringSoon) {
      parts.push(pc.red(`🔴 Cache: ~${remainingMins} m / ${ttlLabel}`));
    } else {
      parts.push(pc.green(`🟢 Cache: ~${remainingMins} m / ${ttlLabel}`));
    }

    if (widgetBadge) {
      parts.push(pc.yellow(widgetBadge));
    }
  }

  return parts.join(pc.gray(' │ '));
}

/**
 * Manage ccstatusline integration in ~/.config/ccstatusline/settings.json
 */
export const CCSTATUSLINE_SETTINGS_PATH = path.join(os.homedir(), '.config', 'ccstatusline', 'settings.json');

export function hasCcstatuslineConfig(): boolean {
  return fs.existsSync(CCSTATUSLINE_SETTINGS_PATH);
}

export function isWidgetInstalledInCcstatusline(): boolean {
  if (!hasCcstatuslineConfig()) return false;
  try {
    const content = fs.readFileSync(CCSTATUSLINE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    if (!settings.lines || !Array.isArray(settings.lines)) return false;

    return settings.lines.some((line: Array<{ commandPath?: string }>) =>
      line.some((item) => item.commandPath && item.commandPath.includes('cc-cache-alert widget'))
    );
  } catch {
    return false;
  }
}

export function installWidgetInCcstatusline(): { success: boolean; message: string } {
  if (!hasCcstatuslineConfig()) {
    return { success: false, message: 'ccstatusline settings.json not found' };
  }

  try {
    const content = fs.readFileSync(CCSTATUSLINE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    if (!settings.lines || !Array.isArray(settings.lines)) {
      settings.lines = [[]];
    }

    if (isWidgetInstalledInCcstatusline()) {
      return { success: true, message: 'cc-cache-alert widget is already installed in ccstatusline' };
    }

    const widgetEntry = {
      id: "cc-cache-alert-indicator",
      type: "custom-command",
      commandPath: "cc-cache-alert widget",
      preserveColors: false,
      rawValue: false
    };

    // Place immediately after cache-timer on the first line
    const line0 = settings.lines[0] || [];
    const cacheTimerIndex = line0.findIndex((item: { type?: string }) => item.type === 'cache-timer');

    if (cacheTimerIndex !== -1) {
      line0.splice(cacheTimerIndex + 1, 0, widgetEntry);
    } else {
      line0.push(widgetEntry);
    }

    settings.lines[0] = line0;
    fs.writeFileSync(CCSTATUSLINE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    return { success: true, message: 'Successfully added cc-cache-alert widget to ccstatusline!' };
  } catch (err) {
    return { success: false, message: `Failed to update ccstatusline settings: ${String(err)}` };
  }
}

export function uninstallWidgetFromCcstatusline(): { success: boolean; message: string } {
  if (!hasCcstatuslineConfig()) {
    return { success: true, message: 'No ccstatusline configuration found' };
  }

  try {
    const content = fs.readFileSync(CCSTATUSLINE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    if (!settings.lines || !Array.isArray(settings.lines)) return { success: true, message: 'Done' };

    for (let i = 0; i < settings.lines.length; i++) {
      settings.lines[i] = settings.lines[i].filter(
        (item: { commandPath?: string }) => !item.commandPath?.includes('cc-cache-alert widget')
      );
    }

    fs.writeFileSync(CCSTATUSLINE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    return { success: true, message: 'Successfully removed cc-cache-alert widget from ccstatusline' };
  } catch (err) {
    return { success: false, message: `Failed to update ccstatusline settings: ${String(err)}` };
  }
}
