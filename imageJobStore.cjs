const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const safe = value => {
  const text = String(value ?? '');
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(text)) throw Object.assign(new Error('Invalid task identifier'), { status: 400 });
  return text;
};
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const canonicalize = value => {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value).sort().reduce((result, key) => {
    if (!['clientRequestId', 'client_request_id', 'asyncTask'].includes(key)) result[key] = canonicalize(value[key]);
    return result;
  }, {});
};
const fingerprintBody = body => crypto.createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
const statusError = (message, status) => Object.assign(new Error(message), { status });

function createImageJobStore(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, 'storage', 'image-jobs'));
  const jobsDir = path.join(root, 'jobs');
  const requestsDir = path.join(root, 'requests');
  const outcomesDir = path.join(root, 'outcomes');
  const assetUpdatesDir = path.join(root, 'asset-updates');
  const pendingDir = path.join(root, 'pending');
  const settlementDir = path.join(root, 'settlement');
  const storagePendingDir = path.join(root, 'storage-pending');
  const db = options.useMySql === false ? null : require('./db.cjs');
  const useMySql = options.useMySql === true || Boolean(db?.isMySqlConfigured());
  let pool = options.pool;
  const lock = new Map();
  let ready;
  const init = () => ready ||= (async () => {
    await Promise.all([jobsDir,requestsDir,outcomesDir,assetUpdatesDir,pendingDir,settlementDir,storagePendingDir].map(directory=>fs.mkdir(directory,{recursive:true})));
    if(useMySql) {
      pool ||= await db.getPool();
      await pool.execute(`CREATE TABLE IF NOT EXISTS image_jobs (
        task_id VARCHAR(100) PRIMARY KEY, user_id VARCHAR(100) NOT NULL,
        request_id VARCHAR(128) NOT NULL, fingerprint CHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL, created_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL,
        job_json JSON NOT NULL, UNIQUE KEY image_jobs_owner_request (user_id, request_id),
        KEY image_jobs_status (status, created_at_ms), KEY image_jobs_owner_created (user_id,created_at_ms)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    }
    else {
      // Rebuild compact on-disk indexes once at boot, including jobs written
      // immediately before an interruption in pointer maintenance.
      for(const entry of (await fs.readdir(jobsDir)).filter(name=>name.endsWith('.json'))) {
        const job=JSON.parse(await fs.readFile(path.join(jobsDir,entry),'utf8'));
        if(['queued','running'].includes(job.status))await fs.writeFile(path.join(pendingDir,`${safe(job.taskId)}.json`),'');
        if(job.settlementPending)await fs.writeFile(path.join(settlementDir,`${safe(job.taskId)}.json`),'');
        if(job.status==='succeeded'&&job.storageStatus==='pending')await fs.writeFile(path.join(storagePendingDir,`${safe(job.taskId)}.json`),'');
      }
    }
  })().catch(error=>{ready=null;throw error;});
  const serialize = value => JSON.stringify(value, null, 2);
  const jobFile = id => path.join(jobsDir, `${safe(id)}.json`);
  const requestFile = id => path.join(requestsDir, `${safe(id)}.json`);
  const withLock = async (key, work) => {
    const prior = lock.get(key) || Promise.resolve();
    let resolve;
    const next = new Promise(r => { resolve = r; });
    lock.set(key, next);
    await prior;
    try { return await work(); } finally { resolve(); if (lock.get(key) === next) lock.delete(key); }
  };
  const writeAtomic = async (file, data) => {
    const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    const handle=await fs.open(temp,'wx',0o600);
    try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
    try {
      for(let attempt=0;;attempt++) {
        try {await fs.rename(temp,file);break;}
        catch(error){
          // Windows readers and scanners can hold the destination briefly. Keep
          // the old metadata intact while retrying the same atomic replacement.
          if(attempt>=12||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
          await new Promise(resolve=>setTimeout(resolve,Math.min(200,25*2**attempt)));
        }
      }
    } catch (error) { await fs.unlink(temp).catch(()=>{}); throw error; }
  };
  const parseRow = row => row ? (typeof row.job_json==='string'?JSON.parse(row.job_json):clone(row.job_json)) : null;
  const read = async id => {
    await init();
    if(useMySql){const [rows]=await pool.execute('SELECT job_json FROM image_jobs WHERE task_id = ?',[safe(id)]);return parseRow(rows[0]);}
    try { return JSON.parse(await fs.readFile(jobFile(id),'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const admit = async (input = {}, {body = null} = {}) => {
    await init();
    const taskId = safe(input.taskId || `job-${crypto.randomBytes(12).toString('hex')}`);
    const requestId = String(input.requestId || '').trim();
    const userId = String(input.userId || '').trim();
    if (!/^job-[a-zA-Z0-9_-]+$/.test(taskId) || !requestId || !userId) throw statusError('Invalid image job admission',400);
    const fp = input.fingerprint || fingerprintBody(body || {});
    return withLock(`request:${userId}:${requestId}`, async () => {
      const duplicate = await findByRequest(requestId,userId);
      if (duplicate) {
        if (duplicate.fingerprint !== fp) throw statusError('clientRequestId is already used for a different request',409);
        return {job: duplicate, duplicate:true};
      }
      const now = new Date().toISOString();
      const job = {
        taskId, id: taskId, endpoint: String(input.endpoint || ''), requestId, userId,
        accountId: input.accountId || null, chargeId: input.chargeId || null,
        generationRecordId: input.generationRecordId || null,
        uiMode: input.uiMode || 'canvas', clientLiveTaskIds: input.clientLiveTaskIds || [],
        prompt: String(input.prompt || '').slice(0,32000), modelId: input.modelId || null,
        model: input.model || null, routeId: input.routeId || null, outputSize: input.outputSize || null,
        aspectRatio: input.aspectRatio || null,
        fingerprint: fp, status: input.status || 'queued', progress: 0,
        innerTaskId: input.innerTaskId || null, resultUrls: [], images: [], results: [],
        previewUrl: null, storageStatus: null, storage_status: null, error: null,
        settlementPending: false, compensatedAt: null, createdAt: input.createdAt || now,
        updatedAt: now, startedAt: null, completedAt: null, deadlineAt: input.deadlineAt || null,
      };
      await writeAtomic(requestFile(taskId), serialize(body || {}));
      try {
        if(useMySql)await pool.execute('INSERT INTO image_jobs (task_id,user_id,request_id,fingerprint,status,created_at_ms,updated_at_ms,job_json) VALUES (?,?,?,?,?,?,?,?)',[taskId,userId,requestId,fp,job.status,new Date(job.createdAt).getTime(),Date.now(),JSON.stringify(job)]);
        else {await writeAtomic(jobFile(taskId), serialize(job));await syncIndex(job);}
      }catch(error){
        await fs.unlink(requestFile(taskId)).catch(()=>{});
        if(error.code==='ER_DUP_ENTRY') {
          const winner=await findByRequest(requestId,userId);
          if(winner?.fingerprint!==fp)throw statusError('clientRequestId is already used for a different request',409);
          return {job:winner,duplicate:true};
        }
        throw error;
      }
      return {job, duplicate:false};
    });
  };
  const update = async (id, patchOrFn) => withLock(`job:${id}`, async () => {
    const current = await read(id); if (!current) return null;
    const patch = typeof patchOrFn === 'function' ? await patchOrFn(clone(current)) : patchOrFn;
    const next = {...current, ...(patch || {}), updatedAt:new Date().toISOString()};
    if(useMySql)await pool.execute('UPDATE image_jobs SET status = ?, updated_at_ms = ?, job_json = ? WHERE task_id = ?',[next.status,Date.now(),JSON.stringify(next),safe(id)]);
    else {
      await writeAtomic(jobFile(id), serialize(next));
      await syncIndex(next);
    }
    return clone(next);
  });
  const syncIndex = async job => {
    for(const [directory,keep]of [[pendingDir,['queued','running'].includes(job.status)],[settlementDir,job.settlementPending],[storagePendingDir,job.status==='succeeded'&&job.storageStatus==='pending']]) {
      const file=path.join(directory,`${safe(job.taskId)}.json`);
      if(keep)await fs.writeFile(file,'');else await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  };
  const list = async ({status, statuses, userId, uiMode, includeBody = false, publicListProjection = false, settlementPending, storageStatus, limit, descending=false, createdBefore} = {}) => {
    await init();
    if(useMySql){
      const predicates=[],params=[];
      if(userId){predicates.push('user_id = ?');params.push(userId);}
      if(uiMode){predicates.push("JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.uiMode')) = ?");params.push(uiMode);}
      if(status){predicates.push('status = ?');params.push(status);}
      if(statuses?.length){predicates.push(`status IN (${statuses.map(()=>'?').join(',')})`);params.push(...statuses);}
      if(settlementPending){predicates.push("JSON_EXTRACT(job_json, '$.settlementPending') = true");}
      if(storageStatus){predicates.push("JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.storageStatus')) = ?");params.push(storageStatus);}
      if(createdBefore){predicates.push('created_at_ms < ?');params.push(createdBefore);}
      const safeLimit=Math.max(1,Math.min(5000,Number(limit)||5000));
      // Public recovery uses resultUrls, billing and payload.preview_urls only.
      // Drop duplicate provider data in MySQL before it crosses the connection;
      // maintenance, settlement and individual lookups still read the full job.
      const projection=publicListProjection
        ? "JSON_SET(JSON_REMOVE(job_json, '$.payload', '$.images', '$.results'), '$.payload', JSON_OBJECT('preview_urls', JSON_EXTRACT(job_json, '$.payload.preview_urls'))) AS job_json"
        : 'job_json';
      // Sort only narrow ids: ordering full job_json rows overflows MySQL's
      // sort buffer once payloads grow, which silently stopped maintenance.
      const [idRows]=await pool.execute(`SELECT task_id FROM image_jobs${predicates.length?` WHERE ${predicates.join(' AND ')}`:''} ORDER BY created_at_ms ${descending?'DESC':'ASC'} LIMIT ${safeLimit}`,params);
      const ids=idRows.map(row=>row.task_id);
      if(!ids.length)return [];
      const [jobRows]=await pool.execute(`SELECT task_id, ${projection} FROM image_jobs WHERE task_id IN (${ids.map(()=>'?').join(',')})`,ids);
      const byId=new Map(jobRows.map(row=>[row.task_id,row]));
      const rows=ids.map(id=>byId.get(id)).filter(Boolean);
      return rows.map(parseRow).filter(job=>(!status||job.status===status)&&(!statuses?.length||statuses.includes(job.status))&&(!userId||job.userId===userId)&&(!uiMode||job.uiMode===uiMode)&&(!settlementPending||job.settlementPending)&&(!storageStatus||job.storageStatus===storageStatus));
    }
    const indexDir=storageStatus==='pending'?storagePendingDir:settlementPending?settlementDir:statuses?.every(value=>['queued','running'].includes(value))?pendingDir:status&&['queued','running'].includes(status)?pendingDir:jobsDir;
    const entries = await fs.readdir(indexDir); const jobs=[];
    for (const entry of entries.filter(name=>name.endsWith('.json'))) {
      try { const job=JSON.parse(await fs.readFile(path.join(jobsDir,entry),'utf8')); if (status && job.status !== status) continue; if(statuses?.length&&!statuses.includes(job.status))continue;if(settlementPending&&!job.settlementPending)continue;if(storageStatus&&job.storageStatus!==storageStatus)continue;if(createdBefore&&new Date(job.createdAt).getTime()>=createdBefore)continue; if (userId && job.userId !== userId) continue; if(uiMode&&job.uiMode!==uiMode)continue; if (includeBody) job.body=JSON.parse(await fs.readFile(requestFile(job.taskId),'utf8')); jobs.push(job); } catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    const sorted=jobs.sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime());if(descending)sorted.reverse();return limit?sorted.slice(0,Math.max(1,Number(limit)||100)):sorted;
  };
  const get = async id => read(id);
  const findByRequest = async (requestId, userId) => {
    await init();
    if(useMySql){const [rows]=await pool.execute('SELECT job_json FROM image_jobs WHERE user_id = ? AND request_id = ?',[String(userId),String(requestId)]);return parseRow(rows[0]);}
    return (await list({userId})).find(job=>job.requestId===String(requestId||'').trim()) || null;
  };
  const readRequest = async id => { await init(); try { return JSON.parse(await fs.readFile(requestFile(id),'utf8')); } catch (error) { if(error.code==='ENOENT') throw error; throw error; } };
  const remove = async id => {await init();if(useMySql)await pool.execute('DELETE FROM image_jobs WHERE task_id = ?',[safe(id)]);else await fs.unlink(jobFile(id)).catch(()=>{});await Promise.all([requestFile(id),path.join(pendingDir,`${safe(id)}.json`),path.join(settlementDir,`${safe(id)}.json`),path.join(storagePendingDir,`${safe(id)}.json`),path.join(outcomesDir,`${safe(id)}.json`),path.join(assetUpdatesDir,`${safe(id)}.json`)].map(file=>fs.unlink(file).catch(()=>{})));};
  const removeRequest = async id => fs.unlink(requestFile(id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const saveOutcome = async (id,patch) => withLock(`outcome:${id}`,async()=>{await init();await writeAtomic(path.join(outcomesDir,`${safe(id)}.json`),JSON.stringify({taskId:id,patch}));});
  const recoverOutcomes = async ({excludeTaskIds=[],shouldRecover=()=>true}={}) => {
    await init();
    for(const entry of (await fs.readdir(outcomesDir)).filter(name=>name.endsWith('.json'))) {
      const id=entry.slice(0,-5);
      await withLock(`outcome:${id}`,async()=>{
        // Check live executions after enumeration and while holding the same
        // lock used by publication, so an old confirmation cannot replace final assets.
        if(excludeTaskIds.includes(id)||!shouldRecover(id))return;
        const file=path.join(outcomesDir,entry);
        let outcome;
        try{outcome=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
        await update(outcome.taskId,outcome.patch);
        await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
      });
    }
  };
  const clearOutcome = async id => withLock(`outcome:${id}`,()=>fs.unlink(path.join(outcomesDir,`${safe(id)}.json`)).catch(error=>{if(error.code!=='ENOENT')throw error;}));
  // Asset callbacks may arrive long after generation completion. Keep their
  // compact publication separate so completion cannot clear a newer save.
  const saveAssetUpdate = async (id,patch,version) => withLock(`asset-update:${id}`,async()=>{
    await init();await writeAtomic(path.join(assetUpdatesDir,`${safe(id)}.json`),JSON.stringify({taskId:id,patch,version}));
  });
  const clearAssetUpdate = async (id,version) => withLock(`asset-update:${id}`,async()=>{
    const file=path.join(assetUpdatesDir,`${safe(id)}.json`);
    try{const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.version===version)await fs.unlink(file);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  });
  const recoverAssetUpdates = async ({excludeTaskIds=[]}={}) => {
    await init();
    for(const entry of (await fs.readdir(assetUpdatesDir)).filter(name=>name.endsWith('.json'))) {
      const id=entry.slice(0,-5);if(excludeTaskIds.includes(id))continue;
      await withLock(`asset-update:${id}`,async()=>{
        const file=path.join(assetUpdatesDir,entry);
        const {taskId,patch}=JSON.parse(await fs.readFile(file,'utf8'));
        await update(taskId,current=>current.status==='failed'?{}:patch);await fs.unlink(file);
      });
    }
  };
  return {root,jobsDir,requestsDir,admit,update,get,list,findByRequest,readRequest,remove,removeRequest,saveOutcome,recoverOutcomes,clearOutcome,saveAssetUpdate,clearAssetUpdate,recoverAssetUpdates,fingerprintBody,init};
}

module.exports = {createImageJobStore, fingerprintBody, canonicalize};
