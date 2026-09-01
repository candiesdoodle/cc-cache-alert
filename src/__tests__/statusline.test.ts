import { describe, it, expect } from 'vitest';
import { renderWidget, renderStandaloneStatusline, getInitialAlertThresholdMinutes } from '../statusline.js';

describe('Statusline Module', () => {
  it('calculates initial threshold minutes correctly', () => {
    // 3600s TTL (1h) with 20% alert threshold -> 80% elapsed = 2880s = 48 mins
    const mins1h = getInitialAlertThresholdMinutes(3600, 20);
    expect(mins1h).toBe(48);

    // 300s TTL (5m) with 20% alert threshold -> 80% elapsed = 240s = 4 mins
    const mins5m = getInitialAlertThresholdMinutes(300, 20);
    expect(mins5m).toBe(4);
  });

  it('renders standalone statusline sticking strictly to cache info without model or cost', () => {
    const output = renderStandaloneStatusline({
      model: { display_name: 'Claude 3.7 Sonnet' },
      cost: { total_cost_usd: 12.34 },
    });

    // Must NOT contain model name or cost
    expect(output).not.toContain('Claude 3.7 Sonnet');
    expect(output).not.toContain('$12.34');
    expect(output).toContain('Cache:');
  });

  it('renders widget text gracefully without crashing', () => {
    const text = renderWidget({
      session_id: 'test-session',
    });
    expect(typeof text).toBe('string');
  });
});
