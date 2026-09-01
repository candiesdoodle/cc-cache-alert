import { describe, it, expect } from 'vitest';
import { formatCacheAlertMessage } from '../telegram.js';

describe('Telegram Formatter', () => {
  it('formats cache alert with project and custom session name', () => {
    const msg = formatCacheAlertMessage({
      project: 'my-web-app',
      sessionName: 'refactor-auth-flow',
      remainingMinutes: 12,
      remainingSeconds: 720,
      ttlLabel: '1h',
    });

    expect(msg).toContain('Claude Code Prompt Cache Expiring Soon!');
    expect(msg).toContain('my-web-app');
    expect(msg).toContain('refactor-auth-flow');
    expect(msg).toContain('~12m');
    expect(msg).toContain('1h');
  });
});
