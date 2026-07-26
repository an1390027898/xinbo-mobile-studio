(function(){
  if(window.anningDesktop) return;
  const NS='xinbo_mobile_desktop_adapter:';
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const read=k=>{try{return JSON.parse(localStorage.getItem(NS+k)||'null')}catch(_){return null}};
  const write=(k,v)=>{localStorage.setItem(NS+k,JSON.stringify(v));return true};
  const download=(name,data,type='application/json')=>{
    const blob=data instanceof Blob?data:new Blob([data],{type});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},100);
  };
  const chooseJson=()=>new Promise(resolve=>{
    const i=document.createElement('input');i.type='file';i.accept='.json,application/json';
    i.onchange=async()=>{try{resolve(JSON.parse(await i.files[0].text()))}catch(e){resolve(null)}};i.click();
  });
  const api={
    isMobileAdapter:true,
    getLicenseStatus:async()=>({ok:true,licensed:true,status:'active',edition:'mobile-full'}),
    activateLicense:async()=>({ok:true}),deactivateLicense:async()=>({ok:true}),
    readClipboardText:async()=>{try{return await navigator.clipboard.readText()}catch(_){return''}},
    writeClipboardText:async value=>{try{await navigator.clipboard.writeText(String(value||''));return{ok:true}}catch(e){return{ok:false,message:e.message}}},
    getDisplays:async()=>[{id:'mobile',label:'当前屏幕',bounds:{width:innerWidth,height:innerHeight}}],
    moveWindowToDisplay:async()=>({ok:false,mobile:true}),
    setWindowFullscreen:async(_n,value)=>{try{if(value)await document.documentElement.requestFullscreen();else await document.exitFullscreen();return{ok:true}}catch(e){return{ok:false}}},
    toggleWindowFullscreen:async()=>{try{document.fullscreenElement?await document.exitFullscreen():await document.documentElement.requestFullscreen();return{ok:true}}catch(e){return{ok:false}}},
    focusWindow:async()=>({ok:true}),getWindowState:async()=>({fullscreen:!!document.fullscreenElement}),
    listOpenWindows:async()=>['main'],listCaptureSources:async()=>[],
    getMediaPermissionStatus:async()=>({status:'prompt'}),
    requestMicrophoneAccess:async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());return{ok:true}}catch(e){return{ok:false,message:e.message}}},
    openTool:async url=>{window.open(url,'_blank','noopener');return{ok:true}},
    openOutputWindow:async()=>({ok:false,mobile:true,message:'移动端使用当前页全屏输出'}),
    closeOutputWindow:async()=>({ok:true}),updateOutputState:async p=>(write('outputState',p),{ok:true}),
    getOutputState:async()=>read('outputState')||{},
    getAppInfo:async()=>({name:'信伯礼控 Mobile Full',version:'6.0.0-mobile.1',platform:'mobile'}),
    getStartupSummary:async()=>({ok:true,mobile:true}),getRecoveryInfo:async()=>null,clearRecoveryInfo:async()=>({ok:true}),
    runSelfCheck:async()=>({ok:true,checks:[{name:'本地存储',ok:true},{name:'Web Audio',ok:!!window.AudioContext},{name:'麦克风',ok:!!navigator.mediaDevices}]}),
    runInstallPreflight:async()=>({ok:true,mobile:true}),exportDiagnosticsReport:async()=>({ok:true}),
    relaunchSafeMode:async()=>location.reload(),restoreLatestWorkspaceBackup:async()=>({ok:false}),
    openUserData:async()=>({ok:false,mobile:true}),openLogsDir:async()=>({ok:false,mobile:true}),openBackupsDir:async()=>({ok:false,mobile:true}),
    storeGet:async key=>clone(read('store:'+key)),
    storeSet:async(key,value)=>{write('store:'+key,value);return{ok:true,value}},
    storeMerge:async(key,value)=>{const next=Object.assign({},read('store:'+key)||{},value||{});write('store:'+key,next);return{ok:true,value:next}},
    writeLog:async line=>{const a=read('logs')||[];a.push({at:new Date().toISOString(),line});write('logs',a.slice(-500));return{ok:true}},
    navigateTo:async view=>{document.getElementById('tab'+String(view).charAt(0).toUpperCase()+String(view).slice(1))?.click();return{ok:true}},
    getPreferences:async()=>read('preferences')||{},setPreference:async(key,value)=>{const p=read('preferences')||{};p[key]=value;write('preferences',p);return{ok:true}},
    exportWorkspace:async(kind,data)=>{download(`信伯礼控_${kind}_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({kind,data,exportedAt:new Date().toISOString()},null,2));return{ok:true}},
    importWorkspace:async()=>{const v=await chooseJson();return v?{ok:true,data:v.data||v}:{ok:false,canceled:true}},
    listWorkspaceBackups:async()=>({ok:true,items:read('backups')||[]}),
    createWorkspaceBackup:async(kind,data)=>{const a=read('backups')||[];a.unshift({id:Date.now(),kind,data,createdAt:new Date().toISOString()});write('backups',a.slice(0,20));return{ok:true}},
    restoreWorkspaceBackup:async()=>({ok:false,mobile:true}),resetWindowState:async()=>({ok:true}),
    openWelcomeWindow:async()=>({ok:true}),openPreferencesWindow:async()=>({ok:true}),
    openAlmanacWindow:async()=>{
      if(location.hash==='#almanac-window')return{ok:true};
      location.hash='almanac-window';
      location.reload();
      return{ok:true};
    },
    openKnowledgeWindow:async()=>{location.href='./knowledge.html';return{ok:true}}
  };
  const KNOTES='knowledge:notes', KLINKS='knowledge:links';
  const defaultFolders=['00-收件箱','10-主持台词','20-婚礼项目复盘','30-音乐经验','40-自媒体素材','50-工作项目/Simple Studio/关联项目','60-客户沟通经验'];
  const knowledgeNotes=()=>read(KNOTES)||[];
  const saveKnowledge=a=>write(KNOTES,a);
  const normalizePath=(folder,title)=>`${String(folder||'00-收件箱').replace(/^\/+|\/+$/g,'')}/${String(title||'未命名').replace(/[\\/:*?"<>|]/g,'_')}.md`;
  const parseTasks=content=>String(content||'').split('\n').map((line,i)=>{
    const m=line.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/);return m?{taskIndex:i,text:m[2],done:m[1].toLowerCase()==='x'}:null;
  }).filter(Boolean);
  const parseLinks=content=>[...String(content||'').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(m=>m[1].trim());
  const noteView=n=>Object.assign({},n,{excerpt:String(n.content||'').replace(/^---[\s\S]*?---\s*/,'').replace(/[#>*_[\]`-]/g,' ').trim().slice(0,180),tasks:parseTasks(n.content),links:parseLinks(n.content)});
  const findNote=path=>knowledgeNotes().find(n=>n.path===path);
  const updateNote=(path,patch)=>{
    const a=knowledgeNotes(),i=a.findIndex(n=>n.path===path);if(i<0)return null;
    a[i]=Object.assign({},a[i],patch,{mtime:Date.now()});saveKnowledge(a);return a[i];
  };
  Object.assign(api,{
    knowledgeGetConfig:async()=>({ok:true,mode:'builtin',builtin:true,vaultPath:'移动设备内置知识库',path:'移动设备内置知识库',folders:defaultFolders,recent:read('knowledge:recent')||[]}),
    knowledgeUseBuiltin:async()=>({ok:true,mode:'mobile'}),
    knowledgeChooseVault:async()=>({ok:false,reason:'移动端使用内置知识库；原生文件夹连接将在安装包中提供'}),
    knowledgeListNotes:async(query='')=>{
      const q=String(query||'').toLowerCase();let items=knowledgeNotes().filter(n=>!n.trashed).map(noteView);
      if(q)items=items.filter(n=>`${n.title} ${n.content} ${(n.tags||[]).join(' ')}`.toLowerCase().includes(q));
      return{ok:true,items,notes:items,total:items.length,signature:items.map(n=>`${n.path}:${n.mtime}`).join('|'),config:{folders:defaultFolders,recent:read('knowledge:recent')||[]}};
    },
    knowledgeReadNote:async relativePath=>{
      const n=findNote(relativePath);if(!n||n.trashed)return{ok:false,reason:'笔记不存在'};
      const recent=(read('knowledge:recent')||[]).filter(x=>x!==relativePath);recent.unshift(relativePath);write('knowledge:recent',recent.slice(0,30));
      return{ok:true,content:n.content||'',mtime:n.mtime||Date.now()};
    },
    knowledgeCreateNote:async payload=>{
      const path=normalizePath(payload.folder,payload.title);if(findNote(path))return{ok:false,reason:'同名笔记已存在'};
      const now=Date.now(),a=knowledgeNotes();a.unshift({path,title:String(payload.title||'未命名'),folder:payload.folder||'00-收件箱',tags:payload.tags||[],content:payload.content||'',favorite:false,ctime:now,mtime:now});saveKnowledge(a);
      return{ok:true,relativePath:path};
    },
    knowledgeAddTask:async text=>{
      let inbox=knowledgeNotes().find(n=>n.path==='00-收件箱/任务收集.md');
      if(!inbox){await api.knowledgeCreateNote({folder:'00-收件箱',title:'任务收集',tags:['待办'],content:''});inbox=findNote('00-收件箱/任务收集.md')}
      updateNote(inbox.path,{content:`${inbox.content||''}${inbox.content?'\n':''}- [ ] ${text}`});return{ok:true,relativePath:inbox.path};
    },
    knowledgeUpdateNote:async payload=>{
      const n=findNote(payload.relativePath);if(!n)return{ok:false,reason:'笔记不存在'};
      if(payload.expectedMtime&&n.mtime!==payload.expectedMtime)return{ok:false,reason:'笔记已在其他位置更新，请重新打开'};
      const out=updateNote(payload.relativePath,{content:payload.content||''});return{ok:true,mtime:out.mtime};
    },
    knowledgeToggleTask:async payload=>{
      const n=findNote(payload.relativePath);if(!n)return{ok:false,reason:'笔记不存在'};
      const lines=String(n.content||'').split('\n'),i=Number(payload.taskIndex);if(!lines[i])return{ok:false,reason:'待办不存在'};
      lines[i]=lines[i].replace(/^(\s*-\s+\[)[ xX](\])/,`$1${payload.done?'x':' '}$2`);updateNote(n.path,{content:lines.join('\n')});return{ok:true};
    },
    knowledgeSetTags:async payload=>updateNote(payload.relativePath,{tags:payload.tags||[]})?{ok:true}:{ok:false,reason:'笔记不存在'},
    knowledgeMoveNote:async payload=>{
      const n=findNote(payload.relativePath);if(!n)return{ok:false,reason:'笔记不存在'};
      const next=normalizePath(payload.folder,n.title);if(findNote(next))return{ok:false,reason:'目标目录已有同名笔记'};
      updateNote(n.path,{path:next,folder:payload.folder});return{ok:true,relativePath:next};
    },
    knowledgeTrashNote:async relativePath=>updateNote(relativePath,{trashed:true})?{ok:true}:{ok:false,reason:'笔记不存在'},
    knowledgeToggleFavorite:async relativePath=>{const n=findNote(relativePath);if(!n)return{ok:false};const favorite=!n.favorite;updateNote(relativePath,{favorite});return{ok:true,favorite}},
    knowledgeGetDashboard:async()=>{
      const items=knowledgeNotes().filter(n=>!n.trashed).map(noteView),tasks=items.flatMap(n=>n.tasks.map(t=>Object.assign({},t,{path:n.path,title:n.title})));
      const recent=(read('knowledge:recent')||[]).map(p=>items.find(n=>n.path===p)).filter(Boolean);
      return{ok:true,stats:{notes:items.length,inbox:items.filter(n=>n.folder==='00-收件箱').length,openTasks:tasks.filter(t=>!t.done).length},tasks,recent,inbox:items.filter(n=>n.folder==='00-收件箱')};
    },
    knowledgeGetGraph:async()=>{
      const items=knowledgeNotes().filter(n=>!n.trashed).map(noteView),byTitle=new Map(items.map(n=>[n.title,n]));
      const edges=[];items.forEach(n=>n.links.forEach(title=>{const to=byTitle.get(title);if(to)edges.push({from:n.path,to:to.path})}));
      return{ok:true,nodes:items.map(n=>({id:n.path,path:n.path,title:n.title})),edges};
    },
    knowledgeHealthCheck:async()=>{
      const items=knowledgeNotes().filter(n=>!n.trashed).map(noteView),linked=new Set();items.forEach(n=>n.links.forEach(x=>linked.add(x)));
      return{ok:true,stats:{notes:items.length,empty:items.filter(n=>!String(n.content).trim()).length,orphan:items.filter(n=>!n.links.length&&!linked.has(n.title)).length},empty:items.filter(n=>!String(n.content).trim()),orphans:items.filter(n=>!n.links.length&&!linked.has(n.title)),duplicates:[]};
    },
    knowledgeSmartAnalyze:async relativePath=>{
      const n=noteView(findNote(relativePath)||{}),words=String(n.content||'').replace(/\s+/g,' ').trim();
      const suggestedTags=[n.folder?.split('/').pop(),words.includes('音乐')?'音乐':words.includes('客户')?'客户沟通':words.includes('婚礼')?'婚礼':null].filter(Boolean);
      return{ok:true,summary:words.slice(0,120)||'暂无正文',typeSuggestion:n.folder||'未分类',suggestedTags:[...new Set(suggestedTags)],related:knowledgeNotes().filter(x=>x.path!==relativePath&&(x.tags||[]).some(t=>(n.tags||[]).includes(t))).slice(0,5).map(x=>({path:x.path,title:x.title,score:1}))};
    },
    knowledgeCaptureBusiness:async payload=>{
      let content=String(payload.content||'');if(!payload.allowSensitive)content=content.replace(/1\d{10}/g,'[手机号已隐藏]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[邮箱已隐藏]').replace(/XB-[A-Za-z0-9-]+/g,'[密钥已隐藏]');
      const folders={主持台词:'10-主持台词',婚礼项目复盘:'20-婚礼项目复盘',音乐经验:'30-音乐经验',自媒体素材:'40-自媒体素材',客户沟通经验:'60-客户沟通经验'};
      return api.knowledgeCreateNote({folder:folders[payload.type]||'00-收件箱',title:payload.title,tags:[payload.type],content});
    },
    knowledgeListBusinessLinks:async()=>({ok:true,items:read(KLINKS)||[]}),
    knowledgeGetBusinessRecords:async()=>{
      let main={};try{main=JSON.parse(localStorage.getItem('host_handbook_major_upgrade_v1')||'{}')}catch(_){}
      return{ok:true,bookings:Object.values(main.bookings||{}),customers:Object.values(main.customers||{})};
    },
    knowledgeLinkBusinessProject:async payload=>{
      const title=payload.title||'关联项目',folder='50-工作项目/Simple Studio/关联项目',created=await api.knowledgeCreateNote({folder,title,tags:['关联项目',payload.sourceType],content:`# ${title}\n\n关联来源：${payload.sourceType} / ${payload.sourceId}\n\n## 执行记录\n\n`});
      if(!created.ok)return created;const links=read(KLINKS)||[];links.push({sourceType:payload.sourceType,sourceId:payload.sourceId,notePath:created.relativePath});write(KLINKS,links);return created;
    },
    knowledgeCreateBackup:async()=>{download(`信伯礼控知识库_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({notes:knowledgeNotes(),links:read(KLINKS)||[]},null,2));return{ok:true}},
    knowledgeOpenFolder:async()=>({ok:false,reason:'移动端知识库位于应用沙盒中'}),
    knowledgeOpenInObsidian:async()=>({ok:false,reason:'移动端暂不支持直接打开 Obsidian'})
  });
  window.anningDesktop=api;
  window.electronAPI=api;
  const openHashView=()=>{
    const hash=String(location.hash||'').replace('#','').toLowerCase();
    const ids={music:'tabMusic',player:'tabMusic',schedule:'tabSchedule',customers:'tabCustomers',butler:'tabWeddingButler',lines:'tabLines',video:'tabVideoModule'};
    const target=document.getElementById(ids[hash]);if(target)target.click();
  };
  const scheduleHashView=()=>[120,450,1000,1800,3000,5000].forEach(ms=>setTimeout(openHashView,ms));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleHashView,{once:true});
  else scheduleHashView();
  window.addEventListener('hashchange',()=>setTimeout(openHashView,0));
  const installPwaSupport=()=>{
    if(!document.body)return;
    let installPrompt=null;
    const install=document.createElement('button');install.id='mobileInstallApp';install.type='button';install.textContent='安装到桌面';
    document.body.appendChild(install);
    const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
    const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    if(!standalone&&isiOS){install.dataset.show='1';install.textContent='添加到主屏幕';install.onclick=()=>alert('请点击 Safari 底部“分享”按钮，然后选择“添加到主屏幕”。');}
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;install.dataset.show='1'});
    install.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;install.dataset.show='0'});
    window.addEventListener('appinstalled',()=>{install.dataset.show='0'});
    if('serviceWorker'in navigator){
      navigator.serviceWorker.register('./sw.js').then(reg=>{
        reg.addEventListener('updatefound',()=>{
          const worker=reg.installing;if(!worker)return;
          worker.addEventListener('statechange',()=>{
            if(worker.state==='installed'&&navigator.serviceWorker.controller){
              let bar=document.getElementById('pwaUpdateNotice');
              if(!bar){bar=document.createElement('div');bar.id='pwaUpdateNotice';bar.innerHTML='<span>发现新版本，刷新后即可使用</span><button type="button">立即更新</button>';document.body.appendChild(bar);bar.querySelector('button').onclick=()=>location.reload()}
              bar.classList.add('show');
            }
          });
        });
      }).catch(()=>{});
    }
    const net=document.createElement('div');net.id='pwaNetworkState';net.textContent='离线使用中 · 数据保存在本机';document.body.appendChild(net);
    const syncNetwork=()=>net.classList.toggle('show',!navigator.onLine);
    addEventListener('online',syncNetwork);addEventListener('offline',syncNetwork);syncNetwork();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installPwaSupport,{once:true});else installPwaSupport();
  const installAlmanacBack=()=>{
    if(location.hash!=='#almanac-window'||!document.body||document.getElementById('mobileAlmanacBack'))return;
    const button=document.createElement('button');button.id='mobileAlmanacBack';button.type='button';button.textContent='← 返回工作台';
    button.style.cssText='position:fixed;z-index:2147483600;left:14px;top:calc(10px + env(safe-area-inset-top));min-height:44px;padding:0 15px;border:0;border-radius:999px;background:#171a24;color:#fff;font-weight:800;box-shadow:0 10px 26px rgba(0,0,0,.25)';
    button.onclick=()=>{location.href='./index.html'};
    document.body.appendChild(button);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(installAlmanacBack,300),{once:true});else setTimeout(installAlmanacBack,300);
  window.addEventListener('error',e=>{try{api.writeLog(String(e.message||e.error||'unknown error'))}catch(_){}});
})();
