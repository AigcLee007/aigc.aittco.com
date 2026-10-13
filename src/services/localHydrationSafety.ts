// Each unread store protects its own persisted data; cleanup waits for all stores.
const failedStores = new Set<string>();
const readBaselines = new Map<string, unknown>();
const failedAttempts = new Set<string>();
const listeners = new Set<() => void>();

export function beginLocalRead(store: string, state: unknown) {
  if (!readBaselines.has(store)) readBaselines.set(store, state);
  failedAttempts.delete(store);
}

export function setLocalReadFailed(store: string) {
  failedStores.add(store);
  failedAttempts.add(store);
  listeners.forEach(listener => listener());
}

export function setLocalReadSucceeded(store: string) {
  failedStores.delete(store);
  failedAttempts.delete(store);
  readBaselines.delete(store);
  listeners.forEach(listener => listener());
}

export function finishLocalRead(store: string, error?: unknown) {
  if (error || failedAttempts.has(store)) {
    setLocalReadFailed(store);
    return false;
  }
  // Called after Zustand has installed the merged state.
  setLocalReadSucceeded(store);
  return true;
}

export function localStoreWritable(store: string) {
  return !failedStores.has(store) && !readBaselines.has(store);
}

export function deferLocalRecoveryWrite(store: string, writeLatest: () => unknown) {
  // Initial localStorage hydration can finish before the exported store exists.
  // Read the live state in this microtask, including edits made during install.
  void Promise.resolve().then(() => {
    if (localStoreWritable(store)) return writeLatest();
  }).catch(error => console.warn(`[LocalPersistence] Failed to persist recovered ${store}`, error));
}

export function localReadFailed(store: string) { return failedStores.has(store); }
export function localReadsSafe() { return failedStores.size === 0; }
export function subscribeLocalReadSafety(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  }
  return false;
}

function overlayDelta(baseline: unknown, current: unknown, recovered: unknown, collection = false): unknown {
  if (equal(baseline, current)) return recovered;
  if (collection && Array.isArray(baseline) && Array.isArray(current) && Array.isArray(recovered)) {
    const before = new Map(baseline.map(item => [item.id, item]));
    const saved = new Map(recovered.map(item => [item.id, item]));
    const currentIds = new Set(current.map(item => item.id));
    // Current order preserves prepended history, node reorder and new references.
    const edited = current.map(item => {
      if (!before.has(item.id)) return item;
      return overlayDelta(before.get(item.id), item, saved.get(item.id) ?? item);
    });
    return [...edited, ...recovered.filter(item => !before.has(item.id) && !currentIds.has(item.id))];
  }
  if (isRecord(baseline) && isRecord(current) && isRecord(recovered)) {
    const result = { ...recovered };
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
      if (equal(baseline[key], current[key])) continue;
      if (!Object.hasOwn(current, key)) delete result[key];
      else result[key] = overlayDelta(baseline[key], current[key], recovered[key]);
    }
    return result;
  }
  return current;
}

export function mergeRecoveredLocalState<T extends object>(store: string, recovered: T, current: T, collections: string[] = []): T {
  if (failedAttempts.has(store)) return current;
  const baseline = readBaselines.get(store);
  if (!isRecord(baseline)) return recovered;
  const result = { ...recovered } as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    const latest = (current as Record<string, unknown>)[key];
    if (!equal(baseline[key], latest)) {
      result[key] = overlayDelta(baseline[key], latest, result[key], collections.includes(key));
    }
  }
  return result as T;
}
