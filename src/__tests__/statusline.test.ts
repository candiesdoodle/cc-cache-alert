import { describe, it, expect } from 'vitest';
import { renderWidget, renderStandaloneStatusline } from '../statusline.js';

describe('Statusline Module', () => {
  it('renders standalone statusline with model and cost', () => {
    const output = renderStandaloneStatusline({
      model: { display_name: 'Claude 3.7 Sonnet' },
      cost: { total_cost_usd: 0.42 },
    });

    expect(output).toContain('Claude 3.7 Sonnet');
    expect(output).toContain('$0.42');
  });

  it('renders widget text gracefully without crashing', () => {
    const text = renderWidget({
      session_id: 'test-session',
    });
    // Can be empty or string depending on mock data
    expect(typeof text).toBe('string');
  });
});
