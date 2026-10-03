'use strict';

/** ICY radio metadata: strips the blocks interleaved every icy-metaint bytes and reports StreamTitle changes. */

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

function decode(bytes) {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/** Parse "StreamTitle='Artist - Title';StreamUrl='';" into fields. */
function parseIcyMeta(text) {
  const clean = String(text).replace(/\0+$/, '');
  const out = {};
  const re = /(\w+)='((?:[^']|'(?!;))*)';/g;
  let m;
  while ((m = re.exec(clean))) out[m[1]] = m[2];
  if (!('StreamTitle' in out)) {
    const t = /StreamTitle='(.*)'/.exec(clean);
    if (t) out.StreamTitle = t[1];
  }
  return out;
}

/** Split "Artist - Title" the way most stations format it. */
function splitTitle(streamTitle) {
  const s = String(streamTitle || '').trim();
  const i = s.indexOf(' - ');
  if (i > 0) return { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() };
  return { artist: '', title: s };
}

/**
 * @param {number} metaint bytes of audio between metadata blocks
 * @param {(meta: object) => void} onMeta called when the StreamTitle changes
 */
function createIcyTransform(metaint, onMeta) {
  let state = 'audio';
  let toAudio = metaint;
  let metaLen = 0;
  let metaBuf = null;
  let metaGot = 0;
  let last = null;
  return new TransformStream({
    transform(chunk, controller) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      let i = 0;
      while (i < bytes.length) {
        if (state === 'audio') {
          const n = Math.min(toAudio, bytes.length - i);
          controller.enqueue(bytes.slice(i, i + n));
          i += n;
          toAudio -= n;
          if (toAudio === 0) state = 'len';
        } else if (state === 'len') {
          metaLen = bytes[i++] * 16;
          if (metaLen === 0) {
            state = 'audio';
            toAudio = metaint;
          } else {
            metaBuf = new Uint8Array(metaLen);
            metaGot = 0;
            state = 'meta';
          }
        } else {
          const n = Math.min(metaLen - metaGot, bytes.length - i);
          metaBuf.set(bytes.subarray(i, i + n), metaGot);
          metaGot += n;
          i += n;
          if (metaGot === metaLen) {
            const meta = parseIcyMeta(decode(metaBuf));
            if (meta.StreamTitle !== undefined && meta.StreamTitle !== last) {
              last = meta.StreamTitle;
              try {
                onMeta({ ...meta, ...splitTitle(meta.StreamTitle) });
              } catch {
                /* listener errors must not break the stream */
              }
            }
            state = 'audio';
            toAudio = metaint;
          }
        }
      }
    },
  });
}

module.exports = { createIcyTransform, parseIcyMeta, splitTitle };
