const fs=require('node:fs/promises');
const path=require('node:path');
const {monitorEventLoopDelay}=require('node:perf_hooks');

const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
function parseMeminfo(text){
  const values={};for(const line of String(text||'').split(/\r?\n/)){const match=line.match(/^(MemTotal|MemAvailable):\s*(\d+)\s+kB\s*$/);if(match)values[match[1]]=Number(match[2])*1024;}
  if(!(values.MemTotal>0)||finite(values.MemAvailable)===null||values.MemAvailable>values.MemTotal)return null;
  return {memoryTotalBytes:values.MemTotal,memoryAvailableBytes:values.MemAvailable};
}
function parseCpuStat(text){
  const match=String(text||'').match(/^cpu\s+(\d+(?:\s+\d+){3,})\s*$/m);if(!match)return null;
  // guest and guest_nice are already included in user/nice.
  const values=match[1].trim().split(/\s+/).slice(0,8).map(Number);
  const total=values.reduce((sum,value)=>sum+value,0),idle=values[3]+(values[4]||0);
  return Number.isSafeInteger(total)&&total>0?{total,idle}:null;
}
function cpuPercent(previous,current){
  if(!previous||!current)return null;const total=current.total-previous.total,idle=current.idle-previous.idle;
  return total>0&&idle>=0&&idle<=total?100*(total-idle)/total:null;
}
function parseCgroupValue(text){
  const value=String(text??'').trim();if(!/^\d+$/.test(value))return null;
  const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:null;
}
function createOperationsRuntimeMetrics(options={}){
  const readFile=options.readFile||fs.readFile,statfs=options.statfs||fs.statfs;
  const now=options.now||Date.now,memoryUsage=options.memoryUsage||(()=>process.memoryUsage()),uptime=options.uptime||(()=>process.uptime());
  const storageRoot=options.storageRoot||path.join(__dirname,'storage');
  const hostProcPath=options.hostProcPath||process.env.OPERATIONS_HOST_PROC_PATH;
  const cgroupPath=options.cgroupPath||'/sys/fs/cgroup';
  const sourcePath=(root,file)=>root.startsWith('/')?path.posix.join(root,file):path.join(root,file);
  const timeoutMs=Math.max(10,Math.min(5000,Number(options.collectionTimeoutMs)||1000));
  const sampler=(options.monitorEventLoopDelay||monitorEventLoopDelay)({resolution:20});sampler.enable();
  let eventLoopP95Ms=null,previousCpu=null,collecting=null,closed=false;
  const sampleEventLoop=()=>{const value=Number(sampler.percentile(95))/1e6;eventLoopP95Ms=Number.isFinite(value)&&value>=0?value:null;sampler.reset();};
  const interval=setInterval(sampleEventLoop,Math.max(1000,Math.min(60000,Number(options.eventLoopSampleMs)||10000)));interval.unref?.();
  const empty=()=>({generatedAt:null,host:{available:false,cpuPercent:null,memoryTotalBytes:null,memoryAvailableBytes:null},process:{rssBytes:null,heapUsedBytes:null,uptimeSeconds:null,eventLoopP95Ms:null},cgroup:{memoryCurrentBytes:null,memoryMaxBytes:null},disk:{totalBytes:null,freeBytes:null},coverage:{host:hostProcPath?'not_collected':'unavailable',hostCpu:'not_collected',hostMemory:'not_collected',process:'not_collected',cgroup:'not_collected',cgroupMemoryLimit:'not_collected',disk:'not_collected'}});
  let snapshot=empty();
  const getSnapshot=()=>JSON.parse(JSON.stringify(snapshot));
  const bestEffort=async work=>{let timer;try{return await Promise.race([Promise.resolve().then(work).catch(()=>null),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);}finally{clearTimeout(timer);}};
  async function collect(){
    if(closed)return getSnapshot();if(collecting)return collecting;
    collecting=(async()=>{
      const [mem,cpu,current,max,disk]=await Promise.all([
        hostProcPath?bestEffort(()=>readFile(sourcePath(hostProcPath,'meminfo'),'utf8')):null,
        hostProcPath?bestEffort(()=>readFile(sourcePath(hostProcPath,'stat'),'utf8')):null,
        bestEffort(()=>readFile(sourcePath(cgroupPath,'memory.current'),'utf8')),
        bestEffort(()=>readFile(sourcePath(cgroupPath,'memory.max'),'utf8')),
        bestEffort(()=>statfs(storageRoot)),
      ]);
      const hostMemory=parseMeminfo(mem),hostCpu=parseCpuStat(cpu);
      const host={available:!!(hostMemory||hostCpu),cpuPercent:cpuPercent(previousCpu,hostCpu),memoryTotalBytes:hostMemory?.memoryTotalBytes??null,memoryAvailableBytes:hostMemory?.memoryAvailableBytes??null};
      previousCpu=hostCpu;
      let usage={};try{usage=memoryUsage()||{};}catch{}let processUptime=null;try{processUptime=finite(uptime());}catch{}
      // Read the current histogram too: collection may precede the first timer.
      if(eventLoopP95Ms===null)sampleEventLoop();
      const memoryCurrentBytes=parseCgroupValue(current),memoryMaxBytes=parseCgroupValue(max);
      const blockSize=finite(disk?.bsize),blocks=finite(disk?.blocks),available=finite(disk?.bavail);
      const diskAvailable=blockSize>0&&blocks!==null&&available!==null&&available<=blocks;
      snapshot={generatedAt:new Date(now()).toISOString(),host,process:{rssBytes:finite(usage.rss),heapUsedBytes:finite(usage.heapUsed),uptimeSeconds:processUptime,eventLoopP95Ms},cgroup:{memoryCurrentBytes,memoryMaxBytes},disk:{totalBytes:diskAvailable?blockSize*blocks:null,freeBytes:diskAvailable?blockSize*available:null},coverage:{host:host.available?'available':'unavailable',hostCpu:hostCpu?(host.cpuPercent===null?'warming_up':'available'):'unavailable',hostMemory:hostMemory?'available':'unavailable',process:finite(usage.rss)!==null?'available':'unavailable',cgroup:memoryCurrentBytes!==null?'available':'unavailable',cgroupMemoryLimit:String(max??'').trim()==='max'?'unlimited':memoryMaxBytes!==null?'available':'unavailable',disk:diskAvailable?'available':'unavailable'}};
      return getSnapshot();
    })();
    try{return await collecting;}finally{collecting=null;}
  }
  function close(){closed=true;clearInterval(interval);sampler.disable();}
  return {collect,getSnapshot,close};
}
module.exports={createOperationsRuntimeMetrics,parseMeminfo,parseCpuStat,cpuPercent,parseCgroupValue};
