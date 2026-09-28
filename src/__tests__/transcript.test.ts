import { describe, it, expect } from 'vitest';
import { scanTailForState } from '../transcript.js';

describe('Transcript Scanner', () => {
  it('detects when Claude is actively working (turn in flight)', () => {
    const nowIso = new Date().toISOString();
    const tail = [
      '{"type":"assistant","timestamp":"2026-09-01T08:00:00.000Z","message":{"usage":{"cache_read_input_tokens":1000}}}',
      `{"type":"user","timestamp":"${nowIso}","message":{"content":"Run cargo test"}}`,
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state).not.toBeNull();
    expect(state?.isWorking).toBe(true);
    expect(state?.lastAssistant).toBeNull();
  });

  it('does not get stuck in working state on slash commands like /compact', () => {
    const nowIso = new Date().toISOString();
    const tail = [
      '{"type":"assistant","timestamp":"2026-09-01T08:00:00.000Z","message":{"usage":{"cache_read_input_tokens":1000}}}',
      `{"type":"user","timestamp":"${nowIso}","message":{"content":"/compact"}}`,
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state).not.toBeNull();
    expect(state?.isWorking).toBe(false);
    expect(state?.lastAssistant).toEqual(new Date('2026-09-01T08:00:00.000Z'));
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

  it('reports compacted after /compact as recorded by Claude Code', () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const tail = [
      `{"type":"assistant","timestamp":"${iso(-120000)}","message":{"usage":{"cache_read_input_tokens":1000}}}`,
      `{"type":"system","subtype":"compact_boundary","timestamp":"${iso(-1000)}"}`,
      `{"type":"user","isCompactSummary":true,"timestamp":"${iso(-1000)}","message":{"content":"This session is being continued..."}}`,
      `{"type":"user","isMeta":true,"timestamp":"${iso(-60000)}","message":{"content":"<local-command-caveat>Caveat</local-command-caveat>"}}`,
      `{"type":"user","timestamp":"${iso(-60000)}","message":{"content":"<command-name>/compact</command-name>"}}`,
      `{"type":"user","timestamp":"${iso(-500)}","message":{"content":"<local-command-stdout>Compacted</local-command-stdout>"}}`,
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state?.isCompacted).toBe(true);
    expect(state?.isWorking).toBe(false);
  });

  it('resumes normal tracking once a turn completes after compaction', () => {
    const tail = [
      '{"type":"system","subtype":"compact_boundary","timestamp":"2026-09-01T08:00:00.000Z"}',
      '{"type":"user","timestamp":"2026-09-01T08:01:00.000Z","message":{"content":"next task"}}',
      '{"type":"assistant","timestamp":"2026-09-01T08:02:00.000Z","message":{"usage":{"cache_creation_input_tokens":800}}}',
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state?.isCompacted).toBeFalsy();
    expect(state?.lastAssistant).toEqual(new Date('2026-09-01T08:02:00.000Z'));
  });

  it('treats a new prompt after compaction as a turn in flight', () => {
    const tail = [
      '{"type":"system","subtype":"compact_boundary","timestamp":"2026-09-01T08:00:00.000Z"}',
      `{"type":"user","timestamp":"${new Date().toISOString()}","message":{"content":"next task"}}`,
    ].join('\n');

    expect(scanTailForState(tail)?.isWorking).toBe(true);
  });

  it('ignores local command output such as /rename', () => {
    const tail = [
      '{"type":"assistant","timestamp":"2026-09-01T08:00:00.000Z","message":{"usage":{"cache_read_input_tokens":1000}}}',
      `{"type":"user","timestamp":"${new Date().toISOString()}","message":{"content":"<command-name>/rename</command-name>"}}`,
      `{"type":"user","timestamp":"${new Date().toISOString()}","message":{"content":"<local-command-stdout>Renamed</local-command-stdout>"}}`,
    ].join('\n');

    const state = scanTailForState(tail);
    expect(state?.isWorking).toBe(false);
    expect(state?.lastAssistant).toEqual(new Date('2026-09-01T08:00:00.000Z'));
  });

  it('uses the in-flight window passed by the caller (TTL)', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const tail = [
      '{"type":"assistant","timestamp":"2026-09-01T08:00:00.000Z","message":{"usage":{"cache_read_input_tokens":1000}}}',
      `{"type":"user","timestamp":"${tenMinAgo}","message":{"content":"long running task"}}`,
    ].join('\n');

    expect(scanTailForState(tail, 3600 * 1000)?.isWorking).toBe(true);
    expect(scanTailForState(tail, 300 * 1000)?.isWorking).toBe(false);
  });
});
