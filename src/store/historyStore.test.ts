import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { useHistoryStore } from './historyStore';

const storageKey = 'infinitemuse-history';

beforeEach(async () => {
  await useHistoryStore.persist.rehydrate();
  useHistoryStore.getState().clearLogs();
  await clear();
});

describe('history metadata without durable image bytes', () => {
  it('retains a completed inline result across compaction and reload when caching never finishes', async () => {
    const id = useHistoryStore.getState().addLog('keep the generation record', 'data:image/png;base64,AQID');
    useHistoryStore.getState().compactLogs();

    const persisted = JSON.parse((await get<string>(storageKey))!);
    expect(persisted.state.logs).toHaveLength(1);
    expect(persisted.state.logs[0]).toMatchObject({ id, prompt: 'keep the generation record', imageUrl: '' });
    expect(JSON.stringify(persisted)).not.toContain('base64');

    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().logs).toHaveLength(1);
    expect(useHistoryStore.getState().logs[0].id).toBe(id);
  });

  it('retains old records whose session-only image address is no longer reusable', async () => {
    await set(storageKey, JSON.stringify({ state: { logs: [
      { id: 'previous-session', time: '2026-10-15T08:00:00Z', prompt: 'previous result', imageUrl: 'blob:https://example.test/expired', type: 'IMAGE' },
      null,
      {},
    ] }, version: 0 }));

    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().logs).toEqual([
      { id: 'previous-session', time: '2026-10-15T08:00:00Z', prompt: 'previous result', imageUrl: '', type: 'IMAGE' },
    ]);
  });

  it('still honors an explicit history clear', async () => {
    useHistoryStore.getState().addLog('remove this record', 'data:image/png;base64,AQID');
    useHistoryStore.getState().clearLogs();
    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().logs).toEqual([]);
  });
});
