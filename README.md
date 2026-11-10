# Oriel Explore feed

The photos on the Explore page of the [Oriel](https://oriel.akbarjon.uz) apps: up to 300 wallpapers for computers and
300 for phones, new every hour, the same for everyone, each liked at least 500 times on Unsplash.

- `.github/workflows/hourly.yml` runs `scripts/build.mjs` a few minutes past every hour. It makes twenty to thirty-six
  Unsplash API calls in all, however many people use the apps, keeps only photos with 500+ likes, and skips photos
  shown in the last twelve hours.
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

## Live wallpapers

The Live side of Explore: up to 300 looping videos (landscape, at least 1920 wide) from **Pixabay** and **Coverr**,
`live.json` on the same branch, rebuilt **once a day** by `scripts/live.mjs` (about fourteen API calls; the other runs of
the day keep it, as both sites ask for caching). Metadata only: the apps stream and download the videos from the sites'
CDNs and credit the author and site. A failed day keeps the previous list, and never stops the photos.

`https://raw.githubusercontent.com/oriel-releases/explore/feed/live.json`

```json
{
  "version": 1,
  "day": "2026-11-10",
  "videos": [{ "id": "pixabay-71122", "source": "Pixabay", "sourceId": "71122", "title": "Waves, sea, ocean",
               "author": "…", "authorUrl": "https://pixabay.com/users/…", "pageUrl": "https://pixabay.com/videos/id-71122/",
               "thumbnailUrl": "…_small.jpg", "posterUrl": "…_large.jpg",
               "files": [{ "url": "…_tiny.mp4", "width": 1280, "height": 720 }, { "url": "…_large.mp4", "width": 3840, "height": 2160 }],
               "seconds": 19, "tags": ["waves", "sea", "loop"] }]
}
```

Secrets: `UNSPLASH_ACCESS_KEY` (Oriel's Unsplash key), `PIXABAY_API_KEY`, `COVERR_API_KEY` (the live wallpapers' keys).
Run by hand: Actions → Hourly feed → Run workflow.
