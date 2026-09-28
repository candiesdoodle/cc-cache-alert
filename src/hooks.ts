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
    SessionEnd?: ClaudeHookGroup[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const HOOKS: Array<{ event: string; matcher?: string; command: string }> = [
  { event: 'Stop', command: 'cc-cache-alert on-stop' },
  { event: 'UserPromptSubmit', command: 'cc-cache-alert on-submit' },
  // /compact keeps the session id and fires SessionStart with source "compact"
  { event: 'SessionStart', matcher: 'compact', command: 'cc-cache-alert on-reset' },
  // /clear fires SessionEnd with reason "clear" and the old session id, then starts a new session
  { event: 'SessionEnd', matcher: 'clear', command: 'cc-cache-alert on-reset' },
];

function hasHook(groups: ClaudeHookGroup[] | undefined, command: string): boolean {
  return !!groups?.some((g) => g.hooks?.some((h) => h.command?.includes(command)));
}

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
  const hooks = getClaudeSettings().hooks;
  if (!hooks) return false;
  return HOOKS.every((h) => hasHook(hooks[h.event] as ClaudeHookGroup[] | undefined, h.command));
}

export function installClaudeHooks(): { success: boolean; message: string } {
  const settings = getClaudeSettings();
  const hooks = (settings.hooks ??= {});

  for (const h of HOOKS) {
    const groups = ((hooks[h.event] as ClaudeHookGroup[] | undefined) ??= []);
    if (hasHook(groups, h.command)) continue;
    groups.push({
      ...(h.matcher ? { matcher: h.matcher } : {}),
      hooks: [{ type: 'command', command: h.command, timeout: 10 }],
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

  for (const event of new Set(HOOKS.map((h) => h.event))) {
    const groups = settings.hooks[event] as ClaudeHookGroup[] | undefined;
    if (!groups) continue;
    const kept = groups.filter((g) => !g.hooks?.some((h) => h.command?.startsWith('cc-cache-alert ')));
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }

  try {
    saveClaudeSettings(settings);
    return { success: true, message: 'Successfully removed hooks from ~/.claude/settings.json' };
  } catch (err) {
    return { success: false, message: `Failed to update settings.json: ${String(err)}` };
  }
}
