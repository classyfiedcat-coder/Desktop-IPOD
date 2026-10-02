/** Up Next: what's queued and what's coming from the current list. */

import { ListView } from './list.js';
import { songOptions } from './options.js';

export function upNextView(app) {
  const { player } = app;
  const view = new ListView({
    title: 'Up Next',
    empty: 'Nothing is queued.',
    load: async () => build(),
  });

  async function build() {
    if (player.source === 'spotify') {
      const { queue } = await app.spotifyApi.queue();
      return queue.length
        ? [{ label: 'Spotify Queue', header: true }, ...queue.slice(0, 50).map((t) => ({ label: t.title, value: t.artist, arrow: false, onHold: () => songOptions(app, t) }))]
        : [];
    }
    const items = [];
    const cur = player.track;
    if (cur) items.push({ label: 'Now Playing', header: true }, { label: cur.title, value: cur.artist, icon: 'speaker', arrow: false, action: () => app.nav.nowPlaying() });
    const { upNext, rest } = player.queue.upcoming(150);
    if (upNext.length) {
      items.push({ label: 'Up Next', header: true });
      upNext.forEach((t, i) =>
        items.push({
          label: t.title,
          value: t.artist,
          arrow: false,
          action: () => (player.playUpNextAt(i), app.nav.nowPlaying()),
          onHold: () => {
            player.removeUpNext(i);
            view.reload();
            app.os.alert('Removed from Up Next', 900);
          },
        })
      );
      items.push({
        label: 'Clear Up Next',
        arrow: false,
        action: () => {
          player.clearUpNext();
          view.reload();
        },
      });
    }
    if (rest.length) {
      items.push({ label: player.store.settings.shuffle !== 'off' ? 'Coming Up (Shuffled)' : 'Coming Up', header: true });
      const base = player.queue.pos + 1;
      rest.forEach((t, i) =>
        items.push({
          label: t.title,
          value: t.artist,
          arrow: false,
          action: () => (player.jumpTo(base + i), app.nav.nowPlaying()),
          onHold: () => songOptions(app, t),
        })
      );
    }
    return items;
  }

  const off = player.on('queue', () => view.mounted && view.reload());
  const destroy = view.destroy.bind(view);
  view.destroy = () => {
    off();
    destroy();
  };
  return view;
}
