// Builds this hour's Explore feed: Unsplash photo metadata only (no images), the same for every Oriel user.
// About twenty API calls an hour in all, however many people scroll: 300 photos for computers, 300 for phones.
//
//   UNSPLASH_ACCESS_KEY=... node scripts/build.mjs <out dir> [previous seen.json]
//
// Writes <out>/explore.json (what the apps read) and <out>/seen.json (photo IDs of the last twelve hours, so a photo
// doesn't come back for a while).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.UNSPLASH_ACCESS_KEY;
const API = "https://api.unsplash.com/";
const PER_SIDE = 300;
const CALLS_PER_SIDE = 10;
const EXTRA_CALLS = 4; // per side, only while repeats and small photos leave it short of PER_SIDE
// Long enough that a photo doesn't come straight back, short enough that the sources below never run dry.
const SEEN_HOURS = 12;

// Unsplash's curated topics (page through "popular") and the apps' built-in Interests (page through "relevant").
const TOPICS = ["wallpapers", "wallpapers", "nature", "travel", "architecture-interior", "textures-patterns",
  "street-photography", "experimental", "animals", "film", "3d-renders"];
const SEARCHES = ["nature", "mountains", "ocean", "beach", "lakes", "waterfalls", "forest", "autumn", "flowers",
  "desert", "snow", "northern lights", "night sky", "space", "sunset", "cities", "city at night", "architecture",
  "japan", "islands", "wildlife", "countryside", "aerial", "fog", "rain", "minimal", "abstract", "tropical", "canyon",
  "volcano", "lavender field", "starry night", "old town", "bridge", "road trip", "cherry blossom", "glacier"];

// Big enough to be a sharp wallpaper on a 4K screen / a modern phone.
const SIDES = {
  landscape: (p) => p.width > p.height && p.width >= 3000,
  portrait: (p) => p.height > p.width && p.height >= 2400,
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const page = (max) => 1 + Math.floor(Math.random() * max);

function nextSource(orientation) {
  if (Math.random() < 0.4) {
    const topic = pick(TOPICS);
    return { topic, url: `${API}topics/${topic}/photos?orientation=${orientation}&order_by=popular&per_page=30&page=${page(50)}` };
  }
  const query = pick(SEARCHES);
  return {
    topic: query,
    url: `${API}search/photos?orientation=${orientation}&content_filter=high&order_by=relevant&per_page=30` +
      `&page=${page(10)}&query=${encodeURIComponent(query)}`,
  };
}

let calls = 0;
async function api(url) {
  calls++;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${KEY}`, "Accept-Version": "v1" } });
  if (!res.ok) throw new Error(`Unsplash ${res.status} for ${url.replace(API, "")} (${res.headers.get("x-ratelimit-remaining")} left)`);
  const json = await res.json();
  return Array.isArray(json) ? json : json.results ?? [];
}

// Only what the apps use, in Unsplash's own shape, so each app reads it with the parser it already has.
const trim = (p, topic) => ({
  id: p.id,
  width: p.width,
  height: p.height,
  likes: p.likes ?? 0,
  color: p.color ?? null,
  blur_hash: p.blur_hash ?? null,
  description: p.description ?? null,
  alt_description: p.alt_description ?? null,
  topic,
  urls: { raw: p.urls.raw },
  links: { html: p.links.html, download_location: p.links.download_location },
  user: { name: p.user.name, username: p.user.username, links: { html: p.user.links.html } },
});

async function side(orientation, seen) {
  const fits = SIDES[orientation];
  const found = new Map();
  for (let i = 0; i < CALLS_PER_SIDE + EXTRA_CALLS && found.size < PER_SIDE; i++) {
    const source = nextSource(orientation);
    let photos;
    try {
      photos = await api(source.url);
    } catch (e) {
      console.warn(e.message);
      if (/ 40[13] /.test(e.message) || / 429 /.test(e.message)) break; // key refused or out of requests
      continue;
    }
    for (const p of photos) {
      // Free photos only (Unsplash+ ones live on plus.unsplash.com and need a licence).
      if (!p?.urls?.raw?.startsWith("https://images.unsplash.com/") || p.premium || p.plus) continue;
      if (!fits(p) || seen.has(p.id) || found.has(p.id)) continue;
      found.set(p.id, trim(p, source.topic));
    }
  }
  const list = [...found.values()].slice(0, PER_SIDE);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const [outDir = "out", seenPath] = process.argv.slice(2);
if (!KEY) throw new Error("UNSPLASH_ACCESS_KEY is not set");

const now = new Date();
const hour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
const hourId = hour.toISOString().replace(".000", "");

// seen.json = { "2026-10-21T14:00:00Z": ["id", ...], ... }, the last SEEN_HOURS hours.
let seenByHour = {};
try {
  if (seenPath) seenByHour = JSON.parse(readFileSync(seenPath, "utf8"));
} catch {
  seenByHour = {};
}
const cutoff = hour.getTime() - SEEN_HOURS * 3_600_000;
seenByHour = Object.fromEntries(Object.entries(seenByHour).filter(([h]) => Date.parse(h) > cutoff && h !== hourId));
const seen = new Set(Object.values(seenByHour).flat());

const landscape = await side("landscape", seen);
const portrait = await side("portrait", seen);
console.log(`${hourId}: ${landscape.length} landscape, ${portrait.length} portrait, ${calls} calls, ${seen.size} recently seen`);
if (landscape.length < 30 || portrait.length < 30) {
  // Keep the last feed rather than publish a thin one.
  throw new Error("Too few photos this hour; the previous feed stays up.");
}

seenByHour[hourId] = [...landscape, ...portrait].map((p) => p.id);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "explore.json"), JSON.stringify({ version: 1, hour: hourId, landscape, portrait }));
writeFileSync(join(outDir, "seen.json"), JSON.stringify(seenByHour));
