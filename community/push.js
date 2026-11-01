/* PAPit per-room push: consent on tap, cancellable, endpoint-only storage. */
import { api } from './auth.js?v=2'
export const VAPID_PUBLIC='BFlhYf01n-6jz4hVWY-Uq0tOIDUv7vo4KrtfKQEmCjAFkti7iLFhUp4TFk8cizueQCJIaUpC29wttao84uDgOEU'
const LS='papit.push.rooms'
const urlB64=u=>{const p='='.repeat((4-u.length%4)%4);const b=atob((u+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0))}
export const supported=()=>'serviceWorker' in navigator&&'PushManager' in window
export function localRooms(){try{return new Set(JSON.parse(localStorage.getItem(LS)||'[]'))}catch{return new Set()}}
function saveLocal(s){try{localStorage.setItem(LS,JSON.stringify([...s]))}catch{}}
export async function swReg(){return await navigator.serviceWorker.register('sw.js')}
async function syncSw(s){try{const r=await swReg();(r.active||navigator.serviceWorker.controller)?.postMessage({type:'rooms',slugs:[...s]})}catch{}}
export async function refreshSwRooms(){await syncSw(localRooms())}
/* 'on' | 'off' | 'unsupported' | 'denied' */
export async function roomState(slug){
  if(!supported())return 'unsupported'
  if(!localRooms().has(slug))return 'off'
  try{const r=await swReg();const sub=await r.pushManager.getSubscription();if(!sub)return 'off'}catch{return 'off'}
  return Notification.permission==='granted'?'on':'denied'
}
export async function subscribeRoom(slug){
  if(!supported())return 'unsupported'
  const perm=await Notification.requestPermission()
  if(perm!=='granted')return 'denied'
  const r=await swReg()
  let sub=await r.pushManager.getSubscription()
  if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64(VAPID_PUBLIC)})
  await api('/push/subscribe',{method:'POST',body:{room_slug:slug,endpoint:sub.endpoint}})
  const s=localRooms();s.add(slug);saveLocal(s);await syncSw(s)
  return 'on'
}
export async function unsubscribeRoom(slug){
  const s=localRooms()
  try{const r=await swReg();const sub=await r.pushManager.getSubscription()
    if(sub)await api('/push/unsubscribe',{method:'POST',body:{room_slug:slug,endpoint:sub.endpoint}})}catch{}
  s.delete(slug);saveLocal(s);await syncSw(s)
  return 'off'
}
