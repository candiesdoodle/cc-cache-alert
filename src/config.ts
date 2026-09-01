import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AppConfig } from './types.js';

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'cc-cache-alert');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const TIMERS_DIR = path.join(CONFIG_DIR, 'timers');

export const DEFAULT_CONFIG: AppConfig = {
  telegram: {
    botToken: '',
    chatId: '',
    enabled: true,
  },
  cache: {
    ttlSeconds: 3600, // 1 hour
    alertThresholdPercent: 20, // 20% (12 mins remaining)
  },
  notifications: {
    sound: true,
    includeProjectName: true,
    includeSessionName: true,
  },
};

export function ensureDirs(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(TIMERS_DIR)) {
    fs.mkdirSync(TIMERS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): AppConfig {
  ensureDirs();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Support legacy includeSessionId if includeSessionName is missing
    const includeSessionName =
      parsed.notifications?.includeSessionName ??
      parsed.notifications?.includeSessionId ??
      DEFAULT_CONFIG.notifications.includeSessionName;

    return {
      telegram: { ...DEFAULT_CONFIG.telegram, ...parsed.telegram },
      cache: { ...DEFAULT_CONFIG.cache, ...parsed.cache },
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...parsed.notifications,
        includeSessionName,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}
