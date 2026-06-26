import { describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS,
  revokeDownloadObjectUrlLater,
} from './downloadObjectUrl';

describe('download object URL cleanup', () => {
  it('keeps generated blob URLs alive long enough for large downloads to start', () => {
    expect(DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS).toBeGreaterThanOrEqual(60000);
  });

  it('schedules object URL cleanup instead of revoking immediately', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.useFakeTimers();

    revokeDownloadObjectUrlLater('blob:https://aigc.aittco.com/example');

    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS - 1);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:https://aigc.aittco.com/example');

    vi.useRealTimers();
    revokeSpy.mockRestore();
  });
});
