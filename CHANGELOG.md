# Changelog

## 3.0.1

### Spotify
- A song picked from search no longer stops at the end, or when you skip it: your Spotify queue plays next, then a mix of songs like it (more from the same artist, never another version of the same song). If there's nothing like it, the rest of its album plays.

## 3.0.0

The iPod comes to the Mac, syncs with your iTunes or Music library, and keeps itself up to date.

### Mac
- A Mac app for Apple silicon and Intel Macs (macOS 13 Ventura or later), built and released alongside the Windows version.
- A proper Mac menu bar (iPod, Edit, Controls, Window, with ⌘Q and ⌘, for Settings), a menu bar icon that suits light and dark menu bars, and Show in Dock / Open at Login in Settings › Desktop. Clicking the Dock icon shows the iPod, and songs opened from Finder or dropped on the Dock icon play.
- Global shortcuts are ⌃⌥⌘ + Space, arrows and I on a Mac (⌘⌥ + arrows switches tabs in most apps).
- The Mac app isn't notarized by Apple yet: the first time, open it from System Settings › Privacy & Security › Open Anyway. It tells you when there's a new version; you download it yourself.

### iTunes and the Music app
- The iPod reads the library file that iTunes (Windows and Mac) and the Music app (Mac) share with other apps, like an iPod synced with iTunes.
- Your iTunes playlists appear in Music › Playlists, in their own order, including smart playlists (as they are now) and playlist folders.
- Star ratings, play counts, last played and date added come from iTunes, so Top 25 Most Played, Recently Played and My Top Rated reflect years of listening. Plays on the iPod add to iTunes', and a rating you give on the iPod wins. Nothing in iTunes is changed.
- It's read again whenever iTunes saves it, and matched to your music files by where they are. Settings › Music Library › iTunes Library shows how many songs matched and how to turn on sharing in iTunes or Music.

### Spotify
- Picking a song from search plays that song, then Spotify carries on the way it would itself: your queue, then songs like it (Spotify's autoplay). Before, the other search results played next, so after Céline Dion's "The Power of Love" came Huey Lewis's.
- Search results show album art, with the artist, album and year under each song, so you can tell versions apart at a glance: the original, a live version, a remaster, a soundtrack. Music › Search shows your own songs the same way.
- Explicit songs have Spotify's E in lists, search and Now Playing, and Now Playing shows the album's year.

### Updates install themselves
- The Windows app checks for new versions when it starts, every four hours and when your PC wakes up, and downloads them in the background. Then it waits for a quiet moment (nothing playing, no video, game, stopwatch or sleep timer running, not locked, and untouched for three minutes), installs silently and opens again where you left off. Before, it only checked once at startup and installed when you quit.
- Settings › Software Update is a menu: Check for Updates, Install Automatically (on by default) and the version. After an update, the iPod says "Updated to …" once.
- The portable version and the Mac app check for new versions too, and link to the download.

### Sharper screen
- The screen stays sharp when the iPod is tilted or floating. It's drawn at twice the resolution and scaled down, so small text no longer blurs at an angle.

## 2.0.0

The iPod now lives on your desktop as a real 3D object, and gained radio, podcasts, lyrics, Cover Flow and much more.

### It's a 3D object now
- The body is a real 3D model rendered with WebGL: smooth rounded edges where the front plastic meets the steel shell, a headphone jack you can see into, a chrome hold slider that moves in its slot (and can be clicked), and a dock connector with its row of pins. The screen and click wheel stay sharp HTML on top, lined up to the pixel.
- It turns toward your mouse pointer anywhere on screen, lifts and sways when you carry it, settles with a bounce, nudges when you press the wheel, floats gently when idle, and flips over with momentum (double-click).
- Reflections slide across the glossy front, the screen glass (with a soft-box reflection when you tip it toward the light) and the chrome. The screen sits behind the glass with a little parallax.
- A polished mirror or glossy black steel back reflecting a studio, with etched lettering, capacity (30GB, 60GB or 80GB, like the real ones), fine print and regulatory marks. Wear (Brand New, A Few Months, Well Loved) adds scratches, swirls, smudges and dust that break up the reflections.
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
- Light on your computer: nothing is drawn while nothing moves; motion is capped at about 90 fps on high refresh rate screens; the idle float draws about 20 frames a second and stops after five minutes; pointer moves too small to see don't draw a frame; Now Playing repaints once a second; the charging battery steps instead of animating every frame; and a GPU that can't keep up draws the 3D body at a lower resolution. Switching to Light detail frees the 3D body's graphics memory.
- Unit tests, and end-to-end tests that drive the real app (with the 3D body on a software renderer) in CI.

## 1.0.0

The first release: a frameless iPod 5th generation with a working click wheel, the iPod menus and Now Playing, your local music library, Spotify, games and extras.
