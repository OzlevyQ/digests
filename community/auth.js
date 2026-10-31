/* PAPit shared client: Descope Google sign-in + PAPit server API (Supabase edge function). */
const DESCOPE_PID='P3JSQ5xGjXf4sEVQz7q0lTaAgN54'
export const API_BASE='https://kuehljnnpwgzyodjaund.supabase.co/functions/v1/papit-api'
export const dSdk=(()=>{try{return Descope({projectId:DESCOPE_PID,persistTokens:true})}catch(e){console.warn('descope init failed',e);return null}})()
let refreshP=null
export const sdkRefresh=()=>{
  if(!dSdk)return Promise.resolve(null)
  if(!refreshP)refreshP=dSdk.refresh().catch(e=>{console.warn('descope refresh failed',e);return null}).finally(()=>{refreshP=null})
  return refreshP
}
export async function getSessionJwt(){
  const r=await sdkRefresh()
  return (r&&r.data&&r.data.sessionJwt)||null
}
export async function getUser(){
  try{
    const r=await sdkRefresh()
    const sj=r&&r.data&&r.data.sessionJwt
    if(!sj)return null
    const ju=r.data.user
    if(ju&&(ju.userId||ju.sub))return{id:ju.userId||ju.sub,name:ju.name||(ju.email||'').split('@')[0]||'חבר/ת קהילה',email:ju.email||'',pictureUrl:ju.picture||''}
    try{
      const me=await dSdk.me()
      const u=(me&&me.data)||{}
      if(u.userId)return{id:u.userId,name:u.name||(u.email||'').split('@')[0]||'חבר/ת קהילה',email:u.email||'',pictureUrl:u.picture||''}
    }catch(e){console.warn('me() failed, using token claims',e)}
    const p=JSON.parse(atob(sj.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
    return p.sub?{id:p.sub,name:'חבר/ת קהילה',email:'',pictureUrl:''}:null
  }catch(e){console.warn('getUser failed',e);return null}
}
/* Server API. Public reads need no token; writes send the Descope session JWT. */
export async function api(path,{method='GET',body,auth=false}={}){
  const headers={}
  if(auth){
    const t=await getSessionJwt()
    if(!t)throw Object.assign(new Error('not_signed_in'),{status:401})
    headers.authorization='Bearer '+t
  }
  if(body!==undefined)headers['content-type']='application/json'
  const r=await fetch(API_BASE+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined})
  const ct=r.headers.get('content-type')||''
  const j=ct.includes('json')?await r.json().catch(()=>({})):{}
  if(!r.ok)throw Object.assign(new Error(j.error||('http_'+r.status)),{status:r.status})
  return j
}
export async function signOut(){try{if(dSdk)await dSdk.logout()}catch{}}
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const fmtDate=iso=>new Date(iso).toLocaleString('he-IL',{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
export const qs=k=>new URLSearchParams(location.search).get(k)
