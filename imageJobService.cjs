const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { fingerprintBody } = require('./imageJobStore.cjs');

const imageJobContext = new AsyncLocalStorage();
const statusError = (message, status = 500) => Object.assign(new Error(message), {status});
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : fallback;
const terminal = job => ['succeeded','failed'].includes(job?.status);
const state = payload => String(payload?.status || payload?.data?.status || '').trim().toUpperCase();
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
const smallPayload = (payload, urls) => ({
  ...(payload?.billing ? {billing:payload.billing} : {}),
  images:urls,results:urls,data:urls.map(url=>({url})),
});

function createImageJobService(options = {}) {
  if (!options.store) throw new Error('Image job store is required');
  const store=options.store;
  const assets=options.assets;
  const concurrency=Math.max(1,Math.min(16,Math.floor(positive(options.concurrency || process.env.IMAGE_JOB_CONCURRENCY,4))));
  const maxQueued=Math.max(1,positive(options.maxQueued || process.env.IMAGE_JOB_MAX_QUEUED,64));
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
  const outcomePatch = job => Object.fromEntries(['status','progress','resultUrls','previewUrl','storageStatus','storageError','payload','billing','error','completedAt','settlementPending'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]]));
  let started=false,stopped=false,pumping=false,reconciling=false,admission=Promise.resolve(),maintenance,lastCleanup=0,startPromise;
  const warn = error => options.logger?.warn?.({type:'Image job maintenance',message:error.message});
  const owner = (job,userId) => { if(!job || job.userId!==String(userId||'')) throw statusError('Image task not found',404);return job; };
  const ack = job => ({id:job.taskId,task_id:job.taskId,request_id:job.requestId,status:job.status==='running'?'processing':job.status,progress:job.progress||0,results:[],created_at:job.createdAt});
  const publicJob = job => ({...ack(job),...smallPayload(job,job.resultUrls||[]),
    clientRequestId:job.requestId,clientLiveTaskIds:job.clientLiveTaskIds||[],
    prompt:job.prompt||'',model:job.model||null,modelId:job.modelId||null,routeId:job.routeId||null,
    outputSize:job.outputSize||null,aspectRatio:job.aspectRatio||null,uiMode:job.uiMode||'canvas',
    status:job.status==='running'?'processing':job.status,
    preview_url:job.previewUrl||null,thumbnail_url:job.previewUrl||null,storage_status:job.storageStatus||null,
    ...(job.error?{error:job.error,failure_reason:job.error}:{}),
    ...(job.storageError?{storage_error:job.storageError}:{}),
    ...(job.completedAt?{completed_at:job.completedAt}:{}),
  });
  const persist = async (id,patch) => store.update(id,patch);
  const compensate = async job => {
    if(settlements.has(job.taskId))return settlements.get(job.taskId);
    const work=(async()=>{
      const current=await store.get(job.taskId);if(current?.compensatedAt)return;
      if(options.compensate)await options.compensate(current||job);
      await persist(job.taskId,{compensatedAt:new Date().toISOString(),settlementPending:false});
    })();
    settlements.set(job.taskId,work);
    try{await work;}finally{settlements.delete(job.taskId);}
  };
  const fail = async (id,error) => {
    if(outcomes.has(id)){warn(error instanceof Error?error:new Error(String(error)));return;}
    const job=await store.get(id); if(!job || job.status==='succeeded') return;
    const failed=await persist(id,{status:'failed',progress:100,error:String(error?.message||error||'Image generation failed').slice(0,2000),completedAt:new Date().toISOString(),settlementPending:true});
    await compensate(failed).catch(warn);
    await store.removeRequest?.(id).catch(warn);
  };
  const settleSuccess = async job => {
    if (!options.settleSuccess) return persist(job.taskId,{settlementPending:false});
    try { await options.settleSuccess(job); await persist(job.taskId,{settlementPending:false}); }
    catch (error) { warn(error); await persist(job.taskId,{settlementPending:true}); }
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
      payload:smallPayload(update.payload,urls),settlementPending:true,
    }};
    assetUpdates.set(id,entry);
    if(outcomes.has(id))outcomes.set(id,{...outcomes.get(id),...entry.patch});
    await applyAssetUpdate(id,entry).catch(warn);
  };
  const succeed = async (id,payload,urls,snapshot) => {
    resumedAssetJobs.add(id);
    const known=snapshot;
    // A confirmed upstream image can never be refunded because metadata or
    // image persistence was unavailable. Only compact outcomes enter this map.
    outcomes.set(id,{...known,status:'running',progress:95,resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'pending'});
    // Compact confirmation is durable before asynchronous asset preparation.
    // If an inline original cannot finish saving across a process interruption,
    // report storage loss while preserving the upstream success and its charge.
    const usableUrls=urls.filter(url=>!/^data:/i.test(url));
    const confirmation={status:'succeeded',progress:100,resultUrls:usableUrls,
      storageStatus:usableUrls.length?'pending':'failed',
      storageError:usableUrls.length?null:'图片生成已成功，原图暂存尚未完成',
      completedAt:new Date().toISOString(),error:null,settlementPending:true};
    await store.saveOutcome?.(id,confirmation).catch(warn);
    let savedUpdate;
    const callback = async update => {
      savedUpdate=update;
      await publishAssetUpdate(id,update);
    };
    let prepared={payload:smallPayload(payload,urls),resultUrls:urls,previewUrl:null,storageStatus:'external'};
    let storageError=null;
    if(assets) {
      try { prepared=await assets.prepare({payload,resultUrls:urls,context:{userId:known.userId,taskId:id},onSaved:callback}); }
      catch(error) { storageError=String(error.message||'Image save failed').slice(0,1000); prepared={payload:{},resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'failed'}; }
    } else if(urls.some(url=>/^data:/i.test(url))) {
      prepared={payload:{},resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'failed'};storageError='Image storage is unavailable';
    }
    await store.removeRequest?.(id).catch(warn);
    const result=savedUpdate||prepared;
    const completion={status:'succeeded',progress:100,error:null,completedAt:new Date().toISOString(),
        resultUrls:(result.resultUrls||[]).filter(url=>!/^data:/i.test(url)),previewUrl:result.previewUrl||null,
        storageStatus:result.storageStatus||'external',storageError,payload:smallPayload(result.payload,result.resultUrls||[]),
        billing:payload?.billing||known.billing||null,settlementPending:true};
    try {
      await store.saveOutcome?.(id,completion);
      const job=await persist(id,current => {
        if(current.status==='failed')return {};
        const latest=savedUpdate;
        return latest?{...completion,resultUrls:latest.resultUrls,previewUrl:latest.previewUrl||null,storageStatus:latest.storageStatus,payload:smallPayload(latest.payload,latest.resultUrls)}:completion;
      });
      await store.clearOutcome?.(id);
      outcomes.delete(id);
      if(job.status==='succeeded')await settleSuccess(job);
    }catch(error){outcomes.set(id,{...known,...completion,...(savedUpdate?{resultUrls:savedUpdate.resultUrls,previewUrl:savedUpdate.previewUrl,storageStatus:savedUpdate.storageStatus}: {})});warn(error);}
  };
  const processPayload = async (id,payload,snapshot) => {
    const status=state(payload);const urls=extract(payload||{});
    const isSuccess=urls.length && !failureState(status) && (successState(status)||!status||!payload?.task_id);
    if(isSuccess) {
      // Establish success from the provider reply before the next metadata read.
      // Any failure below belongs to persistence, never to upstream generation.
      const known=snapshot||{taskId:id,userId:''};
      outcomes.set(id,{...known,status:'running',progress:95,resultUrls:urls.filter(url=>!/^data:/i.test(url)),storageStatus:'pending'});
      await succeed(id,payload,urls,known);return true;
    }
    const current=await store.get(id);if(!current||terminal(current)||outcomes.has(id))return true;
    if(failureState(status)) { await fail(id,statusError(payload?.error?.message||payload?.error||payload?.failure_reason||'Image task failed'));return true; }
    if(successState(status)) { await fail(id,statusError('上游成功响应未返回图片 (no image result)'));return true; }
    const taskId=payload?.task_id||payload?.taskId||payload?.id||payload?.data?.task_id||payload?.data?.taskId;
    if(taskId) { await persist(id,{innerTaskId:String(taskId),billing:payload?.billing||current.billing||null});return false; }
    if(current.innerTaskId && status) return false;
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
      active.delete(id);if(!stopped)void pump();
    }
  };
  const pump = async () => {
    if(!started||stopped||pumping)return;pumping=true;
    try {
      const jobs=await store.list({statuses:['queued','running'],limit:maxQueued+concurrency});
      if(stopped)return;
      for(const job of jobs) {
        if(active.size>=concurrency)break;
        if(!['queued','running'].includes(job.status)||active.has(job.taskId)||outcomes.has(job.taskId))continue;
        const controller=new AbortController();active.set(job.taskId,controller);
        const work=run(job,controller);runs.add(work);void work.finally(()=>runs.delete(work));
      }
    }catch(error){warn(error);}finally{pumping=false;}
  };
  const reconcile = async () => {
    if(reconciling)return;reconciling=true;
    try{
    await store.recoverOutcomes?.({excludeTaskIds:[...outcomes].filter(([,job])=>job.status!=='succeeded').map(([id])=>id)});
    for(const [id,job]of outcomes){if(job.status!=='succeeded')continue;await persist(id,outcomePatch(job));outcomes.delete(id);}
    await store.recoverAssetUpdates?.({excludeTaskIds:[...assetUpdates.keys()]});
    for(const [id,entry]of assetUpdates)await applyAssetUpdate(id,entry);
    for(const job of await store.list({statuses:['succeeded','failed'],settlementPending:true,limit:100})) {
      if(job.status==='failed' && job.settlementPending)await compensate(job).catch(warn);
      if(job.status==='succeeded' && job.settlementPending)await settleSuccess(job).catch(warn);
    }
    if(assets)for(const job of await store.list({status:'succeeded',storageStatus:'pending',limit:100})) {
      if(resumedAssetJobs.has(job.taskId))continue;resumedAssetJobs.add(job.taskId);
      try {
        await assets.prepare({payload:job.payload,resultUrls:job.resultUrls,context:{userId:job.userId,taskId:job.taskId},onSaved:async update=>{
          await publishAssetUpdate(job.taskId,update,job.resultUrls);
        }});
      }catch(error){warn(error);await persist(job.taskId,{storageStatus:'failed',storageError:String(error.message).slice(0,1000)});}
    }
    if(Date.now()-lastCleanup>60*60*1000){
      lastCleanup=Date.now();
      for(const job of await store.list({statuses:['succeeded','failed'],createdBefore:Date.now()-retentionMs,limit:1000}))if(!job.settlementPending){
        try{await store.remove(job.taskId);resumedAssetJobs.delete(job.taskId);}catch(error){warn(error);}
      }
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
      const queued=(await store.list({status:'queued',limit:maxQueued})).length;
      if(queued>=maxQueued)throw statusError('图片任务队列繁忙，请稍后再试',429);
      const now=Date.now();const {job}=await store.admit({taskId:`job-${crypto.randomBytes(16).toString('hex')}`,requestId,userId:String(userId),endpoint,fingerprint:fp,createdAt:new Date(now).toISOString(),deadlineAt:now+deadlineMs,uiMode:body.uiMode==='classic'?'classic':'canvas',clientLiveTaskIds:Array.isArray(body.clientLiveTaskIds)?body.clientLiveTaskIds:body.clientLiveTaskId?[body.clientLiveTaskId]:[],prompt:body.prompt,modelId:body.modelId,model:body.model,routeId:body.routeId,outputSize:body.image_size||body.size,aspectRatio:body.aspect_ratio||body.aspectRatio},{body:{body,identity,headers:{authorization:headers.authorization||''}}});
      setImmediate(()=>void pump());return ack(job);
    }finally{release();}
  };
  return {submit,get:async(id,userId)=>publicJob(owner(outcomes.get(id)||await store.get(id),userId)),
    lookupRequest:async(requestId,userId)=>{const job=owner(await store.findByRequest(requestId,userId),userId);return publicJob(outcomes.get(job.taskId)||job);},
    list:async(userId,{uiMode,status='all',limit=100}={})=>(await store.list({userId:String(userId),uiMode,...(status==='pending'?{statuses:['queued','running']}:{}),limit:Math.max(1,Math.min(100,Number(limit)||100)),descending:true})).map(job=>({...publicJob(job),ui_mode:job.uiMode,client_live_task_ids:job.clientLiveTaskIds||[]})),
    start,stop,reconcile,persist,processPayload,store};
}
module.exports={createImageJobService,imageJobContext,collectImages};
