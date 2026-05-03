# follow-tracker

Subscription service that watches Bilibili UPs and YouTube channels,
queues new uploads at mediago-core for download, and fires the AI notes
pipeline once the video lands.

## Layout on disk

After a creator's video downloads + processes, the files end up here:

```
/downloads/
└── <creator>/
    └── <video title>/
        ├── <video title>.mp4    # 720p preferred, BBDown / yt-dlp output
        ├── notes.md              # summary + key topics + sections + mermaid mindmap
        └── transcript.txt        # raw FUNASR transcription
```

`notes.md` and `transcript.txt` use fixed names so the Files page
filter (`?kind=note` / `?kind=transcript`) can pick them out without
guessing from the title. Deleting the mp4 and keeping the notes is the
explicit "video → trash, notes → keep" workflow the user asked for.

## API surface

```
GET    /api/creators                list creators
POST   /api/creators                add (platform, externalId|name, cookies?)
PATCH  /api/creators/:id            update name / autoDownload / cookies
DELETE /api/creators/:id            remove
POST   /api/creators/:id/refresh    pull latest videos now (sync, ~30s)
GET    /api/creators/:id/videos     videos discovered for that creator
GET    /api/videos/:id              one video's record
POST   /api/videos/:id/queue        manually push into download queue
POST   /api/videos/:id/skip         mark as skipped
GET    /health                      status + counts
```

The follow-tracker is reachable through admin-ui at `/api/follow/*` —
basic-auth gated alongside the rest of the SaaS.

## Bilibili cookies

Anonymous Bilibili access is heavily rate-limited (-352 风控) and
caps BBDown at 480P. Two ways to provide a logged-in cookie:

- `.env`: `BILI_SESSDATA=<...>` — applies to every Bilibili creator,
  threaded into both the API source's WBI calls and BBDown's `-c` flag.
- Per-creator: paste the full DevTools cookie blob into the creator's
  `cookies` field via `POST /api/creators` or `PATCH /api/creators/:id`.
  Per-creator wins when both are set, so different creators can use
  different accounts (e.g. a paid one for member-only videos).

## Sources

| Platform | Primary                                              | Fallback                                    |
| -------- | ---------------------------------------------------- | ------------------------------------------- |
| Bilibili | WBI-signed `api.bilibili.com/x/space/wbi/arc/search` | Selenium + headless Chrome with stealth     |
| YouTube  | per-channel Atom feed                                | `yt-dlp --flat-playlist --dump-single-json` |

The orchestrator in `sources/__init__.py` tries the primary first and
falls back on `SourceError`. Empty results count as a failure so the
fallback gets a chance.

## Maintenance

- `python scripts/migrate_layout.py` — one-shot, idempotent reorganizer
  from the old flat layout `<creator>/<creator> - <title>.mp4` to the
  per-video folder layout above. Materializes notes.md / transcript.txt
  for any rows that were AI-processed before this layout existed and
  sweeps BBDown's leftover aid-named tmp dirs.
