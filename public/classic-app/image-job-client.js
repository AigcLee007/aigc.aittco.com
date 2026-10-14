(function (root) {
  function database() {
    return new Promise((resolve, reject) => {
      const open = root.indexedDB.open('image-job-recovery-v1', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('requests')) open.result.createObjectStore('requests'); };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  async function stored(owner, requestId, value, remove = false) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('requests', value || remove ? 'readwrite' : 'readonly');
        const store = tx.objectStore('requests'), key = `${owner}:${requestId}`;
        if (value) {
          const scan = store.openCursor();
          scan.onsuccess = () => {
            const cursor = scan.result;
            if (!cursor) return;
            if (Date.now() - cursor.value.createdAt > 1200000) cursor.delete();
            cursor.continue();
          };
        }
        const req = value ? store.put(value, key) : remove ? store.delete(key) : store.get(key);
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  const transient = error => error?.status ? error.status === 408 || error.status === 429 || error.status >= 500
    : ['TypeError', 'AbortError'].includes(error?.name) || /network|timeout|failed to fetch/i.test(error?.message || '');
  async function request(url, options = {}, timeout = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => {
        if (!response.ok) throw Object.assign(new Error(`请求失败 (${response.status})`), { status: response.status });
        throw new TypeError('任务响应中断');
      });
      if (!response.ok) throw Object.assign(new Error(data.error?.message || data.error || data.message || `请求失败 (${response.status})`), { status: response.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  async function query(taskId, headers, legacyUrl, owner = '') {
    const pending = taskId.startsWith('request-');
    const url = pending ? `/api/image-jobs/request/${encodeURIComponent(taskId.slice(8))}`
      : taskId.startsWith('job-') ? `/api/task/${encodeURIComponent(taskId)}` : legacyUrl;
    try {
      const found = await request(url, { headers });
      if (pending && owner) await stored(owner, taskId.slice(8), null, true).catch(() => {});
      return found;
    }
    catch (error) {
      if (pending && error.status === 404) {
        const session = root.localStorage?.getItem('auth-session-v1');
        const headerSession = headers['X-Auth-Session'] || headers['x-auth-session'];
        if (owner && (owner !== root.classicImageJobOwner || !session || session !== headerSession)) throw Object.assign(new Error('登录账号已切换'), { status: 401 });
        if (owner) {
          const identity = await request('/api/auth/session', { headers });
          if (String(identity.user?.userId || '') !== owner || session !== root.localStorage?.getItem('auth-session-v1')) throw Object.assign(new Error('登录账号已切换'), { status: 401 });
        }
        const saved = owner ? await stored(owner, taskId.slice(8)).catch(() => null) : null;
        if (owner && (owner !== root.classicImageJobOwner || session !== root.localStorage?.getItem('auth-session-v1'))) throw Object.assign(new Error('登录账号已切换'), { status: 401 });
        if (saved && Date.now() - saved.createdAt < 1200000) {
          const result = await request(saved.endpoint, { method: 'POST', headers, body: JSON.stringify(saved.payload) }, 120000);
          await stored(owner, taskId.slice(8), null, true).catch(() => {});
          return result;
        }
        if (saved) await stored(owner, taskId.slice(8), null, true).catch(() => {});
        return { task_id: taskId, status: 'processing', connection_status: 'unconfirmed' };
      }
      throw error;
    }
  }
  async function submit(endpoint, payload, headers, requestId, owner = '') {
    const value = { ...payload, asyncTask: true, clientRequestId: requestId };
    if (owner) await stored(owner, requestId, { owner, requestId, endpoint, payload: value, createdAt: Date.now() }).catch(() => {});
    const body = JSON.stringify(value);
    const send = () => {
      if (owner && (owner !== root.classicImageJobOwner || (headers['X-Auth-Session'] || headers['x-auth-session']) !== root.localStorage?.getItem('auth-session-v1'))) throw Object.assign(new Error('登录账号已切换'), { status: 401 });
      return request(endpoint, { method: 'POST', headers, body }, 120000);
    };
    const accepted = async result => { if (owner) await stored(owner, requestId, null, true).catch(() => {}); return result; };
    try { return await accepted(await send()); }
    catch (error) {
      if (!transient(error)) { if (owner) await stored(owner, requestId, null, true).catch(() => {}); throw error; }
      try {
        const found = await query(`request-${requestId}`, headers);
        if (found.connection_status !== 'unconfirmed') return await accepted(found);
        try { return await accepted(await send()); } catch (retryError) { if (!transient(retryError)) throw retryError; }
        return found;
      } catch (lookupError) { if (!transient(lookupError)) throw lookupError; }
      return { task_id: `request-${requestId}`, status: 'processing', connection_status: 'recovering' };
    }
  }
  root.ClassicImageJobs = { request, query, submit, transient, newId: () => root.crypto?.randomUUID?.() || `img-${Date.now()}-${Math.random().toString(36).slice(2)}` };
})(typeof window === 'undefined' ? globalThis : window);
