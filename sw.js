const VERSION='xinbo-pwa-v19-resilient-offline-start'
const CORE=['./','./index.html','./update.html','./knowledge.html','./preferences.html','./output.html','./license.html','./splash.html','./mobile-full.css','./mobile-adapter.js','./manifest.webmanifest','./icon-512.png','./video-final.css','./video-final.js','./lame.min.js','./vendor/lunar-javascript/lunar.js']
self.addEventListener('install',event=>event.waitUntil(
  caches.open(VERSION)
    .then(cache=>Promise.allSettled(CORE.map(url=>cache.add(new Request(url,{cache:'reload'})))))
    .then(()=>self.skipWaiting())
))
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return
  const url=new URL(event.request.url)
  if(url.origin!==location.origin)return
  if(event.request.mode==='navigate'){
    event.respondWith(caches.match(event.request).then(hit=>{
      const fresh=fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>null)
      if(hit)return hit
      return caches.match('./index.html').then(fallback=>fallback||fresh.then(response=>response||new Response('<h1>首次缓存尚未完成</h1><p>请联网后用 Safari 打开一次，再重新进入桌面 App。</p>',{headers:{'Content-Type':'text/html;charset=utf-8'}})))
    }))
    return
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy))}return response})))
})
