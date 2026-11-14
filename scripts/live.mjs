// Builds today's live wallpapers for the Explore page's Live side: looping videos from Pixabay and Coverr, metadata
// only (the apps stream and download the videos from the sites' own CDNs), the same for every Oriel user. Once a day:
// an earlier run's list from today is kept as it is (both sites ask for results to be cached), so about fourteen API
// calls a day in all, however many people browse. The keys live only here, as repository secrets.
//
// The searches are the same every day and their popular results barely move, so each day takes a big pool (up to 200
// per Pixabay search, a different page of Coverr's), shuffles it with the day as the seed and puts yesterday's videos
// last: a new list every day, with no more calls.
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
// Pixabay's most per call; each search then gives about 130 landscape videos to choose from.
const PIXABAY_PER_PAGE = 200;
const COVERR_PAGE_SIZE = 30;
// Coverr's page turns each day among the first few (every search has at least this many).
const COVERR_PAGES = 5;

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
  const url = `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=${PIXABAY_PER_PAGE}` +
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
  const page = (dayNumber % COVERR_PAGES) + 1;
  const url = (p) => `https://api.coverr.co/videos?query=${encodeURIComponent(query)}&page_size=${COVERR_PAGE_SIZE}&page=${p}&urls=true&api_key=${COVERR_KEY}`;
  let json = await get(url(page), "Coverr");
  // A search with fewer pages than that: its first page, as before.
  if (!json.hits?.length && page > 1) json = await get(url(1), "Coverr");
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

/** A random number generator that gives the same numbers for the same seed (mulberry32). */
function seeded(text) {
  let seed = [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let x = Math.imul(seed ^ (seed >>> 15), seed | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** One search's videos for today: shuffled by the day, the ones yesterday's list had at the end. */
function forToday(list, random, yesterday) {
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [...shuffled.filter((v) => !yesterday.has(v.id)), ...shuffled.filter((v) => yesterday.has(v.id))];
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
const dayNumber = Math.floor(Date.parse(day) / 86_400_000);

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
  const random = seeded(day);
  const yesterday = new Set((previous?.videos ?? []).map((v) => v.id));
  const videos = merge(lists.map((list) => forToday(list, random, yesterday)));
  const repeated = videos.filter((v) => yesterday.has(v.id)).length;
  console.log(`${day}: ${videos.length} live wallpapers (${repeated} also yesterday), ${calls} calls`);
  if (videos.length >= MIN_VIDEOS) write({ version: 1, day, videos });
  else if (previous?.videos?.length) {
    console.warn("Too few live wallpapers today; yesterday's stay up.");
    write(previous);
  } else throw new Error("Too few live wallpapers and none from before.");
}
