/* PAPit player extras:
   1. Media Session API — lock screen / Control Center shows the current episode
      (title, room, cover) and routes taps back to this PWA, with play/pause,
      prev/next episode and seek controls.
   2. Cross-page handoff — audio keeps going when moving between the homepage
      and a room page: the leaving page stores position, the arriving page resumes. */
const HK='papit-handoff'
const COVERS_URL='https://kuehljnnpwgzyodjaund.supabase.co/storage/v1/object/public/papit-covers/'
const ICONS=[
  {src:'icon-512.png',sizes:'512x512',type:'image/png'},
  {src:'icon-192.png',sizes:'192x192',type:'image/png'}]

export function attachPlayerFX({audio,getPost,step,backSec=15,fwdSec=30}){
  if(!('mediaSession' in navigator))return
  const setMeta=p=>{
    if(!p)return
    const room=p.room_title||'PAPit'
    const base={title:p.title,artist:p.author_name||room,album:room+' · PAPit'}
    try{navigator.mediaSession.metadata=new MediaMetadata({...base,artwork:ICONS})}catch{}
    if(p.room_slug){
      const apply=cover=>{try{navigator.mediaSession.metadata=new MediaMetadata({...base,artwork:[{src:cover,sizes:'512x512',type:'image/png'},...ICONS]})}catch{}}
      const remote=COVERS_URL+p.room_slug+'.png'
      const img=new Image()
      img.onload=()=>apply(remote)
      img.onerror=()=>{const loc=new Image();loc.onload=()=>apply(loc.src);loc.src='cover-'+p.room_slug+'.png'}
      img.src=remote
    }
  }
  const pos=()=>{try{
    if(isFinite(audio.duration)&&audio.duration>0)
      navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate||1,position:Math.min(audio.currentTime,audio.duration)})
  }catch{}}
  const H=(n,f)=>{try{navigator.mediaSession.setActionHandler(n,f)}catch{}}
  H('play',()=>{audio.play().catch(()=>{})})
  H('pause',()=>audio.pause())
  H('previoustrack',()=>step(-1))
  H('nexttrack',()=>step(1))
  H('seekbackward',d=>{audio.currentTime=Math.max(0,audio.currentTime-((d&&d.seekOffset)||backSec))})
  H('seekforward',d=>{const t=audio.currentTime+((d&&d.seekOffset)||fwdSec);audio.currentTime=isFinite(audio.duration)?Math.min(audio.duration,t):t})
  H('seekto',d=>{if(d&&d.seekTime!=null)audio.currentTime=d.seekTime;pos()})
  audio.addEventListener('play',()=>{navigator.mediaSession.playbackState='playing';setMeta(getPost())})
  audio.addEventListener('pause',()=>{navigator.mediaSession.playbackState='paused'})
  audio.addEventListener('loadedmetadata',()=>{setMeta(getPost());pos()})
  audio.addEventListener('timeupdate',pos)
  audio.addEventListener('ratechange',pos)
  /* Handoff: written continuously, not only on pagehide — when a page freezes
     into the back/forward cache the browser has already paused the element, so
     reading audio.paused on pagehide records a lie. `intent` tracks what the
     user last asked for: play sets it at once, pause only after a grace period,
     so a freeze-time pause (immediately followed by pagehide) is ignored. */
  let intent=false, intentTimer=null, lastWrite=0
  const writeHandoff=()=>{
    const p=getPost()
    try{
      if(!p){localStorage.removeItem(HK);return}
      localStorage.setItem(HK,JSON.stringify({id:p.id,t:audio.currentTime,playing:intent,ts:Date.now()}))
    }catch{}
  }
  audio.addEventListener('play',()=>{clearTimeout(intentTimer);intent=true;writeHandoff()})
  audio.addEventListener('pause',()=>{clearTimeout(intentTimer);intentTimer=setTimeout(()=>{intent=false;writeHandoff()},400)})
  audio.addEventListener('timeupdate',()=>{const n=Date.now();if(n-lastWrite>3000){lastWrite=n;writeHandoff()}})
  window.addEventListener('pagehide',()=>{clearTimeout(intentTimer);writeHandoff()})
  setMeta(getPost())
}

/* one-time read of a fresh handoff left by the page we navigated from (20s expiry) */
export function takeHandoff(){
  try{
    const h=JSON.parse(localStorage.getItem(HK)||'null')
    if(h&&h.id&&Date.now()-h.ts<20000){localStorage.removeItem(HK);return h}
  }catch{}
  return null
}
