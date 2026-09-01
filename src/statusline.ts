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

  // 1. Check if an active timer file exists for this session
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timerPath = path.join(TIMERS_DIR, `${safeId}.json`);

  if (fs.existsSync(timerPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(timerPath, 'utf-8')) as TimerMetadata;
      const now = Date.now();
      const diffMs = data.fireAt - now;

      if (diffMs > 0) {
        const diffMins = Math.max(1, Math.round(diffMs / 60000));
        return `🔔 ${diffMins}m`;
      } else {
        return `📲 Alerted`;
      }
    } catch {
      // fallback to transcript inspection
    }
  }

  // 2. Fallback to calculating from transcript state
  const state = getTranscriptCacheState(
    transcriptPath,
    config.cache.ttlSeconds,
    config.cache.alertThresholdPercent
  );

  if (state.isWorking) {
    return '🔥 Hot';
  }

  if (state.isExpired) {
    return '❄️ Cold';
  }

  const thresholdSeconds = config.cache.ttlSeconds * (config.cache.alertThresholdPercent / 100);
  const remainingUntilAlert = state.remainingSeconds - thresholdSeconds;

  if (remainingUntilAlert > 0) {
    const mins = Math.max(1, Math.round(remainingUntilAlert / 60));
    return `🔔 ${mins}m`;
  } else {
    return `📲 Alerted`;
  }
}

/**
 * Render a complete, standalone statusline (for users who do NOT have ccstatusline)
 */
export function renderStandaloneStatusline(payload?: StdinPayload): string {
  const config = loadConfig();
  const widgetText = renderWidget(payload);

  let modelName = 'Claude';
  if (payload?.model?.display_name) {
    modelName = payload.model.display_name;
  } else if (payload?.model?.id) {
    modelName = payload.model.id.replace('claude-', '').replace(/-\d{8}$/, '');
  }

  let transcriptPath = payload?.transcript_path || payload?.transcriptPath;
  if (!transcriptPath) {
    const active = findActiveClaudeTranscripts();
    if (active.length > 0) {
      transcriptPath = active[0].transcriptPath;
    }
  }

  const parts: string[] = [];
  parts.push(pc.bold(pc.cyan(modelName)));

  if (transcriptPath) {
    const state = getTranscriptCacheState(
      transcriptPath,
      config.cache.ttlSeconds,
      config.cache.alertThresholdPercent
    );

    if (state.isWorking) {
      parts.push(pc.green('🔥 Cache: Hot'));
    } else if (state.isExpired) {
      parts.push(pc.gray('❄️ Cache: Cold'));
    } else {
      const remainingMins = Math.round(state.remainingSeconds / 60);
      parts.push(pc.green(`🟢 Cache: ~${remainingMins}m`));
    }
  }

  if (widgetText) {
    parts.push(pc.yellow(widgetText));
  }

  if (payload?.cost?.total_cost_usd !== undefined) {
    parts.push(pc.magenta(`$${payload.cost.total_cost_usd.toFixed(2)}`));
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

    // Try to place it immediately after cache-timer on the first line
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
