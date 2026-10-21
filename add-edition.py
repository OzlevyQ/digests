#!/usr/bin/env python3
"""Add a new digest edition: copy audio into the repo, update editions.json, rebuild site.
Usage: add-edition.py --repo /path/to/repo --date 2026-10-21 --slot evening \
        --ai /path/ai.ogg --gh /path/gh.ogg \
        --ai-links url1 url2 --gh-links url1 url2 [--skip-ai]
Then commit + push. Run from anywhere; editions.json/build.py live in the repo root.
"""
import argparse, json, os, shutil, subprocess, sys

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--date", required=True)   # YYYY-MM-DD, Israel time
    p.add_argument("--slot", required=True, choices=["morning", "evening"])
    p.add_argument("--ai")
    p.add_argument("--gh")
    p.add_argument("--ai-links", nargs="*", default=[])
    p.add_argument("--gh-links", nargs="*", default=[])
    p.add_argument("--skip-ai", action="store_true")
    a = p.parse_args()

    ej_path = os.path.join(a.repo, "editions.json")
    with open(ej_path, encoding="utf-8") as f:
        editions = json.load(f)

    audio_dir = os.path.join(a.repo, "audio")
    os.makedirs(audio_dir, exist_ok=True)
    for track, src in (("ai", a.ai), ("gh", a.gh)):
        if src:
            shutil.copy(src, os.path.join(audio_dir, f"{a.date}-{a.slot}-{track}.ogg"))

    ed = {"date": a.date, "slot": a.slot, "ai_links": a.ai_links, "gh_links": a.gh_links}
    if a.skip_ai:
        ed["skip_ai"] = True
    editions = [e for e in editions if not (e["date"] == a.date and e["slot"] == a.slot)]
    editions.append(ed)
    editions.sort(key=lambda e: (e["date"], 0 if e["slot"] == "morning" else 1))
    with open(ej_path, "w", encoding="utf-8") as f:
        json.dump(editions, f, ensure_ascii=False, indent=2)

    subprocess.run([sys.executable, os.path.join(a.repo, "build.py"), a.repo], check=True)
    print("edition added and site rebuilt; commit + push to publish")

if __name__ == "__main__":
    main()
