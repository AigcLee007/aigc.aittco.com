import 'fake-indexeddb/auto';
import { describe,it,expect,vi,afterEach } from 'vitest';
import { get as readLocalState, set as saveLocalState } from 'idb-keyval';
import { useCanvasStore, sanitizePersistedNode } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { collectReferencedAssetIds } from './localCacheMaintenance';
import { historyManager } from '../commands/HistoryManager';
import { localReadsSafe } from './localHydrationSafety';
import { retryFailedLocalReads } from './localPersistenceRecovery';

describe('durable asset references',()=>{
  afterEach(async()=>{
    vi.restoreAllMocks();
    await Promise.all([useCanvasStore.persist.rehydrate(),useHistoryStore.persist.rehydrate(),useSelectionStore.persist.rehydrate()]);
    historyManager.clear();
  });

  it('retains canvas edits and completed generation while a failed read recovers',async()=>{
    await useCanvasStore.persist.rehydrate();
    const original={id:'generating',type:'IMAGE' as const,x:0,y:0,width:300,height:200,loading:true};
    const removed={...original,id:'removed',loading:false};
    await useCanvasStore.setState({nodes:[original,removed]});
    const saved=await readLocalState('infinitemuse-storage');
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('temporary canvas read failure');});
    await useCanvasStore.persist.rehydrate();
    read.mockRestore();
    useCanvasStore.getState().addNode({...original,id:'during-outage',loading:false},true);
    useCanvasStore.getState().deleteNode('removed');
    await saveLocalState('infinitemuse-storage',saved);

    // A result can arrive after retry starts but before IndexedDB returns.
    const storage=useCanvasStore.persist.getOptions().storage!;
    let resume!:()=>void;
    const wait=new Promise<void>(resolve=>{resume=resolve;});
    const delayedRead=vi.spyOn(storage,'getItem').mockImplementation(async(name)=>{
      const value=await readLocalState(name);
      await wait;
      return value as any;
    });
    const retry=useCanvasStore.persist.rehydrate();
    useCanvasStore.getState().updateNode('generating',{loading:false,assetId:'generated-original',src:'https://example.test/result.png'},true);
    resume();
    await retry;
    delayedRead.mockRestore();
    expect(useCanvasStore.getState().nodes.map(node=>node.id)).toEqual(['generating','during-outage']);
    expect(useCanvasStore.getState().nodes[0]).toMatchObject({loading:false,assetId:'generated-original',src:'https://example.test/result.png'});
    expect((await readLocalState<any>('infinitemuse-storage')).state.nodes).toEqual(useCanvasStore.getState().nodes);
  });

  it('keeps healthy stores writable while canvas storage cannot be read',async()=>{
    await Promise.all([useCanvasStore.persist.rehydrate(),useSelectionStore.persist.rehydrate()]);
    useSelectionStore.getState().setPrompt('before outage');
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('temporary canvas read failure');});
    await useCanvasStore.persist.rehydrate();
    read.mockRestore();
    useSelectionStore.getState().setPrompt('edited while canvas is unavailable');
    expect(JSON.parse(window.localStorage.getItem('selection-storage')!).state.prompt).toBe('edited while canvas is unavailable');
  });

  it('overlays prompt and reference edits made while selection hydration is unavailable',async()=>{
    useSelectionStore.getState().setPrompt('baseline');
    useSelectionStore.getState().setReferenceImages([{id:'removed-reference',src:'https://example.test/old.png',type:'url'}]);
    const saved=JSON.stringify({state:{prompt:'saved prompt',aspectRatio:'16:9',referenceImages:[{id:'removed-reference',src:'https://example.test/old.png',type:'url'}]},version:0});
    window.localStorage.setItem('selection-storage',saved);
    const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('temporary selection read failure');});
    await useSelectionStore.persist.rehydrate();
    read.mockRestore();
    useSelectionStore.getState().setPrompt('draft typed during outage');
    useSelectionStore.getState().setReferenceImages([{id:'new-reference',src:'https://example.test/new.png',type:'url'}]);
    expect(window.localStorage.getItem('selection-storage')).toBe(saved);
    await useSelectionStore.persist.rehydrate();
    expect(useSelectionStore.getState().prompt).toBe('draft typed during outage');
    expect(useSelectionStore.getState().aspectRatio).toBe('16:9');
    expect(useSelectionStore.getState().referenceImages.map(image=>image.id)).toEqual(['new-reference']);
    expect(JSON.parse(window.localStorage.getItem('selection-storage')!).state.prompt).toBe('draft typed during outage');
  });

  it('keeps history added during a read failure when saved logs return',async()=>{
    await useHistoryStore.persist.rehydrate();
    await useHistoryStore.setState({logs:[{id:'saved-log',time:'',prompt:'saved',imageUrl:'https://example.test/saved.png',type:'IMAGE'}]});
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('temporary history read failure');});
    await useHistoryStore.persist.rehydrate();
    read.mockRestore();
    const added=useHistoryStore.getState().addLog('generated during outage','https://example.test/new.png','new-original');
    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().logs.map(log=>log.id)).toEqual([added,'saved-log']);
  });

  it('recovers unread saved nodes alongside imports made before the first successful read',async()=>{
    await useCanvasStore.persist.rehydrate();
    await useCanvasStore.setState({nodes:[]});
    const storedNode={id:'unread-saved',type:'IMAGE' as const,x:0,y:0,width:300,height:200,assetId:'saved-original'};
    await saveLocalState('infinitemuse-storage',{state:{nodes:[storedNode]},version:0});
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('initial read failure');});
    await useCanvasStore.persist.rehydrate();
    read.mockRestore();
    useCanvasStore.getState().addNode({...storedNode,id:'new-import',assetId:'imported-original'},true);
    await retryFailedLocalReads();
    expect(useCanvasStore.getState().nodes.map(node=>node.id)).toEqual(expect.arrayContaining(['unread-saved','new-import']));
  });

  it('deduplicates simultaneous retries and only rehydrates failed stores',async()=>{
    await Promise.all([useCanvasStore.persist.rehydrate(),useHistoryStore.persist.rehydrate(),useSelectionStore.persist.rehydrate()]);
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('retryable canvas read failure');});
    await useCanvasStore.persist.rehydrate();
    read.mockRestore();
    const canvasRetry=vi.spyOn(useCanvasStore.persist,'rehydrate');
    const historyRetry=vi.spyOn(useHistoryStore.persist,'rehydrate');
    const selectionRetry=vi.spyOn(useSelectionStore.persist,'rehydrate');
    await Promise.all([retryFailedLocalReads(),retryFailedLocalReads()]);
    expect(canvasRetry).toHaveBeenCalledTimes(1);
    expect(historyRetry).not.toHaveBeenCalled();
    expect(selectionRetry).not.toHaveBeenCalled();
    expect(localReadsSafe()).toBe(true);
  });

  it('keeps cleared history deleted across repeated failures and later recovery',async()=>{
    await useHistoryStore.persist.rehydrate();
    await useHistoryStore.setState({logs:[{id:'to-clear',time:'',prompt:'saved',imageUrl:'https://example.test/saved.png',type:'IMAGE'}]});
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('repeated history read failure');});
    await useHistoryStore.persist.rehydrate();
    useHistoryStore.getState().clearLogs();
    await useHistoryStore.persist.rehydrate();
    read.mockRestore();
    await retryFailedLocalReads();
    expect(useHistoryStore.getState().logs).toEqual([]);
    expect(JSON.parse((await readLocalState<string>('infinitemuse-history'))!).state.logs).toEqual([]);
  });

  it('flushes generation completed between installing recovered canvas and finishing hydration',async()=>{
    await useCanvasStore.persist.rehydrate();
    await useCanvasStore.setState({nodes:[{id:'late-generation',type:'IMAGE',x:0,y:0,width:300,height:200,loading:true}]});
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('temporary read failure');});
    await useCanvasStore.persist.rehydrate();
    read.mockRestore();
    let queued=false;
    const stop=useCanvasStore.subscribe(()=>{
      if(queued)return;
      queued=true;
      queueMicrotask(()=>useCanvasStore.getState().updateNode('late-generation',{loading:false,assetId:'late-original',src:'https://example.test/late.png'},true));
    });
    await useCanvasStore.persist.rehydrate();
    stop();
    expect(useCanvasStore.getState().nodes[0].assetId).toBe('late-original');
    expect((await readLocalState<any>('infinitemuse-storage')).state.nodes[0]).toMatchObject({loading:false,assetId:'late-original'});
    await useCanvasStore.persist.rehydrate();
    expect(useCanvasStore.getState().nodes[0].assetId).toBe('late-original');
  });

  it('flushes history asset updated between installing recovered logs and finishing hydration',async()=>{
    await useHistoryStore.persist.rehydrate();
    await useHistoryStore.setState({logs:[{id:'late-log',time:'',prompt:'generated',imageUrl:'https://example.test/late.png',assetId:'old-original',type:'IMAGE'}]});
    const read=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(()=>{throw new Error('temporary read failure');});
    await useHistoryStore.persist.rehydrate();
    read.mockRestore();
    let queued=false;
    const stop=useHistoryStore.subscribe(()=>{
      if(queued)return;
      queued=true;
      queueMicrotask(()=>useHistoryStore.getState().updateLogAsset('late-log','late-original'));
    });
    await useHistoryStore.persist.rehydrate();
    stop();
    expect(useHistoryStore.getState().logs[0].assetId).toBe('late-original');
    expect(JSON.parse((await readLocalState<string>('infinitemuse-history'))!).state.logs[0].assetId).toBe('late-original');
    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().logs[0].assetId).toBe('late-original');
  });

  it('flushes prompt edited by a subscriber while recovered selection is installed',async()=>{
    useSelectionStore.getState().setPrompt('before recovery');
    const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('temporary read failure');});
    await useSelectionStore.persist.rehydrate();
    read.mockRestore();
    let edited=false;
    const stop=useSelectionStore.subscribe(()=>{
      if(edited)return;
      edited=true;
      useSelectionStore.getState().setPrompt('late draft');
    });
    await useSelectionStore.persist.rehydrate();
    stop();
    expect(useSelectionStore.getState().prompt).toBe('late draft');
    expect(JSON.parse(window.localStorage.getItem('selection-storage')!).state.prompt).toBe('late draft');
    await useSelectionStore.persist.rehydrate();
    expect(useSelectionStore.getState().prompt).toBe('late draft');
  });

  it('preserves selection metadata on a transient read failure and resumes persistence after recovery',async()=>{
    await Promise.all([useCanvasStore.persist.rehydrate(),useHistoryStore.persist.rehydrate()]);
    const saved=JSON.stringify({state:{prompt:'saved prompt'},version:0});
    window.localStorage.setItem('selection-storage',saved);
    const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('temporary read failure');});
    await useSelectionStore.persist.rehydrate();
    expect(localReadsSafe()).toBe(false);
    read.mockRestore();
    expect(window.localStorage.getItem('selection-storage')).toBe(saved);
    await useSelectionStore.persist.rehydrate();
    expect(localReadsSafe()).toBe(true);
    expect(useSelectionStore.getState().prompt).toBe('saved prompt');
  });
  it('persists failure states and asset history without runtime URLs',()=>{
    const saved=sanitizePersistedNode({id:'n',type:'IMAGE',x:0,y:0,width:300,height:200,error:true,errorMessage:'failed',src:'blob:old',assetId:'cached',history:[{src:'blob:old',assetId:'previous'}],historyIndex:0});
    expect(saved.error).toBe(true);expect(saved.errorMessage).toBe('failed');expect(saved.src).toBeUndefined();expect(saved.history?.[0].assetId).toBe('previous');
  });
  it('protects asset references in undo, redo, canvas history, logs and reference images',()=>{
    historyManager.clear();
    const node={id:'asset-node',type:'IMAGE' as const,x:0,y:0,width:300,height:200,assetId:'original',history:[{src:'',assetId:'previous'}]};
    useCanvasStore.getState().setNodes([node],true);
    useHistoryStore.setState({logs:[{id:'l',time:'',prompt:'',imageUrl:'',assetId:'log',type:'IMAGE'}]});
    useSelectionStore.setState({referenceImages:[{id:'r',src:'',assetId:'reference',type:'blob'}]});
    useCanvasStore.getState().deleteNode(node.id);
    expect([...collectReferencedAssetIds()]).toEqual(expect.arrayContaining(['original','previous','log','reference']));
    historyManager.undo();historyManager.redo();expect(collectReferencedAssetIds().has('original')).toBe(true);
    historyManager.clear();
  });
});
