/* Simple Studio v4.6.2 音乐模块全流程回归与录音后 A1 稳定版 */
(() => {
  'use strict';
  if (window.__SIMPLE_STUDIO_MULTITRACK_V462__) return;
  window.__SIMPLE_STUDIO_MULTITRACK_V462__ = true;

  const MAX_LANES = 12;
  const MAX_CLIPS = 48;
  const DB_NAME = 'SimpleStudioMultiTrack_v1';
  const STORE = 'projects';
  const LAST_KEY = 'ss_multitrack_last_project_v1';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const uid = (p='mt') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const clamp = (n,a,b) => Math.max(a, Math.min(b, Number(n)||0));
  const esc = (s) => String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt = (sec) => {
    sec = Math.max(0, Number(sec)||0);
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60), cs = Math.floor((sec%1)*100);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  };
  const safeName = (s) => String(s||'多轨融合').replace(/[\\/:*?"<>|]+/g,'_').slice(0,80);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch(_e) { return null; } };
  const lsSet = (k,v) => { try { localStorage.setItem(k,v); return true; } catch(_e) { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch(_e) {} };

  const S = {
    active:false, lanes:[], clips:[], selectedClipId:'', selectedLaneId:'', projectId:'', projectName:'', dirty:false,
    audioCtx:null, sources:[], playing:false, cursor:0, startedAt:0, startedCursor:0, raf:0,
    master:0.9, normalize:true, dialogCues:[], db:null, exporting:false,
    viewDuration:120, gesture:null, suppressClick:false, snap:true,
    autoCrossfade:true, crossfadeDuration:1.5, snapGuide:null, dropLaneId:'', dragGhost:null,
    recorder:null, recordStream:null, recordChunks:[], recording:false, recordProcessing:false,
    recordStartedAt:0, recordTimer:0, recordLaneId:'', recordOffset:0, recordMime:'', recordDiscard:false,
    recordSourceNode:null, recordAnalyser:null, recordData:null, recordVisualRaf:0,
    recordWaveHistory:[], recordLevel:0, recordPeak:0, recordLastUiAt:0, recordLastTimelineGrow:0,
    a1RestoreTimers:[], a1HealthToken:0, a1ProtectedSrcdoc:'', a1WasHealthyBeforeRecord:false
  };
  Object.defineProperty(S,'tracks',{get(){return S.clips;}});

  function toast(msg){
    try { if (typeof window.toast === 'function') return window.toast(msg); } catch(_e) {}
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style,{position:'fixed',right:'22px',bottom:'22px',zIndex:'99999',padding:'10px 14px',borderRadius:'12px',background:'rgba(10,16,26,.94)',color:'#fff',border:'1px solid rgba(255,255,255,.16)',boxShadow:'0 12px 38px rgba(0,0,0,.35)',fontWeight:'800'});
    document.body.appendChild(el); setTimeout(()=>el.remove(),2200);
  }

  function openDb(){
    if (S.db) return Promise.resolve(S.db);
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME,1);
      req.onupgradeneeded = ()=>{ const db=req.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'}); };
      req.onsuccess=()=>{S.db=req.result;resolve(S.db);}; req.onerror=()=>reject(req.error);
    });
  }
  async function dbPut(v){ const db=await openDb(); return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v);tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error);}); }
  async function dbGet(id){ const db=await openDb(); return new Promise((res,rej)=>{const q=db.transaction(STORE).objectStore(STORE).get(id);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error);}); }
  async function dbAll(){ const db=await openDb(); return new Promise((res,rej)=>{const q=db.transaction(STORE).objectStore(STORE).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);}); }
  async function dbDel(id){ const db=await openDb(); return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error);}); }

  function panelHtml(){
    return `<section id="multiTrackPanel" tabindex="-1" aria-label="多轨融合音乐编辑器">
      <div class="mtTop">
        <div class="mtBrand">
          <div class="mtBrandMark"><span>MX</span><i></i></div>
          <div class="mtBrandCopy"><div class="mtBrandTitle"><b>多轨融合音乐编辑器</b><em class="mtModeBadge">PRO TIMELINE</em></div><span>跨轨拖放 · 实时录音波形 · 音乐块独立音量 · 自动交叉淡化 · MP3 输出</span></div>
        </div>
        <div class="mtTopActions">
          <div class="mtActionGroup"><small>导入素材</small><button class="mtBtn primary" id="mtAddFiles">＋ 本地音频</button><button class="mtBtn" id="mtAddA1">从 A1 选歌</button></div>
          <div class="mtActionGroup recordGroup"><small>现场录制</small><button class="mtBtn record" id="mtRecord">● 开始录音</button><button class="mtBtn danger" id="mtRecordCancel" hidden>取消本次</button></div>
          <div class="mtActionGroup"><small>轨道</small><button class="mtBtn" id="mtAddLane">＋ 新建轨道</button></div>
          <div class="mtActionGroup outputGroup"><small>输出</small><button class="mtBtn" id="mtExport">导出 MP3</button><button class="mtBtn primary" id="mtExportA1">合成并加入 A1</button></div>
          <button class="mtBtn mtBackBtn" id="mtClose">返回 A1</button>
          <input id="mtFileInput" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" multiple hidden>
        </div>
      </div>
      <div class="mtProjectBar">
        <div class="mtProjectLead"><span>PROJECT</span><b>融合工程</b></div>
        <select id="mtProjectSelect" title="已保存项目"><option value="">未保存的新项目</option></select>
        <input id="mtProjectName" class="mtProjectName" placeholder="项目名称，例如：新娘入场音乐融合">
        <button class="mtBtn" id="mtNewProject">新建</button>
        <button class="mtBtn primary" id="mtSaveProject">保存项目</button>
        <button class="mtBtn danger" id="mtDeleteProject">删除</button>
        <span id="mtDirtyLabel"></span>
      </div>
      <div class="mtTransport">
        <div class="mtTransportButtons"><button class="mtBtn primary mtPlayBtn" id="mtPlay">▶ 播放</button><button class="mtBtn mtStopBtn" id="mtStop">■ 停止</button></div>
        <div class="mtTimeBox"><small>PLAYHEAD / TOTAL</small><div class="mtTime" id="mtTime">0:00.00 / 0:00.00</div></div>
        <input class="mtSeek" id="mtSeek" type="range" min="0" max="1" step="0.01" value="0">
        <div class="mtMasterRack"><label class="mtMaster"><span>主音量</span><input id="mtMaster" type="range" min="0" max="1.2" step="0.01" value="0.9"><b id="mtMasterLabel">90%</b></label><label class="mtMaster normalize"><input id="mtNormalize" type="checkbox" checked> 导出防爆音</label></div>
      </div>
      <div class="mtEditBar">
        <div class="mtToolTitle"><span>EDIT TOOLS</span><b>编辑辅助</b></div>
        <label class="mtToolChip"><input id="mtSnap" type="checkbox" checked> 磁吸对齐</label>
        <label class="mtToolChip"><input id="mtAutoCrossfade" type="checkbox" checked> 自动交叉淡化</label>
        <label class="mtToolChip">交叉时长 <input id="mtCrossfadeDuration" type="number" min="0.1" max="10" step="0.1" value="1.5"> 秒</label>
        <span>音频块可横向定位、上下换轨；单击轨道或音乐块会显示选中反馈，Delete / Backspace 删除当前选中对象。</span>
      </div>
      <div class="mtRecordBar" id="mtRecordBar" hidden>
        <div class="mtRecordHeader">
          <div class="mtRecordIdentity"><span class="mtRecordDot"></span><div><small>LIVE INPUT</small><b id="mtRecordState">正在录音</b></div></div>
          <div class="mtRecordClock"><small>REC TIME</small><span id="mtRecordTime">00:00.0</span></div>
          <span id="mtRecordTarget">录音将作为普通音频块加入当前轨道</span>
        </div>
        <div class="mtRecordVisual">
          <div class="mtRecordScope"><canvas id="mtRecordWave"></canvas><span>实时麦克风波形</span></div>
          <div class="mtRecordMeter"><small>INPUT LEVEL</small><div class="mtRecordMeterTrack"><i id="mtRecordLevelFill"></i><span></span><span></span></div><b id="mtRecordDb">-∞ dB</b><em id="mtRecordSignalHint">等待声音输入</em></div>
        </div>
      </div>
      <div class="mtInspector" id="mtInspector"></div>
      <div class="mtWorkspace" id="mtWorkspace">
        <div class="mtWorkspaceHead"><div><small>MULTITRACK SESSION</small><b>融合时间线</b></div><span>拖动音乐块换轨或调整位置</span></div>
        <div class="mtRulerRow"><div class="mtRulerInfo"><span>轨道控制台</span><span id="mtDurationInfo">总时长 0:00.00</span></div><canvas class="mtRuler" id="mtRuler"></canvas></div>
        <div class="mtTracks" id="mtTracks"></div>
      </div>
      <div class="mtStatus"><span id="mtStatus">等待导入音频</span><span>空格：播放/暂停 · Delete / Backspace：删除选中轨道或音乐块 · 录音时显示实时波形与输入电平</span></div>
      <dialog id="mtA1Dialog"><div class="mtDlgTop"><b>从 A1 音乐库加入音频块</b><input id="mtA1Search" placeholder="搜索歌名或分类"><button class="mtBtn" id="mtA1Refresh">刷新</button><button class="mtBtn" id="mtA1Close">关闭</button></div><div class="mtA1List" id="mtA1List"></div></dialog>
    </section>`;
  }

  function inject(){
    if ($('#multiTrackPanel')) return true;
    const bar = $('#musicSystem .msModeBar');
    const a1Btn = $('#btnMusicP1');
    if (!bar || !a1Btn) return false;
    const btn = document.createElement('button');
    btn.className='segbtn'; btn.id='btnMusicMultiTrack'; btn.type='button'; btn.title='AU式跨轨拖放、自动交叉淡化、裁剪并导出 MP3'; btn.textContent='多轨融合';
    a1Btn.insertAdjacentElement('afterend',btn);
    bar.insertAdjacentHTML('afterend',panelHtml());
    bind(); ensureBaseLanes(4); renderAll(); refreshProjects();
    const last = lsGet(LAST_KEY); if(last) setTimeout(()=>loadProject(last,true),100);
    return true;
  }

  const A1_HEIGHT_KEY='music_p1_console_height_v1';
  function a1TemplateSource(){
    const tpl=$('#tplP1ConsoleSrcdoc');
    return String(tpl?.innerHTML||tpl?.textContent||'').trim();
  }
  function a1FrameHealthy(fr=$('#p1ConsoleFrame')){
    if(!fr)return false;
    const srcdoc=String(fr.getAttribute('srcdoc')||fr.srcdoc||'').trim();
    if(srcdoc.length<800)return false;
    try{
      const doc=fr.contentDocument;
      if(!doc||doc.readyState==='loading')return true;
      const body=doc.body;
      if(!body)return false;
      return body.childElementCount>=2||String(body.textContent||'').trim().length>240||!!doc.querySelector('#btnStop,#queueList,#app,.app,.shell');
    }catch(_e){return true;}
  }
  function ensureA1FrameReady(recoverBlank=false){
    const fr=$('#p1ConsoleFrame');if(!fr)return false;
    const src=a1TemplateSource(),current=String(fr.getAttribute('srcdoc')||fr.srcdoc||'').trim();
    const mustLoad=!current||(recoverBlank&&!a1FrameHealthy(fr));
    if(mustLoad&&src){
      try{fr.setAttribute('srcdoc',src);}catch(_e){}
      try{fr.srcdoc=src;}catch(_e){}
      try{const doc=fr.contentDocument;if(doc&&(!doc.body||!doc.body.children.length)){doc.open();doc.write(src);doc.close();}}catch(_e){}
    }
    try{fr.hidden=false;fr.removeAttribute('hidden');fr.removeAttribute('inert');fr.removeAttribute('aria-hidden');}catch(_e){}
    return true;
  }
  function cancelA1RestoreTimers(){
    (S.a1RestoreTimers||[]).forEach(id=>clearTimeout(id));S.a1RestoreTimers=[];S.a1HealthToken++;
  }
  function restoreA1Dimensions(){
    const wrap=$('#msP1Wrap'),bar=$('#p1SizeBar'),frame=$('#p1ConsoleFrame');
    [wrap,bar,frame].forEach(el=>{if(!el)return;try{el.hidden=false;el.removeAttribute('hidden');el.removeAttribute('inert');el.removeAttribute('aria-hidden');el.style.removeProperty('visibility');el.style.removeProperty('opacity');el.style.removeProperty('pointer-events');}catch(_e){}});
    if(wrap){wrap.style.setProperty('display','block','important');wrap.style.setProperty('visibility','visible','important');wrap.style.setProperty('opacity','1','important');}
    if(bar){bar.style.setProperty('display','flex','important');bar.style.setProperty('visibility','visible','important');bar.style.setProperty('opacity','1','important');}
    if(frame){
      frame.style.setProperty('display','block','important');frame.style.setProperty('visibility','visible','important');frame.style.setProperty('opacity','1','important');frame.style.setProperty('width','100%','important');
      let h=Number(lsGet(A1_HEIGHT_KEY));if(!Number.isFinite(h)||h<360)h=1070;
      let rectH=0;try{rectH=frame.getBoundingClientRect().height||0;}catch(_e){}
      if(rectH<260){frame.style.setProperty('height',`${Math.round(h)}px`,'important');document.documentElement.style.setProperty('--p1ConsoleH',`${Math.round(h)}px`);const r=$('#p1HeightRange');if(r)r.value=String(Math.round(h));const lab=$('#p1HeightLabel');if(lab)lab.textContent=`${Math.round(h)}px`;}
    }
  }
  function scrollA1IntoView(){
    const wrap=$('#msP1Wrap'),view=$('#viewMusic');if(!wrap)return;
    try{if(view&&typeof view.scrollTo==='function')view.scrollTo({top:Math.max(0,wrap.offsetTop-12),behavior:'auto'});}catch(_e){}
    try{wrap.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'});}catch(_e){try{wrap.scrollIntoView(true);}catch(_e2){}}
    try{window.scrollBy(0,-8);}catch(_e){}
  }
  function a1RestorePass({scroll=false,recoverBlank=false}={}){
    try{
      const body=document.body;body.dataset.multitrackActive='0';body.dataset.musicMode='p1';body.dataset.musicModeExt='';body.dataset.p1Fullscreen='0';
      if(body.dataset.musicPage==='uvr')delete body.dataset.musicPage;body.setAttribute('data-a1-only','1');
      const ext=$('#extTools');if(ext&&'open' in ext)ext.open=false;
      $('#multiTrackPanel')?.classList.remove('mtOn');$('#btnMusicMultiTrack')?.classList.remove('on');
      ensureA1FrameReady(recoverBlank);restoreA1Dimensions();
      $$('#musicSystem .segbtn').forEach(b=>{const on=b.id==='btnMusicP1';b.classList.toggle('on',on);try{b.setAttribute('aria-selected',on?'true':'false');}catch(_e){}});
      const hint=$('#musicModeHint');if(hint)hint.textContent='当前：A1 播放器';
      try{window.__HHV513__?.syncUi?.('p1');}catch(_e){}
      if(scroll)requestAnimationFrame(()=>requestAnimationFrame(scrollA1IntoView));
    }catch(_e){}
  }
  function scheduleA1Restore(scroll=true){
    cancelA1RestoreTimers();const token=S.a1HealthToken;
    [0,60,180,480,1100].forEach((delay,index)=>{const id=setTimeout(()=>{if(token!==S.a1HealthToken)return;a1RestorePass({scroll:scroll&&index>=1,recoverBlank:index>=2});},delay);S.a1RestoreTimers.push(id);});
  }
  function protectA1BeforeRecording(){
    const fr=$('#p1ConsoleFrame');ensureA1FrameReady(false);S.a1ProtectedSrcdoc=String(fr?.getAttribute('srcdoc')||fr?.srcdoc||'').trim();S.a1WasHealthyBeforeRecord=a1FrameHealthy(fr);
  }
  function stabilizeA1AfterRecording(){
    const token=++S.a1HealthToken;
    [0,120,420,1000].forEach((delay,index)=>setTimeout(()=>{
      if(token!==S.a1HealthToken)return;
      const fr=$('#p1ConsoleFrame');ensureA1FrameReady(index>=1);
      if(!S.active||document.body.dataset.multitrackActive!=='1')a1RestorePass({scroll:index>=1,recoverBlank:index>=1});
      else if(fr&&!a1FrameHealthy(fr)&&index>=1)ensureA1FrameReady(true);
    },delay));
  }
  function restoreA1View(){
    try{
      S.active=false;document.body.dataset.multitrackActive='0';
      $('#multiTrackPanel')?.classList.remove('mtOn');$('#btnMusicMultiTrack')?.classList.remove('on');
      a1RestorePass({scroll:true,recoverBlank:false});scheduleA1Restore(true);
    }catch(_e){}
  }
  function setActive(on,opts={}){
    if(!on&&(S.recording||S.recordProcessing)){toast('请先停止或取消录音');return false;}
    if(on)cancelA1RestoreTimers();
    S.active=!!on; document.body.dataset.multitrackActive=on?'1':'0';
    $('#multiTrackPanel')?.classList.toggle('mtOn',on);
    $('#btnMusicMultiTrack')?.classList.toggle('on',on);
    if(on){
      ensureA1FrameReady(false);stopA1();
      ['netMusicPanel','aiMusicPanel','weddingMusicPanel','licensedMusicPanel','extTools'].forEach(id=>{const x=$('#'+id); if(x && 'open' in x) x.open=false;});
      $$('#musicSystem .segbtn').forEach(b=>{ if(b.id!=='btnMusicMultiTrack') b.classList.remove('on'); });
      const h=$('#musicModeHint'); if(h) h.textContent='当前：多轨融合音乐编辑器';
      setTimeout(()=>{ const panel=$('#multiTrackPanel'); panel?.scrollIntoView({block:'start',behavior:'smooth'}); try{ panel?.focus({preventScroll:true}); }catch(_e){ panel?.focus(); } },20);
    }else{
      pausePlayback(false); document.body.dataset.multitrackActive='0';
      if(opts.restoreA1!==false)restoreA1View();
      else{$('#btnMusicMultiTrack')?.classList.remove('on');const h=$('#musicModeHint');if(h&&opts.modeLabel)h.textContent=`当前：${opts.modeLabel}`;}
    }
    return true;
  }

  function stopA1(){
    try{ const w=$('#p1ConsoleFrame')?.contentWindow; if(w?.stopAll) w.stopAll({fade:true}); else w?.postMessage({type:'__HOST_STOP_P1_AUDIO__'},'*'); }catch(_e){}
  }
  async function a1Api(){
    const fr=$('#p1ConsoleFrame'), tpl=$('#tplP1ConsoleSrcdoc');
    if(!fr) throw new Error('没有找到 A1 播放器');
    let w=fr.contentWindow, api=w && (w.__UVR_P1__||w.__P1_AI_API__); if(api) return api;
    const current=String(fr.getAttribute('srcdoc')||fr.srcdoc||'').trim(); if(!current && tpl){ try{fr.srcdoc=tpl.innerHTML;}catch(_e){} }
    for(let i=0;i<50;i++){ await new Promise(r=>setTimeout(r,100)); w=fr.contentWindow; api=w&&(w.__UVR_P1__||w.__P1_AI_API__); if(api) return api; }
    throw new Error('A1 音乐库还没有准备好，请先打开一次 A1 播放器');
  }

  async function audioContext(){
    if(!S.audioCtx || S.audioCtx.state==='closed') S.audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    if(S.audioCtx.state==='suspended') await S.audioCtx.resume();
    return S.audioCtx;
  }
  async function decodeBlob(blob){ const ctx=await audioContext(); const ab=await blob.arrayBuffer(); return await ctx.decodeAudioData(ab.slice(0)); }

  function preferredRecordMime(){
    if(!window.MediaRecorder)return '';
    const candidates=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
    return candidates.find(x=>{try{return MediaRecorder.isTypeSupported(x);}catch(_e){return false;}})||'';
  }
  function recordTarget(){
    let lane=selectedLane();
    if(!lane)lane=firstEmptyLane();
    if(!lane&&S.lanes.length<MAX_LANES)lane=addLane('录音轨道',false);
    if(!lane)lane=S.lanes[0]||addLane('录音轨道',false);
    if(lane){S.selectedLaneId=lane.id;S.selectedClipId='';updateSelectionClasses();renderInspector();}
    return {lane,offset:Math.max(0,Number(S.cursor)||0)};
  }
  function recordElapsed(){return S.recordStartedAt?Math.max(0,(performance.now()-S.recordStartedAt)/1000):0;}
  function renderRecording(){
    const btn=$('#mtRecord'),cancel=$('#mtRecordCancel'),bar=$('#mtRecordBar'),time=$('#mtRecordTime'),state=$('#mtRecordState'),target=$('#mtRecordTarget');
    if(btn){btn.classList.toggle('on',S.recording);btn.disabled=!!S.recordProcessing;btn.textContent=S.recordProcessing?'正在生成录音…':S.recording?'■ 停止录音':'● 开始录音';}
    if(cancel){cancel.hidden=!S.recording;cancel.disabled=!!S.recordProcessing;}
    if(bar){bar.hidden=!S.recording&&!S.recordProcessing;bar.classList.toggle('isProcessing',S.recordProcessing);}
    if(state)state.textContent=S.recordProcessing?'正在生成可编辑音频块':'正在实时录音';
    const elapsed=S.recording?recordElapsed():0;
    if(time)time.textContent=fmt(elapsed).replace(/^\d+:/,'');
    if(target){const lane=laneById(S.recordLaneId);target.textContent=S.recordProcessing?'录音完成后可像歌曲一样拖动、裁剪、调音量和参与合成':`写入 ${lane?.name||'当前轨道'} · 起点 ${fmt(S.recordOffset)}`;}
  }
  function stopRecordStream(){
    try{S.recordStream?.getTracks?.().forEach(t=>t.stop());}catch(_e){}
    S.recordStream=null;
  }
  function clearRecordTimer(){if(S.recordTimer){clearInterval(S.recordTimer);S.recordTimer=0;}}
  async function setupRecordMonitor(stream){
    stopRecordVisualizer(true);
    const ctx=await audioContext(),source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();
    analyser.fftSize=2048;analyser.smoothingTimeConstant=.68;source.connect(analyser);
    S.recordSourceNode=source;S.recordAnalyser=analyser;S.recordData=new Float32Array(analyser.fftSize);
    S.recordWaveHistory=[];S.recordLevel=0;S.recordPeak=0;S.recordLastUiAt=0;S.recordLastTimelineGrow=0;
  }
  function stopRecordVisualizer(disconnect=false){
    if(S.recordVisualRaf){cancelAnimationFrame(S.recordVisualRaf);S.recordVisualRaf=0;}
    if(disconnect){try{S.recordSourceNode?.disconnect();}catch(_e){}try{S.recordAnalyser?.disconnect();}catch(_e){}S.recordSourceNode=null;S.recordAnalyser=null;S.recordData=null;}
  }
  function canvasPixelSize(canvas){
    if(!canvas)return null;const r=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(20,Math.round(r.width*dpr)),h=Math.max(20,Math.round(r.height*dpr));
    if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;return{w,h,dpr,ctx:canvas.getContext('2d')};
  }
  function drawLiveWave(canvas,history,data,compact=false){
    const size=canvasPixelSize(canvas);if(!size)return;const{w,h,dpr,ctx}=size,css=getComputedStyle(document.documentElement),line=css.getPropertyValue('--line').trim()||'rgba(255,255,255,.14)';
    ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(5,10,18,.42)';ctx.fillRect(0,0,w,h);ctx.strokeStyle=line;ctx.lineWidth=1*dpr;
    for(let i=1;i<4;i++){const y=h*i/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    for(let i=1;i<10;i++){const x=w*i/10;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    const center=h/2,available=Math.max(2,history.length),barW=w/Math.max(120,available),start=Math.max(0,history.length-Math.ceil(w/Math.max(1,barW)));
    ctx.strokeStyle=compact?'rgba(248,113,113,.92)':'rgba(255,92,105,.96)';ctx.lineWidth=Math.max(1,dpr*1.15);ctx.beginPath();
    for(let i=start;i<history.length;i++){const x=(i-start)/(Math.max(1,history.length-start-1))*w,amp=Math.min(1,history[i]||0)*h*.43;ctx.moveTo(x,center-amp);ctx.lineTo(x,center+amp);}ctx.stroke();
    if(data?.length&&!compact){ctx.strokeStyle='rgba(255,235,238,.82)';ctx.lineWidth=1*dpr;ctx.beginPath();const step=Math.max(1,Math.floor(data.length/(w/dpr)));let px=0;for(let i=0;i<data.length;i+=step){const x=px++*dpr,y=center+(data[i]||0)*h*.38;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
  }
  function updateRecordingLaneOverlay(elapsed){
    const total=Math.max(timelineDuration(),.001),end=S.recordOffset+elapsed;
    if(end>S.viewDuration*.96&&performance.now()-S.recordLastTimelineGrow>500){S.recordLastTimelineGrow=performance.now();S.viewDuration=Math.ceil((end+30)/10)*10;renderTracks();}
    const el=$('[data-recording-clip]');if(!el)return;const t=Math.max(timelineDuration(),.001);el.style.left=`${clamp(S.recordOffset/t*100,0,100)}%`;el.style.width=`${clamp(elapsed/t*100,0,100)}%`;el.style.minWidth='10px';
    const label=el.querySelector('b');if(label)label.textContent=`REC ${fmt(elapsed)}`;drawLiveWave(el.querySelector('canvas'),S.recordWaveHistory,null,true);
  }
  function recordVisualFrame(now){
    if(!S.recording||!S.recordAnalyser||!S.recordData){S.recordVisualRaf=0;return;}
    S.recordAnalyser.getFloatTimeDomainData(S.recordData);let sum=0,peak=0;
    for(let i=0;i<S.recordData.length;i++){const v=Math.abs(S.recordData[i]||0);sum+=v*v;if(v>peak)peak=v;}
    const rms=Math.sqrt(sum/Math.max(1,S.recordData.length));S.recordLevel=Math.max(rms,S.recordLevel*.82);S.recordPeak=Math.max(peak,S.recordPeak*.92);
    S.recordWaveHistory.push(Math.min(1,Math.max(peak,rms*2.6)));if(S.recordWaveHistory.length>420)S.recordWaveHistory.splice(0,S.recordWaveHistory.length-420);
    const db=rms>0?20*Math.log10(rms):-Infinity,fill=$('#mtRecordLevelFill'),dbEl=$('#mtRecordDb'),hint=$('#mtRecordSignalHint');
    if(fill)fill.style.width=`${clamp((db+60)/60*100,0,100)}%`;if(dbEl)dbEl.textContent=Number.isFinite(db)?`${db.toFixed(1)} dB`:'-∞ dB';
    if(hint)hint.textContent=db>-12?'输入偏强，注意避免爆音':db>-42?'声音输入正常':'输入较弱或环境安静';
    drawLiveWave($('#mtRecordWave'),S.recordWaveHistory,S.recordData,false);const elapsed=recordElapsed();updateRecordingLaneOverlay(elapsed);
    if(now-S.recordLastUiAt>80){S.recordLastUiAt=now;renderRecording();setStatus(`● 正在录音 ${fmt(elapsed)} · ${laneById(S.recordLaneId)?.name||'当前轨道'} · ${Number.isFinite(db)?db.toFixed(1)+' dB':'无输入'}`);}
    S.recordVisualRaf=requestAnimationFrame(recordVisualFrame);
  }
  function startRecordVisualizer(){stopRecordVisualizer(false);S.recordVisualRaf=requestAnimationFrame(recordVisualFrame);}
  function recordingClipHtml(total,laneId){
    if(!S.recording||laneId!==S.recordLaneId)return '';
    const elapsed=recordElapsed(),left=clamp(S.recordOffset/Math.max(total,.001)*100,0,100),width=clamp(elapsed/Math.max(total,.001)*100,0,100-left);
    return `<div class="mtRecordingClip" data-recording-clip style="left:${left}%;width:${width}%"><canvas></canvas><span><i></i> LIVE RECORDING</span><b>REC ${fmt(elapsed)}</b></div>`;
  }
  async function startRecording(){
    if(S.recording||S.recordProcessing)return;
    if(S.clips.length>=MAX_CLIPS)return toast(`最多支持 ${MAX_CLIPS} 个音频块`);
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('当前系统或浏览器不支持录音');
    pausePlayback(false);protectA1BeforeRecording();stopA1();ensureBaseLanes(1);
    const target=recordTarget();if(!target.lane)return toast('没有可用轨道');
    try{
      setStatus('正在请求麦克风权限…');
      if(window.anningDesktop?.requestMicrophoneAccess){
        const permission=await window.anningDesktop.requestMicrophoneAccess();
        if(permission && !permission.ok){
          const hint=permission.status==='denied'
            ? '麦克风权限已关闭，请到“系统设置 → 隐私与安全性 → 麦克风”中开启本程序。'
            : '没有获得麦克风权限';
          throw new DOMException(hint,'NotAllowedError');
        }
      }
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2},video:false});
      S.recordStream=stream;
      const mime=preferredRecordMime(),opts=mime?{mimeType:mime,audioBitsPerSecond:192000}:{audioBitsPerSecond:192000};
      const recorder=new MediaRecorder(stream,opts);await setupRecordMonitor(stream);
      S.recorder=recorder;S.recordChunks=[];S.recordDiscard=false;S.recordLaneId=target.lane.id;S.recordOffset=target.offset;S.recordMime=recorder.mimeType||mime||'audio/webm';
      recorder.ondataavailable=e=>{if(e.data&&e.data.size)S.recordChunks.push(e.data);};
      recorder.onerror=e=>{toast('录音失败：'+(e.error?.message||'麦克风异常'));setStatus('录音失败');};
      recorder.onstop=finalizeRecording;
      recorder.start(250);S.recording=true;S.recordStartedAt=performance.now();clearRecordTimer();renderRecording();renderTracks();startRecordVisualizer();
      setStatus(`● 正在录音：${target.lane.name} · ${fmt(target.offset)} 起`);
    }catch(e){
      stopRecordVisualizer(true);stopRecordStream();S.recorder=null;S.recording=false;renderRecording();
      const msg=/denied|permission|notallowed/i.test(String(e?.name)+' '+String(e?.message))?'没有获得麦克风权限，请在系统设置中允许本程序使用麦克风':(e?.message||'无法启动录音');
      toast(msg);setStatus(msg);stabilizeA1AfterRecording();
    }
  }
  function stopRecording(discard=false){
    if(!S.recording||!S.recorder)return;
    S.recordDiscard=!!discard;S.recording=false;S.recordProcessing=true;clearRecordTimer();stopRecordVisualizer(true);renderRecording();renderTracks();
    try{if(S.recorder.state!=='inactive')S.recorder.stop();else finalizeRecording();}catch(_e){finalizeRecording();}
  }
  async function finalizeRecording(){
    clearRecordTimer();stopRecordVisualizer(true);stopRecordStream();
    const discard=S.recordDiscard,chunks=S.recordChunks.slice(),mime=S.recordMime||S.recorder?.mimeType||'audio/webm';
    S.recorder=null;S.recordChunks=[];S.recordDiscard=false;
    if(discard){S.recordProcessing=false;renderRecording();setStatus('已取消本次录音');toast('录音已取消');stabilizeA1AfterRecording();return;}
    try{
      const blob=new Blob(chunks,{type:mime});if(blob.size<500)throw new Error('录音内容过短或没有声音');
      setStatus('正在解析录音并生成音频块…');const buffer=await decodeBlob(blob);
      const stamp=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),clip=addClip({name:`现场录音 ${stamp}`,blob,mime:blob.type,buffer,laneId:S.recordLaneId,offset:S.recordOffset});
      if(!clip)throw new Error('无法创建录音音频块');
      recomputeAutoCrossfades(clip.laneId);dirty();renderAll();setStatus(`录音已加入：${clip.name}，可按普通歌曲继续编辑`);toast('录音已生成音频块 ✅');
    }catch(e){toast('录音生成失败：'+e.message);setStatus('录音生成失败：'+e.message);}
    finally{S.recordProcessing=false;S.recordWaveHistory=[];S.recordStartedAt=0;renderRecording();stabilizeA1AfterRecording();}
  }

  function makeLane(name){
    return {id:uid('lane'),name:name||`轨道 ${S.lanes.length+1}`,mute:false,solo:false};
  }
  function addLane(name,render=true){
    if(S.lanes.length>=MAX_LANES){ toast(`最多支持 ${MAX_LANES} 条轨道`); return null; }
    const lane=makeLane(name);S.lanes.push(lane);if(render){S.selectedLaneId=lane.id;S.selectedClipId='';dirty();renderAll();setStatus(`已新建并选择轨道「${lane.name}」`);}return lane;
  }
  function ensureBaseLanes(n=4){ while(S.lanes.length<Math.min(n,MAX_LANES)) S.lanes.push(makeLane()); }
  function laneById(id){ return S.lanes.find(x=>x.id===id)||null; }
  function clipById(id){ return S.clips.find(x=>x.id===id)||null; }
  function selectedClip(){ return clipById(S.selectedClipId); }
  function selectedLane(){
    const direct=laneById(S.selectedLaneId);if(direct)return direct;
    const c=selectedClip();return c?laneById(c.laneId):null;
  }
  function clipsInLane(id){ return S.clips.filter(c=>c.laneId===id).sort((a,b)=>a.offset-b.offset); }
  function blurTypingFocus(){
    const active=document.activeElement;
    if(active&&isTypingTarget(active)){try{active.blur();}catch(_e){}}
  }
  function updateSelectionClasses(){
    $$('.mtTrack').forEach(el=>el.classList.toggle('isSelectedLane',el.dataset.laneId===S.selectedLaneId));
    $$('.mtLane').forEach(el=>el.classList.toggle('isSelectedLane',el.dataset.laneId===S.selectedLaneId));
    $$('.mtClip').forEach(el=>el.classList.toggle('isSelected',el.dataset.clipId===S.selectedClipId));
  }
  function selectClipById(id,announce=true){
    const c=clipById(id);if(!c)return false;blurTypingFocus();S.selectedClipId=c.id;S.selectedLaneId=c.laneId;renderInspector();updateSelectionClasses();
    if(announce)setStatus(`已选择音乐块「${c.name}」｜按 Delete / Backspace 删除`);return true;
  }
  function selectLaneById(id,announce=true){
    const lane=laneById(id);if(!lane)return false;blurTypingFocus();S.selectedLaneId=lane.id;S.selectedClipId='';renderInspector();updateSelectionClasses();
    if(announce){const count=clipsInLane(lane.id).length;setStatus(`已选择轨道「${lane.name}」${count?`（${count} 个音乐块）`:''}｜按 Delete / Backspace 删除轨道`);}return true;
  }
  function removeClipById(id,source='按钮'){
    const c=clipById(id);if(!c)return false;pausePlayback(false);S.clips=S.clips.filter(x=>x.id!==c.id);
    if(S.selectedClipId===c.id)S.selectedClipId='';S.selectedLaneId=c.laneId;recomputeAutoCrossfades(c.laneId);dirty();renderAll();restartIfPlaying();
    setStatus(`已删除音乐块「${c.name}」｜${source}`);toast('音乐块已删除');return true;
  }
  function removeLaneById(id,confirmOccupied=true,source='按钮'){
    const lane=laneById(id);if(!lane)return false;const laneClips=clipsInLane(lane.id);
    if(laneClips.length&&confirmOccupied&&!window.confirm(`轨道「${lane.name}」中有 ${laneClips.length} 个音乐块。\n确定删除整条轨道及其中全部音乐文件吗？`))return false;
    pausePlayback(false);S.clips=S.clips.filter(c=>c.laneId!==lane.id);S.lanes=S.lanes.filter(l=>l.id!==lane.id);ensureBaseLanes(1);
    S.selectedClipId='';S.selectedLaneId=S.lanes[0]?.id||'';recomputeAutoCrossfades();dirty();renderAll();restartIfPlaying();
    setStatus(`已删除轨道「${lane.name}」${laneClips.length?`及其中 ${laneClips.length} 个音乐块`:''}｜${source}`);toast('轨道已删除');return true;
  }

  function firstEmptyLane(){ return S.lanes.find(l=>!S.clips.some(c=>c.laneId===l.id))||null; }
  function allocateImportLane(){
    const empty=firstEmptyLane(); if(empty) return empty;
    if(S.lanes.length<MAX_LANES) return addLane(null,false);
    const selected=selectedClip(); if(selected&&laneById(selected.laneId)) return laneById(selected.laneId);
    return S.lanes[0]||addLane(null,false);
  }
  function chooseImportLane(){
    const selected=selectedClip();
    if(selected && laneById(selected.laneId)) return laneById(selected.laneId);
    return allocateImportLane();
  }

  async function addFiles(files,opts={}){
    const arr=Array.from(files||[]).filter(f=>f && (String(f.type||'').startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name||'')));
    if(!arr.length) return toast('没有识别到音频文件');
    if(S.clips.length+arr.length>MAX_CLIPS) arr.splice(Math.max(0,MAX_CLIPS-S.clips.length));
    setStatus(`正在解析 ${arr.length} 个音频…`);
    let fixedLane=opts.laneId&&laneById(opts.laneId)?laneById(opts.laneId):null;
    let nextOffset=Number.isFinite(opts.offset)?Math.max(0,opts.offset):null;
    let added=0;
    for(const f of arr){
      try{
        const buffer=await decodeBlob(f);
        let lane=fixedLane;
        if(!lane){ lane=allocateImportLane(); }
        const clip=addClip({name:f.name.replace(/\.[^.]+$/,''),blob:f,mime:f.type,buffer,laneId:lane?.id,offset:nextOffset??0});
        if(clip){
          added++;
          if(nextOffset!==null){
            const cf=S.autoCrossfade?desiredCrossfadeSeconds(clip,null):0;
            nextOffset=clip.offset+effectiveDuration(clip)-cf;
          }
        }
      }catch(e){ toast(`${f.name} 无法解码`); }
    }
    ensureBaseLanes(Math.min(4,MAX_LANES)); recomputeAutoCrossfades(); dirty(); renderAll(); restartIfPlaying(); setStatus(`已加入 ${added} 个音频块`);
  }

  function addClip({name,blob,mime,buffer,laneId,offset=0}){
    if(S.clips.length>=MAX_CLIPS){ toast(`最多支持 ${MAX_CLIPS} 个音频块`); return null; }
    let lane=laneById(laneId); if(!lane) lane=chooseImportLane(); if(!lane) return null;
    const duration=buffer.duration||0;
    const clip={id:uid('clip'),laneId:lane.id,name:name||`音频 ${S.clips.length+1}`,blob,mime:mime||blob?.type||'audio/*',buffer,duration,offset:Math.max(0,offset||0),trimStart:0,trimEnd:duration,fadeIn:0,fadeOut:0,autoFadeIn:0,autoFadeOut:0,volume:1,pan:0};
    S.clips.push(clip); S.selectedClipId=clip.id; S.selectedLaneId=clip.laneId;
    S.viewDuration=Math.max(S.viewDuration,Math.ceil((clip.offset+duration+60)/10)*10);
    return clip;
  }

  function totalDuration(){ return S.clips.reduce((m,c)=>Math.max(m,Math.max(0,c.offset)+effectiveDuration(c)),0); }
  function effectiveDuration(c){ return Math.max(0,(c.trimEnd||0)-(c.trimStart||0)); }
  function timelineDuration(){ return Math.max(10,Number(S.viewDuration)||0,totalDuration()); }
  function ensureTimeline(extra=0){
    const need=Math.max(10,totalDuration(),Number(extra)||0);
    if(!Number.isFinite(S.viewDuration)||S.viewDuration<10)S.viewDuration=120;
    if(need>S.viewDuration*.94)S.viewDuration=Math.ceil((need+Math.max(30,need*.18))/10)*10;
    return S.viewDuration;
  }
  function snapSec(v,e){ const step=e?.shiftKey?.1:.01; return Math.round((Number(v)||0)/step)*step; }
  function laneAudible(lane){ const hasSolo=S.lanes.some(x=>x.solo); return !!lane && !lane.mute && (!hasSolo || lane.solo); }
  function audible(c){ return laneAudible(laneById(c.laneId)); }
  function effectiveFades(c){
    const d=effectiveDuration(c);let fi=Math.max(Number(c.fadeIn)||0,Number(c.autoFadeIn)||0),fo=Math.max(Number(c.fadeOut)||0,Number(c.autoFadeOut)||0);
    if(fi+fo>d&&d>0){const ratio=d/(fi+fo);fi*=ratio;fo*=ratio;}return{fi,fo};
  }
  function effectiveFadeIn(c){ return effectiveFades(c).fi; }
  function effectiveFadeOut(c){ return effectiveFades(c).fo; }
  function envAt(c,globalPos){
    const d=effectiveDuration(c),local=globalPos-c.offset,fi=Math.min(effectiveFadeIn(c),d),fo=Math.min(effectiveFadeOut(c),d);
    if(local<0||local>d)return 0;let g=1;if(fi>0&&local<fi)g=Math.min(g,local/fi);if(fo>0&&local>d-fo)g=Math.min(g,(d-local)/fo);return clamp(g,0,1);
  }
  function sanitizeClip(c){
    c.duration=Math.max(0,c.duration||c.buffer?.duration||0);c.trimStart=clamp(c.trimStart,0,c.duration);c.trimEnd=clamp(c.trimEnd,c.trimStart,c.duration);c.offset=Math.max(0,Number(c.offset)||0);c.volume=clamp(c.volume,0,1.5);c.pan=clamp(c.pan,-1,1);
    const d=effectiveDuration(c);c.fadeIn=clamp(c.fadeIn,0,d);c.fadeOut=clamp(c.fadeOut,0,d);c.autoFadeIn=clamp(c.autoFadeIn,0,d);c.autoFadeOut=clamp(c.autoFadeOut,0,d);
    if(c.fadeIn+c.fadeOut>d&&d>0){const ratio=d/(c.fadeIn+c.fadeOut);c.fadeIn*=ratio;c.fadeOut*=ratio;}
  }
  function desiredCrossfadeSeconds(a,b){
    const base=clamp(S.crossfadeDuration,.1,10);
    const da=a?effectiveDuration(a):Infinity,db=b?effectiveDuration(b):Infinity;
    return Math.max(0,Math.min(base,Number.isFinite(da)?da*.45:base,Number.isFinite(db)?db*.45:base));
  }
  function recomputeAutoCrossfades(laneId=null){
    const affected=laneId?[laneId]:S.lanes.map(l=>l.id);
    S.clips.forEach(c=>{if(!laneId||c.laneId===laneId){c.autoFadeIn=0;c.autoFadeOut=0;}});
    if(!S.autoCrossfade)return;
    affected.forEach(id=>{
      const list=clipsInLane(id);
      for(let i=0;i<list.length-1;i++){
        const a=list[i],b=list[i+1],overlap=(a.offset+effectiveDuration(a))-b.offset;
        if(overlap>.015){
          const x=Math.min(overlap,desiredCrossfadeSeconds(a,b));
          a.autoFadeOut=Math.max(a.autoFadeOut||0,x);b.autoFadeIn=Math.max(b.autoFadeIn||0,x);
        }
      }
    });
  }
  function crossfadePairs(laneId){
    if(!S.autoCrossfade)return[];const list=clipsInLane(laneId),out=[];
    for(let i=0;i<list.length-1;i++){
      const a=list[i],b=list[i+1],start=b.offset,end=Math.min(a.offset+effectiveDuration(a),b.offset+effectiveDuration(b));
      if(end-start>.015)out.push({a,b,start,end,duration:end-start});
    }
    return out;
  }

  function stopSources(){ S.sources.forEach(s=>{try{s.stop();}catch(_e){}try{s.disconnect();}catch(_e){}});S.sources=[]; }
  function pausePlayback(render=true){
    if(S.playing){const ctx=S.audioCtx;if(ctx)S.cursor=clamp(S.startedCursor+(ctx.currentTime-S.startedAt),0,totalDuration());}
    S.playing=false;cancelAnimationFrame(S.raf);stopSources();if(render)renderTransport();
  }
  function stopPlayback(){pausePlayback(false);S.cursor=0;renderTransport();drawAll();}
  function seekPlayback(target,resume=false,announce=true){
    const total=totalDuration(),was=!!resume;
    pausePlayback(false);S.cursor=clamp(target,0,total);renderTransport();drawAll();
    if(announce)setStatus(`播放头已跳转到 ${fmt(S.cursor)}`);
    if(was&&S.cursor<total-.015)playPause();
    return S.cursor;
  }
  async function playPause(){
    if(S.playing)return pausePlayback();
    const total=totalDuration();if(!total||!S.clips.length)return toast('请先导入音频');
    if(S.cursor>=total-.02)S.cursor=0;
    stopA1();const ctx=await audioContext();stopSources();
    const master=ctx.createGain();master.gain.value=S.master;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-2;comp.knee.value=2;comp.ratio.value=8;comp.attack.value=.003;comp.release.value=.15;master.connect(comp).connect(ctx.destination);
    const base=ctx.currentTime+.025,cursor=S.cursor;
    for(const c of S.clips){
      sanitizeClip(c);if(!audible(c)||!c.buffer)continue;
      const d=effectiveDuration(c),gStart=c.offset,gEnd=gStart+d;if(cursor>=gEnd)continue;
      const actualStart=Math.max(cursor,gStart),when=base+Math.max(0,gStart-cursor),sourceOffset=c.trimStart+Math.max(0,cursor-gStart),remaining=gEnd-actualStart;if(remaining<=0)continue;
      const src=ctx.createBufferSource();src.buffer=c.buffer;const gain=ctx.createGain(),pan=ctx.createStereoPanner?ctx.createStereoPanner():null;if(pan)pan.pan.value=c.pan;
      src.connect(gain);if(pan){gain.connect(pan);pan.connect(master);}else gain.connect(master);
      const startGain=c.volume*envAt(c,actualStart);gain.gain.setValueAtTime(startGain,when);
      const fiEnd=gStart+Math.min(effectiveFadeIn(c),d),foStart=gEnd-Math.min(effectiveFadeOut(c),d);
      if(fiEnd>actualStart)gain.gain.linearRampToValueAtTime(c.volume,when+(fiEnd-actualStart));
      if(foStart>actualStart){gain.gain.setValueAtTime(c.volume,when+(foStart-actualStart));gain.gain.linearRampToValueAtTime(0,when+(gEnd-actualStart));}
      else if(effectiveFadeOut(c)>0)gain.gain.linearRampToValueAtTime(0,when+remaining);
      try{src.start(when,sourceOffset,remaining);S.sources.push(src);}catch(_e){}
    }
    S.startedAt=base;S.startedCursor=cursor;S.playing=true;renderTransport();tick();
  }
  function tick(){
    if(!S.playing)return;const total=totalDuration();S.cursor=clamp(S.startedCursor+(S.audioCtx.currentTime-S.startedAt),0,total);renderTransport();updateCursors();
    if(S.cursor>=total-.015){S.playing=false;stopSources();S.cursor=total;renderTransport();drawAll();return;}S.raf=requestAnimationFrame(tick);
  }
  let restartTimer=0;
  function restartIfPlaying(){if(!S.playing)return;clearTimeout(restartTimer);restartTimer=setTimeout(()=>{if(!S.playing)return;const c=S.cursor;pausePlayback(false);S.cursor=c;playPause();},90);}

  function setStatus(s){const el=$('#mtStatus');if(el)el.textContent=s;}
  function dirty(){S.dirty=true;const el=$('#mtDirtyLabel');if(el){el.textContent='● 未保存';el.className='mtDirty';}}
  function clean(){S.dirty=false;const el=$('#mtDirtyLabel');if(el){el.textContent='已保存';el.className='';}}

  function renderAll(){ensureTimeline();recomputeAutoCrossfades();renderInspector();renderTracks();renderTransport();drawAll();requestAnimationFrame(drawAll);}
  function renderTransport(){
    const total=totalDuration(),seek=$('#mtSeek');if(seek){seek.max=String(Math.max(total,.01));seek.value=String(clamp(S.cursor,0,total));}
    const time=$('#mtTime');if(time)time.textContent=`${fmt(S.cursor)} / ${fmt(total)}`;const info=$('#mtDurationInfo');if(info)info.textContent=`总时长 ${fmt(total)}`;
    const play=$('#mtPlay');if(play)play.textContent=S.playing?'❚❚ 暂停':'▶ 播放';const ml=$('#mtMasterLabel');if(ml)ml.textContent=`${Math.round(S.master*100)}%`;
  }

  function renderInspector(){
    const box=$('#mtInspector');if(!box)return;const c=selectedClip();
    if(!c){const lane=selectedLane();box.innerHTML=lane?`<div class="mtInspectorEmpty mtLaneInspector"><b>当前选中轨道：${esc(lane.name)}</b><span>${clipsInLane(lane.id).length} 个音乐块 · 按 Delete / Backspace 可删除整条轨道</span></div>`:'<div class="mtInspectorEmpty">单击轨道或音乐块进行选择；选择音乐块后可精确调整裁剪、独立音量、声像和淡入淡出。</div>';return;}
    sanitizeClip(c);const d=effectiveDuration(c),autoIn=Number(c.autoFadeIn)||0,autoOut=Number(c.autoFadeOut)||0;
    box.innerHTML=`<div class="mtInspectorTop"><b>当前音频块：${esc(c.name)}</b><span>${esc(laneById(c.laneId)?.name||'未分配轨道')} · ${fmt(c.offset)} → ${fmt(c.offset+d)}</span></div>
      <div class="mtInspectorGrid">
        <label>名称<input data-clip-k="name" value="${esc(c.name)}"></label>
        <label>开始时间（秒）<input type="number" step="0.01" min="0" data-clip-k="offset" value="${c.offset.toFixed(2)}"></label>
        <label>裁入（原音频秒）<input type="number" step="0.01" min="0" max="${c.duration}" data-clip-k="trimStart" value="${c.trimStart.toFixed(2)}"></label>
        <label>裁出（原音频秒）<input type="number" step="0.01" min="0" max="${c.duration}" data-clip-k="trimEnd" value="${c.trimEnd.toFixed(2)}"></label>
        <label>手动淡入（秒）<input type="number" step="0.1" min="0" max="${d}" data-clip-k="fadeIn" value="${c.fadeIn.toFixed(2)}"></label>
        <label>手动淡出（秒）<input type="number" step="0.1" min="0" max="${d}" data-clip-k="fadeOut" value="${c.fadeOut.toFixed(2)}"></label>
        <label>音量 ${Math.round(c.volume*100)}%<input type="range" step="0.01" min="0" max="1.5" data-clip-k="volume" value="${c.volume}"></label>
        <label>声像 ${c.pan<-.05?'左':c.pan>.05?'右':'中'} ${Math.round(Math.abs(c.pan)*100)}%<input type="range" step="0.01" min="-1" max="1" data-clip-k="pan" value="${c.pan}"></label>
        <div class="mtInspectorAuto"><span>自动淡入 ${autoIn?autoIn.toFixed(2)+' 秒':'—'}</span><span>自动淡出 ${autoOut?autoOut.toFixed(2)+' 秒':'—'}</span></div>
        <div class="mtInspectorActions"><button class="mtBtn" data-clip-act="volumeReset">音量恢复 100%</button><button class="mtBtn" data-clip-act="autoTrim">自动裁静音</button><button class="mtBtn danger" data-clip-act="remove">删除音频块</button></div>
      </div>`;
  }

  function renderTracks(){
    const box=$('#mtTracks');if(!box)return;ensureBaseLanes(1);const total=Math.max(timelineDuration(),.001);
    box.innerHTML=S.lanes.map((lane,i)=>{
      const list=clipsInLane(lane.id),pairs=crossfadePairs(lane.id);
      return `<div class="mtTrack ${lane.mute?'isMuted':''} ${lane.solo?'isSolo':''} ${lane.id===S.selectedLaneId?'isSelectedLane':''}" data-lane-id="${lane.id}" style="--laneHue:${(198+i*43)%360}">
        <div class="mtTrackControl">
          <div class="mtTrackHead"><span class="mtTrackIndex">${String(i+1).padStart(2,'0')}</span><span class="mtTrackIcon">♫</span><input class="mtTrackName" data-lane-k="name" value="${esc(lane.name)}"><button class="mtTiny ${lane.mute?'on':''}" data-lane-act="mute" title="静音">M</button><button class="mtTiny ${lane.solo?'on':''}" data-lane-act="solo" title="独奏">S</button></div>
          <div class="mtTrackMeta"><span><i class="mtTrackStateDot"></i>${list.length} 个音频块</span><span>${list.length?fmt(Math.max(...list.map(c=>c.offset+effectiveDuration(c)))):'READY'}</span></div>
          <div class="mtTrackActions"><button class="mtTiny" data-lane-act="up">↑ 上移</button><button class="mtTiny" data-lane-act="down">↓ 下移</button><button class="mtTiny danger" data-lane-act="remove" title="删除轨道；有音乐块时会二次确认">删除轨道</button></div>
        </div>
        <div class="mtLane ${!list.length&&!S.recording?'isEmpty':''} ${lane.id===S.selectedLaneId?'isSelectedLane':''}" data-lane-id="${lane.id}">
          <div class="mtLaneGrid"></div>
          ${list.map(c=>clipHtml(c)).join('')}
          ${recordingClipHtml(total,lane.id)}
          ${pairs.map(p=>`<div class="mtCrossfadeBadge" style="left:${clamp(p.start/total*100,0,100)}%;width:${clamp(p.duration/total*100,0,100)}%" title="自动交叉淡化 ${p.duration.toFixed(2)} 秒"><span>交叉 ${p.duration.toFixed(2)}s</span></div>`).join('')}
          <i class="mtSnapGuide"></i><i class="mtCursor"></i>
        </div>
      </div>`;
    }).join('');
    S.clips.forEach(updateClipGeometry);updateCursors();updateSnapGuides();
  }

  function clipHtml(c){
    sanitizeClip(c);const d=effectiveDuration(c),fi=effectiveFadeIn(c),fo=effectiveFadeOut(c);
    return `<div class="mtClip ${c.id===S.selectedClipId?'isSelected':''} ${(c.autoFadeIn||c.autoFadeOut)?'hasAutoFade':''}" data-clip-id="${c.id}">
      <canvas class="mtClipWave" data-clip-wave="${c.id}"></canvas>
      <div class="mtFadeShade in" style="width:${d?clamp(fi/d*100,0,100):0}%"></div><div class="mtFadeShade out" style="width:${d?clamp(fo/d*100,0,100):0}%"></div>
      <div class="mtClipBody" data-drag="move" title="左右拖动定位，上下拖动可放入任意轨道"><span>${esc(c.name)}</span><b>${fmt(c.offset)} → ${fmt(c.offset+d)}</b></div>
      <label class="mtClipQuickVolume" title="当前音乐块独立音量">
        <span>🔊</span><input type="range" min="0" max="1.5" step="0.01" value="${c.volume}" data-clip-volume="${c.id}"><b>${Math.round(c.volume*100)}%</b>
      </label>
      <i class="mtTrimHandle left" data-drag="trim-start" title="拖动裁剪开头"></i><i class="mtTrimHandle right" data-drag="trim-end" title="拖动裁剪结尾"></i>
      <i class="mtFadeHandle in" data-drag="fade-in" title="拖动控制手动淡入"><span>入</span></i><i class="mtFadeHandle out" data-drag="fade-out" title="拖动控制手动淡出"><span>出</span></i>
      ${(c.autoFadeIn||c.autoFadeOut)?'<em class="mtAutoMark">AUTO</em>':''}
    </div>`;
  }

  function canvasSize(c){const r=c.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(10,Math.round(r.width*dpr)),h=Math.max(10,Math.round(r.height*dpr));if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;return{w,h,dpr};}
  function drawRuler(){
    const c=$('#mtRuler');if(!c)return;const{w,h,dpr}=canvasSize(c),ctx=c.getContext('2d'),total=Math.max(timelineDuration(),1);ctx.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement),accent=css.getPropertyValue('--p2').trim()||'#6ee7ff';
    const line='rgba(148,163,184,.22)',text='#e7eef7';
    ctx.strokeStyle=line;ctx.fillStyle=text;ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=2*dpr;ctx.font=`700 ${11*dpr}px system-ui`;ctx.textAlign='left';ctx.textBaseline='top';const raw=total/8,pow=Math.pow(10,Math.floor(Math.log10(Math.max(raw,.1)))),steps=[1,2,5,10],step=(steps.find(x=>raw<=x*pow)||10)*pow;
    for(let t=0;t<=total+.001;t+=step){const x=t/total*w;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.fillText(fmt(t),Math.min(x+4*dpr,w-70*dpr),5*dpr);}ctx.shadowBlur=0;const x=clamp(S.cursor/total,0,1)*w;ctx.strokeStyle=accent;ctx.lineWidth=2*dpr;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
  }
  function drawClip(c){
    const canvas=$(`canvas[data-clip-wave="${CSS.escape(c.id)}"]`);if(!canvas||!c.buffer)return;const{w,h,dpr}=canvasSize(canvas),ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement),wave=css.getPropertyValue('--p2').trim()||'#6ee7ff',muted=css.getPropertyValue('--muted').trim()||'#999',warn=css.getPropertyValue('--warn').trim()||'#fc6',lane=laneById(c.laneId);
    const data=c.buffer.getChannelData(0),a=Math.floor(c.trimStart/c.duration*data.length),b=Math.max(a+1,Math.floor(c.trimEnd/c.duration*data.length));ctx.strokeStyle=lane?.mute?muted:wave;ctx.lineWidth=Math.max(1,dpr);ctx.beginPath();const cols=Math.max(1,Math.floor(w/dpr));
    for(let px=0;px<cols;px++){const s0=a+Math.floor(px/cols*(b-a)),s1=a+Math.floor((px+1)/cols*(b-a));let peak=0;for(let j=s0;j<s1;j+=Math.max(1,Math.floor((s1-s0)/16)))peak=Math.max(peak,Math.abs(data[j]||0));const x=px*dpr,y=peak*(h*.40);ctx.moveTo(x,h/2-y);ctx.lineTo(x,h/2+y);}ctx.stroke();
    const d=effectiveDuration(c),fi=effectiveFadeIn(c),fo=effectiveFadeOut(c);ctx.strokeStyle=warn;ctx.lineWidth=1.5*dpr;if(fi>0){const x=fi/d*w;ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(x,0);ctx.stroke();}if(fo>0){const x=w-fo/d*w;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(w,h);ctx.stroke();}
  }
  function drawAll(){drawRuler();S.clips.forEach(drawClip);updateCursors();}
  function updateCursors(){const total=Math.max(timelineDuration(),.001),pct=`${clamp(S.cursor/total,0,1)*100}%`;$$('#multiTrackPanel .mtCursor').forEach(x=>x.style.left=pct);drawRuler();}

  function updateClipGeometry(c){
    if(!c)return;sanitizeClip(c);const el=$(`.mtClip[data-clip-id="${CSS.escape(c.id)}"]`);if(!el)return;const total=Math.max(timelineDuration(),.001),d=effectiveDuration(c),left=clamp(c.offset/total*100,0,100),width=clamp(d/total*100,0,100-left);
    el.style.left=`${left}%`;el.style.width=`${width}%`;el.style.minWidth=d>0?'22px':'0';
    const fi=el.querySelector('.mtFadeHandle.in'),fo=el.querySelector('.mtFadeHandle.out'),efi=effectiveFadeIn(c),efo=effectiveFadeOut(c);if(fi)fi.style.left=`${d?clamp(efi/d*100,0,100):0}%`;if(fo)fo.style.left=`${d?clamp((1-efo/d)*100,0,100):100}%`;
    const body=el.querySelector('.mtClipBody');if(body){const a=body.querySelector('span'),b=body.querySelector('b');if(a)a.textContent=c.name;if(b)b.textContent=`${fmt(c.offset)} → ${fmt(c.offset+d)}`;}
    const shadeIn=el.querySelector('.mtFadeShade.in'),shadeOut=el.querySelector('.mtFadeShade.out');if(shadeIn)shadeIn.style.width=`${d?clamp(efi/d*100,0,100):0}%`;if(shadeOut)shadeOut.style.width=`${d?clamp(efo/d*100,0,100):0}%`;
    const quick=el.querySelector('[data-clip-volume]'),quickLabel=el.querySelector('.mtClipQuickVolume b');if(quick)quick.value=String(c.volume);if(quickLabel)quickLabel.textContent=`${Math.round(c.volume*100)}%`;
  }
  function redrawClip(c){updateClipGeometry(c);drawClip(c);renderTransport();updateCursors();}

  function nearestLaneRect(y,rects){
    let best=null,dist=Infinity;for(const item of rects){const r=item.rect,d=y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;if(d<dist){dist=d;best=item;}}return best;
  }
  function snapThreshold(rect,view){return Math.max(.04,12/Math.max(1,rect.width)*view);}
  function snapMoveOffset(c,raw,laneId,rect,e){
    const d=effectiveDuration(c),view=S.gesture?.view||timelineDuration(),maxOffset=Math.max(0,view-d),value=clamp(raw,0,maxOffset);
    if(!S.snap||e.altKey)return{offset:snapSec(value,e),guide:null,kind:''};
    const threshold=snapThreshold(rect,view),others=S.clips.filter(x=>x.id!==c.id),same=others.filter(x=>x.laneId===laneId),candidates=[];
    const add=(score,offset,guide,kind)=>{if(score<=threshold)candidates.push({score,offset:clamp(offset,0,maxOffset),guide,kind});};
    add(Math.abs(value),0,0,'起点');add(Math.abs(value-S.cursor),S.cursor,S.cursor,'播放头');add(Math.abs(value+d-S.cursor),S.cursor-d,S.cursor,'播放头');
    for(const o of others){const os=o.offset,oe=o.offset+effectiveDuration(o);add(Math.abs(value-os),os,os,'对齐开头');add(Math.abs(value+d-oe),oe-d,oe,'对齐结尾');}
    for(const o of same){
      const os=o.offset,oe=o.offset+effectiveDuration(o),cf=desiredCrossfadeSeconds(c,o);
      if(S.autoCrossfade&&cf>.01){add(Math.abs(value-oe),oe-cf,oe,'自动交叉');add(Math.abs(value+d-os),os-d+cf,os,'自动交叉');}
      else{add(Math.abs(value-oe),oe,oe,'连接');add(Math.abs(value+d-os),os-d,os,'连接');}
    }
    candidates.sort((a,b)=>a.score-b.score);const best=candidates[0];return best?{offset:snapSec(best.offset,e),guide:best.guide,kind:best.kind}:{offset:snapSec(value,e),guide:null,kind:''};
  }
  function setDropLane(id){S.dropLaneId=id||'';$$('.mtLane').forEach(el=>el.classList.toggle('isDropTarget',el.dataset.laneId===S.dropLaneId));}
  function updateSnapGuides(){
    const total=Math.max(timelineDuration(),.001);$$('.mtSnapGuide').forEach(el=>{const lane=el.closest('.mtLane');if(S.snapGuide&&lane?.dataset.laneId===S.snapGuide.laneId){el.style.left=`${clamp(S.snapGuide.time/total*100,0,100)}%`;el.classList.add('on');}else el.classList.remove('on');});
  }
  function createDragGhost(c,clipRect){
    removeDragGhost();const el=document.createElement('div');el.className='mtDragGhost';el.innerHTML=`<span>${esc(c.name)}</span><b>${fmt(effectiveDuration(c))}</b>`;Object.assign(el.style,{width:`${clipRect.width}px`,height:`${clipRect.height}px`,left:`${clipRect.left}px`,top:`${clipRect.top}px`});document.body.appendChild(el);S.dragGhost=el;
  }
  function removeDragGhost(){S.dragGhost?.remove();S.dragGhost=null;}

  function beginClipGesture(e){
    const handle=e.target.closest('[data-drag]');if(!handle)return;const clipEl=handle.closest('.mtClip'),laneEl=handle.closest('.mtLane');if(!clipEl||!laneEl)return;const c=clipById(clipEl.dataset.clipId);if(!c)return;
    e.preventDefault();e.stopPropagation();pausePlayback(false);selectClipById(c.id,false);
    const mode=handle.dataset.drag,rect=laneEl.getBoundingClientRect(),clipRect=clipEl.getBoundingClientRect(),view=timelineDuration(),laneRects=$$('.mtLane').map(el=>({id:el.dataset.laneId,el,rect:el.getBoundingClientRect()}));
    S.gesture={pointerId:e.pointerId,handle,c,mode,startX:e.clientX,startY:e.clientY,laneRect:rect,clipRect,view,laneRects,originLaneId:c.laneId,targetLaneId:c.laneId,grabSec:(e.clientX-clipRect.left)/Math.max(1,rect.width)*view,orig:{offset:c.offset,trimStart:c.trimStart,trimEnd:c.trimEnd,fadeIn:c.fadeIn,fadeOut:c.fadeOut},moved:false,snapKind:''};
    handle.setPointerCapture?.(e.pointerId);document.body.classList.add('mtDragging');clipEl.classList.add('isDragging');if(mode==='move'){clipEl.classList.add('isDragOrigin');createDragGhost(c,clipRect);setDropLane(c.laneId);}
  }
  function moveClipGesture(e){
    const g=S.gesture;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();const c=g.c,dx=e.clientX-g.startX,sec=dx/g.laneRect.width*g.view,minLen=.05;g.moved=g.moved||Math.abs(dx)>2||Math.abs(e.clientY-g.startY)>2;
    if(g.mode==='move'){
      const target=nearestLaneRect(e.clientY,g.laneRects)||g.laneRects.find(x=>x.id===g.originLaneId);if(!target)return;g.targetLaneId=target.id;const raw=(e.clientX-target.rect.left)/Math.max(1,target.rect.width)*g.view-g.grabSec,result=snapMoveOffset(c,raw,target.id,target.rect,e);c.offset=result.offset;g.snapKind=result.kind;S.snapGuide=result.guide===null?null:{laneId:target.id,time:result.guide};setDropLane(target.id);updateSnapGuides();
      if(S.dragGhost){const left=target.rect.left+c.offset/g.view*target.rect.width,width=Math.max(22,effectiveDuration(c)/g.view*target.rect.width);Object.assign(S.dragGhost.style,{left:`${left}px`,top:`${target.rect.top+7}px`,width:`${width}px`,height:`${Math.max(30,target.rect.height-14)}px`});}
    }else if(g.mode==='trim-start'){
      let ns=clamp(snapSec(g.orig.trimStart+sec,e),0,g.orig.trimEnd-minLen),no=g.orig.offset+(ns-g.orig.trimStart);if(no<0){ns-=no;no=0;}c.trimStart=clamp(ns,0,c.trimEnd-minLen);c.offset=no;sanitizeClip(c);redrawClip(c);
    }else if(g.mode==='trim-end'){
      c.trimEnd=clamp(snapSec(g.orig.trimEnd+sec,e),g.orig.trimStart+minLen,c.duration);sanitizeClip(c);redrawClip(c);
    }else if(g.mode==='fade-in'){
      const local=(e.clientX-g.clipRect.left)/g.clipRect.width*effectiveDuration(c);c.fadeIn=clamp(snapSec(local,e),0,Math.max(0,effectiveDuration(c)-c.fadeOut));sanitizeClip(c);redrawClip(c);
    }else if(g.mode==='fade-out'){
      const local=(g.clipRect.right-e.clientX)/g.clipRect.width*effectiveDuration(c);c.fadeOut=clamp(snapSec(local,e),0,Math.max(0,effectiveDuration(c)-c.fadeIn));sanitizeClip(c);redrawClip(c);
    }
  }
  function endClipGesture(e){
    const g=S.gesture;if(!g||e.pointerId!==g.pointerId)return;try{g.handle.releasePointerCapture?.(e.pointerId);}catch(_e){}
    g.handle.closest('.mtClip')?.classList.remove('isDragging','isDragOrigin');document.body.classList.remove('mtDragging');removeDragGhost();setDropLane('');S.snapGuide=null;S.gesture=null;
    if(g.mode==='move')g.c.laneId=g.targetLaneId||g.originLaneId;S.selectedLaneId=g.c.laneId;S.selectedClipId=g.c.id;
    sanitizeClip(g.c);recomputeAutoCrossfades();
    if(g.moved){dirty();S.suppressClick=true;setTimeout(()=>S.suppressClick=false,80);renderAll();restartIfPlaying();const suffix=g.snapKind?`，${g.snapKind}`:'';setStatus(`音频块已更新${suffix}${S.autoCrossfade?'，连接处已自动检查交叉淡化':''}`);}
    else renderAll();
  }

  function autoTrimClip(c){
    if(!c?.buffer)return false;const sr=c.buffer.sampleRate||44100,len=c.buffer.length,channels=Math.min(2,c.buffer.numberOfChannels),step=Math.max(64,Math.floor(sr*.006)),win=Math.max(step,Math.floor(sr*.018));let peak=0;
    for(let ch=0;ch<channels;ch++){const d=c.buffer.getChannelData(ch);for(let i=0;i<len;i+=step)peak=Math.max(peak,Math.abs(d[i]||0));}
    if(peak<.0005){toast('这个音频块几乎没有可识别声音');return false;}const threshold=Math.max(.0025,peak*.018);let first=-1,last=-1;
    const activeAt=(start)=>{let sum=0,n=0;for(let ch=0;ch<channels;ch++){const d=c.buffer.getChannelData(ch);for(let i=start;i<Math.min(len,start+win);i+=step){const v=d[i]||0;sum+=v*v;n++;}}return n&&Math.sqrt(sum/n)>=threshold;};
    for(let i=0;i<len;i+=win){if(activeAt(i)){first=i;break;}}for(let i=Math.max(0,len-win);i>=0;i-=win){if(activeAt(i)){last=Math.min(len,i+win);break;}}
    if(first<0||last<=first){toast('没有检测到稳定的有效声音');return false;}const pad=Math.floor(sr*.08),oldStart=c.trimStart;c.trimStart=clamp((first-pad)/sr,0,c.duration);c.trimEnd=clamp((last+pad)/sr,c.trimStart+.05,c.duration);c.offset=Math.max(0,c.offset+(c.trimStart-oldStart));sanitizeClip(c);dirty();renderAll();restartIfPlaying();setStatus(`已自动裁掉「${c.name}」首尾静音`);toast('首尾静音已自动裁剪 ✅');return true;
  }

  function isTypingTarget(el){
    if(!el)return false;const tag=String(el.tagName||'').toLowerCase();if(tag==='textarea'||tag==='select'||el.isContentEditable)return true;
    if(tag==='input'){const type=String(el.type||'text').toLowerCase();return !['range','checkbox','radio','button','file','submit','reset'].includes(type);}return false;
  }
  function handleMultiTrackKeydown(e){
    if(!S.active||document.body.dataset.multitrackActive!=='1')return;if(isTypingTarget(e.target)||isTypingTarget(document.activeElement))return;
    const isDelete=e.key==='Delete'||e.key==='Backspace';
    if(isDelete){
      e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(S.recording||S.recordProcessing)return toast('请先结束当前录音，再执行删除');
      const c=selectedClip();if(c)return removeClipById(c.id,'删除热键');const lane=selectedLane();if(lane)return removeLaneById(lane.id,true,'删除热键');return toast('请先单击选择轨道或音乐块');
    }
    const isSpace=e.code==='Space'||e.key===' '||e.key==='Spacebar'||e.key==='Space';if(!isSpace)return;if(S.recording||S.recordProcessing){e.preventDefault();e.stopImmediatePropagation();return;}e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;playPause();
  }

  async function importMixIntoA1(blob,name){
    const fr=$('#p1ConsoleFrame'),api=await a1Api();if(typeof api.importBlobAsCue!=='function')throw new Error('当前 A1 版本不支持写入音频');let payload=blob;
    try{const w=fr?.contentWindow;if(w?.Blob&&!(blob instanceof w.Blob))payload=new w.Blob([await blob.arrayBuffer()],{type:blob.type||'audio/mpeg'});}catch(_e){payload=blob;}
    const cueId=await api.importBlobAsCue(payload,{name:name.replace(/\.mp3$/i,''),fileName:name,catName:'多轨融合输出'});if(!cueId)throw new Error('A1 没有返回新音频编号');
    if(typeof api.getCueBlob==='function'){const savedBlob=await api.getCueBlob(cueId);if(!savedBlob||Number(savedBlob.size)!==Number(blob.size))throw new Error('A1 音频数据校验失败');}
    const queueId=typeof api.enqueueCue==='function'?await api.enqueueCue(cueId):null,cues=typeof api.listAllCues==='function'?await api.listAllCues():[];if(Array.isArray(cues)&&!cues.some(c=>String(c?.id)===String(cueId)))throw new Error('写入后未在 A1 曲库中找到成品');
    if(typeof api.getActiveQueueCueIds==='function'){const queue=await api.getActiveQueueCueIds(),expected=queueId||cueId;if(Array.isArray(queue)&&!queue.some(id=>String(id)===String(expected)))throw new Error('成品已进入曲库，但未进入 A1 当前队列');}return{cueId,queueId};
  }

  function closeForHostMode(mode='p1'){
    if(S.recording||S.recordProcessing){toast('请先停止录音，录音生成完成后再切换播放器');return false;}
    return setActive(false,{restoreA1:mode==='p1',modeLabel:mode==='p1'?'A1 播放器':mode});
  }
  function installHostModeGuard(){
    const hostIds=['btnMusicP1','btnMusicAiPanel','btnMusicExtTools','btnMusicNetSearch','btnWeddingMusicPanel','btnLicensedMusicPanel'];
    document.addEventListener('pointerdown',e=>{
      const b=e.target?.closest?.('#'+hostIds.join(',#'));if(!b||!S.active)return;
      if(S.recording||S.recordProcessing){e.preventDefault();e.stopPropagation();try{e.stopImmediatePropagation();}catch(_e){}toast('请先停止录音，录音生成完成后再返回 A1');return;}
      const isP1=b.id==='btnMusicP1';closeForHostMode(isP1?'p1':(b.textContent||'其他音乐工具').trim());
    },true);
    try{
      const observer=new MutationObserver(()=>{if(!S.active||S.recording||S.recordProcessing)return;const p1On=$('#btnMusicP1')?.classList.contains('on'),otherOn=hostIds.slice(1).some(id=>$('#'+id)?.classList.contains('on'));if(p1On)closeForHostMode('p1');else if(otherOn)closeForHostMode('其他音乐工具');});
      const body=document.body;if(body)observer.observe(body,{attributes:true,attributeFilter:['data-music-mode','data-music-mode-ext','data-music-page']});
      hostIds.forEach(id=>{const el=$('#'+id);if(el)observer.observe(el,{attributes:true,attributeFilter:['class','aria-selected']});});
    }catch(_e){}
  }
  function bind(){
    $('#btnMusicMultiTrack')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setActive(true);});$('#mtClose')?.addEventListener('click',()=>setActive(false,{restoreA1:true}));
    ['btnMusicP1','btnMusicAiPanel','btnMusicExtTools','btnMusicNetSearch','btnWeddingMusicPanel','btnLicensedMusicPanel'].forEach(id=>$('#'+id)?.addEventListener('click',()=>{if(S.active)setActive(false,{restoreA1:id==='btnMusicP1'});},true));
    installHostModeGuard();
    $('#mtAddFiles')?.addEventListener('click',()=>$('#mtFileInput')?.click());$('#mtFileInput')?.addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});$('#mtRecord')?.addEventListener('click',()=>S.recording?stopRecording(false):startRecording());$('#mtRecordCancel')?.addEventListener('click',()=>stopRecording(true));$('#mtAddLane')?.addEventListener('click',()=>addLane());
    $('#mtPlay')?.addEventListener('click',playPause);$('#mtStop')?.addEventListener('click',stopPlayback);$('#mtSeek')?.addEventListener('input',e=>{seekPlayback(Number(e.target.value)||0,S.playing,false);});
    $('#mtMaster')?.addEventListener('input',e=>{S.master=clamp(e.target.value,0,1.2);dirty();renderTransport();restartIfPlaying();});$('#mtNormalize')?.addEventListener('change',e=>{S.normalize=!!e.target.checked;dirty();});
    $('#mtSnap')?.addEventListener('change',e=>{S.snap=!!e.target.checked;dirty();});$('#mtAutoCrossfade')?.addEventListener('change',e=>{S.autoCrossfade=!!e.target.checked;dirty();renderAll();restartIfPlaying();});
    $('#mtCrossfadeDuration')?.addEventListener('change',e=>{S.crossfadeDuration=clamp(e.target.value,.1,10);e.target.value=S.crossfadeDuration.toFixed(1);dirty();renderAll();restartIfPlaying();});
    $('#mtProjectName')?.addEventListener('input',e=>{S.projectName=e.target.value;dirty();});$('#mtSaveProject')?.addEventListener('click',saveProject);$('#mtNewProject')?.addEventListener('click',newProject);$('#mtDeleteProject')?.addEventListener('click',deleteProject);$('#mtProjectSelect')?.addEventListener('change',e=>{if(e.target.value)loadProject(e.target.value);});
    $('#mtExport')?.addEventListener('click',()=>exportMix(false));$('#mtExportA1')?.addEventListener('click',()=>exportMix(true));$('#mtAddA1')?.addEventListener('click',openA1Dialog);$('#mtA1Close')?.addEventListener('click',()=>$('#mtA1Dialog')?.close());$('#mtA1Refresh')?.addEventListener('click',openA1Dialog);$('#mtA1Search')?.addEventListener('input',renderA1List);$('#mtA1List')?.addEventListener('click',async e=>{const b=e.target.closest('[data-a1-add]');if(b)await addA1Cue(b.dataset.a1Add);});
    $('#mtTracks')?.addEventListener('click',tracksClick);$('#mtTracks')?.addEventListener('input',quickClipVolume);$('#mtTracks')?.addEventListener('change',quickClipVolume);$('#mtTracks')?.addEventListener('input',laneInput);$('#mtTracks')?.addEventListener('change',laneInput);$('#mtTracks')?.addEventListener('pointerdown',e=>{if(e.target.closest('.mtClipQuickVolume')){e.stopPropagation();return;}beginClipGesture(e);});
    $('#mtInspector')?.addEventListener('input',clipInput);$('#mtInspector')?.addEventListener('change',clipInput);$('#mtInspector')?.addEventListener('click',clipAction);
    window.addEventListener('pointermove',moveClipGesture,{passive:false});window.addEventListener('pointerup',endClipGesture);window.addEventListener('pointercancel',endClipGesture);
    $('#mtRuler')?.addEventListener('click',e=>{const r=e.currentTarget.getBoundingClientRect(),target=(e.clientX-r.left)/Math.max(1,r.width)*timelineDuration();seekPlayback(target,S.playing,true);});
    const ws=$('#mtWorkspace');['dragenter','dragover'].forEach(ev=>ws?.addEventListener(ev,e=>{e.preventDefault();ws.classList.add('mtDropHot');const lane=e.target.closest('.mtLane');setDropLane(lane?.dataset.laneId||'');}));['dragleave','drop'].forEach(ev=>ws?.addEventListener(ev,e=>{e.preventDefault();ws.classList.remove('mtDropHot');if(ev==='dragleave'&&!ws.contains(e.relatedTarget))setDropLane('');}));
    ws?.addEventListener('drop',e=>{const lane=e.target.closest('.mtLane'),r=lane?.getBoundingClientRect(),offset=r?clamp((e.clientX-r.left)/r.width*timelineDuration(),0,timelineDuration()):undefined;const laneId=lane?.dataset.laneId;setDropLane('');addFiles(e.dataTransfer.files,{laneId,offset});});
    document.addEventListener('keydown',handleMultiTrackKeydown,true);window.addEventListener('resize',()=>{if(S.active)drawAll();});
  }

  function quickClipVolume(e){
    const input=e.target.closest('[data-clip-volume]');if(!input)return;
    const c=clipById(input.dataset.clipVolume);if(!c)return;
    e.stopPropagation();selectClipById(c.id,false);c.volume=clamp(input.value,0,1.5);sanitizeClip(c);dirty();
    const label=input.closest('.mtClipQuickVolume')?.querySelector('b');if(label)label.textContent=`${Math.round(c.volume*100)}%`;
    const inspector=$('#mtInspector [data-clip-k="volume"]');if(inspector&&selectedClip()?.id===c.id){inspector.value=String(c.volume);}
    restartIfPlaying();if(e.type==='change')renderInspector();
  }

  function tracksClick(e){
    const clipEl=e.target.closest('.mtClip');if(clipEl&&!e.target.closest('[data-drag]')){selectClipById(clipEl.dataset.clipId,true);return;}
    const laneRow=e.target.closest('.mtTrack');if(!laneRow)return;const laneId=laneRow.dataset.laneId,act=e.target.closest('[data-lane-act]')?.dataset.laneAct;
    if(act){
      const i=S.lanes.findIndex(l=>l.id===laneId);if(i<0)return;const lane=S.lanes[i];selectLaneById(lane.id,false);
      if(act==='mute')lane.mute=!lane.mute;else if(act==='solo')lane.solo=!lane.solo;else if(act==='remove')return removeLaneById(lane.id,true,'轨道按钮');
      else if(act==='up'&&i>0)[S.lanes[i-1],S.lanes[i]]=[S.lanes[i],S.lanes[i-1]];else if(act==='down'&&i<S.lanes.length-1)[S.lanes[i+1],S.lanes[i]]=[S.lanes[i],S.lanes[i+1]];
      ensureBaseLanes(1);dirty();renderAll();restartIfPlaying();setStatus(`已选择轨道「${lane.name}」并更新轨道设置`);return;
    }
    if(S.suppressClick||clipEl)return;selectLaneById(laneId,true);const lane=e.target.closest('.mtLane');if(!lane)return;const r=lane.getBoundingClientRect(),target=(e.clientX-r.left)/Math.max(1,r.width)*timelineDuration();seekPlayback(target,S.playing,true);
  }
  function laneInput(e){
    const row=e.target.closest('.mtTrack'),k=e.target.dataset.laneK;if(!row||!k)return;const lane=laneById(row.dataset.laneId);if(!lane)return;lane[k]=e.target.value;dirty();if(e.type==='change')renderAll();
  }
  function clipInput(e){
    const k=e.target.dataset.clipK,c=selectedClip();if(!k||!c)return;c[k]=k==='name'?e.target.value:Number(e.target.value);sanitizeClip(c);recomputeAutoCrossfades(c.laneId);dirty();redrawClip(c);
    if(k==='volume'||k==='pan')restartIfPlaying();
    if(e.type==='change'){renderAll();restartIfPlaying();}
  }
  function clipAction(e){
    const act=e.target.closest('[data-clip-act]')?.dataset.clipAct,c=selectedClip();if(!act||!c)return;
    if(act==='volumeReset'){c.volume=1;sanitizeClip(c);dirty();renderAll();restartIfPlaying();setStatus(`「${c.name}」音量已恢复 100%`);return;}
    if(act==='autoTrim')return autoTrimClip(c);if(act==='remove')return removeClipById(c.id,'音频块按钮');
  }

  function projectRecord(){
    return {schema:3,id:S.projectId||uid('project'),name:(S.projectName||$('#mtProjectName')?.value||`多轨项目 ${new Date().toLocaleDateString()}`).trim(),updatedAt:Date.now(),master:S.master,normalize:S.normalize,viewDuration:S.viewDuration,snap:S.snap,autoCrossfade:S.autoCrossfade,crossfadeDuration:S.crossfadeDuration,
      lanes:S.lanes.map(l=>({...l})),clips:S.clips.map(c=>({id:c.id,laneId:c.laneId,name:c.name,blob:c.blob,mime:c.mime,duration:c.duration,offset:c.offset,trimStart:c.trimStart,trimEnd:c.trimEnd,fadeIn:c.fadeIn,fadeOut:c.fadeOut,volume:c.volume,pan:c.pan}))};
  }
  async function saveProject(){
    if(!S.clips.length)return toast('空项目无需保存');try{setStatus('正在保存项目…');const rec=projectRecord();S.projectId=rec.id;S.projectName=rec.name;await dbPut(rec);lsSet(LAST_KEY,rec.id);$('#mtProjectName').value=rec.name;clean();await refreshProjects();$('#mtProjectSelect').value=rec.id;setStatus(`项目已保存：${rec.name}`);toast('多轨项目已保存 ✅');}catch(e){toast('保存失败：'+e.message);setStatus('项目保存失败');}
  }
  async function refreshProjects(){const sel=$('#mtProjectSelect');if(!sel)return;try{const all=(await dbAll()).sort((a,b)=>b.updatedAt-a.updatedAt);sel.innerHTML='<option value="">未保存的新项目</option>'+all.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${new Date(p.updatedAt).toLocaleDateString()}</option>`).join('');if(S.projectId)sel.value=S.projectId;}catch(_e){}}
  async function loadProject(id,silent=false){
    try{
      pausePlayback(false);setStatus('正在加载项目…');const rec=await dbGet(id);if(!rec)return;S.lanes=[];S.clips=[];
      if(rec.schema>=2&&Array.isArray(rec.clips)){
        S.lanes=(rec.lanes||[]).slice(0,MAX_LANES).map((l,i)=>({id:l.id||uid('lane'),name:l.name||`轨道 ${i+1}`,mute:!!l.mute,solo:!!l.solo}));
        for(const x of rec.clips.slice(0,MAX_CLIPS)){try{const buffer=await decodeBlob(x.blob),laneId=laneById(x.laneId)?.id||(S.lanes[0]?.id||addLane(null,false)?.id);S.clips.push({...x,laneId,buffer,duration:buffer.duration,trimEnd:Math.min(x.trimEnd??buffer.duration,buffer.duration),autoFadeIn:0,autoFadeOut:0});}catch(_e){}}
      }else{
        for(const x of rec.tracks||[]){try{const buffer=await decodeBlob(x.blob),lane=addLane(x.name||null,false);S.clips.push({id:x.id||uid('clip'),laneId:lane.id,name:x.name||'音频',blob:x.blob,mime:x.mime,buffer,duration:buffer.duration,offset:x.offset||0,trimStart:x.trimStart||0,trimEnd:Math.min(x.trimEnd??buffer.duration,buffer.duration),fadeIn:x.fadeIn||0,fadeOut:x.fadeOut||0,autoFadeIn:0,autoFadeOut:0,volume:x.volume??1,pan:x.pan??0});lane.mute=!!x.mute;lane.solo=!!x.solo;}catch(_e){}}
      }
      ensureBaseLanes(4);S.projectId=rec.id;S.projectName=rec.name;S.master=rec.master??.9;S.normalize=rec.normalize!==false;S.viewDuration=Math.max(120,Number(rec.viewDuration)||0);S.snap=rec.snap!==false;S.autoCrossfade=rec.autoCrossfade!==false;S.crossfadeDuration=clamp(rec.crossfadeDuration??1.5,.1,10);S.cursor=0;S.selectedClipId=S.clips[0]?.id||'';S.selectedLaneId=S.clips[0]?.laneId||S.lanes[0]?.id||'';
      $('#mtProjectName').value=S.projectName;$('#mtMaster').value=String(S.master);$('#mtNormalize').checked=S.normalize;$('#mtSnap').checked=S.snap;$('#mtAutoCrossfade').checked=S.autoCrossfade;$('#mtCrossfadeDuration').value=S.crossfadeDuration.toFixed(1);lsSet(LAST_KEY,id);clean();renderAll();await refreshProjects();setStatus(`已加载：${rec.name}（${S.lanes.length}轨 / ${S.clips.length}音频块）`);if(!silent)toast('项目已加载');
    }catch(e){toast('项目加载失败：'+e.message);}
  }
  function newProject(){if(S.recording||S.recordProcessing)return toast('请先结束当前录音');pausePlayback(false);S.lanes=[];S.clips=[];ensureBaseLanes(4);S.selectedClipId='';S.selectedLaneId=S.lanes[0]?.id||'';S.projectId='';S.projectName='';S.cursor=0;S.viewDuration=120;$('#mtProjectName').value='';$('#mtProjectSelect').value='';dirty();renderAll();setStatus('已新建空白多轨项目');}
  async function deleteProject(){if(!S.projectId)return toast('当前项目还没有保存');if(!confirm('确定删除当前多轨项目吗？'))return;const id=S.projectId;await dbDel(id);lsDel(LAST_KEY);newProject();await refreshProjects();clean();toast('项目已删除');}

  async function openA1Dialog(){
    const dlg=$('#mtA1Dialog');if(!dlg)return;try{setStatus('正在读取 A1 音乐库…');const api=await a1Api();if(typeof api.listAllCues!=='function')throw new Error('当前 A1 版本不支持读取全库');S.dialogCues=await api.listAllCues();renderA1List();dlg.showModal();setStatus(`A1 音乐库共 ${S.dialogCues.length} 首`);}catch(e){toast(e.message);setStatus(e.message);}
  }
  function renderA1List(){const box=$('#mtA1List');if(!box)return;const q=String($('#mtA1Search')?.value||'').trim().toLowerCase(),list=S.dialogCues.filter(c=>!q||`${c.name} ${c.catName}`.toLowerCase().includes(q)).slice(0,300);box.innerHTML=list.length?list.map(c=>`<div class="mtA1Item"><div style="min-width:0"><div class="mtA1Name">${esc(c.name)}</div><div class="mtA1Meta">${esc(c.catName||'未分类')} · ${fmt(c.duration||0)}</div></div><button class="mtBtn" data-a1-add="${esc(c.id)}">加入编辑器</button></div>`).join(''):'<div class="mtEmpty">没有找到匹配歌曲</div>';}
  async function addA1Cue(id){
    if(S.clips.length>=MAX_CLIPS)return toast(`最多支持 ${MAX_CLIPS} 个音频块`);try{const cue=S.dialogCues.find(c=>c.id===id),api=await a1Api();setStatus(`正在从 A1 读取：${cue?.name||''}`);const blob=await api.getCueBlob(id),buffer=await decodeBlob(blob),lane=S.lanes.length<MAX_LANES?addLane(null,false):chooseImportLane();addClip({name:cue?.name||'A1音频',blob,mime:blob.type,buffer,laneId:lane?.id});dirty();renderAll();setStatus(`已从 A1 加入：${cue?.name||'音频'}`);toast('已加入多轨项目');}catch(e){toast('加入失败：'+e.message);}
  }

  function scheduleOffline(ctx,c,bus){
    if(!audible(c)||!c.buffer)return;sanitizeClip(c);const d=effectiveDuration(c);if(d<=0)return;const src=ctx.createBufferSource();src.buffer=c.buffer;const gain=ctx.createGain(),pan=ctx.createStereoPanner?ctx.createStereoPanner():null;src.connect(gain);if(pan){pan.pan.value=c.pan;gain.connect(pan);pan.connect(bus);}else gain.connect(bus);
    const g0=c.offset,g1=c.offset+d,fi=Math.min(effectiveFadeIn(c),d),fo=Math.min(effectiveFadeOut(c),d);gain.gain.setValueAtTime(fi>0?0:c.volume,g0);if(fi>0)gain.gain.linearRampToValueAtTime(c.volume,g0+fi);if(fo>0){gain.gain.setValueAtTime(c.volume,Math.max(g0,g1-fo));gain.gain.linearRampToValueAtTime(0,g1);}src.start(g0,c.trimStart,d);
  }
  async function renderOffline(){const total=totalDuration();if(!total)throw new Error('没有可合成的音频');const sr=44100,frames=Math.ceil(total*sr),ctx=new OfflineAudioContext(2,frames,sr),master=ctx.createGain(),comp=ctx.createDynamicsCompressor();master.gain.value=S.master;comp.threshold.value=-2;comp.knee.value=2;comp.ratio.value=8;comp.attack.value=.003;comp.release.value=.15;master.connect(comp).connect(ctx.destination);S.clips.forEach(c=>scheduleOffline(ctx,c,master));return await ctx.startRendering();}
  async function mp3Blob(buffer,normalize){
    if(!window.lamejs?.Mp3Encoder)throw new Error('MP3编码组件没有加载');const len=buffer.length,sr=buffer.sampleRate,ch=Math.min(2,buffer.numberOfChannels),left=buffer.getChannelData(0),right=buffer.getChannelData(ch>1?1:0);let peak=0;
    if(normalize){for(let i=0;i<len;i+=8)peak=Math.max(peak,Math.abs(left[i]||0),Math.abs(right[i]||0));}const scale=normalize&&peak>0?Math.min(1,.98/peak):1,encoder=new window.lamejs.Mp3Encoder(2,sr,192),parts=[],block=1152,totalBlocks=Math.ceil(len/block),toInt16=(src,start,n)=>{const out=new Int16Array(n);for(let i=0;i<n;i++){const x=clamp((src[start+i]||0)*scale,-1,1);out[i]=x<0?Math.round(x*32768):Math.round(x*32767);}return out;};
    for(let start=0,idx=0;start<len;start+=block,idx++){const n=Math.min(block,len-start),a=toInt16(left,start,n),b=toInt16(right,start,n),buf=encoder.encodeBuffer(a,b);if(buf.length)parts.push(new Uint8Array(buf));if(idx%35===0){setStatus(`正在编码 MP3… ${Math.min(99,Math.round(idx/Math.max(1,totalBlocks)*100))}%`);await new Promise(r=>setTimeout(r,0));}}const end=encoder.flush();if(end.length)parts.push(new Uint8Array(end));return new Blob(parts,{type:'audio/mpeg'});
  }
  function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);}
  async function exportMix(toA1){
    if(S.exporting)return;S.exporting=true;const b1=$('#mtExport'),b2=$('#mtExportA1');if(b1)b1.disabled=true;if(b2)b2.disabled=true;try{pausePlayback(false);setStatus('正在离线合成多轨音乐…');const rendered=await renderOffline();setStatus('正在生成 MP3 文件…');const blob=await mp3Blob(rendered,S.normalize),name=safeName(S.projectName||$('#mtProjectName')?.value||'多轨融合成品')+'.mp3';
      if(toA1){setStatus('正在写入 A1 曲库并加入当前队列…');await importMixIntoA1(blob,name);download(blob,name);setStatus(`已加入 A1 当前队列并下载：${name}`);toast('MP3 已写入 A1 并加入当前队列 ✅');}
      else{download(blob,name);setStatus(`MP3 已导出：${name}`);toast('多轨 MP3 已导出 ✅');}
    }catch(e){setStatus('合成失败：'+e.message);toast('合成失败：'+e.message);}finally{S.exporting=false;if(b1)b1.disabled=false;if(b2)b2.disabled=false;}
  }

  function boot(){if(inject())return;let n=0;const tm=setInterval(()=>{if(inject()||++n>80)clearInterval(tm);},100);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.SimpleStudioMultiTrack={version:'4.6.2',open:()=>setActive(true),close:()=>setActive(false,{restoreA1:true}),closeForMode:closeForHostMode,togglePlayback:playPause,render:renderAll,restoreA1:restoreA1View,ensureA1:()=>{ensureA1FrameReady(true);scheduleA1Restore(true);},state:S};
})();
