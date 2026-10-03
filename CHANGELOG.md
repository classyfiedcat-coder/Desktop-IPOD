# Changelog

## 2.0.0

The iPod now lives on your desktop as a real 3D object, and gained radio, podcasts, lyrics, Cover Flow and much more.

### It's a 3D object now
- The body is a real 3D model rendered with WebGL: smooth rounded edges where the front plastic meets the steel shell, a headphone jack you can see into, a chrome hold slider that moves in its slot (and can be clicked), and a dock connector with its row of pins. The screen and click wheel stay sharp HTML on top, lined up to the pixel.
- It turns toward your mouse pointer anywhere on screen, lifts and sways when you carry it, settles with a bounce, nudges when you press the wheel, floats gently when idle, and flips over with momentum (double-click).
- Reflections slide across the glossy front, the screen glass (with a soft-box reflection when you tip it toward the light) and the chrome. The screen sits behind the glass with a little parallax.
- A polished mirror or glossy black steel back reflecting a studio, with etched lettering, capacity, fine print and regulatory marks. Wear (Brand New, A Few Months, Well Loved) adds scratches, swirls, smudges and dust that break up the reflections.
- Settings › Appearance: Motion (Follow Pointer, Only on Hover, Off), Motion Amount, Reflections, Wear, Back (Auto, Polished Steel, Black), Float When Idle, and Detail (High 3D, or Light). Light is also used automatically when WebGL isn't available.

### Music
- A new audio engine: gapless playback, crossfade (kept gapless within an album), a custom 10-band EQ, Sound Check, playback speed, and bookmarks for audiobooks and podcasts.
- Up Next: Play Next and Add to Up Next from any song, album or playlist, and an Up Next screen.
- Cover Flow.
- Your own playlists: create, rename, add songs, export as `.m3u8`.
- Song options (hold the centre button): Up Next, playlists, browse album or artist, Song Info, ratings.
- Lyrics from LRCLIB, time-synced when available, plus embedded and `.lrc` lyrics.
- Get Album Artwork finds missing covers online (iTunes, then MusicBrainz and the Cover Art Archive).
- Search with a click-wheel text entry (or type and paste).

### Radio and podcasts
- Internet radio from radio-browser.info: Top Stations, Most Loved, Local Stations, Genres, Countries and Search, with the song title from the stream, favourites and recently played.
- Podcasts: Top Podcasts, Search, Add by Address, OPML import and export, downloads, resume where you left off, and played/unplayed.

### Spotify
- Add to Queue, add to your Spotify playlists, the playing device in Now Playing, and Spotify results in Search.

### Extras
- Solitaire, Contacts (`.vcf`) and Calendars (`.ics`, with repeating events and birthdays).
- Videos sorted into Movies, Music Videos, TV Shows and Video Podcasts, with subtitles and resume.
- Colours: White, Black, U2 Special Edition and Custom (with a colour editor); engraving on the back; an optional wheel glow; startup and power-off animations.

### Desktop
- Taskbar thumbnail buttons, a jump list, global shortcuts (Ctrl+Alt+Space, ←, →, ↑, ↓, I), Open With and drag and drop of music files and folders, song notifications, snapping to screen edges, opacity, start with Windows, and software updates for the installed version.
- The tray and right-click menu have colour, size and motion submenus.
- Back up and restore your settings.

### Under the hood
- Library scanning in a separate process, with an incremental index, folder watching and an artwork cache. Songs on a drive that's unplugged are kept until it's back.
- Every internet request goes through one network layer with timeouts and pacing. Addresses from feeds and streams can't reach your home network, even through redirects or DNS tricks.
- Settings are saved even if you quit the moment after changing them.
- Unit tests, and end-to-end tests that drive the real app (with the 3D body on a software renderer) in CI.

## 1.0.0

The first release: a frameless iPod 5th generation with a working click wheel, the iPod menus and Now Playing, your local music library, Spotify, games and extras.
