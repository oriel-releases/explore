// Builds today's live wallpapers for the Explore page's Live side: looping videos from Pixabay and Coverr, metadata
// only (the apps stream and download the videos from the sites' own CDNs), the same for every Oriel user. Once a day:
// an earlier run's list from today is kept as it is (both sites ask for results to be cached), so about fourteen API
// calls a day in all, however many people browse. The keys live only here, as repository secrets.
//
//   PIXABAY_API_KEY=... COVERR_API_KEY=... node scripts/live.mjs <out dir> [previous live.json]
//
// Writes <out>/live.json:
//   { version, day, videos: [{ id, source, sourceId, title, author, authorUrl, pageUrl, thumbnailUrl, posterUrl,
//                              files: [{ url, width, height }] (smallest first), seconds, tags: [...] }] }

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PIXABAY_KEY = process.env.PIXABAY_API_KEY;
const COVERR_KEY = process.env.COVERR_API_KEY;
// Wide enough for a desktop, in landscape.
const MIN_WIDTH = 1920;
const MAX_VIDEOS = 300;
const MIN_VIDEOS = 20;

// Each site's own words for videos made to loop, and the themes people pick wallpapers from.
const PIXABAY_QUERIES = ["seamless loop", "live wallpaper", "loop nature", "loop ocean", "loop space", "loop abstract",
  "loop city", "loop rain", "loop snow", "loop forest"];
const COVERR_QUERIES = ["loop", "background", "nature", "ocean"];

const capitalized = (text) => {
  const t = (text ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Live wallpaper";
};

let calls = 0;
async function get(url, site) {
  calls++;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${site} ${res.status}`);
  return res.json();
}

async function fromPixabay(query) {
  const url = `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=50` +
    `&min_width=${MIN_WIDTH}&safesearch=true&order=popular`;
  const json = await get(url, "Pixabay");
  return (json.hits ?? []).flatMap((hit) => {
    const sizes = ["tiny", "small", "medium", "large"].map((s) => hit.videos?.[s]).filter((v) => v?.url);
    const largest = sizes.at(-1);
    if (!largest || largest.width <= largest.height) return [];
    return [{
      id: `pixabay-${hit.id}`,
      source: "Pixabay",
      sourceId: String(hit.id),
      title: capitalized(hit.name || hit.tags),
      author: hit.user || "Pixabay",
      authorUrl: hit.userURL ?? null,
      pageUrl: hit.pageURL ?? `https://pixabay.com/videos/id-${hit.id}/`,
      thumbnailUrl: sizes[Math.min(1, sizes.length - 1)].thumbnail ?? "",
      posterUrl: largest.thumbnail ?? "",
      files: sizes.map((v) => ({ url: v.url, width: v.width, height: v.height })),
      seconds: hit.duration ?? 0,
      tags: (hit.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    }];
  });
}

async function fromCoverr(query) {
  const url = `https://api.coverr.co/videos?query=${encodeURIComponent(query)}&page_size=30&urls=true&api_key=${COVERR_KEY}`;
  const json = await get(url, "Coverr");
  return (json.hits ?? []).flatMap((hit) => {
    const [width, height] = [Number(hit.max_width) || 0, Number(hit.max_height) || 0];
    if (hit.is_vertical || width < MIN_WIDTH || width <= height || !hit.urls?.mp4) return [];
    const id = hit.id ?? hit.video_id;
    return [{
      id: `coverr-${id}`,
      source: "Coverr",
      sourceId: id,
      title: capitalized(hit.title),
      author: "Coverr",
      authorUrl: "https://coverr.co/",
      pageUrl: hit.slug ? `https://coverr.co/videos/${hit.slug}` : "https://coverr.co/",
      thumbnailUrl: hit.thumbnail ?? "",
      posterUrl: hit.poster ?? hit.thumbnail ?? "",
      files: [{ url: hit.urls.mp4, width, height }],
      seconds: Number(hit.duration) || 0,
      tags: Array.isArray(hit.tags) ? hit.tags : [],
    }];
  });
}

/** The lists taken in turn (so both sites show near the top), each video once. */
function merge(lists) {
  const seen = new Set();
  const merged = [];
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const list of lists)
      if (i < list.length && !seen.has(list[i].id)) {
        seen.add(list[i].id);
        merged.push(list[i]);
      }
  return merged.slice(0, MAX_VIDEOS);
}

async function collect(fetchOne, queries) {
  const lists = [];
  for (const query of queries) {
    try {
      lists.push(await fetchOne(query));
    } catch (e) {
      console.warn(`${query}: ${e.message}`);
    }
  }
  return lists;
}

const [outDir = "out", previousPath] = process.argv.slice(2);
const day = new Date().toISOString().slice(0, 10);

let previous = null;
try {
  if (previousPath) previous = JSON.parse(readFileSync(previousPath, "utf8"));
} catch {
  previous = null;
}

mkdirSync(outDir, { recursive: true });
const write = (feed) => writeFileSync(join(outDir, "live.json"), JSON.stringify(feed));

if (previous?.day === day && previous.videos?.length) {
  console.log(`${day}: today's ${previous.videos.length} live wallpapers are kept`);
  write(previous);
} else {
  if (!PIXABAY_KEY && !COVERR_KEY) throw new Error("PIXABAY_API_KEY and COVERR_API_KEY are not set");
  const lists = [
    ...(PIXABAY_KEY ? await collect(fromPixabay, PIXABAY_QUERIES) : []),
    ...(COVERR_KEY ? await collect(fromCoverr, COVERR_QUERIES) : []),
  ];
  const videos = merge(lists);
  console.log(`${day}: ${videos.length} live wallpapers, ${calls} calls`);
  if (videos.length >= MIN_VIDEOS) write({ version: 1, day, videos });
  else if (previous?.videos?.length) {
    console.warn("Too few live wallpapers today; yesterday's stay up.");
    write(previous);
  } else throw new Error("Too few live wallpapers and none from before.");
}
