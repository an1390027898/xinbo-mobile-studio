
(() => {
  const STORAGE_KEY = 'desktop-video-final-v3';
  const isDesktop = !!window.anningDesktop?.isDesktop;
  async function desktopLoad(key){
    if(!isDesktop || !window.anningDesktop?.storeGet) return null;
    try{ const res = await window.anningDesktop.storeGet(key); return res?.ok ? res.value : null; }catch{ return null; }
  }
  async function desktopSave(key, value){
    if(!isDesktop || !window.anningDesktop?.storeSet) return false;
    try{ await window.anningDesktop.storeSet(key, value); return true; }catch{ return false; }
  }
  const byId = (id) => document.getElementById(id);
  const q = (sel, root=document) => root.querySelector(sel);
  const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const oldSetTab = window.setTab ? window.setTab.bind(window) : null;

  const state = {
    built: false,
    selectedSourceId: '',
    selectedLayerId: '',
    sceneName: '未命名节目',
    sceneLock: false,
    sources: [],
    previewLayers: [],
    programLayers: [],
    scenes: [],
    queue: [],
    programTitle: '',
    playing: false,
    loop: false,
    autoNext: false,
    black: false,
    safe: false,
    clock: false,
    mute: false,
    pure: false,
    outputOpened: false,
    outputFs: false,
    outputLabel: '',
    drag: null,
    captureSelection: '',
    captureHint: '',
    bottomPanelHeight: 220,
    splitDrag: null
  };

  const captureStreams = new Map();
  let captureSources = [];
  let cropState = { source:null, rect:null, drag:null };
  let backupItems = [];
  let outputDisplays = [];
  let autoSnapshotSig = '';
  let autoSnapshotTimer = null;

  function uid(prefix='id'){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
  function clampBottomPanelHeight(value){
    const num = Number(value);
    if(!Number.isFinite(num)) return 220;
    return Math.max(150, Math.min(420, Math.round(num)));
  }
  function applyLayout(){
    const shell = q('#viewVideoDesk .vd-shell');
    if(shell) shell.style.setProperty('--vd-bottom-h', `${clampBottomPanelHeight(state.bottomPanelHeight)}px`);
  }
  function escapeHtml(str=''){ return String(str).replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m] || m)); }
  function toast(msg){
    try { if (typeof window.toast === 'function') return window.toast(msg); } catch {}
    let box = byId('desktopVideoToast');
    if(!box){
      box = document.createElement('div');
      box.id = 'desktopVideoToast';
      box.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:999999;padding:10px 14px;border-radius:12px;background:rgba(10,16,28,.94);border:1px solid rgba(120,140,180,.22);color:#eef4ff;font:700 12px/1.2 ui-sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.28);display:none;';
      document.body.appendChild(box);
    }
    box.textContent = msg; box.style.display='block';
    clearTimeout(box._t); box._t = setTimeout(()=> box.style.display='none', 1800);
  }
  function getWorkspacePayload(){
    return {
      sceneName: state.sceneName,
      sceneLock: state.sceneLock,
      scenes: state.scenes,
      queue: state.queue,
      programTitle: state.programTitle,
      loop: state.loop,
      autoNext: state.autoNext,
      black: state.black,
      safe: state.safe,
      clock: state.clock,
      mute: state.mute,
      pure: state.pure,
      outputLabel: state.outputLabel,
      selectedSourceId: state.selectedSourceId,
      selectedLayerId: state.selectedLayerId,
      captureSelection: state.captureSelection,
      bottomPanelHeight: clampBottomPanelHeight(state.bottomPanelHeight),
      sources: state.sources.filter(s => s.persist || s.type === 'capture').map(serializeSource),
      previewLayers: state.previewLayers,
      programLayers: state.programLayers
    };
  }

  async function refreshBackups(){
    if(!isDesktop || !window.anningDesktop?.listWorkspaceBackups){ backupItems = []; renderStatus(); return []; }
    try{
      const res = await window.anningDesktop.listWorkspaceBackups('video');
      backupItems = res?.ok ? (res.items || []) : [];
    }catch{ backupItems = []; }
    renderBackupList();
    renderStatus();
    return backupItems;
  }

  async function exportWorkspaceFile(){
    if(!window.anningDesktop?.exportWorkspace) return toast('当前环境不支持导出');
    const res = await window.anningDesktop.exportWorkspace('video', getWorkspacePayload());
    if(res?.ok){ toast('已导出视频工程'); refreshBackups(); }
    else if(res?.reason !== 'cancelled'){ toast('导出失败'); }
  }

  async function importWorkspaceFileUI(){
    if(!window.anningDesktop?.importWorkspace) return toast('当前环境不支持导入');
    const res = await window.anningDesktop.importWorkspace('video');
    if(res?.ok) toast('已导入视频工程，正在刷新');
    else if(res?.reason !== 'cancelled') toast('导入失败');
  }

  async function createWorkspaceSnapshot(manual=true){
    if(!window.anningDesktop?.createWorkspaceBackup) return false;
    const res = await window.anningDesktop.createWorkspaceBackup('video', getWorkspacePayload());
    if(res?.ok){
      if(manual) toast('已保存快照');
      autoSnapshotSig = JSON.stringify(getWorkspacePayload());
      refreshBackups();
      return true;
    }
    if(manual) toast('保存快照失败');
    return false;
  }

  async function restoreWorkspaceBackup(path){
    if(!path || !window.anningDesktop?.restoreWorkspaceBackup) return;
    const ok = confirm('恢复该备份后会刷新当前视频模块，是否继续？');
    if(!ok) return;
    const res = await window.anningDesktop.restoreWorkspaceBackup('video', path);
    if(!res?.ok) toast('恢复备份失败');
  }

  function scheduleAutoSnapshot(){
    if(autoSnapshotTimer) return;
    autoSnapshotTimer = setInterval(async ()=>{
      if(!isDesktop || !window.anningDesktop?.createWorkspaceBackup) return;
      const sig = JSON.stringify(getWorkspacePayload());
      if(!sig || sig === '{}' || sig === autoSnapshotSig) return;
      await createWorkspaceSnapshot(false);
    }, 180000);
  }

  function renderBackupList(){
    const wrap = byId('vdBackupList');
    if(!wrap) return;
    if(!backupItems.length){ wrap.innerHTML = '<div class="vd-note">暂无备份</div>'; return; }
    wrap.innerHTML = backupItems.slice(0,5).map(item=>{
      const d = new Date(item.mtime || Date.now());
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `<button class="vd-backItem" data-path="${escapeHtml(item.path)}"><span class="vd-backName">${escapeHtml(item.name)}</span><span class="vd-backTime">${escapeHtml(ds)}</span></button>`;
    }).join('');
    qa('.vd-backItem', wrap).forEach(btn=>btn.addEventListener('click', ()=> restoreWorkspaceBackup(btn.dataset.path || '')));
  }

  function serializeSource(src){
    return {
      id: src.id,
      name: src.name,
      type: src.type,
      url: src.type === 'capture' ? '' : (src.url || ''),
      width: src.width || 0,
      height: src.height || 0,
      duration: src.duration || 0,
      fileSize: src.fileSize || 0,
      text: src.text || '',
      captureSourceId: src.captureSourceId || '',
      captureKind: src.captureKind || '',
      thumbnail: src.thumbnail || '',
      appIcon: src.appIcon || '',
      displayId: src.displayId || '',
      crop: src.crop || null,
      persist: src.type === 'capture'
    };
  }
  function saveState(){
    try{
      const clean = getWorkspacePayload();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      desktopSave?.('videoDesktopState', clean);
    }catch{}
  }
  async function loadState(){
    try{
      let data = null;
      const desktopData = await desktopLoad?.('videoDesktopState');
      if (desktopData && typeof desktopData === 'object') data = desktopData;
      if (!data) data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      Object.assign(state, data || {});
    }catch{}
    state.sources = Array.isArray(state.sources) ? state.sources : [];
    state.previewLayers = Array.isArray(state.previewLayers) ? state.previewLayers : [];
    state.programLayers = Array.isArray(state.programLayers) ? state.programLayers : [];
    state.scenes = Array.isArray(state.scenes) ? state.scenes : [];
    state.queue = Array.isArray(state.queue) ? state.queue : [];
    state.outputDisplayId = String(state.outputDisplayId || '');
    state.bottomPanelHeight = clampBottomPanelHeight(state.bottomPanelHeight);
  }
  async function listCaptureSources(){
    if(!isDesktop || !window.anningDesktop?.listCaptureSources) return [];
    try{
      const res = await window.anningDesktop.listCaptureSources();
      return res?.ok ? (res.sources || []) : [];
    }catch{ return []; }
  }
  function syncCaptureSourceStatus(){
    const live = new Map(captureSources.map(src => [src.id, src]));
    let changed = false;
    state.sources.forEach(src => {
      if(src.type !== 'capture') return;
      const meta = live.get(src.captureSourceId || '');
      const online = !!meta;
      if(src.online !== online){ src.online = online; changed = true; }
      if(meta){
        if(src.name && src.name.startsWith('窗口映射') || src.name && src.name.startsWith('区域映射')){
          const prefix = src.crop ? '区域映射' : '窗口映射';
          const nextName = `${prefix} · ${meta.name}`;
          if(src.name !== nextName){ src.name = nextName; changed = true; }
        }
        ['thumbnail','appIcon','displayId'].forEach(k => { if(meta[k] && src[k] !== meta[k]){ src[k]=meta[k]; changed = true; } });
      }
    });
    if(changed){ saveState(); renderLibrary(); renderLayerList(); renderProps(); renderProgram(); renderStatus(); }
  }
  async function refreshCaptureSources(preferred=''){
    captureSources = await listCaptureSources();
    captureSources = captureSources.slice().sort((a, b) => {
      const kindWeight = (item) => item.kind === 'window' ? 0 : 1;
      const diff = kindWeight(a) - kindWeight(b);
      if(diff) return diff;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
    const sel = byId('vdCaptureSelect');
    if(sel){
      const current = preferred || state.captureSelection || sel.value || '';
      sel.innerHTML = captureSources.map(src => `<option value="${escapeHtml(src.id)}">${escapeHtml(src.kind === 'screen' ? '屏幕' : '窗口')} · ${escapeHtml(src.name)}</option>`).join('');
      if(current && captureSources.some(src => src.id === current)) sel.value = current;
      else if(captureSources[0]) sel.value = captureSources[0].id;
      state.captureSelection = sel.value || '';
    }
    syncCaptureSourceStatus();
    updateCaptureHint();
    saveState();
    return captureSources;
  }
  function selectedCaptureMeta(){
    const sel = byId('vdCaptureSelect');
    const id = sel?.value || state.captureSelection || '';
    return captureSources.find(src => src.id === id) || null;
  }

  async function refreshDisplays(preferred=''){
    if(!isDesktop || !window.anningDesktop?.getDisplays) return [];
    try{
      const list = await window.anningDesktop.getDisplays();
      outputDisplays = Array.isArray(list) ? list : [];
    }catch{
      outputDisplays = [];
    }
    const sel = byId('vdOutputDisplay');
    if(sel){
      const fallback = outputDisplays.find(item => !item.isPrimary) || outputDisplays[0] || null;
      const current = String(preferred || state.outputDisplayId || sel.value || fallback?.id || '');
      sel.innerHTML = outputDisplays.map(item => `<option value="${escapeHtml(String(item.id))}">${escapeHtml(item.label)}${item.isPrimary ? '（主屏）' : ''}</option>`).join('');
      if(current && outputDisplays.some(item => String(item.id) === current)) sel.value = current;
      else if(fallback) sel.value = String(fallback.id);
      state.outputDisplayId = sel.value || '';
    }
    saveState();
    return outputDisplays;
  }

  function selectedOutputDisplay(){
    const sel = byId('vdOutputDisplay');
    const id = String(sel?.value || state.outputDisplayId || '');
    return outputDisplays.find(item => String(item.id) === id) || outputDisplays.find(item => !item.isPrimary) || outputDisplays[0] || null;
  }

  async function ensureOutputDisplayReady(){
    if(!outputDisplays.length) await refreshDisplays(state.outputDisplayId);
    return selectedOutputDisplay();
  }
  function updateCaptureHint(){
    const meta = selectedCaptureMeta();
    const el = byId('vdCaptureHint');
    if(!el) return;
    if(!meta){ el.textContent = '支持选择系统中已打开的窗口，或先选整块屏幕后再做区域映射。'; return; }
    const base = meta.kind === 'screen'
      ? '整屏源更适合做区域映射，原窗口可以隐藏；若做窗口映射，原窗口最小化后不保证稳定。'
      : '当前是窗口映射源。可直接映射窗口；若需要隐藏原窗口，建议改用整屏 + 区域映射。';
    el.textContent = `${meta.kind === 'screen' ? '屏幕' : '窗口'} · ${meta.name} ｜ ${base}`;
  }
  async function detectThumbnailCrop(dataUrl){
    if(!dataUrl) return null;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try{
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if(!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let minX = width, minY = height, maxX = -1, maxY = -1;
          const step = Math.max(1, Math.round(Math.min(width, height) / 320));
          for(let y = 0; y < height; y += step){
            for(let x = 0; x < width; x += step){
              const i = (y * width + x) * 4;
              const a = data[i + 3] || 0;
              const r = data[i] || 0;
              const g = data[i + 1] || 0;
              const b = data[i + 2] || 0;
              const bright = r + g + b;
              if(a > 24 && bright > 30){
                if(x < minX) minX = x;
                if(y < minY) minY = y;
                if(x > maxX) maxX = x;
                if(y > maxY) maxY = y;
              }
            }
          }
          if(maxX < 0 || maxY < 0) return resolve(null);
          const pad = Math.max(2, step * 2);
          minX = Math.max(0, minX - pad);
          minY = Math.max(0, minY - pad);
          maxX = Math.min(width - 1, maxX + pad);
          maxY = Math.min(height - 1, maxY + pad);
          const crop = {
            x: minX / width,
            y: minY / height,
            w: (maxX - minX + 1) / width,
            h: (maxY - minY + 1) / height
          };
          if(crop.w >= 0.96 && crop.h >= 0.96) return resolve(null);
          if(crop.w <= 0.12 || crop.h <= 0.12) return resolve(null);
          resolve(crop);
        }catch{ resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function createCaptureSource(meta, crop=null){
    if(!meta) return null;
    const baseW = Number(meta.width) || 1280;
    const baseH = Number(meta.height) || 720;
    const width = crop ? Math.max(160, Math.round(baseW * crop.w)) : baseW;
    const height = crop ? Math.max(90, Math.round(baseH * crop.h)) : baseH;
    const src = {
      id: uid('src'),
      name: `${crop ? '区域映射' : '窗口映射'} · ${meta.name}`,
      type: 'capture',
      captureSourceId: meta.id,
      captureKind: meta.kind,
      displayId: meta.displayId || '',
      thumbnail: meta.thumbnail || '',
      appIcon: meta.appIcon || '',
      width, height,
      crop: crop || null,
      persist: true,
      online: true
    };
    state.sources.unshift(src);
    state.selectedSourceId = src.id;
    saveState();
    renderAll();
    return src;
  }
  async function createWindowMapping(){
    const meta = selectedCaptureMeta();
    if(!meta) return toast('先选一个窗口或屏幕');
    let autoCrop = null;
    if(meta.kind === 'window' && meta.thumbnail){
      autoCrop = await detectThumbnailCrop(meta.thumbnail).catch(() => null);
    }
    const src = createCaptureSource(meta, autoCrop || null);
    if(src && autoCrop){
      src.name = `窗口映射 · ${meta.name}`;
      src.width = Math.max(160, Math.round((Number(meta.width) || 1280) * autoCrop.w));
      src.height = Math.max(90, Math.round((Number(meta.height) || 720) * autoCrop.h));
      saveState();
      renderAll();
    }
    toast(autoCrop ? `已加入映射源：${meta.name}（已自动裁掉黑边）` : `已加入映射源：${meta.name}`);
  }
  async function openRegionCropper(){
    const meta = selectedCaptureMeta();
    if(!meta) return toast('先选一个窗口或屏幕');
    if(!meta.thumbnail) return toast('当前源没有可用预览图');
    cropState = { source: meta, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, drag: null };
    const mask = byId('vdCropMask');
    const img = byId('vdCropPreview');
    if(!mask || !img) return;
    byId('vdCropTitle').textContent = `区域映射 · ${meta.name}`;
    byId('vdCropSub').textContent = meta.kind === 'screen'
      ? '建议：做整屏捕获后再框选区域，这样原窗口隐藏或切换后更稳定。'
      : '当前是窗口源。窗口被最小化后，系统不保证持续输出。';
    img.onload = () => { renderCropRect(); };
    img.src = meta.thumbnail;
    mask.classList.add('show');
  }
  function closeRegionCropper(){
    byId('vdCropMask')?.classList.remove('show');
    cropState = { source:null, rect:null, drag:null };
  }
  function cropWrapMetrics(){
    const wrap = byId('vdCropWrap');
    const img = byId('vdCropPreview');
    if(!wrap || !img) return null;
    const wr = wrap.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    return { wrap, img, wr, ir };
  }
  function renderCropRect(){
    const box = byId('vdCropBox');
    const m = cropWrapMetrics();
    if(!box || !m || !cropState.rect) return;
    const { ir } = m; const r = cropState.rect;
    box.style.display = 'block';
    box.style.left = `${ir.left - m.wr.left + ir.width * r.x}px`;
    box.style.top = `${ir.top - m.wr.top + ir.height * r.y}px`;
    box.style.width = `${ir.width * r.w}px`;
    box.style.height = `${ir.height * r.h}px`;
    const note = byId('vdCropReadout');
    if(note) note.textContent = `区域：${Math.round(r.x*100)}%, ${Math.round(r.y*100)}% ｜ ${Math.round(r.w*100)}% × ${Math.round(r.h*100)}%`;
  }
  function onCropPointerDown(e){
    const m = cropWrapMetrics();
    if(!m) return;
    const { ir } = m;
    const x = Math.max(0, Math.min(1, (e.clientX - ir.left) / ir.width));
    const y = Math.max(0, Math.min(1, (e.clientY - ir.top) / ir.height));
    cropState.drag = { x0: x, y0: y };
    cropState.rect = { x, y, w: 0.001, h: 0.001 };
    renderCropRect();
    window.addEventListener('pointermove', onCropPointerMove);
    window.addEventListener('pointerup', onCropPointerUp, { once:true });
    e.preventDefault();
  }
  function onCropPointerMove(e){
    const d = cropState.drag; const m = cropWrapMetrics();
    if(!d || !m) return;
    const { ir } = m;
    const x1 = Math.max(0, Math.min(1, (e.clientX - ir.left) / ir.width));
    const y1 = Math.max(0, Math.min(1, (e.clientY - ir.top) / ir.height));
    const x = Math.min(d.x0, x1), y = Math.min(d.y0, y1), w = Math.max(0.02, Math.abs(x1 - d.x0)), h = Math.max(0.02, Math.abs(y1 - d.y0));
    cropState.rect = { x, y, w, h };
    renderCropRect();
  }
  function onCropPointerUp(){
    cropState.drag = null;
    window.removeEventListener('pointermove', onCropPointerMove);
  }
  function confirmRegionCrop(){
    if(!cropState.source || !cropState.rect) return;
    createCaptureSource(cropState.source, cropState.rect);
    closeRegionCropper();
    toast('区域映射已加入素材库');
  }
  async function getCaptureStream(sourceId) {
    if (!sourceId) return null;
    const cached = captureStreams.get(sourceId);
    if (cached && cached.active) return cached;
    try{
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 640,
            minHeight: 360,
            maxWidth: 3840,
            maxHeight: 2160,
            maxFrameRate: 30
          }
        }
      });
      captureStreams.set(sourceId, stream);
      const src = state.sources.find(item => item.type==='capture' && item.captureSourceId===sourceId);
      if(src && src.online === false){ src.online = true; saveState(); renderLibrary(); renderProps(); renderStatus(); }
      return stream;
    }catch(err){
      const src = state.sources.find(item => item.type==='capture' && item.captureSourceId===sourceId);
      if(src && src.online !== false){ src.online = false; saveState(); renderLibrary(); renderProps(); renderStatus(); }
      throw err;
    }
  }
  async function hydrateCaptureVideos(root = document) {
    const videos = qa('video[data-capture-id]', root);
    for (const video of videos) {
      const sourceId = video.dataset.captureId || '';
      if (!sourceId) continue;
      try {
        const stream = await getCaptureStream(sourceId);
        if (video.srcObject !== stream) video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.play().catch(()=>{});
      } catch (err) {
        console.error('capture hydrate failed', err);
      }
    }
  }
  function applyMediaStyle(node, layer){
    if(!node) return;
    const fit = layer.fitMode === 'contain' ? 'contain' : (layer.fitMode === 'stretch' ? 'fill' : 'cover');
    if(layer.type === 'capture'){
      node.classList.add('capMedia');
      const crop = layer.crop || null;
      if(crop && crop.w > 0 && crop.h > 0){
        node.style.objectFit = 'fill';
        node.style.width = `${100 / crop.w}%`;
        node.style.height = `${100 / crop.h}%`;
        node.style.left = `${-(crop.x / crop.w) * 100}%`;
        node.style.top = `${-(crop.y / crop.h) * 100}%`;
      } else {
        node.style.objectFit = fit;
        node.style.width = '100%';
        node.style.height = '100%';
        node.style.left = '0';
        node.style.top = '0';
      }
      return;
    }
    if(node.tagName === 'VIDEO' || node.tagName === 'IMG') node.style.objectFit = fit;
  }

  function inferType(file){
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    if(type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv)$/i.test(name)) return 'video';
    if(type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name)) return 'image';
    if(type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    return '';
  }
  function readVideoMeta(url){
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve({ width:v.videoWidth || 1920, height:v.videoHeight || 1080, duration:v.duration || 0 });
      v.onerror = () => resolve({ width:1920, height:1080, duration:0 });
      v.src = url;
    });
  }
  function readImageMeta(url){
    return new Promise(resolve => {
      const i = new Image();
      i.onload = () => resolve({ width:i.naturalWidth || 1920, height:i.naturalHeight || 1080, duration:0 });
      i.onerror = () => resolve({ width:1920, height:1080, duration:0 });
      i.src = url;
    });
  }
  function stageRect(stageEl){
    if(!stageEl) return { width:1280, height:720 };
    const r = stageEl.getBoundingClientRect();
    return { width: Math.max(10, Math.round(r.width)), height: Math.max(10, Math.round(r.height)) };
  }
  function bestFit(inW, inH, boxW, boxH){
    const safeW = Math.max(10, boxW);
    const safeH = Math.max(10, boxH);
    const scale = Math.min(safeW / inW, safeH / inH);
    const w = Math.max(60, Math.round(inW * scale));
    const h = Math.max(40, Math.round(inH * scale));
    const x = Math.round((boxW - w) / 2);
    const y = Math.round((boxH - h) / 2);
    return { x,y,w,h };
  }
  function originalFit(inW, inH, boxW, boxH){
    let w = Math.round(inW);
    let h = Math.round(inH);
    if(w > boxW || h > boxH){
      return bestFit(inW, inH, boxW, boxH);
    }
    return { x:Math.round((boxW-w)/2), y:Math.round((boxH-h)/2), w, h };
  }
  function fitLayerToStage(layer, stageEl, fitMode='contain', aspectWidth=null, aspectHeight=null){
    if(!layer || !stageEl) return;
    const rect = stageRect(stageEl);
    if(!rect.width || !rect.height) return;
    if(aspectWidth && aspectHeight){
      const ratio = Math.max(0.0001, Number(aspectWidth) / Math.max(1, Number(aspectHeight)));
      let w = rect.width;
      let h = Math.round(w / ratio);
      if(h > rect.height){
        h = rect.height;
        w = Math.round(h * ratio);
      }
      layer.x = Math.round((rect.width - w) / 2);
      layer.y = Math.round((rect.height - h) / 2);
      layer.w = Math.round(w);
      layer.h = Math.round(h);
    } else {
      layer.x = 0; layer.y = 0; layer.w = rect.width; layer.h = rect.height;
    }
    layer.fitMode = fitMode;
  }

  function syncProgramLayerPlaybackState(){
    const stage = byId('vdProgramStage');
    if(!stage) return;
    qa('.vd-layer', stage).forEach(box => {
      const id = box.dataset.layerId || '';
      const layer = state.programLayers.find(item => item.id === id);
      if(!layer) return;
      const media = box.querySelector('video:not([data-capture-id])');
      if(media && Number.isFinite(media.currentTime)){
        layer.currentTime = Number(media.currentTime) || 0;
      }
    });
  }

  function applyScreenMap(){
    const layer = selectedLayer();
    if(!layer) return toast('先在预监里选中一个图层');
    const preferStretch = ['capture','web','pdf'].includes(layer.type);
    fitLayerToStage(layer, byId('vdPreviewStage'), preferStretch ? 'stretch' : 'contain');
    renderAll();
    saveState();
    toast('已适配当前预监画布');
  }

  function adaptLayerToOutputDisplay(){
    const layer = selectedLayer();
    if(!layer) return toast('先在预监里选中一个图层');
    const target = selectedOutputDisplay();
    const bounds = target?.bounds || null;
    const preferStretch = ['capture','web','pdf'].includes(layer.type);
    fitLayerToStage(layer, byId('vdPreviewStage'), preferStretch ? 'stretch' : 'contain', bounds?.width || null, bounds?.height || null);
    renderAll();
    saveState();
    toast(target ? `已按 ${target.label} 比例适配` : '已按当前屏幕比例适配');
  }
  function cloneLayers(layers){
    return JSON.parse(JSON.stringify(layers || []));
  }
  function scaleLayerRects(layers, fromRect, toRect){
    const fw = Math.max(1, Number(fromRect?.width) || 1);
    const fh = Math.max(1, Number(fromRect?.height) || 1);
    const tw = Math.max(1, Number(toRect?.width) || fw);
    const th = Math.max(1, Number(toRect?.height) || fh);
    const sx = tw / fw;
    const sy = th / fh;
    return cloneLayers(layers).map(layer => ({
      ...layer,
      x: Math.round((Number(layer.x) || 0) * sx),
      y: Math.round((Number(layer.y) || 0) * sy),
      w: Math.max(1, Math.round((Number(layer.w) || tw) * sx)),
      h: Math.max(1, Math.round((Number(layer.h) || th) * sy))
    }));
  }
  function selectedLayer(){ return state.previewLayers.find(l=>l.id===state.selectedLayerId) || null; }
  function selectedSource(){ return state.sources.find(s=>s.id===state.selectedSourceId) || null; }

  async function importFiles(files){
    let added = 0, skipped = 0;
    for(const file of Array.from(files || [])){
      const mediaType = inferType(file);
      if(!mediaType){ skipped++; continue; }
      const url = URL.createObjectURL(file);
      let meta = { width:1920, height:1080, duration:0 };
      if(mediaType === 'video') meta = await readVideoMeta(url);
      if(mediaType === 'image') meta = await readImageMeta(url);
      state.sources.unshift({
        id: uid('src'),
        name: file.name,
        type: mediaType,
        url,
        width: meta.width,
        height: meta.height,
        duration: meta.duration || 0,
        fileSize: file.size || 0
      });
      added++;
    }
    if(added) state.selectedSourceId = state.sources[0].id;
    renderAll();
    if(added) toast(`已导入 ${added} 个素材`);
    if(skipped) toast(`跳过 ${skipped} 个不支持的文件`);
  }

  function addQuickSource(kind){
    if(kind === 'text'){
      const src = { id:uid('src'), name:'文本层', type:'text', text:'双击右侧修改文本', width:1200, height:240 };
      state.sources.unshift(src); state.selectedSourceId = src.id;
    } else if(kind === 'clock'){
      const src = { id:uid('src'), name:'时钟层', type:'clock', width:420, height:110 };
      state.sources.unshift(src); state.selectedSourceId = src.id;
    } else if(kind === 'web'){
      const url = prompt('输入网页地址', 'https://example.com');
      if(!url) return;
      const src = { id:uid('src'), name:'网页层', type:'web', url, width:1280, height:720 };
      state.sources.unshift(src); state.selectedSourceId = src.id;
    }
    renderAll();
  }

  function makeLayerFromSource(src, mode='fit'){
    const rect = stageRect(byId('vdPreviewStage'));
    let box = bestFit(src.width || 1920, src.height || 1080, rect.width, rect.height);
    if(mode === 'original') box = originalFit(src.width || 1920, src.height || 1080, rect.width, rect.height);
    if(mode === 'fill' || mode === 'screenfit') box = { x:0, y:0, w:rect.width, h:rect.height };
    const layer = {
      id: uid('layer'),
      sourceId: src.id,
      name: src.name,
      type: src.type,
      url: src.url || '',
      text: src.text || '',
      x: box.x, y: box.y, w: box.w, h: box.h,
      opacity: 1,
      fitMode: mode === 'fill' ? 'cover' : (mode === 'screenfit' ? ((src.type === 'capture' || src.type === 'web' || src.type === 'pdf') ? 'stretch' : 'contain') : 'contain'),
      intrinsicWidth: src.width || box.w,
      intrinsicHeight: src.height || box.h,
      loop: true,
      currentTime: 0,
      captureSourceId: src.captureSourceId || '',
      captureKind: src.captureKind || '',
      crop: src.crop || null,
      thumbnail: src.thumbnail || ''
    };
    state.previewLayers.push(layer);
    state.selectedLayerId = layer.id;
    if(!state.sceneLock) state.sceneName = src.name.replace(/\.[^.]+$/,'');
    renderAll();
  }

  function addSelectedSource(mode='fit'){
    const src = selectedSource();
    if(!src) return toast('先选一个素材');
    makeLayerFromSource(src, mode);
  }

  function applyLayerMode(mode){
    const layer = selectedLayer();
    if(!layer) return;
    const rect = stageRect(byId('vdPreviewStage'));
    if(mode === 'fit'){
      Object.assign(layer, bestFit(layer.intrinsicWidth || layer.w, layer.intrinsicHeight || layer.h, rect.width, rect.height), { fitMode:'contain' });
    } else if(mode === 'original'){
      Object.assign(layer, originalFit(layer.intrinsicWidth || layer.w, layer.intrinsicHeight || layer.h, rect.width, rect.height), { fitMode:'contain' });
    } else if(mode === 'fill'){
      Object.assign(layer, { x:0, y:0, w:rect.width, h:rect.height, fitMode:'cover' });
    } else if(mode === 'screenfit'){
      Object.assign(layer, { x:0, y:0, w:rect.width, h:rect.height, fitMode: ['capture','web','pdf'].includes(layer.type) ? 'stretch' : 'contain' });
    }
    renderAll();
  }

  function removeSource(id){
    const idx = state.sources.findIndex(s=>s.id===id);
    if(idx < 0) return;
    const src = state.sources[idx];
    state.sources.splice(idx,1);
    state.previewLayers = state.previewLayers.filter(l=>l.sourceId !== id);
    state.queue = state.queue.filter(q=>q.sourceId !== id);
    if(state.selectedSourceId === id) state.selectedSourceId = state.sources[0]?.id || '';
    if(state.selectedLayerId && !state.previewLayers.some(l=>l.id===state.selectedLayerId)) state.selectedLayerId = state.previewLayers[0]?.id || '';
    try{ if(src.url) URL.revokeObjectURL(src.url); }catch{}
    renderAll();
  }

  function removeLayer(id){
    state.previewLayers = state.previewLayers.filter(l=>l.id!==id);
    if(state.selectedLayerId===id) state.selectedLayerId = state.previewLayers[state.previewLayers.length-1]?.id || '';
    renderAll();
  }

  function moveLayer(id, dir){
    const idx = state.previewLayers.findIndex(l=>l.id===id);
    if(idx < 0) return;
    const to = idx + dir;
    if(to < 0 || to >= state.previewLayers.length) return;
    const [item] = state.previewLayers.splice(idx,1);
    state.previewLayers.splice(to,0,item);
    renderAll();
  }

  function applyLayerProps(){
    const layer = selectedLayer();
    if(!layer) return;
    const num = (id, fallback) => {
      const v = Number(byId(id)?.value);
      return Number.isFinite(v) ? v : fallback;
    };
    layer.x = num('vdPropX', layer.x);
    layer.y = num('vdPropY', layer.y);
    layer.w = Math.max(20, num('vdPropW', layer.w));
    layer.h = Math.max(20, num('vdPropH', layer.h));
    layer.opacity = Math.max(0, Math.min(1, Number(byId('vdPropO')?.value || layer.opacity)));
    if(layer.type === 'text'){
      layer.text = byId('vdPropText')?.value || layer.text || '';
    }
    renderAll();
  }

  function clearPreview(){
    state.previewLayers = [];
    state.selectedLayerId = '';
    renderAll();
  }

  function saveScene(){
    const name = (byId('vdSceneName')?.value || '').trim() || '未命名节目';
    state.sceneName = name;
    const snap = { id:uid('scene'), name, layers: cloneLayers(state.previewLayers) };
    state.scenes.unshift(snap);
    if(state.scenes.length > 50) state.scenes.length = 50;
    saveState();
    renderAll();
    toast('节目已保存');
  }

  function loadScene(sceneId){
    const scene = state.scenes.find(s=>s.id===sceneId);
    if(!scene) return;
    state.previewLayers = cloneLayers(scene.layers);
    state.selectedLayerId = state.previewLayers[0]?.id || '';
    if(!state.sceneLock) state.sceneName = scene.name;
    renderAll();
  }

  function takeScene(sceneId){
    loadScene(sceneId);
    takeToProgram();
  }

  function queueScene(sceneId){
    const scene = state.scenes.find(s=>s.id===sceneId);
    if(!scene) return;
    state.queue.push({ id:uid('q'), name:scene.name, layers:cloneLayers(scene.layers) });
    saveState();
    renderAll();
  }

  function queueCurrent(){
    const name = (byId('vdSceneName')?.value || '').trim() || '当前节目';
    state.queue.push({ id:uid('q'), name, layers:cloneLayers(state.previewLayers) });
    saveState(); renderAll();
  }

  function queueNext(){
    if(!state.queue.length){ toast('当前队列为空'); return; }
    const item = state.queue.shift();
    state.programLayers = cloneLayers(item.layers);
    state.programTitle = item.name || 'PROGRAM';
    state.playing = true;
    saveState();
    renderProgram();
    pushOutputState();
    renderQueue();
  }

  function moveQueue(id, dir){
    const idx = state.queue.findIndex(q=>q.id===id);
    if(idx < 0) return;
    const to = idx + dir;
    if(to < 0 || to >= state.queue.length) return;
    const [item] = state.queue.splice(idx,1);
    state.queue.splice(to,0,item);
    saveState(); renderQueue();
  }

  function removeQueue(id){
    state.queue = state.queue.filter(q=>q.id !== id);
    saveState(); renderQueue();
  }

  function takeToProgram(){
    if(!state.previewLayers.length){
      toast('预监区当前没有内容');
      return;
    }
    const previewRect = stageRect(byId('vdPreviewStage'));
    const programRect = stageRect(byId('vdProgramStage'));
    state.programLayers = scaleLayerRects(state.previewLayers, previewRect, programRect);
    state.programTitle = (byId('vdSceneName')?.value || '').trim() || state.sceneName || 'PROGRAM';
    state.playing = true;
    renderProgram();
    pushOutputState();
    saveState();
    toast('已上屏');
  }

  function downScreen(){
    state.programLayers = [];
    state.programTitle = '';
    state.playing = false;
    renderProgram();
    pushOutputState();
    saveState();
    toast('已下屏');
  }

  function setProgramMediaState(action){
    if(action === 'toggle') action = state.playing ? 'pause' : 'play';
    const stage = byId('vdProgramStage');
    qa('video', stage).forEach(v => {
      try{
        v.muted = true;
        if(action==='play') v.play().catch(()=>{});
        if(action==='pause') v.pause();
        if(action==='replay'){ v.currentTime = 0; v.play().catch(()=>{}); }
      }catch{}
    });
    syncProgramLayerPlaybackState();
    if(action==='play') state.playing = true;
    if(action==='pause') state.playing = false;
    if(action==='replay') state.playing = true;
    pushOutputState();
    renderStatus();
    saveState();
  }

  async function openOutput(){
    if(!isDesktop){ toast('当前不是桌面环境'); return; }
    const res = await window.anningDesktop.openOutputWindow();
    if(res?.ok){
      state.outputOpened = true;
      await refreshDisplays(state.outputDisplayId);
      const target = selectedOutputDisplay();
      if(target){
        await window.anningDesktop.moveWindowToDisplay('video_output', target.id).catch(()=>{});
        state.outputDisplayId = String(target.id);
      }
      pushOutputState();
      renderStatus();
      saveState();
    }
  }

  async function locateOutput(){
    if(!isDesktop){ toast('当前不是桌面环境'); return; }
    await openOutput();
    const target = await ensureOutputDisplayReady();
    if(!target) return toast('没有检测到显示器');
    const moved = await window.anningDesktop.moveWindowToDisplay('video_output', target.id);
    if(moved?.ok){ state.outputOpened = true; state.outputDisplayId = String(target.id); toast(`已定位到：${target.label}`); renderStatus(); saveState(); }
  }

  async function toggleOutputFs(){
    if(!isDesktop){ toast('当前不是桌面环境'); return; }
    await openOutput();
    const target = await ensureOutputDisplayReady();
    if(target){
      await window.anningDesktop.moveWindowToDisplay('video_output', target.id);
      state.outputDisplayId = String(target.id);
    }
    const want = !state.outputFs;
    if(want && !state.pure){
      state.pure = true;
      await pushOutputState();
    }
    const res = await window.anningDesktop.setWindowFullscreen('video_output', want);
    state.outputFs = !!res?.isFullScreen;
    if(state.outputFs && target) toast(`已在 ${target.label} 全屏输出`);
    if(!state.outputFs) toast('已退出输出全屏');
    renderStatus();
    saveState();
  }

  async function setOutputPure(value){
    state.pure = !!value;
    pushOutputState();
    renderStatus();
    saveState();
  }

  function toggleFlag(key){
    state[key] = !state[key];
    renderProgram();
    pushOutputState();
    saveState();
  }

  async function pushOutputState(){
    if(!isDesktop) return;
    syncProgramLayerPlaybackState();
    const rect = stageRect(byId('vdProgramStage'));
    const payload = {
      title: state.programTitle || 'PROGRAM OUTPUT',
      baseSize: { width: rect.width, height: rect.height },
      layers: cloneLayers(state.programLayers),
      black: state.black,
      pure: state.pure,
      mute: state.mute,
      safe: state.safe,
      clock: state.clock,
      playing: !!state.playing,
      label: state.outputLabel || ''
    };
    await window.anningDesktop.updateOutputState(payload);
  }

  function renderLibrary(){
    const box = byId('vdLibList');
    if(!box) return;
    box.innerHTML = '';
    const qv = (byId('vdSourceSearch')?.value || '').trim().toLowerCase();
    state.sources.filter(s => !qv || s.name.toLowerCase().includes(qv)).forEach(src => {
      const row = document.createElement('div');
      row.className = `vd-item${state.selectedSourceId===src.id ? ' sel':''}`;
      const thumb = src.type==='image'
        ? `<img src="${src.url}">`
        : src.type==='video'
          ? `<video src="${src.url}" muted></video>`
          : src.type==='capture'
            ? (src.thumbnail ? `<img src="${src.thumbnail}">` : `<span>${src.captureKind === 'screen' ? 'SCREEN' : 'WINDOW'}</span>`)
            : `<span>${src.type.toUpperCase()}</span>`;
      const capStatus = src.type === 'capture' ? (src.online === false ? '离线' : '在线') : '';
      const meta = src.type === 'capture'
        ? `${src.captureKind === 'screen' ? '整屏/区域' : '窗口'} · ${src.crop ? '已裁切' : '原始'} · ${src.width||'-'}×${src.height||'-'} · ${capStatus}`
        : `${src.type} · ${src.width||'-'}×${src.height||'-'}`;
      row.innerHTML = `
        <div class="vd-itemTop">
          <div class="vd-thumb">${thumb}</div>
          <div style="flex:1;min-width:0">
            <div class="vd-name">${escapeHtml(src.name)}${src.type==='capture' ? ` <span class="vd-capBadge ${src.online===false ? 'off':''}">${escapeHtml(capStatus)}</span>` : ''}</div>
            <div class="vd-meta">${escapeHtml(meta)}</div>
          </div>
        </div>
        <div class="vd-actions">
          <button class="vd-mini" data-act="fit">原比适配</button>
          <button class="vd-mini" data-act="screenfit">全屏映射</button>
          <button class="vd-mini" data-act="fill">铺满</button>
          ${src.type==='capture' ? `<button class="vd-mini" data-act="refresh">重连</button><button class="vd-mini" data-act="crop">重选区域</button>` : ``}
          <button class="vd-mini" data-act="del">删除</button>
        </div>`;
      row.addEventListener('click', (e)=>{
        if((e.target).closest('button')) return;
        state.selectedSourceId = src.id; renderLibrary();
      });
      row.querySelector('[data-act="fit"]').addEventListener('click', ()=>{ state.selectedSourceId = src.id; addSelectedSource('fit'); });
      row.querySelector('[data-act="screenfit"]').addEventListener('click', ()=>{ state.selectedSourceId = src.id; addSelectedSource('screenfit'); });
      row.querySelector('[data-act="fill"]').addEventListener('click', ()=>{ state.selectedSourceId = src.id; addSelectedSource('fill'); });
      const refreshBtn = row.querySelector('[data-act="refresh"]');
      if(refreshBtn) refreshBtn.addEventListener('click', async ()=>{
        await refreshCaptureSources(src.captureSourceId || '');
        const now = captureSources.find(item => item.id === (src.captureSourceId || ''));
        if(now){ src.online = true; toast('映射源已重连'); }
        else { src.online = false; toast('当前映射源仍离线'); }
        saveState(); renderAll();
      });
      const cropBtn = row.querySelector('[data-act="crop"]');
      if(cropBtn) cropBtn.addEventListener('click', ()=>{
        state.captureSelection = src.captureSourceId || '';
        byId('vdCaptureSelect') && (byId('vdCaptureSelect').value = state.captureSelection);
        openRegionCropper();
      });
      row.querySelector('[data-act="del"]').addEventListener('click', ()=> removeSource(src.id));
      box.appendChild(row);
    });
  }

  function renderStage(stageId, layers, selectedId, interactive){
    const stage = byId(stageId);
    if(!stage) return;
    stage.innerHTML = '<div class="vd-safeBox" id="'+stageId+'Safe"></div><div class="vd-guideX" id="'+stageId+'GuideX"></div><div class="vd-guideY" id="'+stageId+'GuideY"></div><div class="vd-hud" id="'+stageId+'Hud"></div><div class="vd-black" id="'+stageId+'Black"></div>';
    layers.forEach(layer => {
      const box = document.createElement('div');
      box.className = `vd-layer${selectedId===layer.id ? ' sel':''}`;
      box.style.left = `${layer.x}px`;
      box.style.top = `${layer.y}px`;
      box.style.width = `${layer.w}px`;
      box.style.height = `${layer.h}px`;
      box.style.opacity = String(layer.opacity == null ? 1 : layer.opacity);
      box.dataset.layerId = layer.id;
      let node;
      if(layer.type === 'video'){
        node = document.createElement('video');
        node.src = layer.url;
        node.muted = true;
        node.loop = !!layer.loop;
        node.autoplay = stageId === 'vdProgramStage';
        node.playsInline = true;
        applyMediaStyle(node, layer);
        if(stageId === 'vdProgramStage' && state.playing){ setTimeout(()=> node.play().catch(()=>{}), 10); }
      } else if(layer.type === 'capture'){
        if(layer.online === false){
          node = document.createElement('div');
          node.className='vd-text';
          node.innerHTML = `<div style="font-weight:900;margin-bottom:6px">映射源离线</div><div style="font-size:12px;opacity:.8">${escapeHtml(layer.name || '窗口映射')}</div>`;
        } else {
          node = document.createElement('video');
          node.dataset.captureId = layer.captureSourceId || '';
          node.muted = true;
          node.loop = true;
          node.autoplay = true;
          node.playsInline = true;
          applyMediaStyle(node, layer);
          if(stageId === 'vdProgramStage' && state.playing){ setTimeout(()=> node.play().catch(()=>{}), 10); }
        }
      } else if(layer.type === 'image'){
        node = document.createElement('img');
        node.src = layer.url;
        applyMediaStyle(node, layer);
      } else if(layer.type === 'pdf'){
        node = document.createElement('embed'); node.src = layer.url;
      } else if(layer.type === 'web'){
        node = document.createElement('iframe'); node.src = layer.url;
      } else if(layer.type === 'text'){
        node = document.createElement('div'); node.className='vd-text'; node.textContent = layer.text || '';
      } else if(layer.type === 'clock'){
        node = document.createElement('div'); node.className='vd-clock'; node.textContent = new Date().toLocaleTimeString('zh-CN', {hour12:false});
        setInterval(()=>{ node.textContent = new Date().toLocaleTimeString('zh-CN', {hour12:false}); }, 1000);
      } else {
        node = document.createElement('div'); node.className='vd-text'; node.textContent = layer.name || '素材';
      }
      box.appendChild(node);
      if(interactive){
        ['br','tr','bl'].forEach(pos=>{
          const h = document.createElement('span');
          h.className = `vd-handle ${pos}`;
          h.dataset.handle = pos;
          box.appendChild(h);
        });
        box.addEventListener('pointerdown', onStagePointerDown);
      }
      stage.appendChild(box);
    });
    hydrateCaptureVideos(stage).catch(()=>{});
    const safeBox = byId(stageId+'Safe');
    if(safeBox) safeBox.style.display = state.safe ? 'block' : 'none';
    const black = byId(stageId+'Black');
    if(black) black.style.display = state.black && stageId==='vdProgramStage' ? 'block' : 'none';
    const hud = byId(stageId+'Hud');
    if(hud){
      hud.style.display = state.clock || state.outputLabel ? 'block' : 'none';
      hud.textContent = state.clock ? new Date().toLocaleTimeString('zh-CN', {hour12:false}) : (state.outputLabel || '');
    }
  }

  function renderLayerList(){
    const box = byId('vdLayerList'); if(!box) return;
    box.innerHTML='';
    state.previewLayers.slice().reverse().forEach(layer=>{
      const row = document.createElement('div');
      row.className = `vd-item${state.selectedLayerId===layer.id?' sel':''}`;
      row.innerHTML = `<div class="vd-name">${layer.name}</div><div class="vd-meta">${layer.type} · ${Math.round(layer.x)},${Math.round(layer.y)} · ${Math.round(layer.w)}×${Math.round(layer.h)}</div>
      <div class="vd-actions">
        <button class="vd-mini" data-act="up">上移</button>
        <button class="vd-mini" data-act="down">下移</button>
        <button class="vd-mini" data-act="del">删除</button>
      </div>`;
      row.addEventListener('click', (e)=>{ if((e.target).closest('button')) return; state.selectedLayerId = layer.id; renderAll(); });
      row.querySelector('[data-act="up"]').addEventListener('click', ()=> moveLayer(layer.id, +1));
      row.querySelector('[data-act="down"]').addEventListener('click', ()=> moveLayer(layer.id, -1));
      row.querySelector('[data-act="del"]').addEventListener('click', ()=> removeLayer(layer.id));
      box.appendChild(row);
    });
  }

  function renderScenes(){
    const box = byId('vdSceneList'); if(!box) return;
    box.innerHTML='';
    state.scenes.forEach(scene=>{
      const row = document.createElement('div');
      row.className = 'vd-item';
      row.innerHTML = `<div class="vd-name">${scene.name}</div><div class="vd-meta">${scene.layers.length} 层</div>
      <div class="vd-actions">
        <button class="vd-mini" data-act="load">装入</button>
        <button class="vd-mini" data-act="take">上屏</button>
        <button class="vd-mini" data-act="queue">入队</button>
      </div>`;
      row.querySelector('[data-act="load"]').addEventListener('click', ()=> loadScene(scene.id));
      row.querySelector('[data-act="take"]').addEventListener('click', ()=> takeScene(scene.id));
      row.querySelector('[data-act="queue"]').addEventListener('click', ()=> queueScene(scene.id));
      box.appendChild(row);
    });
  }

  function renderQueue(){
    const box = byId('vdQueueList'); if(!box) return;
    box.innerHTML='';
    state.queue.forEach(item=>{
      const row = document.createElement('div');
      row.className = 'vd-item';
      row.innerHTML = `<div class="vd-name">${item.name}</div><div class="vd-meta">${item.layers.length} 层</div>
      <div class="vd-actions">
        <button class="vd-mini" data-act="take">切到这一条</button>
        <button class="vd-mini" data-act="up">上移</button>
        <button class="vd-mini" data-act="down">下移</button>
        <button class="vd-mini" data-act="del">删除</button>
      </div>`;
      row.querySelector('[data-act="take"]').addEventListener('click', ()=>{
        state.programLayers = cloneLayers(item.layers); state.programTitle = item.name; state.playing = true;
        renderProgram(); pushOutputState(); saveState();
      });
      row.querySelector('[data-act="up"]').addEventListener('click', ()=> moveQueue(item.id,-1));
      row.querySelector('[data-act="down"]').addEventListener('click', ()=> moveQueue(item.id,+1));
      row.querySelector('[data-act="del"]').addEventListener('click', ()=> removeQueue(item.id));
      box.appendChild(row);
    });
  }

  function renderProps(){
    const layer = selectedLayer();
    byId('vdSceneName').value = state.sceneName || '';
    byId('vdSceneLock').checked = !!state.sceneLock;
    const playToggle = byId('vdPlayToggle');
    if(playToggle){
      playToggle.textContent = state.playing ? '暂停' : '播放';
      playToggle.classList.toggle('primary', !!state.playing);
    }
    byId('vdLoop').classList.toggle('primary', !!state.loop);
    byId('vdAutoNext').classList.toggle('primary', !!state.autoNext);
    byId('vdBlack').classList.toggle('warn', !!state.black);
    byId('vdSafe').classList.toggle('primary', !!state.safe);
    byId('vdClock').classList.toggle('primary', !!state.clock);
    byId('vdMute').classList.toggle('primary', !!state.mute);
    byId('vdPure').classList.toggle('primary', !!state.pure);
    byId('vdOutputOpen').classList.toggle('primary', !!state.outputOpened);
    byId('vdOutputFs').textContent = state.outputFs ? '退出全屏' : '输出全屏';
    byId('vdProgramName').textContent = state.programTitle || 'PROGRAM';
    byId('vdOutputLabel').value = state.outputLabel || '';
    const wrap = byId('vdPropsWrap');
    if(!layer){
      wrap.innerHTML = `<div class="vd-note">当前没有选中图层。先从左侧素材库加入预监，或在预监舞台里点击一个图层。</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="vd-field"><label>图层名称</label><input id="vdPropName" class="vd-input" value="${layer.name || ''}"></div>
      <div class="vd-grid2">
        <div class="vd-field"><label>X</label><input id="vdPropX" class="vd-input" type="number" value="${Math.round(layer.x)}"></div>
        <div class="vd-field"><label>Y</label><input id="vdPropY" class="vd-input" type="number" value="${Math.round(layer.y)}"></div>
      </div>
      <div class="vd-grid2">
        <div class="vd-field"><label>宽</label><input id="vdPropW" class="vd-input" type="number" value="${Math.round(layer.w)}"></div>
        <div class="vd-field"><label>高</label><input id="vdPropH" class="vd-input" type="number" value="${Math.round(layer.h)}"></div>
      </div>
      <div class="vd-field"><label>透明度 (0-1)</label><input id="vdPropO" class="vd-input" type="number" step="0.05" min="0" max="1" value="${layer.opacity ?? 1}"></div>
      ${layer.type==='text' ? `<div class="vd-field"><label>文本内容</label><input id="vdPropText" class="vd-input" value="${(layer.text||'').replace(/"/g,'&quot;')}"></div>` : ''}
      ${layer.type==='capture' ? `<div class="vd-note">当前映射源：${escapeHtml(layer.name)} ｜ ${layer.online===false ? '离线' : '在线'}。若希望隐藏原窗口，请改用“整屏 + 区域映射”；窗口最小化后不保证稳定。</div><div class="vd-actions"><button class="vd-mini" id="vdCaptureReconnect">刷新映射状态</button></div>` : ''}
      <div class="vd-actions">
        <button class="vd-mini" id="vdApplyProps">应用参数</button>
        <button class="vd-mini" id="vdModeFit">原比适配</button>
        <button class="vd-mini" id="vdModeScreenFit">适配屏幕全屏映射</button>
        <button class="vd-mini" id="vdModeOriginal">原始尺寸</button>
        <button class="vd-mini" id="vdModeFill">铺满全屏</button>
      </div>
      <div class="vd-divider"></div>
      <div class="vd-note">拖动图层可自动吸附到中心线；右下 / 右上 / 左下角点可直接改大小。</div>
    `;
    byId('vdApplyProps').addEventListener('click', ()=>{
      layer.name = byId('vdPropName').value || layer.name;
      applyLayerProps();
    });
    byId('vdCaptureReconnect')?.addEventListener('click', async ()=>{
      await refreshCaptureSources(layer.captureSourceId || '');
      const now = captureSources.find(item => item.id === (layer.captureSourceId || ''));
      layer.online = !!now;
      toast(layer.online ? '映射源在线' : '映射源离线');
      saveState(); renderAll();
    });
    byId('vdModeFit').addEventListener('click', ()=> applyLayerMode('fit'));
    byId('vdModeScreenFit').addEventListener('click', ()=> applyScreenMap());
    byId('vdModeOriginal').addEventListener('click', ()=> applyLayerMode('original'));
    byId('vdModeFill').addEventListener('click', ()=> applyLayerMode('fill'));
  }

  function renderProgram(){
    renderStage('vdProgramStage', state.programLayers, '', false);
    renderStatus();
    const stage = byId('vdProgramStage');
    hydrateCaptureVideos(stage).catch(()=>{});
    qa('video', stage).forEach(v=>{
      v.muted = true;
      if(state.playing) v.play().catch(()=>{});
      else v.pause();
      if(!v.dataset.captureId){
        v.onended = () => {
          if(state.loop){
            try{ v.currentTime = 0; v.play().catch(()=>{}); }catch{}
          } else if(state.autoNext){
            queueNext();
          }
        };
      }
    });
  }

  function renderStatus(){
    byId('vdPlayStatus').textContent = state.playing ? '播放中' : (state.programLayers.length ? '已暂停' : '未上屏');
    const caps = state.sources.filter(s => s.type === 'capture');
    const onlineCount = caps.filter(s => s.online !== false).length;
    const offlineCount = caps.filter(s => s.online === false).length;
    byId('vdBottomStatus').innerHTML = `
      <span class="vd-hotkey">图层 ${state.previewLayers.length}</span>
      <span class="vd-hotkey">节目 ${state.scenes.length}</span>
      <span class="vd-hotkey">队列 ${state.queue.length}</span>
      <span class="vd-hotkey">${state.programTitle || 'PROGRAM'}</span>
      <span class="vd-hotkey">映射 在线 ${onlineCount} / 离线 ${offlineCount}</span>
      <span class="vd-hotkey">备份 ${backupItems.length}</span>
      <span class="vd-hotkey">${state.outputOpened ? '输出窗已打开' : '输出窗未打开'}</span>`;
    const fsBtn = byId('vdOutputFs'); if(fsBtn) fsBtn.textContent = state.outputFs ? '退出全屏' : '输出全屏';
    const pureBtn = byId('vdPure'); if(pureBtn) pureBtn.textContent = state.pure ? '恢复工具栏' : '纯净输出';
    const playToggle = byId('vdPlayToggle');
    if(playToggle){
      playToggle.textContent = state.playing ? '暂停' : '播放';
      playToggle.classList.toggle('primary', !!state.playing);
    }
    const downBtn = byId('vdDownScreen'); if(downBtn) downBtn.classList.toggle('danger', true);
  }

  function renderAll(){
    applyLayout();
    renderLibrary();
    renderStage('vdPreviewStage', state.previewLayers, state.selectedLayerId, true);
    renderLayerList();
    renderScenes();
    renderQueue();
    renderProps();
    renderProgram();
    renderStatus();
  }

  function pushGuides(stageId, x, y){
    const stage = byId(stageId);
    const rect = stageRect(stage);
    const gx = byId(stageId+'GuideX');
    const gy = byId(stageId+'GuideY');
    if(gx){ gx.style.display = x == null ? 'none' : 'block'; gx.style.left = `${x}px`; }
    if(gy){ gy.style.display = y == null ? 'none' : 'block'; gy.style.top = `${y}px`; }
    return rect;
  }

  function onStagePointerDown(e){
    const layerEl = e.currentTarget;
    const layerId = layerEl.dataset.layerId;
    const layer = state.previewLayers.find(l=>l.id===layerId);
    if(!layer) return;
    state.selectedLayerId = layerId;
    const stage = byId('vdPreviewStage');
    const rect = stageRect(stage);
    const handle = e.target?.dataset?.handle || '';
    const startX = e.clientX, startY = e.clientY;
    const start = { x:layer.x, y:layer.y, w:layer.w, h:layer.h };
    state.drag = { layerId, handle, startX, startY, start, rect };
    window.addEventListener('pointermove', onStagePointerMove);
    window.addEventListener('pointerup', onStagePointerUp, { once:true });
    renderAll();
    e.preventDefault();
  }

  function onStagePointerMove(e){
    const d = state.drag;
    if(!d) return;
    const layer = state.previewLayers.find(l=>l.id===d.layerId);
    if(!layer) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if(!d.handle){
      layer.x = d.start.x + dx;
      layer.y = d.start.y + dy;
    } else if(d.handle === 'br'){
      layer.w = Math.max(40, d.start.w + dx);
      layer.h = Math.max(30, d.start.h + dy);
    } else if(d.handle === 'tr'){
      layer.w = Math.max(40, d.start.w + dx);
      layer.h = Math.max(30, d.start.h - dy);
      layer.y = d.start.y + dy;
    } else if(d.handle === 'bl'){
      layer.w = Math.max(40, d.start.w - dx);
      layer.h = Math.max(30, d.start.h + dy);
      layer.x = d.start.x + dx;
    }
    const centerX = Math.round((layer.x + layer.w/2));
    const centerY = Math.round((layer.y + layer.h/2));
    let snapX = null, snapY = null;
    if(Math.abs(centerX - d.rect.width/2) <= 8){
      layer.x = Math.round(d.rect.width/2 - layer.w/2); snapX = Math.round(d.rect.width/2);
    }
    if(Math.abs(centerY - d.rect.height/2) <= 8){
      layer.y = Math.round(d.rect.height/2 - layer.h/2); snapY = Math.round(d.rect.height/2);
    }
    pushGuides('vdPreviewStage', snapX, snapY);
    renderStage('vdPreviewStage', state.previewLayers, state.selectedLayerId, true);
    renderProps();
  }

  function onStagePointerUp(){
    state.drag = null;
    pushGuides('vdPreviewStage', null, null);
    window.removeEventListener('pointermove', onStagePointerMove);
    renderAll();
  }

  function onMainSplitMove(event){
    const drag = state.splitDrag;
    if(!drag) return;
    const deltaY = event.clientY - drag.startY;
    state.bottomPanelHeight = clampBottomPanelHeight(drag.startBottom - deltaY);
    applyLayout();
  }

  function onMainSplitUp(){
    if(!state.splitDrag) return;
    state.splitDrag = null;
    window.removeEventListener('pointermove', onMainSplitMove);
    window.removeEventListener('pointerup', onMainSplitUp);
    saveState();
    renderStatus();
  }

  function startMainSplitResize(event){
    const split = byId('vdMainSplit');
    if(!split) return;
    event.preventDefault();
    state.splitDrag = {
      startY: event.clientY,
      startBottom: clampBottomPanelHeight(state.bottomPanelHeight)
    };
    try{ split.setPointerCapture?.(event.pointerId); }catch{}
    window.addEventListener('pointermove', onMainSplitMove);
    window.addEventListener('pointerup', onMainSplitUp);
  }

  function buildUI(){
    const tabsHost = byId('tabMusic')?.parentElement;
    const viewsHost = byId('viewMusic')?.parentElement;
    if(!tabsHost || !viewsHost) return false;

    byId('tabVideoModule')?.remove();
    byId('viewVideoModule')?.remove();

    let tab = byId('tabVideoDesk');
    if(!tab){
      tab = document.createElement('button');
      tab.id = 'tabVideoDesk';
      tab.className = 'tab';
      tab.type = 'button';
      tab.textContent = '🎬 视频系统';
      tabsHost.appendChild(tab);
    }

    let view = byId('viewVideoDesk');
    if(!view){
      view = document.createElement('section');
      view.id = 'viewVideoDesk';
      view.className = 'view';
      view.style.display = 'none';
      viewsHost.appendChild(view);
    }

    view.style.display = view.classList.contains('active') ? 'block' : 'none';
    view.innerHTML = `
      <div class="vd-shell">
        <aside class="vd-left vd-card">
          <div class="vd-head">
            <div class="vd-title">Media Library</div>
            <div class="vd-tools">
              <button class="vd-mini" id="vdImportBtn">导入</button>
              <input id="vdFileInput" type="file" accept="video/*,image/*,.pdf" multiple hidden>
            </div>
          </div>
          <div style="padding:10px 10px 0 10px;display:flex;gap:8px;flex-wrap:wrap">
            <input id="vdSourceSearch" class="vd-input" placeholder="搜索素材">
            <button class="vd-mini" id="vdAddText">文本</button>
            <button class="vd-mini" id="vdAddClock">时钟</button>
            <button class="vd-mini" id="vdAddWeb">网页</button>
          </div>
          <div class="vd-libList" id="vdLibList"></div>
          <div class="vd-statusbar">
            <span class="vd-hotkey">导入后点“原比适配”即可入预监</span>
          </div>
        </aside>

        <main class="vd-center">
          <section class="vd-stageCard vd-card">
            <div class="vd-stageInfo">
              <div class="vd-stageTitle">PREVIEW</div>
              <div class="vd-stageMeta">拖动 / 拉伸 / 中心吸附</div>
            </div>
            <div class="vd-stage" id="vdPreviewStage"></div>
            <div class="vd-transport">
              <div class="vd-rowBtns">
                <button class="vd-btn" id="vdAddFit">原比适配入预监</button>
                <button class="vd-btn" id="vdAddFill">铺满全屏入预监</button>
                <button class="vd-btn" id="vdClearPreview">清空预监</button>
              </div>
              <div class="vd-rowBtns">
                <input class="vd-input" id="vdSceneName" placeholder="节目名称">
                <label class="vd-pill"><input id="vdSceneLock" type="checkbox" style="margin-right:6px">锁定节目名</label>
                <button class="vd-btn primary" id="vdTake">TAKE 上屏</button>
                <button class="vd-btn" id="vdSaveScene">保存节目</button>
                <button class="vd-btn" id="vdQueueCurrent">当前节目入队</button>
              </div>
            </div>
          </section>

          <aside class="vd-middle">
            <section class="vd-card vd-middleCard">
              <div class="vd-middleTitle">输出控制</div>
              <div class="vd-middleGroup">
                <button class="vd-btn" id="vdOutputOpen">打开输出窗</button>
                <button class="vd-btn" id="vdLocateOut">外屏定位</button>
                <button class="vd-btn" id="vdOutputFs">输出全屏</button>
                <button class="vd-btn" id="vdAdaptOut">外屏适配</button>
                <button class="vd-btn" id="vdPure">纯净输出</button>
              </div>
            </section>
            <section class="vd-card vd-middleCard">
              <div class="vd-middleTitle">辅助功能</div>
              <div class="vd-middleGroup">
                <button class="vd-btn warn" id="vdBlack">黑场</button>
                <button class="vd-btn" id="vdSafe">安全框</button>
                <button class="vd-btn" id="vdClock">时钟</button>
                <button class="vd-btn" id="vdMute">静音</button>
              </div>
              <div class="vd-middleHint">主控界面保持静音，声音只跟随输出窗，避免重复叠音。</div>
            </section>
          </aside>

          <section class="vd-stageCard vd-card">
            <div class="vd-stageInfo">
              <div class="vd-stageTitle">PROGRAM</div>
              <div class="vd-stageMeta" id="vdProgramName">PROGRAM</div>
            </div>
            <div class="vd-stage" id="vdProgramStage"></div>
            <div class="vd-transport">
              <div class="vd-rowBtns">
                <button class="vd-btn" id="vdPlayToggle">播放</button>
                <button class="vd-btn" id="vdReplay">重播</button>
                <button class="vd-btn danger" id="vdDownScreen">下屏</button>
                <button class="vd-btn" id="vdQueueNext">下一条</button>
                <button class="vd-btn" id="vdLoop">循环</button>
                <button class="vd-btn" id="vdAutoNext">自动下一条</button>
              </div>
              <div class="vd-rowBtns">
                <span class="vd-pill" id="vdPlayStatus">已暂停</span>
              </div>
            </div>
          </section>
        </main>

        <div class="vd-mainSplit" id="vdMainSplit" title="上下拖动调整下方面板高度"></div>

        <aside class="vd-right vd-card">
          <div class="vd-head"><div class="vd-title">Properties</div></div>
          <div class="vd-rightBody">
            <div class="vd-captureBlock">
              <div class="vd-captureHead"><div class="vd-captureTitle">Quick Source</div></div>
              <div class="vd-field"><label>窗口 / 屏幕映射</label><select id="vdCaptureSelect" class="vd-select"></select></div>
              <div class="vd-actions">
                <button class="vd-mini" id="vdCaptureRefresh">刷新窗口</button>
                <button class="vd-mini" id="vdCaptureAdd">映射窗口</button>
                <button class="vd-mini" id="vdCaptureRegion">区域映射</button>
              </div>
              <div class="vd-note" id="vdCaptureHint">支持选择系统中已打开的窗口，或先选整块屏幕后再做区域映射。</div>
            </div>
            <div class="vd-captureBlock">
              <div class="vd-captureHead"><div class="vd-captureTitle">工程 / 备份</div></div>
              <div class="vd-actions">
                <button class="vd-mini" id="vdExportWorkspace">导出工程</button>
                <button class="vd-mini" id="vdImportWorkspace">导入工程</button>
                <button class="vd-mini" id="vdSaveSnapshot">保存快照</button>
              </div>
              <div class="vd-note">自动快照每 3 分钟执行一次；退出程序前也会保留最近工作状态。</div>
              <div class="vd-backList" id="vdBackupList"></div>
            </div>
            <div class="vd-field"><label>输出标签</label><input id="vdOutputLabel" class="vd-input" placeholder="右上角标签"></div>
            <div class="vd-field"><label>输出屏幕</label><select id="vdOutputDisplay" class="vd-select"></select></div>
            <div class="vd-actions">
              <button class="vd-mini" id="vdDisplayRefresh">刷新屏幕列表</button>
            </div>
            <div class="vd-note">桌面版优先通过 Electron 独立输出窗控制外显屏：打开、定位、全屏、纯净，都走桌面桥接。</div>
            <div class="vd-divider"></div>
            <div id="vdPropsWrap"></div>
          </div>
          <div class="vd-statusbar" id="vdBottomStatus"></div>
        </aside>

        <section class="vd-bottom">
          <div class="vd-bottomPanel vd-card">
            <div class="vd-head"><div class="vd-title">Layer Stack</div></div>
            <div class="vd-layerList" id="vdLayerList"></div>
          </div>
          <div class="vd-bottomPanel vd-card">
            <div class="vd-head">
              <div class="vd-title">Scenes / Queue</div>
              <div class="vd-tools"><button class="vd-mini" id="vdClearQueue">清空队列</button></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:0;flex:1">
              <div style="display:flex;flex-direction:column;min-height:0">
                <div class="vd-sceneList" id="vdSceneList"></div>
              </div>
              <div style="display:flex;flex-direction:column;min-height:0">
                <div class="vd-queueList" id="vdQueueList"></div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div class="vd-cropMask" id="vdCropMask">
        <div class="vd-cropPanel">
          <div class="vd-cropBar">
            <div>
              <div class="vd-title" id="vdCropTitle">区域映射</div>
              <div class="vd-cropMeta" id="vdCropSub">先在缩略图上拖出你要投放的区域。</div>
            </div>
            <div class="vd-rowBtns">
              <button class="vd-btn" id="vdCropCancel">取消</button>
              <button class="vd-btn primary" id="vdCropConfirm">加入素材库</button>
            </div>
          </div>
          <div class="vd-cropWrap" id="vdCropWrap">
            <img id="vdCropPreview" class="vd-cropCanvas" alt="capture preview">
            <div id="vdCropBox" class="vd-cropBox"></div>
          </div>
          <div class="vd-cropHint">
            <span id="vdCropReadout">区域：10%, 10% ｜ 50% × 50%</span>
            <span class="vd-capBadge">提示：若要隐藏原窗口，建议选择整屏后再做区域映射</span>
          </div>
        </div>
      </div>
    `;

    tab.addEventListener('click', ()=> window.setTab && window.setTab('videoDesk'));
    bindUI();
    applyLayout();
    refreshBackups();
    scheduleAutoSnapshot();
    window.addEventListener('beforeunload', ()=>{ try{ createWorkspaceSnapshot(false); }catch{} });
    return true;
  }

  function bindUI(){
    byId('vdImportBtn').addEventListener('click', ()=> byId('vdFileInput').click());
    byId('vdFileInput').addEventListener('change', (e)=> importFiles(e.target.files));
    byId('vdSourceSearch').addEventListener('input', renderLibrary);
    byId('vdAddText').addEventListener('click', ()=> addQuickSource('text'));
    byId('vdAddClock').addEventListener('click', ()=> addQuickSource('clock'));
    byId('vdAddWeb').addEventListener('click', ()=> addQuickSource('web'));
    byId('vdCaptureRefresh').addEventListener('click', async ()=>{ await refreshCaptureSources(); renderAll(); toast('窗口列表已刷新'); });
    byId('vdCaptureSelect').addEventListener('change', ()=> { state.captureSelection = byId('vdCaptureSelect').value || ''; updateCaptureHint(); saveState(); });
    byId('vdOutputDisplay').addEventListener('change', ()=> { state.outputDisplayId = byId('vdOutputDisplay').value || ''; saveState(); });
    byId('vdDisplayRefresh').addEventListener('click', async ()=> { await refreshDisplays(state.outputDisplayId); toast('已刷新屏幕列表'); });
    byId('vdCaptureAdd').addEventListener('click', createWindowMapping);
    byId('vdCaptureRegion').addEventListener('click', openRegionCropper);
    byId('vdExportWorkspace').addEventListener('click', exportWorkspaceFile);
    byId('vdImportWorkspace').addEventListener('click', importWorkspaceFileUI);
    byId('vdSaveSnapshot').addEventListener('click', ()=> createWorkspaceSnapshot(true));
    byId('vdCropCancel').addEventListener('click', closeRegionCropper);
    byId('vdCropConfirm').addEventListener('click', confirmRegionCrop);
    byId('vdCropWrap').addEventListener('pointerdown', onCropPointerDown);
    byId('vdAddFit').addEventListener('click', ()=> addSelectedSource('fit'));
    byId('vdAddFill').addEventListener('click', ()=> addSelectedSource('fill'));
    byId('vdClearPreview').addEventListener('click', clearPreview);
    byId('vdTake').addEventListener('click', takeToProgram);
    byId('vdSaveScene').addEventListener('click', saveScene);
    byId('vdQueueCurrent').addEventListener('click', queueCurrent);
    byId('vdMainSplit').addEventListener('pointerdown', startMainSplitResize);
    byId('vdMainSplit').addEventListener('dblclick', ()=>{ state.bottomPanelHeight = 220; applyLayout(); saveState(); toast('已恢复默认高度'); });
    byId('vdPlayToggle').addEventListener('click', ()=> setProgramMediaState('toggle'));
    byId('vdReplay').addEventListener('click', ()=> setProgramMediaState('replay'));
    byId('vdDownScreen').addEventListener('click', downScreen);
    byId('vdQueueNext').addEventListener('click', queueNext);
    byId('vdLoop').addEventListener('click', ()=> { state.loop=!state.loop; saveState(); renderProps(); renderStatus(); });
    byId('vdAutoNext').addEventListener('click', ()=> { state.autoNext=!state.autoNext; saveState(); renderProps(); renderStatus(); });
    byId('vdOutputOpen').addEventListener('click', openOutput);
    byId('vdLocateOut').addEventListener('click', locateOutput);
    byId('vdOutputFs').addEventListener('click', toggleOutputFs);
    byId('vdAdaptOut').addEventListener('click', adaptLayerToOutputDisplay);
    byId('vdPure').addEventListener('click', ()=> setOutputPure(!state.pure));
    byId('vdBlack').addEventListener('click', ()=> toggleFlag('black'));
    byId('vdSafe').addEventListener('click', ()=> toggleFlag('safe'));
    byId('vdClock').addEventListener('click', ()=> toggleFlag('clock'));
    byId('vdMute').addEventListener('click', ()=> toggleFlag('mute'));
    byId('vdOutputLabel').addEventListener('change', ()=> { state.outputLabel = byId('vdOutputLabel').value || ''; pushOutputState(); renderProps(); });
    byId('vdSceneName').addEventListener('change', ()=> { state.sceneName = byId('vdSceneName').value || ''; saveState(); });
    byId('vdSceneLock').addEventListener('change', ()=> { state.sceneLock = byId('vdSceneLock').checked; saveState(); });
    byId('vdClearQueue').addEventListener('click', ()=> { state.queue = []; saveState(); renderQueue(); });
    window.addEventListener('keydown', (e)=>{
      if(!byId('viewVideoDesk')?.classList.contains('active')) return;
      if(e.code === 'Space'){ e.preventDefault(); state.playing ? setProgramMediaState('pause') : setProgramMediaState('play'); }
      if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); takeToProgram(); }
      if(e.key === 'F9'){ e.preventDefault(); openOutput(); }
      if(e.key === 'F10'){ e.preventDefault(); toggleOutputFs(); }
    });
  }


  function syncViewVisibility(activeId){
    qa('.view').forEach((el)=>{
      const on = !!activeId && el.id === activeId;
      el.style.display = on ? 'block' : 'none';
      el.classList.toggle('active', on);
    });
  }

  function activateVideo(){
    qa('.tab').forEach(el=>{ el.classList.remove('active'); el.setAttribute('aria-selected','false'); });
    syncViewVisibility('viewVideoDesk');
    byId('tabVideoDesk')?.classList.add('active');
    byId('tabVideoDesk')?.setAttribute('aria-selected','true');
    renderAll();
  }


  function installMainTabCapture(){
    const map = {
      tabSchedule: 'schedule',
      tabCustomers: 'customers',
      tabHandbook: 'handbook',
      tabLines: 'lines',
      tabSocial: 'social',
      tabMusic: 'music',
      tabVideoDesk: 'videoDesk'
    };
    Object.entries(map).forEach(([id, target])=>{
      const el = byId(id);
      if(!el || el.dataset.vdBound === '1') return;
      el.dataset.vdBound = '1';
      el.addEventListener('click', (event)=>{
        event.preventDefault();
        event.stopImmediatePropagation();
        window.setTab && window.setTab(target);
      }, true);
    });
  }

  function installTabBridge(){
    window.setTab = function(which){
      if(which === 'videoDesk' || which === 'video'){
        activateVideo();
        try{ localStorage.setItem('lastTab','videoDesk'); }catch{}
        return;
      }
      byId('tabVideoDesk')?.classList.remove('active');
      byId('tabVideoDesk')?.setAttribute('aria-selected','false');
      byId('viewVideoDesk')?.classList.remove('active');
      byId('viewVideoDesk') && (byId('viewVideoDesk').style.display = 'none');
      const result = oldSetTab ? oldSetTab(which) : undefined;
      qa('.view').forEach((el)=>{
        if(el.id !== 'viewVideoDesk') el.style.display = el.classList.contains('active') ? 'block' : 'none';
      });
      return result;
    };
  }

  async function refreshOutputState(){
    if(!isDesktop) return;
    const res = await window.anningDesktop.getWindowState('video_output').catch(()=>null);
    state.outputOpened = !!res?.ok;
    state.outputFs = !!res?.isFullScreen;
    renderStatus();
    saveState();
  }

  async function init(){
    await loadState();
    if(!buildUI()) return;
    installTabBridge();
    state.built = true;
    renderAll();
    const captureSelect = byId('vdCaptureSelect');
    if(captureSelect) captureSelect.innerHTML = '<option value="">点击“刷新窗口”后选择</option>';
    refreshDisplays(state.outputDisplayId).catch(()=>{});
    refreshOutputState();
    window.anningDesktop?.onDesktopEvent?.((payload)=>{
      if(payload?.type === 'output-window-closed'){
        state.outputOpened = false; state.outputFs = false; renderStatus(); saveState();
      }
      if(payload?.type === 'output-state' && payload?.state){
        state.black = !!payload.state.black;
        state.safe = !!payload.state.safe;
        state.clock = !!payload.state.clock;
        state.mute = !!payload.state.mute;
        state.pure = !!payload.state.pure;
        state.outputLabel = payload.state.label || '';
        renderProps(); renderProgram(); renderStatus(); saveState();
      }
    });
    const lastTab = localStorage.getItem('lastTab');
    if(lastTab === 'videoDesk' && byId('viewVideoDesk')?.classList.contains('active')) activateVideo();
    setInterval(refreshOutputState, 2200);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
