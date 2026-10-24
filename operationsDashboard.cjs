const fs = require('node:fs/promises');
const path = require('node:path');

const WINDOWS = new Set(['15m', '1h', '24h', '7d']);
const STALE_MS = 60000;
const RUNTIME_STALE_MS = 30000;
const redact = value => String(value ?? '').replace(/data:[^\s]+/gi, '[redacted]').replace(/https?:\/\/[^\s]+/gi, '[url redacted]').replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]').replace(/(?:sk|sess|session)[-_][a-z0-9_-]+/gi, '[redacted]').replace(/((?:authorization|api[_-]?key|token|password|secret|session)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 1000);
const identifier = (value, max=160) => value == null ? null : redact(value).slice(0,max);
const iso = value => {const date=new Date(value);return value && Number.isFinite(date.getTime())?date.toISOString():null;};
const safeTask = (task={}) => {
  const result={};
  for(const name of ['taskId','requestId','userId','userLabel','uiMode','modelId','routeId','status','phase','storageStatus','settlementStatus','failureStage','failureCategory','failureCode']) {if(task[name]!=null) result[name]=identifier(task[name],name==='userLabel'?255:160);}
  for(const name of ['createdAt','startedAt','upstreamStartedAt','completedAt','updatedAt']) if(task[name])result[name]=iso(task[name]);
  if(task.httpStatus!=null)result.httpStatus=Number(task.httpStatus)||null;
  if(task.errorSummary||task.error||task.storageError)result.errorSummary=redact(task.errorSummary||task.error||task.storageError);
  for(const name of ['queueMs','totalMs'])if(Number.isFinite(task[name]))result[name]=Math.max(0,task[name]);
  if(!result.settlementStatus)result.settlementStatus=task.settlementPending?'pending':task.compensatedAt?'refunded':task.status==='succeeded'?'settled':'not_started';
  return result;
};
const classifyFailure = (error={}, stage='generation') => {
  const code=identifier(error.failureCode||error.code), status=Number(error.httpStatus||error.status||error.response?.status)||null;
  const message=redact(error.errorSummary||error.message||error.error||'');
  let category='unknown';
  if(code==='USER_QUEUE_FULL')category='user_queue_full';
  else if(code==='GLOBAL_QUEUE_FULL')category='site_queue_full';
  else if(['storage','preview','settlement','database'].includes(stage))category=stage+'_error';
  else if(status===429)category='upstream_rate_limit';
  else if(status===401||status===403)category='upstream_auth';
  else if(status===402||/insufficient|余额不足|quota/i.test(message))category='upstream_balance';
  else if(/timeout|timed out|期限|超时/i.test(message))category='timeout';
  else if(/content.policy|safety|moderation|内容|违规/i.test(message))category='content_policy';
  else if(status>=500)category='upstream_service';
  else if(/no image|未返回图片|未返回任务|result/i.test(message))category='invalid_result';
  else if(/network|socket|ECONN|ENOTFOUND|fetch failed/i.test(message))category='network';
  return {stage,category,code,httpStatus:status,message};
};
const readHostFile = async filename => {
  try {const stat=await fs.stat(filename);if(stat.size>32768)return null;return JSON.parse(await fs.readFile(filename,'utf8'));}catch{return null;}
};
function createOperationsDashboard({store,metrics,getRuntime,now=Date.now,logger,readHostSnapshot=()=>readHostFile(process.env.OPERATIONS_HOST_SNAPSHOT_PATH||path.join(__dirname,'storage','operations','host.json'))}={}) {
  const startedAt=new Date(now()).toISOString();
  let lastCollectedAt=null, resources={}, database=null, collectionError=null, collecting=null, aggregateAt=0, pruneAt=0, timer=null, stopping=false;
  let startPromise=null, minute=-1, historyGeneratedAt=null, hostObserved=false;
  const routeAuthFailures=new Map(), terminalObservations=new Set();
  const activeIncidents=new Map(), sustained=new Map(), recording=new Map();
  const warn=()=>{try{logger?.warn?.({type:'Operations collection warning',message:'运行采集暂不可用，业务任务继续执行'});}catch{}};
  const coverage=()=>({...store.getCoverage(),scope:'durable_image_jobs',excluded:['video','anonymous_legacy_images','frontend_preview_load'],collectionError,processStartedAt:startedAt});
  const age=(value,limit)=>{const parsed=Date.parse(value);const ageMs=Number.isFinite(parsed)?Math.max(0,now()-parsed):null;return {stale:ageMs==null||ageMs>limit,ageMs};};
  const freshness=()=>{const collector=age(lastCollectedAt,STALE_MS),runtime=age(getRuntime().generatedAt,RUNTIME_STALE_MS),history=age(historyGeneratedAt,120000);return {...collector,stale:collector.stale||runtime.stale||history.stale,runtime,history};};
  const recordOne=async event=>{
    const task=safeTask(event.task||{}), at=iso(event.createdAt)||new Date(now()).toISOString();
    task.updatedAt=task.updatedAt||at;task.createdAt=task.createdAt||at;
    const stage=event.type==='settlement'&&event.error?'settlement':task.status==='succeeded'&&task.storageStatus==='failed'?'storage':task.failureStage||'generation';
    if(event.error||task.errorSummary||task.status==='failed'||event.type==='rejected'){
      const failure=classifyFailure({...event.error,...task,message:task.errorSummary||event.error?.message||event.error?.error},stage);
      Object.assign(task,{failureStage:failure.stage,failureCategory:failure.category,failureCode:failure.code,httpStatus:failure.httpStatus,errorSummary:failure.message});
    }
    try {
      if(task.taskId)await store.upsertTaskFact(task.taskId,task);
      await store.appendEvent({...task,type:identifier(event.type,48),createdAt:at});
      if(event.type==='terminal'&&task.routeId&&!terminalObservations.has(task.taskId)){
        terminalObservations.add(task.taskId);if(terminalObservations.size>2000)terminalObservations.delete(terminalObservations.values().next().value);
        const previous=routeAuthFailures.get(task.routeId);
        if(task.status==='failed'&&task.failureCategory==='upstream_auth')routeAuthFailures.set(task.routeId,{count:(previous?.count||0)+1,at:now()});
        else routeAuthFailures.delete(task.routeId);
        if(routeAuthFailures.size>100)routeAuthFailures.delete(routeAuthFailures.keys().next().value);
      }
    }catch(error){collectionError='部分任务事件未能保存，正在等待后台补采';warn();throw new Error('Operations event persistence unavailable');}
  };
  const record=event=>{
    const key=String(event.task?.taskId||'rejected');
    if(recording.size>=512&&!recording.has(key)){collectionError='事件缓冲已满，部分运行历史未采集';return Promise.reject(new Error('Operations event buffer full'));}
    const work=(recording.get(key)||Promise.resolve()).catch(()=>{}).then(()=>recordOne(event));
    recording.set(key,work);const cleanup=()=>{if(recording.get(key)===work)recording.delete(key);};void work.then(cleanup,cleanup);return work;
  };
  const sustainedFor=(key,condition,ms)=>{if(!condition){sustained.delete(key);return false;}if(!sustained.has(key))sustained.set(key,now());return now()-sustained.get(key)>=ms;};
  const evaluate=async(runtime,failures)=>{
    const found=new Map();
    const add=(fingerprint,category,severity,message,extra={})=>found.set(fingerprint,{fingerprint,category,severity,message,status:'active',...extra,updatedAt:new Date(now()).toISOString()});
    if(sustainedFor('runtime_stale',age(runtime.generatedAt,RUNTIME_STALE_MS).stale,30000))add('runtime_stale','collector_stale','warning','调度快照超过 30 秒未更新');
    if(sustainedFor('queue',runtime.oldestLocalWaitMs>120000,120000))add('queue_wait','queue_wait','warning','本站排队超过 120 秒并持续 2 分钟');
    for(const route of failures.routes||[]) {
      if(route.total>=10&&route.failed/route.total>=.2)add('route:'+route.routeId,'route_failure_rate','warning','近 5 分钟线路失败率达到 20%',{routeId:route.routeId,sampleCount:route.total,affectedUsers:route.affectedUsers||0});
      if(route.consecutiveAuthFailures>=3)add('auth:'+route.routeId,'route_auth','critical','线路连续 3 次鉴权失败',{routeId:route.routeId});
      if(route.rateLimited>=3)add('rate:'+route.routeId,'upstream_rate_limit','warning','线路持续出现上游限流',{routeId:route.routeId});
    }
    for(const [routeId,value]of routeAuthFailures)if(value.count>=3&&now()-value.at<300000)add('auth:'+routeId,'route_auth','critical','线路连续 3 次鉴权失败',{routeId});
    const available=resources.host?.memoryAvailableBytes;
    if(Number.isFinite(available)){
      if(sustainedFor('memory_critical',available<1024**3,60000))add('memory','host_memory','critical','主机可用内存低于 1 GB 持续 1 分钟');
      else if(sustainedFor('memory_warning',available<2*1024**3,300000))add('memory','host_memory','warning','主机可用内存低于 2 GB 持续 5 分钟');
    }
    const disk=resources.disk;
    if(disk?.totalBytes>0&&Number.isFinite(disk.freeBytes)&&(disk.freeBytes/disk.totalBytes<.15||disk.freeBytes<2*1024**3))add('disk','storage_capacity',disk.freeBytes/disk.totalBytes<.1||disk.freeBytes<2*1024**3?'critical':'warning','图片存储卷空间不足：可用低于 15% 或 2 GB');
    if((runtime.backlogTasks||runtime.tasks||[]).some(task=>task.settlementPending&&task.completedAt&&now()-Date.parse(task.completedAt)>120000))add('settlement','settlement_backlog','warning','存在超过 2 分钟未完成结算的任务');
    if((runtime.backlogTasks||[]).filter(task=>task.storageStatus==='pending'&&task.completedAt&&now()-Date.parse(task.completedAt)>120000).length>=5)add('storage','storage_backlog','warning','至少 5 个任务保存等待超过 2 分钟');
    const storage=runtime.storage;
    if(storage?.consecutiveFailures>=3)add('asset_cleanup','asset_cleanup','critical','图片清理连续 3 次失败，原图可能正在堆积',{lastError:storage.lastError});
    if(storage?.overdueOriginals>0)add('asset_overdue','asset_cleanup','warning','存在超期 1 小时以上仍未删除的原图',{count:storage.overdueOriginals});
    if(storage?.originalTtlMs&&storage.originalTtlMs<5*60*60*1000)add('asset_pressure','storage_capacity','warning','磁盘空间紧张，原图保留已自动缩短');
    for(const name of ['app','mysql'])if(resources.containers?.available&&resources.containers[name]&&resources.containers[name]!=='running')add('container:'+name,'container_state','critical',name+' 容器状态异常');
    if(resources.hostSnapshotStale)add('host_snapshot','collector_stale','warning','主机资源快照已过期或不可读取');
    for(const [key,incident]of found){
      const previous=activeIncidents.get(key);
      if(!previous||previous.severity!==incident.severity||now()-previous.savedAt>=60000){await store.upsertIncident(incident);activeIncidents.set(key,{...incident,savedAt:now()});}
    }
    for(const [key,incident]of activeIncidents)if(!found.has(key)){await store.upsertIncident({...incident,status:'recovered',recoveredAt:new Date(now()).toISOString()});activeIncidents.delete(key);}
  };
  const collect=()=>{
    if(collecting)return collecting;
    collecting=(async()=>{
      try {
        resources=await metrics.collect();
        const host=await readHostSnapshot();
        const hostAge=host?.generatedAt?now()-Date.parse(host.generatedAt):Infinity;
        hostObserved ||= Boolean(host);
        if(host&&Number.isFinite(hostAge)&&hostAge>=-5000&&hostAge<=STALE_MS){
          const cpu=typeof host.cpuPercent==='number'&&Number.isFinite(host.cpuPercent)&&host.cpuPercent>=0&&host.cpuPercent<=100?host.cpuPercent:null;
          const validMemory=Number.isFinite(host.memoryTotalBytes)&&host.memoryTotalBytes>0&&Number.isFinite(host.memoryAvailableBytes)&&host.memoryAvailableBytes>=0&&host.memoryAvailableBytes<=host.memoryTotalBytes;
          resources.host={available:cpu!==null||validMemory,cpuPercent:cpu,memoryTotalBytes:validMemory?host.memoryTotalBytes:null,memoryAvailableBytes:validMemory?host.memoryAvailableBytes:null};
          const states=new Set(['created','running','paused','restarting','removing','exited','dead']);
          const app=states.has(host.containers?.app)?host.containers.app:null,mysql=states.has(host.containers?.mysql)?host.containers.mysql:null;
          resources.containers={available:app!==null||mysql!==null,app,mysql,reason:app===null||mysql===null?'部分容器状态未采集':null};
          resources.coverage={...resources.coverage,host:resources.host.available?'host_snapshot':'unavailable',hostCpu:cpu===null?'unavailable':'host_snapshot',hostMemory:validMemory?'host_snapshot':'unavailable'};
          resources.hostGeneratedAt=host.generatedAt;
          resources.hostSnapshotStale=!resources.host.available;
        }else {
          resources.containers={available:false,reason:'尚未安装主机采集器或快照过期'};
          resources.hostSnapshotStale=hostObserved;
        }
        const runtime=getRuntime();
        if(now()-aggregateAt>=60000){
          const dbStart=performance.now();await store.refreshAggregates();aggregateAt=now();historyGeneratedAt=store.getCoverage().aggregateUpdatedAt||new Date(now()).toISOString();
          database={available:store.getCoverage().available,latencyMs:store.getCoverage().available?Math.round((performance.now()-dbStart)*100)/100:null,description:'本轮聚合查询耗时，非连接池等待'};
        }
        const nextMinute=Math.floor(now()/60000);
        if(nextMinute!==minute){await store.recordRuntimeSample?.({timestamp:new Date(now()).toISOString(),active:runtime.active,localQueued:runtime.localQueued,upstreamQueued:runtime.upstreamQueued});minute=nextMinute;}
        await evaluate(runtime,await store.getFailureSummary({window:'5m'}));
        if(now()-pruneAt>=3600000){await store.pruneExpired();pruneAt=now();}
        resources.database=database;lastCollectedAt=new Date(now()).toISOString();
      }catch{collectionError='运行采集异常，请检查数据库和采集器';warn();}
    })().finally(()=>collecting=null);return collecting;
  };
  const start=()=>startPromise||=(async()=>{
    stopping=false;try{await store.init();}catch{collectionError='运行历史数据库初始化失败';warn();}
    await collect();
    if(!stopping){timer=setInterval(()=>void collect(),20000);timer.unref?.();}
  })();
  const stop=async()=>{stopping=true;clearInterval(timer);if(collecting)await collecting;await Promise.allSettled([...recording.values()]);metrics.close?.();startPromise=null;};
  const base=()=>({success:true,generatedAt:lastCollectedAt,coverage:coverage(),freshness:freshness()});
  return {start,stop,collect,record,
    getSummary:async()=>({...base(),runtime:getRuntime(),resources,failures:await store.getFailureSummary({window:'15m'}),incidents:await store.listIncidents()}),
    getTrends:async filters=>({...base(),generatedAt:historyGeneratedAt,...await store.getTrends(filters)}),
    listTasks:async filters=>({...base(),...await store.listTaskFacts(filters)}),
    getTask:async taskId=>{const detail=await store.getTaskFact(taskId);return detail?{...base(),...detail}:null;},
    getFailures:async filters=>{
      const summary=await store.getFailureSummary(filters);
      const metadata=base();
      const history=age(summary.generatedAt,['24h','7d'].includes(filters?.window)?17*60000:120000);
      return {...metadata,...summary,freshness:{...metadata.freshness,history,stale:metadata.freshness.stale||history.stale}};
    },
    getIncidents:async()=>({...base(),...await store.listIncidents()}),
  };
}
function registerOperationsRoutes(app,{dashboard,requireAdminAccess,adminKeys=[],sendAuthError}) {
  const wrap=handler=>async(req,res)=>{try{await requireAdminAccess(req,adminKeys);res.setHeader('Cache-Control','private, no-store');await handler(req,res);}catch(error){if(sendAuthError(res,error))return;res.status(error.status===400?400:503).json({error:error.status===400?error.message:'运行数据暂不可用，请稍后重试'});}};
  const bad=message=>{throw Object.assign(new Error(message),{status:400});};
  const filters=req=>{
    const window=String(req.query.window||'24h');if(!WINDOWS.has(window))bad('不支持的时间范围');
    if(req.query.status&&!['all','queued','running','succeeded','failed','rejected'].includes(String(req.query.status)))bad('不支持的任务状态');
    const output={window,limit:Math.max(1,Math.min(50,parseInt(req.query.limit,10)||50))};
    for(const key of ['status','userId','routeId','taskId','requestId','failureCategory','storageStatus','settlementStatus','cursor'])if(req.query[key]!=null){if(typeof req.query[key]!=='string'||req.query[key].length>512)bad('筛选参数无效');output[key]=req.query[key];}
    return output;
  };
  app.get('/api/admin/operations/summary',wrap(async(_req,res)=>res.json(await dashboard.getSummary())));
  app.get('/api/admin/operations/trends',wrap(async(req,res)=>res.json(await dashboard.getTrends({...filters(req),window:req.query.window||'1h'}))));
  app.get('/api/admin/operations/tasks',wrap(async(req,res)=>res.json(await dashboard.listTasks(filters(req)))));
  app.get('/api/admin/operations/tasks/:taskId',wrap(async(req,res)=>{if(req.params.taskId.length>100)bad('任务编号无效');const data=await dashboard.getTask(req.params.taskId);return data?res.json(data):res.status(404).json({error:'未找到任务或历史未采集'});}));
  app.get('/api/admin/operations/failures',wrap(async(req,res)=>res.json(await dashboard.getFailures(filters(req)))));
  app.get('/api/admin/operations/incidents',wrap(async(_req,res)=>res.json(await dashboard.getIncidents())));
}
module.exports={createOperationsDashboard,registerOperationsRoutes,classifyFailure,safeTask,redact};
