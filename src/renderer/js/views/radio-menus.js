/** Radio: favourites, top stations, local stations, genres, countries, search. */

import { ListView } from './list.js';
import { SearchView } from './search.js';
import { songOptions } from './options.js';
import { stationTrack } from '../library/radio.js';

export function createRadioMenus(app) {
  const radio = app.radio;

  const play = (stations, i) => {
    const tracks = stations.map(stationTrack);
    app.player.playTracks(tracks, i);
    radio.click(stations[i]);
    radio.addRecent(stations[i]);
    app.nav.nowPlaying();
  };

  const stationItems = (stations) =>
    stations.map((s, i) => ({
      label: s.name,
      sortName: s.name,
      value: s.bitrate ? `${s.bitrate}k` : s.countrycode || '',
      arrow: false,
      icon: () => (app.player.track && app.player.track.sid === s.uuid ? 'speaker' : null),
      action: () => play(stations, i),
      onHold: () => songOptions(app, stationTrack(s)),
    }));

  const stationsView = (title, load, empty = 'No stations found') =>
    new ListView({
      title,
      empty,
      index: true,
      load: async () => stationItems(await load()),
    });

  const genres = () =>
    new ListView({
      title: 'Genres',
      index: true,
      load: async () => (await radio.tags()).map((t) => ({ label: cap(t.name), sortName: t.name, value: String(t.count), view: () => stationsView(cap(t.name), () => radio.byTag(t.name)) })),
    });

  const countries = () =>
    new ListView({
      title: 'Countries',
      index: true,
      load: async () =>
        (await radio.countries())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ label: c.name, sortName: c.name, value: String(c.count), view: () => stationsView(c.name, () => radio.byCountry(c.code)) })),
    });

  const search = () =>
    new SearchView(app, {
      title: 'Search Radio',
      debounce: 450,
      search: async (q) => stationItems(await radio.search(q)),
    });

  return {
    root() {
      return new ListView({
        title: 'Radio',
        refreshOnEnter: true,
        items: () => {
          const items = [];
          if (radio.favorites.length) items.push({ label: 'Favorites', value: String(radio.favorites.length), view: () => new ListView({ title: 'Favorites', refreshOnEnter: true, empty: 'Hold Select on a station to add it.', items: () => stationItems(radio.favorites) }) });
          if (app.store.user.radioRecent.length) items.push({ label: 'Recently Played', view: () => new ListView({ title: 'Recently Played', items: () => stationItems(app.store.user.radioRecent) }) });
          items.push({ label: 'Top Stations', view: () => stationsView('Top Stations', () => radio.top()) });
          items.push({ label: 'Most Loved', view: () => stationsView('Most Loved', () => radio.popular()) });
          const cc = radio.localCountry();
          items.push({ label: 'Local Stations', value: cc, view: () => stationsView('Local Stations', () => radio.byCountry(cc)) });
          items.push({ label: 'Genres', view: genres });
          items.push({ label: 'Countries', view: countries });
          items.push({ label: 'Search Stations', view: search });
          return items;
        },
      });
    },
  };
}

function cap(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}
