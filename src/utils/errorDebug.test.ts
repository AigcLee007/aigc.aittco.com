import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './errorDebug';

describe('extractErrorMessage', () => {
  it('prefers upstream fail_reason over success-like message fields', () => {
    expect(
      extractErrorMessage({
        status: 'FAILURE',
        message: 'success',
        fail_reason: 'Your request was rejected by the safety system.',
      }),
    ).toBe('Your request was rejected by the safety system.');
  });

  it('reads nested failure details from data payloads', () => {
    expect(
      extractErrorMessage({
        status: 'failed',
        message: 'ok',
        data: {
          fail_reason: 'Safety review failed',
        },
      }),
    ).toBe('Safety review failed');
  });

  it('ignores standalone success-like strings as errors', () => {
    expect(extractErrorMessage('success')).toBe('');
  });

  it('parses JSON-like error strings before extracting the message', () => {
    expect(
      extractErrorMessage(
        '{"status":"FAILURE","message":"success","fail_reason":"Upstream rejected the request"}',
      ),
    ).toBe('Upstream rejected the request');
  });
});
