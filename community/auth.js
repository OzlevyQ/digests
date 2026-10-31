/* PAPit client helpers: server API + room keys kept in this browser only. */
export const API_BASE='https://kuehljnnpwgzyodjaund.supabase.co/functions/v1/papit-api'
export async function api(path,{method='GET',body,apiKey=''}={}){
  const headers={}
  if(apiKey)headers['x-api-key']=apiKey
  if(body!==undefined)headers['content-type']='application/json'
  const r=await fetch(API_BASE+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined})
  const ct=r.headers.get('content-type')||''
  const j=ct.includes('json')?await r.json().catch(()=>({})):{}
  if(!r.ok)throw Object.assign(new Error(j.error||('http_'+r.status)),{status:r.status})
  return j
}
export const roomKey=slug=>{try{return localStorage.getItem('papit.key.'+slug)||''}catch{return ''}}
export const saveRoomKey=(slug,key)=>{try{localStorage.setItem('papit.key.'+slug,key)}catch{}}
export const forgetRoomKey=slug=>{try{localStorage.removeItem('papit.key.'+slug)}catch{}}
export const myRoomSlugs=()=>{try{return Object.keys(localStorage).filter(k=>k.startsWith('papit.key.')).map(k=>k.slice(10))}catch{return[]}}
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const fmtDate=iso=>new Date(iso).toLocaleString('he-IL',{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
export const qs=k=>new URLSearchParams(location.search).get(k)
