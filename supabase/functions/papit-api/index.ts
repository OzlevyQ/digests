// PAPit server API: rooms, posts, moderation, account deletion, RSS feeds.
// All PAPit table access flows through this function (tables have RLS with no
// policies, so direct PostgREST access is denied). Identity = Descope session
// JWT verified against the project's public JWKS. No user secrets here:
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import * as jose from 'https://esm.sh/jose@5.9.6'

const SB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DESCOPE_PID = 'P3JSQ5xGjXf4sEVQz7q0lTaAgN54'
const JWKS = jose.createRemoteJWKSet(new URL(`https://api.descope.com/v2/keys/${DESCOPE_PID}`))
const SITE = 'https://ozlevyq.github.io/digests/community'
const API_PUBLIC = 'https://kuehljnnpwgzyodjaund.supabase.co/functions/v1/papit-api'
const sb = createClient(SB_URL, SVC)

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } })
const xesc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const cdata = (s: string) => String(s ?? '').replace(/\]\]>/g, ']]&gt;')
const rfc822 = (iso: string) => new Date(iso).toUTCString()
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const okLink = (v: string) => v === '' || /^https?:\/\/\S+$/i.test(v)

interface ApiUser { id: string; name: string; email: string; picture: string }
async function authUser(req: Request): Promise<ApiUser | null> {
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!t) return null
  try {
    const { payload } = await jose.jwtVerify(t, JWKS)
    const id = typeof payload.sub === 'string' ? payload.sub : ''
    if (!id) return null
    const p = payload as Record<string, unknown>
    return {
      id,
      name: typeof p.name === 'string' ? p.name : '',
      email: typeof p.email === 'string' ? p.email : '',
      picture: typeof p.picture === 'string' ? p.picture : '',
    }
  } catch { return null }
}
async function ensureProfile(u: ApiUser, displayName: string) {
  const name = (displayName || u.name || 'חבר/ת קהילה').slice(0, 60)
  await sb.from('papit_profiles').upsert({
    id: u.id, display_name: name, email: u.email.slice(0, 120),
    picture_url: u.picture.slice(0, 300), updated_at: new Date().toISOString(),
  })
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

async function rssFeed(slug: string | null): Promise<Response> {
  let room: { id: string; slug: string; title: string; description: string } | null = null
  if (slug) {
    const { data } = await sb.from('papit_rooms').select('id,slug,title,description').eq('slug', slug).maybeSingle()
    if (!data) return new Response('room not found', { status: 404, headers: CORS })
    room = data
  }
  let q = sb.from('papit_posts')
    .select('id,title,body,link,created_at,papit_profiles(display_name),papit_rooms(slug,title)')
    .order('created_at', { ascending: false }).limit(50)
  if (room) q = q.eq('room_id', room.id)
  const { data: posts } = await q
  const chanTitle = room ? `PAPit — ${room.title}` : 'PAPit — כל הפוסטים'
  const chanLink = room ? `${SITE}/room.html?r=${encodeURIComponent(room.slug)}` : `${SITE}/`
  const selfUrl = room ? `${API_PUBLIC}/rss/${encodeURIComponent(room.slug)}` : `${API_PUBLIC}/rss`
  const items = (posts ?? []).map((p: Record<string, any>) => {
    const pageLink = `${SITE}/room.html?r=${encodeURIComponent(p.papit_rooms?.slug ?? '')}`
    const desc = (p.body ? `<p>${xesc(p.body)}</p>` : '') + (p.link ? `<p><a href="${xesc(p.link)}">${xesc(p.link)}</a></p>` : '')
    return `    <item>
      <title>${xesc(p.title)}</title>
      <link>${xesc(p.link || pageLink)}</link>
      <guid isPermaLink="false">papit-${p.id}</guid>
      <pubDate>${rfc822(p.created_at)}</pubDate>
      <dc:creator>${xesc(p.papit_profiles?.display_name ?? '')}</dc:creator>
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
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const rest = parts.slice(1) // strip 'papit-api'
  const seg = (i: number) => (rest[i] ? decodeURIComponent(rest[i]) : '')
  try {
    if (req.method === 'GET' && seg(0) === 'health') return json({ ok: true, service: 'papit-api' })

    if (req.method === 'GET' && seg(0) === 'rss') return await rssFeed(seg(1) || null)

    if (req.method === 'GET' && seg(0) === 'rooms' && !seg(1)) {
      const { data, error } = await sb.from('papit_rooms')
        .select('slug,title,description,created_at,owner_id,papit_profiles(display_name),papit_posts(count)')
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return json({ rooms: (data ?? []).map((r: Record<string, any>) => ({
        slug: r.slug, title: r.title, description: r.description, created_at: r.created_at,
        owner_id: r.owner_id, owner_name: r.papit_profiles?.display_name ?? '',
        post_count: r.papit_posts?.[0]?.count ?? 0,
      })) })
    }

    if (req.method === 'GET' && seg(0) === 'rooms' && seg(1)) {
      const { data: room } = await sb.from('papit_rooms').select('*').eq('slug', seg(1)).maybeSingle()
      if (!room) return json({ error: 'room_not_found' }, 404)
      const { data: owner } = await sb.from('papit_profiles').select('display_name').eq('id', room.owner_id).maybeSingle()
      const { data: posts } = await sb.from('papit_posts')
        .select('id,title,body,link,created_at,author_id,papit_profiles(display_name)')
        .eq('room_id', room.id).order('created_at', { ascending: false }).limit(200)
      return json({
        room: { slug: room.slug, title: room.title, description: room.description, created_at: room.created_at, owner_id: room.owner_id, owner_name: owner?.display_name ?? '' },
        posts: (posts ?? []).map((p: Record<string, any>) => ({
          id: p.id, title: p.title, body: p.body, link: p.link, created_at: p.created_at,
          author_id: p.author_id, author_name: p.papit_profiles?.display_name ?? '',
        })),
      })
    }

    if (req.method === 'GET' && seg(0) === 'latest') {
      const { data, error } = await sb.from('papit_posts')
        .select('id,title,body,link,created_at,papit_rooms(slug,title),papit_profiles(display_name)')
        .order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return json({ posts: (data ?? []).map((p: Record<string, any>) => ({
        id: p.id, title: p.title, body: p.body, link: p.link, created_at: p.created_at,
        room_slug: p.papit_rooms?.slug ?? '', room_title: p.papit_rooms?.title ?? '',
        author_name: p.papit_profiles?.display_name ?? '',
      })) })
    }

    if (req.method === 'POST' && seg(0) === 'rooms' && !seg(1)) {
      const u = await authUser(req)
      if (!u) return json({ error: 'not_signed_in' }, 401)
      const b = await req.json().catch(() => ({}))
      const title = clean(b.title, 80)
      if (!title) return json({ error: 'title_required' }, 400)
      await ensureProfile(u, clean(b.display_name, 60))
      const slug = await uniqueSlug(slugify(title))
      const { error } = await sb.from('papit_rooms').insert({ slug, title, description: clean(b.description, 300), owner_id: u.id })
      if (error) { console.error(error); return json({ error: 'create_failed' }, 500) }
      return json({ slug })
    }

    if (req.method === 'POST' && seg(0) === 'rooms' && seg(1) && seg(2) === 'posts') {
      const u = await authUser(req)
      if (!u) return json({ error: 'not_signed_in' }, 401)
      const { data: room } = await sb.from('papit_rooms').select('id').eq('slug', seg(1)).maybeSingle()
      if (!room) return json({ error: 'room_not_found' }, 404)
      const b = await req.json().catch(() => ({}))
      const title = clean(b.title, 120)
      if (!title) return json({ error: 'title_required' }, 400)
      const link = clean(b.link, 500)
      if (!okLink(link)) return json({ error: 'invalid_link' }, 400)
      await ensureProfile(u, clean(b.display_name, 60))
      const { data, error } = await sb.from('papit_posts')
        .insert({ room_id: room.id, author_id: u.id, title, body: clean(b.body, 5000), link })
        .select('id').single()
      if (error) { console.error(error); return json({ error: 'create_failed' }, 500) }
      return json({ id: data.id })
    }

    if (req.method === 'DELETE' && seg(0) === 'posts' && seg(1)) {
      const u = await authUser(req)
      if (!u) return json({ error: 'not_signed_in' }, 401)
      const { data: post } = await sb.from('papit_posts').select('id,author_id,room_id').eq('id', seg(1)).maybeSingle()
      if (!post) return json({ error: 'not_found' }, 404)
      const { data: room } = await sb.from('papit_rooms').select('owner_id').eq('id', post.room_id).maybeSingle()
      if (post.author_id !== u.id && room?.owner_id !== u.id) return json({ error: 'forbidden' }, 403)
      await sb.from('papit_posts').delete().eq('id', post.id)
      return json({ ok: true })
    }

    if (req.method === 'DELETE' && seg(0) === 'rooms' && seg(1)) {
      const u = await authUser(req)
      if (!u) return json({ error: 'not_signed_in' }, 401)
      const { data: room } = await sb.from('papit_rooms').select('id,owner_id').eq('slug', seg(1)).maybeSingle()
      if (!room) return json({ error: 'room_not_found' }, 404)
      if (room.owner_id !== u.id) return json({ error: 'forbidden' }, 403)
      await sb.from('papit_rooms').delete().eq('id', room.id) // cascades posts
      return json({ ok: true })
    }

    if (req.method === 'DELETE' && seg(0) === 'me') {
      const u = await authUser(req)
      if (!u) return json({ error: 'not_signed_in' }, 401)
      await sb.from('papit_posts').delete().eq('author_id', u.id)
      await sb.from('papit_rooms').delete().eq('owner_id', u.id) // cascades room posts
      await sb.from('papit_profiles').delete().eq('id', u.id)
      return json({ ok: true })
    }

    return json({ error: 'not_found' }, 404)
  } catch (e) {
    console.error(e)
    return json({ error: 'server_error' }, 500)
  }
})
