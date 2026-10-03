/* Browser-side mock of the Spotify Web API used by scripts/e2e.js. */
(() => {
    const art = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c + '"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/></svg>');
    const track = (n, al) => ({ id: 't' + n, uri: 'spotify:track:t' + n, name: 'Spotify Song ' + n, duration_ms: 180000 + n * 1000, track_number: n,
      artists: [{ id: 'ar1', name: 'Mock Artist' }], album: al });
    const album = { id: 'al1', uri: 'spotify:album:al1', name: 'Mock Album', artists: [{ name: 'Mock Artist' }], images: [{ url: art('#1ed760'), width: 300, height: 300 }], total_tracks: 3, release_date: '2024-01-01' };
    window.__calls = [];
    window.__plays = [];
    // Two songs with the same name: only the artist, album and year tell them apart.
    const powerAlbum = (id, name, artist, date, c) => ({ id, uri: 'spotify:album:' + id, name, artists: [{ name: artist }], images: [{ url: art(c) }], release_date: date });
    const SEARCH = [
      { id: 'pow1', uri: 'spotify:track:pow1', name: 'The Power of Love', duration_ms: 341000, explicit: false, artists: [{ id: 'cd', name: 'Céline Dion' }], album: powerAlbum('cdal', 'The Colour of My Love', 'Céline Dion', '1993-11-09', '#c0392b') },
      { id: 'pow2', uri: 'spotify:track:pow2', name: 'The Power of Love', duration_ms: 236000, explicit: true, artists: [{ id: 'hl', name: 'Huey Lewis & The News' }], album: powerAlbum('bttf', 'Back to the Future (Original Motion Picture Soundtrack)', 'Various Artists', '1985-07-03', '#2980b9') },
      track(7, album),
    ];
    let playing = { item: track(1, album), is_playing: true, progress_ms: 4000, device: { id: 'd1', name: 'My PC', type: 'Computer', is_active: true }, shuffle_state: false, repeat_state: 'off', context: { uri: 'spotify:playlist:pl1' } };
    const routes = [
      [/\/me\/player\/devices/, () => ({ devices: [{ id: 'd1', name: 'My PC', type: 'Computer', is_active: true }] })],
      [/\/me\/player\/play/, (u, o) => {
        const b = o.body ? JSON.parse(o.body) : {};
        window.__plays.push(b);
        const uri = (b.offset && b.offset.uri) || (b.uris && b.uris[b.offset && b.offset.position ? b.offset.position : 0]);
        if (uri) playing.item = SEARCH.find((t) => t.uri === uri) || track(+uri.replace(/\D/g, ''), album);
        playing.is_playing = true;
        return null;
      }],
      [/\/me\/player\/pause/, () => { playing.is_playing = false; return null; }],
      [/\/me\/player\/(next|previous|seek|volume|shuffle|repeat)/, () => null],
      [/\/me\/player\/recently-played/, () => ({ items: [{ track: track(2, album) }] })],
      [/\/me\/player(\?|$)/, () => playing],
      [/\/me\/playlists/, () => ({ items: [
        { id: 'pl1', uri: 'spotify:playlist:pl1', name: 'Road Trip', images: [{ url: art('#ff5f6d') }], items: { total: 3 }, owner: { id: 'tester' } },
        { id: 'pl2', uri: 'spotify:playlist:pl2', name: 'Followed Mix', images: [], items: { total: 50 }, owner: { id: 'someone' } } ], next: null })],
      [/\/playlists\/pl1\/items/, () => ({ items: [1, 2, 3].map((n) => ({ item: track(n, album) })), next: null, total: 3 })],
      [/\/playlists\/pl2\/items/, () => ({ __status: 403, error: { status: 403, message: 'Forbidden' } })],
      [/\/me\/tracks/, () => ({ items: [4, 5].map((n) => ({ track: track(n, album) })), next: null, total: 2 })],
      [/\/me\/albums/, () => ({ items: [{ album }], next: null })],
      [/\/albums\/al1\/tracks/, () => ({ items: [1, 2, 3].map((n) => ({ ...track(n), album: undefined })), next: null })],
      [/\/me\/following/, () => ({ artists: { items: [{ id: 'ar1', uri: 'spotify:artist:ar1', name: 'Mock Artist', images: [] }], next: null, cursors: {} } })],
      [/\/artists\/ar1\/albums/, () => ({ items: [album], next: null })],
      [/\/me\/shows/, () => ({ items: [], next: null })],
      [/\/me\/library\/contains/, () => [false]],
      [/\/me\/library/, () => null],
      [/\/search/, () => ({ tracks: { items: SEARCH }, albums: { items: [album] }, artists: { items: [] }, playlists: { items: [null] } })],
      [/\/me(\?|$)/, () => ({ id: 'tester', display_name: 'Test User' })],
    ];
    const realFetch = window.fetch;
    window.fetch = async (url, o = {}) => {
      if (!String(url).startsWith('https://api.spotify.com')) return realFetch(url, o);
      window.__calls.push((o.method || 'GET') + ' ' + String(url).replace('https://api.spotify.com/v1', ''));
      const r = routes.find(([re]) => re.test(String(url).split('?')[0] + (String(url).includes('?') ? '?' : '')));
      const body = r ? r[1](String(url), o) : { error: { status: 404, message: 'No mock' } };
      const status = body && body.__status ? body.__status : r ? (body === null ? 204 : 200) : 404;
      return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };
    const api = __ipod.spotifyApi;
    api.token = async () => 'mock-token';
    api.status = { configured: true, connected: true };
    api.emit('status', api.status);
    return true;
  })();
