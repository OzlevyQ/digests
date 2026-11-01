/* PAPit service worker: offline shell + room push notifications.
   Pushes are payload-free tickles; the SW fetches the fresh post itself. */
const CACHE='papit-v12'
const API='https://kuehljnnpwgzyodjaund.supabase.co/functions/v1/papit-api'
const SHELL=['./','index.html','room.html','auth.js','push.js','playerfx.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png']
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())))
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{
    if(r.ok&&new URL(e.request.url).origin===location.origin){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
    return r
  }).catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html'))))
})
/* --- subscribed rooms, persisted in IDB so a cold SW still knows them --- */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open('papit-sw',1)
  r.onupgradeneeded=()=>r.result.createObjectStore('state')
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function loadState(){
  try{const db=await idb();return await new Promise(res=>{const tx=db.transaction('state').objectStore('state').get('push');tx.onsuccess=()=>res(tx.result||{});tx.onerror=()=>res({})})}catch{return{}}}
async function saveState(st){
  try{const db=await idb();await new Promise((res,rej)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(st,'push');tx.oncomplete=res;tx.onerror=rej})}catch{}}
self.addEventListener('message',e=>{
  if(e.data&&e.data.type==='rooms')(async()=>{const st=await loadState();st.slugs=e.data.slugs||[];await saveState(st)})()
})
self.addEventListener('push',e=>{
  e.waitUntil((async()=>{
    const st=await loadState()
    const slugs=st.slugs||[]
    if(!slugs.length)return
    st.lastSeen=st.lastSeen||{}
    for(const slug of slugs){
      try{
        const r=await fetch(API+'/rooms/'+encodeURIComponent(slug),{cache:'no-store'})
        if(!r.ok)continue
        const j=await r.json()
        let ls=st.lastSeen[slug]
        if(typeof ls==='string')ls={ts:ls,ids:[]}
        /* fresh = newer timestamp, or same timestamp with an unseen id (edition
           posts can share one timestamp) */
        const fresh=(j.posts||[]).filter(p=>{
          if(!ls)return true
          if(p.created_at>ls.ts)return true
          return p.created_at===ls.ts&&!(ls.ids||[]).includes(p.id)
        })
        if(!fresh.length)continue
        const p=fresh[0]
        const newTs=p.created_at
        const prevIds=ls&&ls.ts===newTs?ls.ids||[]:[]
        st.lastSeen[slug]={ts:newTs,ids:[...new Set([...prevIds,...fresh.filter(x=>x.created_at===newTs).map(x=>x.id)])].slice(-20)}
        await saveState(st)
        await self.registration.showNotification(j.room.title,{
          body:p.title,icon:'icon-192.png',badge:'icon-192.png',dir:'rtl',lang:'he',
          tag:'papit-'+slug,renotify:false,
          data:{url:'room.html?r='+encodeURIComponent(slug)}})
      }catch{}
    }
  })())
})
self.addEventListener('notificationclick',e=>{
  e.notification.close()
  const u=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    const c=cs.find(c=>c.url.startsWith(self.registration.scope))
    if(c){c.navigate(u);return c.focus()}
    return clients.openWindow(u)
  }))
})
