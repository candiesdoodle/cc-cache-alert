import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export interface ClaudeHookEntry {
  type: string;
  command: string;
  timeout?: number;
}

export interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}

export interface ClaudeSettings {
  hooks?: {
    Stop?: ClaudeHookGroup[];
    UserPromptSubmit?: ClaudeHookGroup[];
    SessionStart?: ClaudeHookGroup[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const STOP_COMMAND = 'cc-cache-alert on-stop';
const SUBMIT_COMMAND = 'cc-cache-alert on-submit';

export function getClaudeSettings(): ClaudeSettings {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveClaudeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export function areHooksInstalled(): boolean {
  const settings = getClaudeSettings();
  if (!settings.hooks) return false;

  const hasStop = settings.hooks.Stop?.some((group) =>
    group.hooks?.some((h) => h.command && h.command.includes('cc-cache-alert on-stop'))
  );

  return !!hasStop;
}

export function installClaudeHooks(): { success: boolean; message: string } {
  const settings = getClaudeSettings();
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // 1. Add Stop Hook
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }
  const stopExists = settings.hooks.Stop.some((g) =>
    g.hooks?.some((h) => h.command?.includes('cc-cache-alert on-stop'))
  );
  if (!stopExists) {
    settings.hooks.Stop.push({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: STOP_COMMAND,
          timeout: 10,
        },
      ],
    });
  }

  // 2. Add UserPromptSubmit Hook
  if (!settings.hooks.UserPromptSubmit) {
    settings.hooks.UserPromptSubmit = [];
  }
  const submitExists = settings.hooks.UserPromptSubmit.some((g) =>
    g.hooks?.some((h) => h.command?.includes('cc-cache-alert on-submit'))
  );
  if (!submitExists) {
    settings.hooks.UserPromptSubmit.push({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: SUBMIT_COMMAND,
          timeout: 10,
        },
      ],
    });
  }

  try {
    saveClaudeSettings(settings);
    return { success: true, message: 'Successfully installed hooks in ~/.claude/settings.json' };
  } catch (err) {
    return { success: false, message: `Failed to update settings.json: ${String(err)}` };
  }
}

export function uninstallClaudeHooks(): { success: boolean; message: string } {
  const settings = getClaudeSettings();
  if (!settings.hooks) {
    return { success: true, message: 'No hooks found in settings.json' };
  }

  if (settings.hooks.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.filter(
      (g) => !g.hooks?.some((h) => h.command?.includes('cc-cache-alert on-stop'))
    );
    if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
  }

  if (settings.hooks.UserPromptSubmit) {
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
      (g) => !g.hooks?.some((h) => h.command?.includes('cc-cache-alert on-submit'))
    );
    if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
  }

  try {
    saveClaudeSettings(settings);
    return { success: true, message: 'Successfully removed hooks from ~/.claude/settings.json' };
  } catch (err) {
    return { success: false, message: `Failed to update settings.json: ${String(err)}` };
  }
}
