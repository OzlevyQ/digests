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
