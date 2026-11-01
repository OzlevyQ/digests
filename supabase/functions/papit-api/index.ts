// PAPit server API v2: no user accounts. Anyone can open a room; room creation
// returns a one-time API key (only its sha256 hash is stored). The key gates
// publishing, post deletion and room deletion. Reads and RSS are public.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SITE = 'https://ozlevyq.github.io/digests/community'
const API_PUBLIC = 'https://kuehljnnpwgzyodjaund.supabase.co/functions/v1/papit-api'
const sb = createClient(SB_URL, SVC)

/* Web Push (VAPID). Payload-free tickles: the service worker fetches the fresh
   post itself, so no payload encryption is needed and only endpoints are stored. */
const VAPID_JWK = Deno.env.get('VAPID_JWK') ?? ''
const VAPID_SUB = Deno.env.get('VAPID_SUB') ?? 'https://ozlevyq.github.io/digests/community/'
const VAPID_PUBLIC = 'BFlhYf01n-6jz4hVWY-Uq0tOIDUv7vo4KrtfKQEmCjAFkti7iLFhUp4TFk8cizueQCJIaUpC29wttao84uDgOEU'
function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function vapidJwt(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 3600 * 12, sub: VAPID_SUB })))
  const key = await crypto.subtle.importKey('jwk', JSON.parse(VAPID_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(header + '.' + payload))
  return header + '.' + payload + '.' + b64u(sig)
}
async function sendPush(endpoint: string): Promise<'ok' | 'gone' | 'fail'> {
  try {
    const jwt = await vapidJwt(endpoint)
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}`, ttl: '86400', urgency: 'high' },
    })
    if (r.status === 404 || r.status === 410) return 'gone'
    return r.status >= 200 && r.status < 300 ? 'ok' : 'fail'
  } catch { return 'fail' }
}
async function fanout(roomId: string) {
  if (!VAPID_JWK) return
  const { data: subs } = await sb.from('papit_push_subs').select('id,endpoint').eq('room_id', roomId).limit(2000)
  for (const s of subs ?? []) {
    if (await sendPush(s.endpoint) === 'gone') await sb.from('papit_push_subs').delete().eq('id', s.id)
  }
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-api-key',
}
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } })
const xesc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const cdata = (s: string) => String(s ?? '').replace(/\]\]>/g, ']]&gt;')
const rfc822 = (iso: string) => new Date(iso).toUTCString()
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const okLink = (v: string) => v === '' || /^https?:\/\/\S+$/i.test(v)

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function newApiKey(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return 'papit_' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
function apiKeyFrom(req: Request): string {
  const h = req.headers.get('x-api-key') ?? ''
  if (h) return h.trim()
  const a = req.headers.get('authorization') ?? ''
  return a.startsWith('Bearer ') ? a.slice(7).trim() : ''
}
/* Returns the room row iff the presented key matches its stored hash. */
async function roomByKey(slug: string, key: string) {
  const { data: room } = await sb.from('papit_rooms').select('id,slug,title,api_key_hash').eq('slug', slug).maybeSingle()
  if (!room) return { error: json({ error: 'room_not_found' }, 404), room: null }
  if (!key || (await sha256hex(key)) !== room.api_key_hash) return { error: json({ error: 'bad_api_key' }, 401), room: null }
  return { error: null, room }
}
function slugify(t: string): string {
  let s = t.toLowerCase().normalize('NFKD').replace(/[׳']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!s) s = 'room-' + Math.random().toString(36).slice(2, 8)
  return s.slice(0, 48)
}
async function uniqueSlug(base: string): Promise<string> {
  let s = base
  for (let i = 2; ; i++) {
    const { data } = await sb.from('papit_rooms').select('slug').eq('slug', s).maybeSingle()
    if (!data) return s
    s = base.slice(0, 44) + '-' + i
  }
}

/* Server-side abuse protection (no accounts, so keyed by caller IP):
   returns retry-after seconds when the caller is over the limit, else null
   and records the attempt. Events older than a day are cleaned up lazily. */
function callerIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}
async function rateLimit(action: string, actor: string, maxHour: number, maxDay: number): Promise<number | null> {
  const now = Date.now()
  const hourAgo = new Date(now - 3600e3).toISOString()
  const dayAgo = new Date(now - 86400e3).toISOString()
  const { count: h } = await sb.from('papit_rate_events').select('*', { count: 'exact', head: true })
    .eq('action', action).eq('actor', actor).gte('created_at', hourAgo)
  if ((h ?? 0) >= maxHour) return 3600
  const { count: d } = await sb.from('papit_rate_events').select('*', { count: 'exact', head: true })
    .eq('action', action).eq('actor', actor).gte('created_at', dayAgo)
  if ((d ?? 0) >= maxDay) return 86400
  await sb.from('papit_rate_events').insert({ action, actor })
  if (Math.random() < 0.02) await sb.from('papit_rate_events').delete().lt('created_at', dayAgo)
  return null
}
const tooMany = (retry: number) =>
  json({ error: 'rate_limited', retry_after_seconds: retry }, 429)
async function rssFeed(slug: string | null): Promise<Response> {
  let room: { id: string; slug: string; title: string; description: string } | null = null
  if (slug) {
    const { data } = await sb.from('papit_rooms').select('id,slug,title,description').eq('slug', slug).maybeSingle()
    if (!data) return new Response('room not found', { status: 404, headers: CORS })
    room = data
  }
  let q = sb.from('papit_posts')
    .select('id,title,body,link,author_name,created_at,papit_rooms(slug,title)')
    .order('created_at', { ascending: false }).limit(50)
  if (room) q = q.eq('room_id', room.id)
  const { data: posts } = await q
  const chanTitle = room ? `PAPit — ${room.title}` : 'PAPit — כל הפוסטים'
  const chanLink = room ? `${SITE}/room.html?r=${encodeURIComponent(room.slug)}` : `${SITE}/`
  const selfUrl = room ? `${API_PUBLIC}/rss/${encodeURIComponent(room.slug)}` : `${API_PUBLIC}/rss`
  const items = (posts ?? []).map((p: Record<string, any>) => {
    const pageLink = `${SITE}/room.html?r=${encodeURIComponent(p.papit_rooms?.slug ?? '')}`
    const desc = (p.body ? `<p>${xesc(p.body)}</p>` : '') + (p.link ? `<p><a href="${xesc(p.link)}">${xesc(p.link)}</a></p>` : '')
    const creator = p.author_name || p.papit_rooms?.title || ''
    return `    <item>
      <title>${xesc(p.title)}</title>
      <link>${xesc(p.link || pageLink)}</link>
      <guid isPermaLink="false">papit-${p.id}</guid>
      <pubDate>${rfc822(p.created_at)}</pubDate>
      <dc:creator>${xesc(creator)}</dc:creator>
      <category>${xesc(p.papit_rooms?.title ?? '')}</category>
      <description><![CDATA[${cdata(desc)}]]></description>
    </item>`
  }).join('\n')
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xesc(chanTitle)}</title>
    <link>${xesc(chanLink)}</link>
    <atom:link href="${xesc(selfUrl)}" rel="self" type="application/rss+xml"/>
    <description>${xesc(room?.description || 'פוסטים מחדרי הקהילה ב-PAPit')}</description>
    <language>he</language>
    <lastBuildDate>${rfc822(new Date().toISOString())}</lastBuildDate>
${items}
  </channel>
</rss>
`
  return new Response(feed, { headers: { ...CORS, 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=60' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const clen = Number(req.headers.get('content-length') ?? 0)
  if (clen > 65536) return json({ error: 'payload_too_large' }, 413)
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const rest = parts.slice(1) // strip 'papit-api'
  const seg = (i: number) => (rest[i] ? decodeURIComponent(rest[i]) : '')
  try {
    if (req.method === 'GET' && seg(0) === 'health') return json({ ok: true, service: 'papit-api', version: 4 })
    if (req.method === 'GET' && seg(0) === 'rss') return await rssFeed(seg(1) || null)

    if (req.method === 'GET' && seg(0) === 'rooms' && !seg(1)) {
      const { data, error } = await sb.from('papit_rooms')
        .select('slug,title,description,created_at,papit_posts(count)')
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return json({ rooms: (data ?? []).map((r: Record<string, any>) => ({
        slug: r.slug, title: r.title, description: r.description, created_at: r.created_at,
        post_count: r.papit_posts?.[0]?.count ?? 0,
      })) })
    }

    if (req.method === 'GET' && seg(0) === 'rooms' && seg(1)) {
      const { data: room } = await sb.from('papit_rooms').select('id,slug,title,description,created_at').eq('slug', seg(1)).maybeSingle()
      if (!room) return json({ error: 'room_not_found' }, 404)
      const { data: posts } = await sb.from('papit_posts')
        .select('id,title,body,link,author_name,created_at')
        .eq('room_id', room.id).order('created_at', { ascending: false }).limit(200)
      return json({ room: { slug: room.slug, title: room.title, description: room.description, created_at: room.created_at }, posts: posts ?? [] })
    }

    if (req.method === 'GET' && seg(0) === 'latest') {
      const { data, error } = await sb.from('papit_posts')
        .select('id,title,body,link,author_name,created_at,papit_rooms(slug,title)')
        .order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return json({ posts: (data ?? []).map((p: Record<string, any>) => ({
        id: p.id, title: p.title, body: p.body, link: p.link, created_at: p.created_at,
        author_name: p.author_name ?? '',
        room_slug: p.papit_rooms?.slug ?? '', room_title: p.papit_rooms?.title ?? '',
      })) })
    }

    /* Push subscriptions: per-room, endpoint-only, payload-free tickles. */
    if (req.method === 'POST' && seg(0) === 'push' && seg(1) === 'subscribe') {
      const rl = await rateLimit('push_write', callerIp(req), 30, 120)
      if (rl !== null) return tooMany(rl)
      const b = await req.json().catch(() => ({}))
      const slug = clean(b.room_slug, 60)
      const endpoint = clean(b.endpoint, 1000)
      if (!slug || !/^https:\/\/\S+$/i.test(endpoint)) return json({ error: 'bad_request' }, 400)
      const { data: room } = await sb.from('papit_rooms').select('id').eq('slug', slug).maybeSingle()
      if (!room) return json({ error: 'room_not_found' }, 404)
      const { error } = await sb.from('papit_push_subs').upsert({ room_id: room.id, endpoint }, { onConflict: 'room_id,endpoint' })
      if (error) { console.error(error); return json({ error: 'subscribe_failed' }, 500) }
      return json({ ok: true })
    }
    if (req.method === 'POST' && seg(0) === 'push' && seg(1) === 'unsubscribe') {
      const b = await req.json().catch(() => ({}))
      const endpoint = clean(b.endpoint, 1000)
      if (!endpoint) return json({ error: 'bad_request' }, 400)
      let q = sb.from('papit_push_subs').delete().eq('endpoint', endpoint)
      const slug = clean(b.room_slug, 60)
      if (slug) {
        const { data: room } = await sb.from('papit_rooms').select('id').eq('slug', slug).maybeSingle()
        if (room) q = q.eq('room_id', room.id)
      }
      await q
      return json({ ok: true })
    }

    /* Open room creation. Returns the room's API key exactly once. */
    if (req.method === 'POST' && seg(0) === 'rooms' && !seg(1)) {
      const ip = callerIp(req)
      const rl = await rateLimit('create_room', ip, 3, 10)
      if (rl !== null) return tooMany(rl)
      const rg = await rateLimit('create_room', 'global', 40, 100)
      if (rg !== null) return tooMany(rg)
      const b = await req.json().catch(() => ({}))
      const title = clean(b.title, 80)
      if (!title) return json({ error: 'title_required' }, 400)
      const email = clean(b.email, 120).toLowerCase()
      if (!email) return json({ error: 'email_required' }, 400)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400)
      const slug = await uniqueSlug(slugify(title))
      const apiKey = newApiKey()
      const { error } = await sb.from('papit_rooms').insert({
        slug, title, description: clean(b.description, 300), owner_email: email,
        api_key_hash: await sha256hex(apiKey), key_hint: '…' + apiKey.slice(-4),
      })
      if (error) { console.error(error); return json({ error: 'create_failed' }, 500) }
      return json({ slug, api_key: apiKey, rss: `${API_PUBLIC}/rss/${encodeURIComponent(slug)}` })
    }

    /* Room cover upload (owner key). Public read from the papit-covers bucket. */
    if (req.method === 'POST' && seg(0) === 'rooms' && seg(1) && seg(2) === 'cover') {
      const { error, room } = await roomByKey(seg(1), apiKeyFrom(req))
      if (error) return error
      const b = await req.json().catch(() => ({}))
      const ct = clean(b.content_type, 40)
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(ct)) return json({ error: 'invalid_image' }, 400)
      let bytes: Uint8Array
      try {
        const bin = atob(String(b.data ?? '').replace(/\s/g, ''))
        if (!bin.length) throw new Error('empty')
        if (bin.length > 3_000_000) return json({ error: 'image_too_large' }, 400)
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      } catch { return json({ error: 'invalid_image' }, 400) }
      const up = await sb.storage.from('papit-covers').upload(`${seg(1)}.png`, bytes, { contentType: ct, upsert: true, cacheControl: '3600' })
      if (up.error) { console.error(up.error); return json({ error: 'upload_failed' }, 500) }
      return json({ url: `${SB_URL}/storage/v1/object/public/papit-covers/${seg(1)}.png` })
    }

    if (req.method === 'POST' && seg(0) === 'rooms' && seg(1) && seg(2) === 'posts') {
      const { error, room } = await roomByKey(seg(1), apiKeyFrom(req))
      if (error) return error
      const rl = await rateLimit('create_post', callerIp(req), 20, 100)
      if (rl !== null) return tooMany(rl)
      const { count: roomPosts } = await sb.from('papit_posts').select('*', { count: 'exact', head: true }).eq('room_id', room!.id)
      if ((roomPosts ?? 0) >= 500) return json({ error: 'room_post_limit' }, 429)
      const b = await req.json().catch(() => ({}))
      const title = clean(b.title, 120)
      if (!title) return json({ error: 'title_required' }, 400)
      const link = clean(b.link, 500)
      if (!okLink(link)) return json({ error: 'invalid_link' }, 400)
      const { data, error: ie } = await sb.from('papit_posts')
        .insert({ room_id: room!.id, title, body: clean(b.body, 5000), link, author_name: clean(b.author_name, 60) })
        .select('id').single()
      if (ie) { console.error(ie); return json({ error: 'create_failed' }, 500) }
      const er = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
      if (er?.waitUntil) er.waitUntil(fanout(room!.id))
      else await fanout(room!.id)
      return json({ id: data.id })
    }

    if (req.method === 'DELETE' && seg(0) === 'posts' && seg(1)) {
      const { data: post } = await sb.from('papit_posts').select('id,room_id').eq('id', seg(1)).maybeSingle()
      if (!post) return json({ error: 'not_found' }, 404)
      const { data: room } = await sb.from('papit_rooms').select('slug,api_key_hash').eq('id', post.room_id).maybeSingle()
      if (!room) return json({ error: 'not_found' }, 404)
      const key = apiKeyFrom(req)
      if (!key || (await sha256hex(key)) !== room.api_key_hash) return json({ error: 'bad_api_key' }, 401)
      await sb.from('papit_posts').delete().eq('id', post.id)
      return json({ ok: true })
    }

    if (req.method === 'DELETE' && seg(0) === 'rooms' && seg(1)) {
      const { error, room } = await roomByKey(seg(1), apiKeyFrom(req))
      if (error) return error
      await sb.from('papit_rooms').delete().eq('id', room!.id) // cascades posts
      return json({ ok: true })
    }

    return json({ error: 'not_found' }, 404)
  } catch (e) {
    console.error(e)
    return json({ error: 'server_error' }, 500)
  }
})
