const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { fingerprintBody } = require('./imageJobStore.cjs');

const imageJobContext = new AsyncLocalStorage();
const statusError = (message, status = 500) => Object.assign(new Error(message), {status});
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : fallback;
const terminal = job => ['succeeded','failed'].includes(job?.status);
const state = payload => String(payload?.status || payload?.state || payload?.data?.status || payload?.data?.state || '').trim().toUpperCase();
const readProgress = (payload, depth=0) => {
  if(!payload || typeof payload!=='object' || depth>4)return undefined;
  for(const key of ['progress','percentage','percent']) {
    const raw=payload[key];
    const value=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(?:\.\d+)?\s*%?$/.test(raw.trim())?Number(raw.trim().replace(/\s*%$/,'')):NaN;
    if(Number.isFinite(value)&&value>0&&value<100)return value;
  }
  for(const key of ['data','task','result']) {const value=readProgress(payload[key],depth+1);if(value!==undefined)return value;}
};
const failureState = value => ['FAILED','FAILURE','ERROR','CANCELLED','CANCELED','EXPIRED'].includes(value);
const successState = value => ['SUCCESS','SUCCEEDED','COMPLETED','DONE'].includes(value);
const collectImages = value => {
  const found=[];
  const visit = (entry, key='') => {
    if (typeof entry === 'string') {
      if (['url','image_url','imageUrl','src','output','images','results'].includes(key) && (/^https?:\/\//i.test(entry) || /^\/(api\/image-job-assets|generated-assets)\//.test(entry) || /^data:image\//i.test(entry))) found.push(entry);
      if (key==='b64_json' && entry.trim()) found.push(/^data:image\//i.test(entry) ? entry : `data:image/png;base64,${entry}`);
      return;
    }
    if (Array.isArray(entry)) return entry.forEach(item=>visit(item,key));
    if (entry && typeof entry==='object') Object.entries(entry).forEach(([child,nested])=>visit(nested,child));
  };
  visit(value);return [...new Set(found)];
};
const safeUrlList = (payload,key) => (Array.isArray(payload?.[key]) ? payload[key] : Array.isArray(payload?.payload?.[key]) ? payload.payload[key] : [])
  .slice(0,12).map(url => typeof url === 'string' && url.length <= 8192 && /^(https?:\/\/|\/(?!\/))/i.test(url) && !/\[truncated\]/i.test(url) ? url : null);
const STORAGE_MODES = ['auto','stable','speed'];
const normalizeStorageMode = value => STORAGE_MODES.includes(value) ? value : 'auto';
const smallPayload = (payload, urls) => ({
  ...(payload?.billing ? {billing:payload.billing} : {}),
  images:urls,results:urls,data:urls.map(url=>({url})),
  preview_urls: safeUrlList(payload,'preview_urls'),
  fast_urls: safeUrlList(payload,'fast_urls'),
  direct_urls: safeUrlList(payload,'direct_urls'),
  ...(payload?.storage_mode||payload?.payload?.storage_mode?{storage_mode:payload.storage_mode||payload.payload.storage_mode}:{}),
});

// Telemetry is deliberately a projection, never a copy of a provider/request object.
const operationsText = (value, max=1000) => String(value ?? '')
  .replace(/(?:https?:\/\/|data:)[^\s<>"']+/gi,'[redacted URL]')
  .replace(/\bBearer\s+[^\s,;]+/gi,'Bearer [redacted]')
  .replace(/\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:token|id|key)?|password|secret|token|prompt|request[_ -]?body|response[_ -]?body)\b\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'[redacted]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[redacted]')
  .replace(/\b[A-Za-z0-9+/=_-]{160,}\b/g,'[redacted]').slice(0,max);
const operationsPhase = job => job.phase || (job.status==='queued'?'local_queued':job.status==='running'?(['QUEUED','IN_QUEUE'].includes(job.upstreamStatus)?'upstream_queued':'processing'):job.status);
const operationsTask = job => {
  const task={};
  for(const key of ['taskId','requestId','userId','userLabel','uiMode','modelId','routeId','status','storageStatus','storageError','createdAt','startedAt','upstreamStartedAt','completedAt','updatedAt','error','failureCode']) {
    if(job?.[key]!==undefined&&job[key]!==null)task[key]=operationsText(job[key],['error','storageError'].includes(key)?1000:255);
  }
  task.phase=operationsText(operationsPhase(job||{}),32);
  if(typeof job?.settlementPending==='boolean')task.settlementPending=job.settlementPending;
  if(job?.compensatedAt)task.compensatedAt=operationsText(job.compensatedAt,40);
  const httpStatus=Number(job?.httpStatus);if(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)task.httpStatus=httpStatus;
  return task;
};
const operationsFailure = error => {
  const httpStatus=Number(error?.httpStatus||error?.status||error?.response?.status);
  const code=error?.failureCode||error?.code||error?.response?.data?.error?.code;
  return {...(code?{failureCode:operationsText(code,100)}:{}),...(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?{httpStatus}:{}),error:operationsText(error?.message||error||'Image generation failed')};
};

function createImageJobService(options = {}) {
  if (!options.store) throw new Error('Image job store is required');
  const store=options.store;
  const assets=options.assets;
  // Workers mostly wait on the upstream provider, so the global cap follows provider
  // capacity; the per-user caps keep one large batch from occupying every worker.
  const concurrency=Math.max(1,Math.min(64,Math.floor(positive(options.concurrency || process.env.IMAGE_JOB_CONCURRENCY,48))));
  const userConcurrency=Math.max(1,Math.min(concurrency,Math.floor(positive(options.userConcurrency || process.env.IMAGE_JOB_USER_CONCURRENCY,6))));
  const maxQueued=Math.max(1,positive(options.maxQueued || process.env.IMAGE_JOB_MAX_QUEUED,200));
  // Counts the user's queued and running jobs, unlike maxQueued which counts queued jobs only.
  const userMaxQueued=Math.max(1,Math.floor(positive(options.userMaxQueued || process.env.IMAGE_JOB_USER_MAX_QUEUED,32)));
  const maxRequestBytes=positive(options.maxRequestBytes || process.env.IMAGE_JOB_MAX_REQUEST_BYTES,50*1024*1024);
  const deadlineMs=positive(options.deadlineMs || process.env.IMAGE_JOB_DEADLINE_MS,20*60*1000);
  const pollIntervalMs=positive(options.pollIntervalMs || process.env.IMAGE_JOB_POLL_INTERVAL_MS,2000);
  const retentionMs=positive(options.retentionMs || process.env.IMAGE_JOB_RETENTION_MS,5*60*60*1000);
  const extract=options.extractResultUrls || collectImages;
  const active=new Map();
  const settlements=new Map();
  const runs=new Set();
  const outcomes=new Map();
  const assetUpdates=new Map();
  const assetPublications=new Map();
  const resumedAssetJobs=new Set();
  const pendingPublicLists=new Map();
  const operationsJobs=new Map();
  const operationsEventStates=new Map();
  const operationsLabels=new Map();
  const operationsBacklogs=new Map();
  const operationsFinalizing=new Set();
  const operationsSettlementErrors=new Map();
  const operationsDirtyEvents=new Map();
  const operationsCleanup=new Map();
  const operationsStartedAt=new Date().toISOString();
  const operationsMaxPendingEvents=Math.max(1,Math.min(1024,Math.floor(positive(options.operationsMaxPendingEvents,128))));
  const operationsStateLimit=maxQueued+concurrency+200;
  const operationsEventLimit=Math.min(4096,operationsStateLimit*7);
  const operationsEventTimeoutMs=Math.max(10,Math.min(5000,Number(options.operationsEventTimeoutMs)||250));
  let operationsEventSequence=0;
  let operationsGeneratedAt=null,operationsPendingEvents=0,operationsDroppedEvents=0,operationsFailedEvents=0;
  const deliverOperationsEvent = entry => {
    if(entry.work)return entry.work;
    if(operationsPendingEvents>=operationsMaxPendingEvents){if(!entry.deferred){operationsDroppedEvents++;entry.deferred=true;}return Promise.resolve(false);}
    operationsPendingEvents++;
    entry.work=Promise.resolve().then(()=>options.onOperationsEvent(entry.event)).then(()=>{operationsDirtyEvents.delete(entry.key);return true;}).catch(()=>{operationsFailedEvents++;return false;}).finally(()=>{operationsPendingEvents--;entry.work=null;});
    return entry.work;
  };
  const operationsEvent = (type,job,error,key) => {
    if(typeof options.onOperationsEvent!=='function')return Promise.resolve(true);
    key=key||String(++operationsEventSequence);
    let entry=operationsDirtyEvents.get(key);
    if(!entry){
      if(operationsDirtyEvents.size>=operationsEventLimit){operationsDroppedEvents++;return Promise.resolve(false);}
      entry={key,event:{type,task:operationsTask(job),createdAt:new Date().toISOString(),...(error?{error:operationsFailure(error)}:{})}};
      operationsDirtyEvents.set(key,entry);
    }
    return deliverOperationsEvent(entry);
  };
  const waitOperationsEvent = async work => {
    let timer;try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),operationsEventTimeoutMs);})]);}finally{clearTimeout(timer);}
  };
  const removeArchivedJob = async (id,job) => {
    if(!await waitOperationsEvent(operationsEvent('terminal',job,undefined,'archive:'+id)))return false;
    await store.remove(id);resumedAssetJobs.delete(id);operationsBacklogs.delete(id);operationsEventStates.delete(id);operationsLabels.delete(id);operationsCleanup.delete(id);operationsSettlementErrors.delete(id);return true;
  };
  const reportSettlementError = (job,error) => {
    const failure=operationsFailure(error),signature=JSON.stringify(failure);
    if(operationsSettlementErrors.get(job.taskId)===signature)return;
    operationsSettlementErrors.delete(job.taskId);operationsSettlementErrors.set(job.taskId,signature);
    while(operationsSettlementErrors.size>operationsStateLimit)operationsSettlementErrors.delete(operationsSettlementErrors.keys().next().value);
    operationsEvent('settlement',{...job,userLabel:job.userLabel||operationsLabels.get(job.taskId)},error);
  };
  const observeOperations = (job,{events=true}={}) => {
    if(!job?.taskId)return;
    if(operationsFinalizing.has(job.taskId)){if(!terminal(job))return;job={...job,phase:'finalizing'};}
    const previous=operationsEventStates.get(job.taskId);
    const projected=operationsTask({...job,userLabel:job.userLabel||operationsLabels.get(job.taskId)});
    if(['queued','running'].includes(job.status)||active.has(job.taskId))operationsJobs.set(job.taskId,projected);else operationsJobs.delete(job.taskId);
    if(terminal(job)&&(job.settlementPending||job.storageStatus==='pending')){
      operationsBacklogs.delete(job.taskId);operationsBacklogs.set(job.taskId,projected);
      while(operationsBacklogs.size>operationsStateLimit)operationsBacklogs.delete(operationsBacklogs.keys().next().value);
    }else operationsBacklogs.delete(job.taskId);
    if(events){
      if(projected.startedAt&&!previous?.startedAt)operationsEvent('dispatch',projected);
      if(job.upstreamStatus&&job.upstreamStatus!==previous?.upstreamStatus)operationsEvent('upstream_changed',projected);
      if(terminal(job)&&job.status!==previous?.status)operationsEvent('terminal',projected);
      if(job.storageStatus&&(job.storageStatus!==previous?.storageStatus||job.storageError!==previous?.storageError))operationsEvent('storage',projected);
      if((typeof job.settlementPending==='boolean'&&previous&&job.settlementPending!==previous.settlementPending)||job.compensatedAt&&job.compensatedAt!==previous?.compensatedAt)operationsEvent('settlement',projected);
    }
    operationsEventStates.delete(job.taskId);
    operationsEventStates.set(job.taskId,{status:job.status,startedAt:job.startedAt||previous?.startedAt,upstreamStatus:job.upstreamStatus||previous?.upstreamStatus,storageStatus:job.storageStatus,storageError:job.storageError,settlementPending:job.settlementPending,compensatedAt:job.compensatedAt});
    while(operationsEventStates.size>operationsStateLimit){const id=operationsEventStates.keys().next().value;operationsEventStates.delete(id);if(!operationsJobs.has(id))operationsLabels.delete(id);}
    operationsGeneratedAt=new Date().toISOString();
  };
  const getOperationsSnapshot = () => {
    const tasks=[],perUser=new Map();let localQueued=0,upstreamQueued=0,oldestLocalWaitMs=0;
    for(const [id,job] of operationsJobs){
      const occupied=active.has(id);
      if(!occupied&&job.status!=='queued')continue;
      const task={...job};tasks.push(task);
      const userId=String(job.userId||'');const user=perUser.get(userId)||{userId,active:0,queued:0};
      if(occupied){user.active++;if(job.phase==='upstream_queued')upstreamQueued++;}
      else {user.queued++;localQueued++;const createdAt=Date.parse(job.createdAt);if(Number.isFinite(createdAt))oldestLocalWaitMs=Math.max(oldestLocalWaitMs,Date.now()-createdAt);}
      perUser.set(userId,user);
    }
    const backlogTasks=[...operationsBacklogs.values()].map(task=>({...task}));
    return {generatedAt:operationsGeneratedAt,startedAt:operationsStartedAt,storage:assets?.getHealth?.()||null,limits:{concurrency,userConcurrency,maxQueued,userMaxQueued},active:active.size,localQueued,upstreamQueued,activeUsers:[...new Set([...active.values()].map(controller=>controller.userId))].length,oldestLocalWaitMs:Math.max(0,oldestLocalWaitMs),perUser:[...perUser.values()].sort((a,b)=>a.userId.localeCompare(b.userId)),tasks,backlogs:{settlementPending:backlogTasks.filter(task=>task.settlementPending).length,storagePending:backlogTasks.filter(task=>task.storageStatus==='pending').length},backlogTasks,coverage:{source:'process_memory',events:{available:typeof options.onOperationsEvent==='function',pending:operationsPendingEvents,dirty:operationsDirtyEvents.size,dropped:operationsDroppedEvents,failed:operationsFailedEvents}}};
  };
  const outcomePatch = job => Object.fromEntries(['status','progress','resultUrls','previewUrl','storageStatus','storageError','payload','billing','error','completedAt','settlementPending'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]]));
  let started=false,stopped=false,pumping=false,reconciling=false,admission=Promise.resolve(),maintenance,lastCleanup=0,lastAssetCleanup=0,startPromise;
  const assetCleanupIntervalMs=positive(options.assetCleanupIntervalMs,15*60*1000);
  const warn = error => options.logger?.warn?.({type:'Image job maintenance',message:error.message});
  const owner = (job,userId) => { if(!job || job.userId!==String(userId||'')) throw statusError('Image task not found',404);return job; };
  const publicStatus = job => job.status==='running' ? ['QUEUED','IN_QUEUE'].includes(job.upstreamStatus) ? 'queued' : 'processing' : job.status;
  const ack = job => ({id:job.taskId,task_id:job.taskId,request_id:job.requestId,status:publicStatus(job),progress:job.progress||0,results:[],created_at:job.createdAt});
  const publicJob = job => ({...ack(job),...smallPayload(job,job.resultUrls||[]),
    clientRequestId:job.requestId,clientLiveTaskIds:job.clientLiveTaskIds||[],
    prompt:job.prompt||'',model:job.model||null,modelId:job.modelId||null,routeId:job.routeId||null,
    outputSize:job.outputSize||null,aspectRatio:job.aspectRatio||null,uiMode:job.uiMode||'canvas',
    status:publicStatus(job),
    preview_url:job.previewUrl||null,thumbnail_url:job.previewUrl||null,storage_status:job.storageStatus||null,storage_mode:job.storageMode||'auto',
    ...(job.error?{error:job.error,failure_reason:job.error}:{}),
    ...(job.storageError?{storage_error:job.storageError}:{}),
    ...(job.completedAt?{completed_at:job.completedAt}:{}),
  });
  const persist = async (id,patch) => {
    const job=await store.update(id,async current=>{const value=typeof patch==='function'?await patch(current):patch;return {...(operationsLabels.has(id)?{userLabel:operationsLabels.get(id)}:{}),...value};});
    observeOperations(job);return job;
  };
  const compensate = async job => {
    if(settlements.has(job.taskId))return settlements.get(job.taskId);
    const work=(async()=>{
      const current=await store.get(job.taskId);if(current?.compensatedAt)return;
      try{if(options.compensate)await options.compensate(current||job);}
      catch(error){reportSettlementError(current||job,error);throw error;}
      await persist(job.taskId,{compensatedAt:new Date().toISOString(),settlementPending:false});
      operationsSettlementErrors.delete(job.taskId);
    })();
    settlements.set(job.taskId,work);
    try{await work;}finally{settlements.delete(job.taskId);}
  };
  const fail = async (id,error) => {
    if(outcomes.has(id)){warn(error instanceof Error?error:new Error(String(error)));return;}
    const job=await store.get(id); if(!job || job.status==='succeeded') return;
    const {error:safeError,...failureMetadata}=operationsFailure(error);
    const failed=await persist(id,{status:'failed',progress:100,error:String(error?.message||error||'Image generation failed').slice(0,2000),...failureMetadata,completedAt:new Date().toISOString(),settlementPending:true});
    await compensate(failed).catch(warn);
    await store.removeRequest?.(id).catch(warn);
  };
  const settleSuccess = async job => {
    if (!options.settleSuccess) return persist(job.taskId,{settlementPending:false});
    try { await options.settleSuccess(job); await persist(job.taskId,{settlementPending:false});operationsSettlementErrors.delete(job.taskId); }
    catch (error) { warn(error);const pending=await persist(job.taskId,{settlementPending:true});reportSettlementError(pending||job,error); }
  };
  const applyAssetUpdate = async (id,entry) => {
    if(entry.flushing)return;entry.flushing=true;
    const prior=assetPublications.get(id)||Promise.resolve();
    const work=prior.catch(()=>{}).then(async()=>{
      await store.saveAssetUpdate?.(id,entry.patch,entry.version);
      const saved=await persist(id,current=>current.status==='failed'?{}:entry.patch);
      if(saved?.status==='succeeded')await settleSuccess(saved);
      await store.clearAssetUpdate?.(id,entry.version);
      if(assetUpdates.get(id)===entry)assetUpdates.delete(id);
    });
    assetPublications.set(id,work);
    try{await work;}finally{entry.flushing=false;if(assetPublications.get(id)===work)assetPublications.delete(id);}
  };
  const publishAssetUpdate = async (id,update,fallbackUrls=[]) => {
    const urls=(update.resultUrls||fallbackUrls).filter(url=>!/^data:/i.test(url));
    const entry={version:crypto.randomBytes(12).toString('hex'),patch:{
      resultUrls:urls,previewUrl:update.previewUrl||null,storageStatus:update.storageStatus||'saved',
      storageError:update.storageError||null,
      payload:smallPayload(update.payload,urls),settlementPending:true,
    }};
    assetUpdates.set(id,entry);
    if(outcomes.has(id))outcomes.set(id,{...outcomes.get(id),...entry.patch});
    await applyAssetUpdate(id,entry).catch(warn);
  };
  const succeed = async (id,payload,urls,snapshot) => {
    resumedAssetJobs.add(id);
    if(active.has(id))operationsFinalizing.add(id);
    const known=snapshot;
    // A confirmed upstream image can never be refunded because metadata or
    // image persistence was unavailable. Only compact outcomes enter this map.
    outcomes.set(id,{...known,status:'running',progress:95,resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'pending'});
    // Compact confirmation is durable before asynchronous asset preparation.
    // If an inline original cannot finish saving across a process interruption,
    // report storage loss while preserving the upstream success and its charge.
    const usableUrls=urls.filter(url=>!/^data:/i.test(url));
    // Record whether this line returned links or inline bytes, so direct
    // delivery can be offered only where an upstream URL exists.
    const inlineCount=urls.length-usableUrls.length;
    const resultSource=!urls.length?null:!inlineCount?'url':inlineCount===urls.length?'base64':'mixed';
    if(resultSource)options.logger?.info?.({type:'Image result source',routeId:known.routeId||null,resultSource,count:urls.length});
    const confirmation={status:'succeeded',progress:100,resultUrls:usableUrls,resultSource,
      storageStatus:usableUrls.length?'pending':'failed',
      storageError:usableUrls.length?null:'图片生成已成功，原图暂存尚未完成',
      completedAt:new Date().toISOString(),error:null,settlementPending:true};
    observeOperations({...known,...operationsJobs.get(id),...confirmation,phase:'finalizing'});
    await store.saveOutcome?.(id,confirmation).catch(warn);
    let savedUpdate;
    const callback = async update => {
      savedUpdate=update;
      await publishAssetUpdate(id,update);
    };
    let prepared={payload:smallPayload(payload,urls),resultUrls:urls,previewUrl:null,storageStatus:'external'};
    let storageError=null;
    if(assets) {
      try { prepared=await assets.prepare({payload,resultUrls:urls,context:{userId:known.userId,taskId:id},onSaved:callback,storageMode:known.storageMode}); }
      catch(error) { storageError=String(error.message||'Image save failed').slice(0,1000); prepared={payload:{},resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'failed'}; }
    } else if(urls.some(url=>/^data:/i.test(url))) {
      prepared={payload:{},resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'failed'};storageError='Image storage is unavailable';
    }
    await store.removeRequest?.(id).catch(warn);
    const result=savedUpdate||prepared;
    const completion={status:'succeeded',progress:100,error:null,completedAt:new Date().toISOString(),resultSource,
        resultUrls:(result.resultUrls||[]).filter(url=>!/^data:/i.test(url)),previewUrl:result.previewUrl||null,
        storageStatus:result.storageStatus||'external',storageError:result.storageError||storageError,payload:smallPayload(result.payload,result.resultUrls||[]),
        billing:payload?.billing||known.billing||null,settlementPending:true};
    try {
      await store.saveOutcome?.(id,completion);
      const job=await persist(id,current => {
        if(current.status==='failed')return {};
        const latest=savedUpdate;
        return latest?{...completion,resultUrls:latest.resultUrls,previewUrl:latest.previewUrl||null,storageStatus:latest.storageStatus,storageError:latest.storageError||null,payload:smallPayload(latest.payload,latest.resultUrls)}:completion;
      });
      await store.clearOutcome?.(id);
      outcomes.delete(id);
      if(job.status==='succeeded')await settleSuccess(job);
    }catch(error){outcomes.set(id,{...known,...completion,...(savedUpdate?{resultUrls:savedUpdate.resultUrls,previewUrl:savedUpdate.previewUrl,storageStatus:savedUpdate.storageStatus}: {})});warn(error);}
  };
  const processPayload = async (id,payload,snapshot) => {
    const status=state(payload);const urls=extract(payload||{});
    const isSuccess=urls.length && !failureState(status) && (successState(status)||!status);
    if(isSuccess) {
      // Establish success from the provider reply before the next metadata read.
      // Any failure below belongs to persistence, never to upstream generation.
      const known=snapshot||{taskId:id,userId:''};
      outcomes.set(id,{...known,status:'running',progress:95,resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'pending'});
      await succeed(id,payload,urls,known);return true;
    }
    const current=await store.get(id);if(!current||terminal(current)||outcomes.has(id))return true;
    if(failureState(status)) { await fail(id,Object.assign(statusError(payload?.error?.message||payload?.error||payload?.failure_reason||'Image task failed'),{code:payload?.error?.code||payload?.failureCode||payload?.code,httpStatus:payload?.httpStatus||payload?.http_status||payload?.error?.httpStatus||payload?.error?.status}));return true; }
    if(successState(status)) { await fail(id,statusError('上游成功响应未返回图片 (no image result)'));return true; }
    const taskId=payload?.task_id||payload?.taskId||payload?.id||payload?.data?.task_id||payload?.data?.taskId;
    if(taskId || (current.innerTaskId && status)) {
      const progress=readProgress(payload);
      await persist(id,{
        // The first handler response contains the route token; later provider
        // polls may contain only their raw ID and must keep that routing identity.
        innerTaskId:current.innerTaskId||String(taskId),
        billing:payload?.billing||current.billing||null,
        ...(status?{upstreamStatus:status}:{}),
        ...(!current.upstreamStartedAt?{upstreamStartedAt:new Date().toISOString()}:{}),
        ...(progress!==undefined?{progress:Math.max(current.progress||0,progress)}:{}),
      });
      return false;
    }
    await fail(id,statusError('上游未返回任务编号或图片 (no image result)'));return true;
  };
  const delay = (ms,signal) => new Promise(resolve=> {
    if(signal.aborted)return resolve();const timer=setTimeout(done,ms);
    function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}
    signal.addEventListener('abort',done,{once:true});
  });
  const bounded = async (promise,ms,signal) => {
    let timer,abort;
    const interruption=new Promise(resolve=>{
      abort=()=>resolve({__interrupted:true});
      if(signal.aborted)return abort();
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(abort,Math.max(1,ms));
    });
    try{return await Promise.race([promise,interruption]);}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  };
  const run = async (input,controller) => {
    const id=input.taskId;const signal=controller.signal;let physical;
    const context={taskId:id,userId:input.userId,signal,persist:patch=>persist(id,patch)};
    try {
      let job=await store.get(id);
      if(!job||terminal(job))return;
      const remaining=Math.max(0,Number(job.deadlineAt||Date.now()+deadlineMs)-Date.now());
      if(!remaining) return await fail(id,statusError('图片任务已超过最终生成期限'));
      if(job.status==='queued') {
        job=await persist(id,{status:'running',startedAt:new Date().toISOString()});
        const request=await store.readRequest(id);
        const envelope=request?.body ? request : {body:request};
        context.identity=envelope.identity;context.headers=envelope.headers||{};
        job=await persist(id,{upstreamStartedAt:new Date().toISOString()});
        const execution=imageJobContext.run(context,()=>options.execute(job,envelope.body,context));physical=execution;
        // Stopping a process must leave an uncertain running request for restart compensation.
        const result=await bounded(execution,remaining,signal);
        if(result?.__interrupted) {if(!signal.aborted){controller.abort();await fail(id,statusError('图片任务已超过最终生成期限'));}return;}
        if(signal.aborted)return;
        if(await processPayload(id,result,job))return;
      }
      while(!signal.aborted) {
        job=await store.get(id);if(!job||terminal(job))return;
        if(Date.now()>=Number(job.deadlineAt||Date.now()+deadlineMs))return await fail(id,statusError('图片任务已超过最终生成期限'));
        if(!job.innerTaskId)return await fail(id,statusError('服务器中断了无法追踪的同步图片任务，请重新提交'));
        try {
          const request=await store.readRequest(id).catch(()=>({}));
          context.identity=request.identity;context.headers=request.headers||{};
          physical=imageJobContext.run(context,()=>options.poll(job,context));
          const payload=await bounded(physical,Number(job.deadlineAt||Date.now()+deadlineMs)-Date.now(),signal);
          if(signal.aborted)return;
          if(payload?.__interrupted){controller.abort();return await fail(id,statusError('图片任务已超过最终生成期限'));}
          if(await processPayload(id,payload,job))return;
        }catch(error){ if(error.status===404 && !options.poll)throw error;warn(error); }
        await delay(pollIntervalMs,signal);
      }
    }catch(error){if(!signal.aborted)await fail(id,error).catch(warn);}
    finally {
      controller.abort();
      // Keep the slot until its canceled transport actually stops. A timeout
      // cannot silently multiply physical upstream work beyond concurrency.
      if(physical)await physical.catch(()=>{});
      active.delete(id);operationsFinalizing.delete(id);if(!['queued','running'].includes(operationsJobs.get(id)?.status))operationsJobs.delete(id);operationsGeneratedAt=new Date().toISOString();if(!stopped)void pump();
    }
  };
  const pump = async () => {
    if(!started||stopped||pumping)return;pumping=true;
    try {
      const jobs=await store.list({statuses:['queued','running'],limit:maxQueued+concurrency});
      if(stopped)return;
      const listed=new Set(jobs.map(job=>job.taskId));
      for(const id of operationsJobs.keys())if(!active.has(id)&&!listed.has(id))operationsJobs.delete(id);
      for(const job of jobs)observeOperations(job,{events:false});
      operationsGeneratedAt=new Date().toISOString();
      const perUser=new Map();
      for(const {userId} of active.values())perUser.set(userId,(perUser.get(userId)||0)+1);
      for(const job of jobs) {
        if(active.size>=concurrency)break;
        if(!['queued','running'].includes(job.status)||active.has(job.taskId)||outcomes.has(job.taskId))continue;
        // Skip, not stop: later jobs from other users still get a free worker.
        const userId=String(job.userId||'');
        if((perUser.get(userId)||0)>=userConcurrency)continue;
        perUser.set(userId,(perUser.get(userId)||0)+1);
        const controller=new AbortController();controller.userId=userId;active.set(job.taskId,controller);
        const work=run(job,controller);runs.add(work);void work.finally(()=>runs.delete(work));
      }
    }catch(error){warn(error);}finally{pumping=false;}
  };
  const reconcile = async () => {
    if(reconciling)return;reconciling=true;
    try{
    for(const entry of operationsDirtyEvents.values())void deliverOperationsEvent(entry);
    await Promise.allSettled([...operationsCleanup].map(([id,job])=>removeArchivedJob(id,job).catch(warn)));
    await store.recoverOutcomes?.({shouldRecover:id=>!active.has(id)&&!outcomes.has(id)});
    for(const [id,job]of outcomes){if(job.status!=='succeeded')continue;await persist(id,outcomePatch(job));outcomes.delete(id);}
    await store.recoverAssetUpdates?.({excludeTaskIds:[...assetUpdates.keys()]});
    for(const [id,entry]of assetUpdates)await applyAssetUpdate(id,entry);
    for(const job of await store.list({statuses:['succeeded','failed'],settlementPending:true,limit:100})) {
      observeOperations(job,{events:false});
      if(job.status==='failed' && job.settlementPending)await compensate(job).catch(warn);
      if(job.status==='succeeded' && job.settlementPending)await settleSuccess(job).catch(warn);
    }
    if(assets)for(const job of await store.list({status:'succeeded',storageStatus:'pending',limit:100})) {
      observeOperations(job,{events:false});
      if(resumedAssetJobs.has(job.taskId))continue;resumedAssetJobs.add(job.taskId);
      try {
        await assets.prepare({payload:job.payload,resultUrls:job.resultUrls,context:{userId:job.userId,taskId:job.taskId},storageMode:job.storageMode,onSaved:async update=>{
          await publishAssetUpdate(job.taskId,update,job.resultUrls);
        }});
      }catch(error){warn(error);await persist(job.taskId,{storageStatus:'failed',storageError:String(error.message).slice(0,1000)});}
    }
    if(Date.now()-lastCleanup>60*60*1000){
      lastCleanup=Date.now();
      // Expired files must be removed even when the job-row sweep fails.
      const expiredJobs=await store.list({statuses:['succeeded','failed'],createdBefore:Date.now()-retentionMs,limit:1000}).catch(error=>{warn(error);return [];});
      await Promise.allSettled(expiredJobs.filter(job=>!job.settlementPending).map(async job=>{
        try{
          if(typeof options.onOperationsEvent==='function'){if(operationsCleanup.size<1000)operationsCleanup.set(job.taskId,operationsTask(job));await removeArchivedJob(job.taskId,job);}
          else {await store.remove(job.taskId);resumedAssetJobs.delete(job.taskId);operationsBacklogs.delete(job.taskId);operationsEventStates.delete(job.taskId);operationsLabels.delete(job.taskId);}
        }catch(error){warn(error);}
      }));
    }
    // File cleanup is cheap and runs more often so a disk spike is absorbed quickly.
    if(Date.now()-lastAssetCleanup>assetCleanupIntervalMs){
      lastAssetCleanup=Date.now();
      await assets?.cleanup?.().catch(warn);
    }
    await pump();
    }finally{reconciling=false;}
  };
  const start = async () => {
    if(started&&!stopped)return;if(startPromise)return startPromise;
    startPromise=(async()=>{
      stopped=false;
      await store.init?.();
      await store.recoverOutcomes?.();
      for(const job of await store.list({status:'running',limit:1000}))if(!job.innerTaskId)await fail(job.taskId,statusError('服务器重启中断了无法追踪的同步图片任务，本站费用已退回'));
      started=true;
      await reconcile();
      maintenance=setInterval(()=>void reconcile().catch(warn),Math.max(1000,pollIntervalMs));maintenance.unref?.();
    })();
    try{await startPromise;}catch(error){started=false;stopped=true;throw error;}finally{startPromise=null;}
  };
  const stop = async () => {stopped=true;clearInterval(maintenance);for(const controller of active.values())controller.abort();await Promise.allSettled([...runs]);};
  const submit = async ({userId,endpoint,body={},identity=null,headers={}}) => {
    if(!userId)throw statusError('Login required',401);
    const requestId=String(body.clientRequestId||body.client_request_id||'').trim();
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))throw statusError('clientRequestId is required (1-128 letters, numbers, underscores or hyphens)',400);
    if(!['/api/generate','/api/edit','/api/gemini/generate'].includes(endpoint))throw statusError('Unsupported image endpoint',400);
    const bytes=Buffer.byteLength(JSON.stringify(body));if(bytes>maxRequestBytes)throw statusError('Image request exceeds upload size limit',413);
    const fp=fingerprintBody({endpoint,body});
    const prior=admission;let release;admission=new Promise(resolve=>{release=resolve;});await prior;
    try {
      const duplicate=await store.findByRequest(requestId,String(userId));
      if(duplicate) {if(duplicate.fingerprint!==fp)throw statusError('clientRequestId is already used for a different request',409);return ack(duplicate);}
      const ownPending=(await store.list({statuses:['queued','running'],userId:String(userId),limit:userMaxQueued})).length;
      // A definite refusal: clients must show it instead of retrying like a busy server.
      if(ownPending>=userMaxQueued)throw Object.assign(statusError(`您已有 ${ownPending} 张图片在生成或排队，请等待部分完成后再提交`,429),{code:'USER_QUEUE_FULL'});
      const queued=(await store.list({status:'queued',limit:maxQueued})).length;
      if(queued>=maxQueued)throw Object.assign(statusError('图片任务队列繁忙，请稍后再试',429),{code:'GLOBAL_QUEUE_FULL'});
      const now=Date.now();const {job}=await store.admit({taskId:`job-${crypto.randomBytes(16).toString('hex')}`,requestId,userId:String(userId),endpoint,fingerprint:fp,createdAt:new Date(now).toISOString(),deadlineAt:now+deadlineMs,uiMode:body.uiMode==='classic'?'classic':'canvas',clientLiveTaskIds:Array.isArray(body.clientLiveTaskIds)?body.clientLiveTaskIds:body.clientLiveTaskId?[body.clientLiveTaskId]:[],prompt:body.prompt,modelId:body.modelId,model:body.model,routeId:body.routeId,outputSize:body.image_size||body.size,aspectRatio:body.aspect_ratio||body.aspectRatio,storageMode:normalizeStorageMode(body.storageMode)},{body:{body,identity,headers:{authorization:headers.authorization||''}}});
      const label=identity?.username||identity?.email||identity?.user?.username||identity?.user?.email;
      if(label)operationsLabels.set(job.taskId,operationsText(label,255));
      observeOperations({...job,...(label?{userLabel:operationsLabels.get(job.taskId)}:{})},{events:false});
      operationsEvent('admitted',{...job,...(label?{userLabel:operationsLabels.get(job.taskId)}:{})});
      setImmediate(()=>void pump());return ack(job);
    }catch(error){
      if(error?.status===429)operationsEvent('rejected',{taskId:`job-rejected-${crypto.randomBytes(16).toString('hex')}`,requestId,userId:String(userId),userLabel:identity?.username||identity?.email,uiMode:body.uiMode==='classic'?'classic':'canvas',modelId:body.modelId,routeId:body.routeId,status:'rejected',phase:'admission',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...operationsFailure(error)},error);
      throw error;
    }finally{release();}
  };
  const listPublicJobs = (userId,{uiMode,status='all',limit=100}={}) => {
    const ownerId=String(userId),mode=uiMode?String(uiMode):undefined;
    const pending=status==='pending';
    const safeLimit=Math.max(1,Math.min(100,Math.floor(Number(limit)||100)));
    const key=JSON.stringify([ownerId,mode||null,pending,safeLimit]);
    if(pendingPublicLists.has(key))return pendingPublicLists.get(key);
    const request=store.list({userId:ownerId,uiMode:mode,...(pending?{statuses:['queued','running']}:{}),limit:safeLimit,descending:true,publicListProjection:true})
      .then(jobs=>jobs.map(job=>({...publicJob(job),ui_mode:job.uiMode,client_live_task_ids:job.clientLiveTaskIds||[]})))
      .finally(()=>{if(pendingPublicLists.get(key)===request)pendingPublicLists.delete(key);});
    pendingPublicLists.set(key,request);
    return request;
  };
  return {submit,get:async(id,userId)=>publicJob(owner(outcomes.get(id)||await store.get(id),userId)),
    lookupRequest:async(requestId,userId)=>{const job=owner(await store.findByRequest(requestId,userId),userId);return publicJob(outcomes.get(job.taskId)||job);},
    list:listPublicJobs,
    start,stop,reconcile,persist,processPayload,store,getOperationsSnapshot};
}
module.exports={createImageJobService,imageJobContext,collectImages};
