'use strict';

/** Spotify sign-in: Authorization Code + PKCE via a loopback redirect, the user's own Client ID, tokens encrypted with safeStorage. */

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { shell, safeStorage, net } = require('electron');

const PORT = 43827;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
];

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class SpotifyAuth {
  constructor(userDataDir, onChange) {
    this.file = path.join(userDataDir, 'spotify.json');
    this.onChange = onChange || (() => {});
    this.data = { clientId: process.env.SPOTIFY_CLIENT_ID || '', tokens: null, user: null };
    this.pending = null;
    this._refreshing = null;
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.clientId = raw.clientId || this.data.clientId;
      this.data.user = raw.user || null;
      if (raw.tokens) {
        if (raw.encrypted && safeStorage.isEncryptionAvailable()) {
          this.data.tokens = JSON.parse(safeStorage.decryptString(Buffer.from(raw.tokens, 'base64')));
        } else if (!raw.encrypted) {
          this.data.tokens = raw.tokens;
        }
      }
    } catch {
      /* not configured yet */
    }
  }

  _save() {
    const out = { clientId: this.data.clientId, user: this.data.user, encrypted: false, tokens: null };
    if (this.data.tokens) {
      if (safeStorage.isEncryptionAvailable()) {
        out.encrypted = true;
        out.tokens = safeStorage.encryptString(JSON.stringify(this.data.tokens)).toString('base64');
      } else {
        out.tokens = this.data.tokens;
      }
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(out));
    } catch (err) {
      console.error('[spotify] could not persist tokens', err);
    }
  }

  status() {
    return {
      clientId: this.data.clientId,
      configured: !!this.data.clientId,
      connected: !!(this.data.tokens && this.data.tokens.refresh_token),
      user: this.data.user,
      redirectUri: REDIRECT_URI,
      pending: !!this.pending,
    };
  }

  setClientId(id) {
    const clean = String(id || '').trim();
    if (clean && !/^[a-zA-Z0-9]{16,64}$/.test(clean)) throw new Error('That does not look like a Spotify Client ID.');
    if (clean !== this.data.clientId) this.data.tokens = null;
    this.data.clientId = clean;
    this._save();
    this.onChange(this.status());
    return this.status();
  }

  setUser(user) {
    this.data.user = user ? { id: user.id, name: user.display_name || user.id } : null;
    this._save();
    this.onChange(this.status());
  }

  logout() {
    this.data.tokens = null;
    this.data.user = null;
    this._save();
    this.onChange(this.status());
    return this.status();
  }

  async login() {
    if (!this.data.clientId) throw new Error('Add your Spotify Client ID first.');
    if (this.pending) {
      shell.openExternal(this.pending.url);
      return this.pending.promise;
    }
    await this._closeServer();
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const url =
      'https://accounts.spotify.com/authorize?' +
      new URLSearchParams({
        client_id: this.data.clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
        scope: SCOPES.join(' '),
      }).toString();

    let timeout;
    let settled = false;
    const promise = new Promise((resolve, reject) => {
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.pending = null;
        this._closeServer();
        this.onChange(this.status());
        if (error) reject(error);
        else resolve(this.status());
      };
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, REDIRECT_URI);
        if (u.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        // Ignore stray requests that don't belong to this sign-in attempt.
        if (u.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(false, 'This sign-in link has expired. Try again from your iPod.'));
          return;
        }
        const err = u.searchParams.get('error');
        const code = u.searchParams.get('code');
        if (err || !code) {
          const msg = err === 'access_denied' ? 'You cancelled the Spotify sign-in.' : err || 'Spotify sign-in failed.';
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(false, msg));
          finish(new Error(msg));
          return;
        }
        try {
          const tokens = await this._token({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: this.data.clientId,
            code_verifier: verifier,
          });
          this.data.tokens = tokens;
          this._save();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(true));
          finish(null);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(false, e.message));
          finish(e);
        }
      });
      this._server = server;
      server.on('error', (e) => {
        finish(new Error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use by another program. Close it and try again.` : e.message));
      });
      server.listen(PORT, '127.0.0.1', () => shell.openExternal(url));
      timeout = setTimeout(() => finish(new Error('Spotify sign-in timed out. Try again.')), 5 * 60 * 1000);
    });
    this.pending = { url, promise };
    this.onChange(this.status());
    return promise;
  }

  _closeServer() {
    const server = this._server;
    this._server = null;
    if (!server || !server.listening) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      if (server.closeAllConnections) server.closeAllConnections();
    });
  }

  async accessToken() {
    const t = this.data.tokens;
    if (!t) return null;
    if (t.expires_at && t.expires_at - Date.now() > 60 * 1000) return t.access_token;
    if (!t.refresh_token) return null;
    if (!this._refreshing) {
      this._refreshing = this._token({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: this.data.clientId,
      })
        .then((fresh) => {
          this.data.tokens = { ...t, ...fresh, refresh_token: fresh.refresh_token || t.refresh_token };
          this._save();
          return this.data.tokens.access_token;
        })
        .catch((err) => {
          if (err.status === 400 || err.status === 401) {
            // Refresh token revoked or expired (Spotify expires them after ~6 months).
            this.data.tokens = null;
            this._save();
            this.onChange(this.status());
          }
          throw err;
        })
        .finally(() => {
          this._refreshing = null;
        });
    }
    return this._refreshing;
  }

  /** Force the next accessToken() call to refresh (used after a 401). */
  invalidate() {
    if (this.data.tokens) this.data.tokens.expires_at = 0;
  }

  async _token(params) {
    // Chromium's network stack (system proxy, certificates), with a timeout so
    // a stalled refresh can never wedge every later request.
    let res;
    try {
      res = await net.fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      throw new Error(err.name === 'TimeoutError' ? 'Spotify didn’t answer. Check your connection and try again.' : `Couldn’t reach Spotify (${err.message}).`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(body.error_description || body.error || `Token request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      scope: body.scope,
      expires_at: Date.now() + (body.expires_in || 3600) * 1000,
    };
  }
}

function page(ok, message) {
  const title = ok ? 'Connected to Spotify' : 'Could not connect';
  const sub = ok ? 'You can close this tab and go back to your iPod.' : escapeHtml(message || 'Something went wrong.');
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#121212;color:#fff;font:16px/1.5 "Segoe UI",system-ui,sans-serif}
  .card{text-align:center;padding:40px 48px;border-radius:20px;background:#1d1d1f;box-shadow:0 20px 60px #0008}
  .dot{width:64px;height:64px;border-radius:50%;margin:0 auto 18px;background:${ok ? '#1ed760' : '#e5484d'};display:grid;place-items:center;font-size:34px;color:#121212}
  h1{font-size:22px;margin:0 0 6px} p{margin:0;color:#b3b3b3}
</style>
<div class="card"><div class="dot">${ok ? '&#10003;' : '!'}</div><h1>${title}</h1><p>${sub}</p></div>
${ok ? '<script>setTimeout(()=>window.close(),2500)</script>' : ''}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

module.exports = { SpotifyAuth, REDIRECT_URI };
