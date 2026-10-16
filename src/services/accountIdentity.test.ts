import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCurrentAuthSession,
  fetchRegistrationStatus,
  getStoredAuthSessionToken,
  setStoredAuthSessionToken,
} from './accountIdentity';

const session = { success: true, authenticated: true, user: { userId: 'admin-a' } };
const reply = (data: unknown, status = 200) => ({
  ok: status < 400, status, json: async () => data,
}) as Response;

describe('account verification under a stalled server', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setStoredAuthSessionToken('session-a');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shares concurrent verification, then checks the server again on the next refresh', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = fetchCurrentAuthSession();
    const second = fetchCurrentAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(reply(session));
    await expect(first).resolves.toEqual(session);
    await expect(second).resolves.toEqual(session);
    fetchMock.mockResolvedValueOnce(reply(session));
    await fetchCurrentAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ends a stalled verification, aborts its transport and permits a fresh retry', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const pending = expect(fetchCurrentAuthSession()).rejects.toMatchObject({ code: 'CLIENT_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(12001);
    await pending;
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(getStoredAuthSessionToken()).toBe('session-a');
    fetchMock.mockResolvedValueOnce(reply(session));
    await expect(fetchCurrentAuthSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the deadline active while the response body stalls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })));
    const pending = expect(fetchCurrentAuthSession()).rejects.toMatchObject({ code: 'CLIENT_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(12001);
    await pending;
  });

  it('bounds the independent registration-status read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const pending = expect(fetchRegistrationStatus()).rejects.toMatchObject({ code: 'CLIENT_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(12001);
    await pending;
  });

  it('keeps the session token on server failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'Server busy' }, 503)));
    await expect(fetchCurrentAuthSession()).rejects.toThrow('Server busy');
    expect(getStoredAuthSessionToken()).toBe('session-a');
  });

  it('clears a rejected current session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({}, 401)));
    await expect(fetchCurrentAuthSession()).resolves.toBeNull();
    expect(getStoredAuthSessionToken()).toBeNull();
  });

  it.each([200, 401])('discards an old %s response after an account change', async status => {
    let resolveOld!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(done => { resolveOld = done; }))
      .mockResolvedValueOnce(reply({ ...session, user: { userId: 'admin-b' } }));
    vi.stubGlobal('fetch', fetchMock);
    const old = fetchCurrentAuthSession();
    setStoredAuthSessionToken('session-b');
    await expect(fetchCurrentAuthSession()).resolves.toMatchObject({ user: { userId: 'admin-b' } });
    resolveOld(reply(session, status));
    await expect(old).resolves.toBeNull();
    expect(getStoredAuthSessionToken()).toBe('session-b');
  });
});
