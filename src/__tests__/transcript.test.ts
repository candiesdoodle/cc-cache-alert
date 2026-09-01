import { describe, it, expect } from 'vitest';
import { scanTailForState, hasCacheActivity } from '../transcript.js';

describe('Transcript Scanner', () => {
  it('detects when Claude is actively working (turn in flight)', () => {
    const tail = [
      '{"type":"assistant","timestamp":"2026-09-01T08:00:00.000Z","message":{"usage":{"cache_read_input_tokens":1000}}}',
      '{"type":"user","timestamp":"2026-09-01T08:05:00.000Z","message":{"content":"Run cargo test"}}',
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state).not.toBeNull();
    expect(state?.isWorking).toBe(true);
    expect(state?.lastAssistant).toBeNull();
  });

  it('detects idle turn and extracts latest assistant timestamp with cache activity', () => {
    const tail = [
      '{"type":"user","timestamp":"2026-09-01T08:00:00.000Z","message":{"content":"Fix bug"}}',
      '{"type":"assistant","timestamp":"2026-09-01T08:01:00.000Z","message":{"usage":{"cache_read_input_tokens":5000,"cache_creation_input_tokens":0}}}',
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state).not.toBeNull();
    expect(state?.isWorking).toBe(false);
    expect(state?.lastAssistant).toEqual(new Date('2026-09-01T08:01:00.000Z'));
  });

  it('skips sidechains (subagents) and error rows', () => {
    const tail = [
      '{"type":"assistant","timestamp":"2026-09-01T08:01:00.000Z","message":{"usage":{"cache_read_input_tokens":5000}}}',
      '{"type":"assistant","isSidechain":true,"timestamp":"2026-09-01T08:02:00.000Z","message":{"usage":{"cache_read_input_tokens":2000}}}',
      '{"type":"assistant","isApiErrorMessage":true,"timestamp":"2026-09-01T08:03:00.000Z"}',
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state).not.toBeNull();
    expect(state?.lastAssistant).toEqual(new Date('2026-09-01T08:01:00.000Z'));
  });
});
