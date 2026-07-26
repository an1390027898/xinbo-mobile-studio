const SCOPE_KEY=new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'root'
const CACHE_PREFIX=`xinbo-pwa-${SCOPE_KEY}-`
const VERSION=`${CACHE_PREFIX}v22-verified-install`
const ESSENTIAL=['./index.html','./install.html','./mobile-full.css','./mobile-adapter.js','./manifest.webmanifest','./icon-512.png']
const OPTIONAL=['./','./update.html','./knowledge.html','./preferences.html','./output.html','./license.html','./splash.html','./video-final.css','./video-final.js','./lame.min.js','./vendor/lunar-javascript/lunar.js']
self.addEventListener('install',event=>event.waitUntil(
  caches.open(VERSION)
    .then(cache=>cache.addAll(ESSENTIAL)
      .then(()=>Promise.allSettled(OPTIONAL.map(url=>cache.add(url)))))
    .then(()=>self.skipWaiting())
))
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return
  const url=new URL(event.request.url)
  if(url.origin!==location.origin)return
  if(event.request.mode==='navigate'){
    event.respondWith(caches.match(event.request).then(hit=>{
      if(hit)return hit
      return caches.match('./index.html').then(fallback=>{
        if(fallback)return fallback
        return fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put('./index.html',copy))}return response}).catch(()=>new Response('<h1>首次缓存尚未完成</h1><p>请联网后用 Safari 打开一次，再重新进入桌面 App。</p>',{headers:{'Content-Type':'text/html;charset=utf-8'}}))
      })
    }))
    return
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy))}return response})))
})
