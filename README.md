# הדייג'סטים של עוז — RSS + archive site

Static podcast-style archive of the twice-daily Hebrew audio digests
(AI news + wild GitHub repos), served by GitHub Pages.

- Site: `index.html` (mobile, RTL, inline players)
- Feed: `feed.xml` (RSS 2.0 + iTunes tags, one item per voice note)
- Audio: `audio/YYYY-MM-DD-<morning|evening>-<ai|gh>.ogg`
- Data: `editions.json` is the source of truth

## Publish a new edition (06:30 / 18:00 Israel)

```
python3 add-edition.py --repo . --date 2026-10-21 --slot evening \
  --ai /path/ai.ogg --gh /path/gh.ogg \
  --ai-links <urls...> --gh-links <urls...>
git add -A && git commit -m "digest 2026-10-21 evening" && git push
```

`add-edition.py` copies the audio, updates editions.json, and reruns
build.py (regenerates index.html + feed.xml). `--skip-ai` drops the AI
half (e.g. a stale repeat). Pages updates within ~1 minute of push.

## PAPit — community rooms (קהילת החדרים)

`community/` is PAPit: no accounts or Google sign-in. Anyone can open a
room; creation returns a one-time room API key, and only its SHA-256 hash is
stored. The key gates publishing, post deletion and room deletion. Reads are
public, every room has its own dynamic RSS feed, and one global community feed
aggregates all rooms.

- Data: Supabase tables `papit_rooms` / `papit_posts` / `papit_rate_events`
  (see `schema/papit.sql`). RLS is enabled with **no** policies, so all access
  goes through the server API only.
- Server API: Supabase edge function `supabase/functions/papit-api`. Writes
  use the room key in `x-api-key` or a Bearer token; reads and RSS are public.
  RSS lives at `/functions/v1/papit-api/rss` and `/rss/<room-slug>`.
- PWA: service worker + installable manifest in `community/`; per-room web
  push opt-in (bell on room cards / room page). Pushes are payload-free VAPID
  tickles (`papit_push_subs` stores endpoints only); the SW fetches the new
  post itself. `/push/subscribe` and `/push/unsubscribe` are open endpoints.
- Browser clients keep room keys in localStorage only. The digests pipeline,
  `editions.json`, `feed.xml` and `audio/` stay separate.
- The digests homepage links to the community; `build.py`'s template carries
  the link so edition rebuilds keep it.
