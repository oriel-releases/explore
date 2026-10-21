# Oriel Explore feed

The photos on the Explore page of the [Oriel](https://oriel.akbarjon.uz) apps: 300 wallpapers for computers and 300
for phones, new every hour, the same for everyone.

- `.github/workflows/hourly.yml` runs `scripts/build.mjs` a few minutes past every hour. It makes about twenty Unsplash API
  calls in all, however many people use the apps, and skips photos shown in the last twelve hours.
- The result is force-pushed to the `feed` branch (one commit, two files), which the apps read:
  `https://raw.githubusercontent.com/oriel-releases/explore/feed/explore.json`
- **Metadata only.** No images are stored here: each photo is Unsplash's own API object, trimmed, and the apps load
  the pictures from Unsplash's CDN (`urls.raw` with sizing parameters), credit the photographer and ping
  `download_location` when one is set as a wallpaper.

```json
{
  "version": 1,
  "hour": "2026-10-21T14:00:00Z",
  "landscape": [{ "id": "…", "width": 6000, "height": 4000, "likes": 812, "color": "#2E4A3F", "blur_hash": "…",
                  "description": null, "alt_description": "foggy forest at dawn", "topic": "forest",
                  "urls": { "raw": "https://images.unsplash.com/photo-…" },
                  "links": { "html": "https://unsplash.com/photos/…", "download_location": "https://api.unsplash.com/photos/…/download?…" },
                  "user": { "name": "…", "username": "…", "links": { "html": "https://unsplash.com/@…" } } }],
  "portrait": [ ]
}
```

A failed hour leaves the previous feed in place; the apps keep showing it.

Secret: `UNSPLASH_ACCESS_KEY` (Oriel's Unsplash key). Run by hand: Actions → Hourly feed → Run workflow.
