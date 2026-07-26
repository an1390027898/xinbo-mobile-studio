const VERSION='xinbo-pwa-v15-ios-audio-responsive-social'
const CORE=['./','./index.html','./knowledge.html','./preferences.html','./output.html','./license.html','./splash.html','./mobile-full.css','./mobile-adapter.js','./manifest.webmanifest','./icon-512.png','./video-final.css','./video-final.js','./lame.min.js','./vendor/lunar-javascript/lunar.js']
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())))
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return
  const url=new URL(event.request.url)
  if(url.origin!==location.origin)return
  if(event.request.mode==='navigate'){
    event.respondWith(caches.match(event.request).then(hit=>{
      const network=fetch(event.request).then(response=>{const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy));return response}).catch(()=>null)
      return hit||network.then(response=>response||caches.match('./index.html'))
    }))
    return
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy))}return response})))
})
