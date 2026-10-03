/** Lyrics for the current song: embedded tags first, then LRCLIB online. */

/** Parse [mm:ss.xx] synced lyrics; returns null for plain text. */
export function parseLrc(text) {
  if (!/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text || '')) return null;
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +`0.${m[3]}` : 0), text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Index of the line being sung at `pos` seconds (-1 before the first). */
export function lineAt(lines, pos) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= pos + 0.15) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export class LyricsService {
  constructor(store) {
    this.store = store;
    this.cache = new Map();
  }

  key(t) {
    return `${t.artist}\u0000${t.title}`;
  }

  /** { synced: [{t, text}] | null, plain: string | null, instrumental, source } or null */
  async get(t) {
    if (!t) return null;
    if (t.lyrics) {
      const synced = parseLrc(t.lyrics);
      return { synced, plain: synced ? null : t.lyrics, source: 'Embedded' };
    }
    if (!this.store.settings.lyricsOnline) return null;
    const { title, artist } = t;
    // Radio: only once the stream has told us what's playing.
    if (!title || !artist || (t.live && !t.nowPlaying)) return null;
    const key = this.key({ title, artist });
    if (this.cache.has(key)) return this.cache.get(key);
    const job = window.ipod.lyrics
      .get({ title, artist, album: t.live ? undefined : t.album, duration: t.live ? undefined : t.duration })
      .then((r) => (r ? { synced: r.synced ? parseLrc(r.synced) : null, plain: r.plain, instrumental: r.instrumental, source: r.source } : null))
      .catch(() => {
        this.cache.delete(key);
        return null;
      });
    this.cache.set(key, job);
    return job;
  }
}
