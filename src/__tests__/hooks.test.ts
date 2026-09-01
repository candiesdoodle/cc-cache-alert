import { describe, it, expect } from 'vitest';
import { formatCacheAlertMessage } from '../telegram.js';

describe('Telegram Formatter', () => {
  it('formats cache alert with project and session', () => {
    const msg = formatCacheAlertMessage({
      project: 'my-web-app',
      sessionId: '6ed6c317-a17f-4365-be60-1f19ba98a15a',
      remainingMinutes: 12,
      remainingSeconds: 720,
      ttlLabel: '1h',
    });

    expect(msg).toContain('Claude Code Prompt Cache Expiring Soon!');
    expect(msg).toContain('my-web-app');
    expect(msg).toContain('6ed6c317');
    expect(msg).toContain('~12m');
    expect(msg).toContain('1h');
  });
});
