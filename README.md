# iPod for Desktop

A free-floating iPod (5th generation) that lives on your desktop, on Windows and Mac. There's no window frame, just the iPod, and it's a real 3D object that turns toward your mouse. Drag it anywhere, spin the click wheel, and play your music, internet radio, podcasts or your Spotify library. See what's new in the [changelog](CHANGELOG.md).

<p align="center">
  <img src="docs/white-nowplaying.png" width="300" alt="White iPod showing Now Playing" />
  <img src="docs/black-menu.png" width="300" alt="Black iPod showing the main menu" />
</p>

## Features

**It lives on your desktop**

<p align="center"><img src="docs/motion.gif" width="240" alt="The iPod turning toward the pointer, being picked up and flipped over" /></p>

- It's a real 3D model, not a flat picture. The body is rendered with WebGL: perfectly smooth rounded edges where the front plastic meets the steel shell, a headphone jack you can see into, a chrome hold slider that moves in its slot, and a dock connector with its row of pins. The screen and click wheel stay pin-sharp HTML on top, lined up to the pixel.
- The back is polished mirror steel (or glossy black steel) that reflects a studio around it, with matte etched lettering. Settings › Appearance › Wear adds scratches, swirls and smudges that break up the reflections, from Brand New to Well Loved.
- It turns gently toward your mouse pointer, wherever the pointer is on screen. As it turns, reflections slide across the glossy front, the screen glass and the chrome. The screen sits just behind the glass, so it shifts slightly against the bezel.
- Pick it up and it lifts off the desktop, its shadow spreads out, and it sways as you carry it. Put it down and it settles with a little bounce.
- Pressing the wheel pushes that edge in, and spinning it gives the body a slight twist. Left alone, it floats very gently for a few minutes, then comes to rest.
- Double-click it to flip it over and see the back (with your engraving).
- Settings › Appearance › Motion: Follow Pointer, Only on Hover, or Off (Off keeps it perfectly flat and pixel-sharp). You can also set the Motion Amount (Subtle, Normal or Dramatic), Reflections, and Float When Idle.
- Settings › Appearance › Detail: High (the 3D model) or Light (a lighter CSS version, also used automatically if your graphics don't support WebGL).
- It's light on your computer. When nothing moves, nothing is drawn. Motion is capped at about 90 frames a second on high refresh rate screens, and the idle float only needs about 20. Playing music repaints the screen once a second, when the clock ticks. If your graphics can't keep up, the 3D body is drawn at a lower resolution automatically.

**It feels like the real thing**
- A frameless, transparent window shaped like the iPod. Clicks pass through the empty space around it, and you drag it by its body.
- The click wheel works like the real one: drag around it to scroll, click MENU, ⏮, ⏭ or ▶❚❚, and press the centre button. It makes the clicker sound, and the part you press visibly sinks.
- Long presses behave like an iPod: hold ▶❚❚ to turn it off, hold MENU to jump to the main menu, hold ⏮/⏭ to rewind or fast-forward, and hold the centre button for a song's options.
- A working hold switch on the top edge, with the orange flag and a lock on screen.
- The backlight turns off after the timeout. Screens slide in and out, long titles scroll, and spinning fast through a long list shows a big letter.
- The 5th generation screen, with its cool white LCD: full-width menus with the blue highlight, and Now Playing with "6 of 15", album art and the glossy progress bar.
- White, Black, U2 Special Edition or your own colours (there's a colour editor), in four sizes, with an engraving on the back.

**Music**
- Local library: Cover Flow, Playlists (your own, and `.m3u` files), Artists, Albums, Compilations, Songs, Podcasts, Genres, Composers, Audiobooks and Search.
- Smart playlists: Recently Added, Top 25 Most Played, Recently Played and My Top Rated, plus On-The-Go.
- Up Next: Play Next or Add to Up Next from any song, album or playlist. Hold the centre button on a song for more: add to a playlist, browse its album or artist, Song Info.
- Now Playing: turn the wheel for volume. Click the centre button to cycle through the scrubber, the star rating, lyrics (time-synced from LRCLIB, or from the file) and the visualizer.
- Gapless playback or crossfade, Shuffle (Songs/Albums), Repeat (One/All), the classic EQ presets and a custom EQ, Sound Check, Volume Limit, and speeds for audiobooks and podcasts (which also remember where you were).
- Get Album Artwork finds missing covers online.
- Works with the media keys and the Windows media overlay or the Mac's Now Playing.

**iTunes and the Music app**
- Like an iPod synced with iTunes, it uses your iTunes or Music library: your playlists (smart playlists as they are now, and playlist folders), star ratings, play counts, last played and date added. Top 25 Most Played and My Top Rated reflect years of listening.
- It reads the library file iTunes and the Music app share with other apps, and reads it again whenever iTunes saves it. Plays on the iPod add to iTunes', and a rating you give on the iPod wins. Nothing in iTunes is changed.
- To turn on sharing: in iTunes on Windows, Edit › Preferences › Advanced › "Share iTunes Library XML with other applications". In the Music app on a Mac, Music › Settings › Files › "Share Library XML with other applications". Then see Settings › Music Library › iTunes Library.

**Radio and podcasts**
- Internet radio: top and most-loved stations, stations near you, genres, countries and search (from radio-browser.info), with the song that's playing and your favourites.
- Podcasts: top charts, search, subscribe by address, import and export OPML, download episodes, and pick up where you left off.

**Spotify**
- Playlists, Liked Songs, saved Albums, followed Artists, Podcasts, Recently Played, Search and Devices.
- Like songs from Now Playing, add them to the queue or to your playlists.
- Search shows album art, the artist, album and year for every song, so you can pick the version you want. A song picked from search plays on its own, then Spotify carries on with your queue and songs like it, just like in the Spotify app.
- Plays through the Spotify app on your computer, or any Spotify Connect speaker, with the iPod as the remote. If Spotify isn't open, the iPod opens it for you.

**Extras**
- Games: Brick, Parachute, Music Quiz and Solitaire.
- Clocks (world clocks with a day/night analog face), Alarms with snooze, a Sleep Timer, Stopwatch with laps, Screen Lock (4-digit combination), Contacts, Calendars and Notes.
- Photos (thumbnail grid, viewer, Ken Burns slideshow) and Videos (Movies, Music Videos, TV Shows, with subtitles).

**On your desktop**
- A tray icon (Windows) or menu bar icon (Mac) and a right-click menu: colour, size, motion, always on top, hide, quit… On Windows also taskbar play/pause buttons and a jump list; on a Mac, a proper menu bar.
- Global shortcuts that work from any app: Space to play/pause, ← / → previous/next, ↑ / ↓ volume, I to show or hide, with Ctrl+Alt on Windows and ⌃⌥⌘ on a Mac.
- Open music files with the iPod (Open With, or drop them on the Dock icon on a Mac), or drop files and folders on it.
- Snaps to screen edges, optional song notifications, and starts when you log in if you like.
- Updates itself (installed version). It checks for new versions every few hours and after your PC wakes up, and downloads them in the background. When the iPod is quiet (nothing playing, untouched for a few minutes), it installs the update and opens again where you left off. Turn this off in Settings › Software Update › Install Automatically, and it installs when you quit instead. The portable version tells you when there's a new version to download.

## Install

Download it from the [Releases page](../../releases):

- **Windows 10 or 11:** `iPod-Setup-x.y.z.exe` (the installer, which keeps itself up to date) or `iPod-Portable-x.y.z.exe` (no install). Windows SmartScreen may warn you because the app isn't code-signed: click **More info → Run anyway**.
- **Mac (macOS 13 Ventura or later):** `iPod-x.y.z-mac-arm64.dmg` for Apple silicon (M1 and later), or `iPod-x.y.z-mac-x64.dmg` for Intel Macs. Open it and drag iPod to Applications. The app isn't notarized by Apple yet, so the first time macOS won't open it: open it once, then go to **System Settings › Privacy & Security** and click **Open Anyway**.

### Run from source

```bash
npm install
npm start
```

Run the tests (the end-to-end ones need ffmpeg, and xvfb on Linux):

```bash
npm test
npm run e2e
```

Build the app yourself: on Windows the installer and portable exe, on a Mac the disk images.

```bash
npm run dist
```

### Making a release

Bump `version` in `package.json` and add its entry to the [changelog](CHANGELOG.md). Then, on GitHub, go to **Actions › Build › Run workflow**, tick **Publish a GitHub release**, and run it. Once the tests pass, it builds the Windows installer and portable exe and the Mac disk images, and publishes them on the Releases page as `v` + the version, with download links and the changelog entry. Pushing a `v*` tag does the same.

## Controls

| Mouse | Keyboard | Action |
| --- | --- | --- |
| Drag around the wheel / mouse scroll wheel | ↑ ↓ | Scroll, or volume in Now Playing |
| Centre button | Enter | Select |
| MENU | Esc / Backspace | Back (hold for the main menu) |
| ▶❚❚ | Space | Play/Pause (hold to turn off) |
| ⏮ ⏭ | ← → | Previous/Next (hold to rewind/fast-forward) |
| Hold switch on the top edge | H | Lock the buttons |
| Drag the case | | Move the iPod |
| Double-click the case | | Flip it over to see the back |
| Right-click | | Options: always on top, hide, quit… |

The iPod also has a tray icon. Click it to show or hide the iPod.

## Your music

By default the iPod reads your **Music** folder (on a Mac that includes the Music app's songs). To add more folders, go to **Settings › Music Library › Add Music Folder…**. The photo, video and notes folders are set there too.

Supported audio formats: MP3, AAC/M4A, M4B audiobooks, FLAC, WAV, OGG and Opus. Artwork comes from the file's tags or from a `cover.jpg`/`folder.jpg` next to the files.

## Connecting Spotify

Spotify requires every app to use its own Client ID. Setting it up takes about a minute, and the app walks you through it in **Settings › Spotify › Set Up Spotify…**:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create app**.
2. Add the Redirect URI `http://127.0.0.1:43827/callback`, and tick **Web API** and **Web Playback SDK**.
3. Copy the app's **Client ID** into the iPod and click **Connect**. Your browser opens so you can approve access.

Good to know:
- **Spotify Premium is required to control playback.** This is Spotify's rule for the Web API, and since February 2026 it also applies to the developer account that owns the app.
- Spotify apps in Development Mode work for up to 5 users, who must be added under **User Management** in the dashboard.
- In Development Mode, Spotify only lists the songs in playlists you own or collaborate on. For other playlists, the iPod offers **Play Playlist** and **Shuffle Playlist** instead.
- Sign-in uses PKCE (no client secret). Tokens are stored encrypted by the system (DPAPI on Windows, the Keychain on a Mac). Spotify asks you to sign in again after about six months.
- *Playing audio from the iPod itself:* stock Electron can't play Spotify's protected streams, so by default the iPod drives the Spotify app instead. If you build with a Widevine-enabled Electron (such as [castLabs Electron](https://github.com/castlabs/electron-releases)), the iPod detects it and registers itself as a Spotify Connect speaker named "iPod".

## Project layout

```
src/main/        Electron main process: frameless window, tray, app:// file server, library scanner, Spotify sign-in
src/preload/     The safe bridge between the iPod UI and the main process
src/renderer/    The iPod itself (no framework, plain ES modules)
  js/device.js     The physical iPod: case, click wheel and hold switch input
  js/body3d.js     The 3D body (WebGL): shell, ports, materials
  js/rig.js        The motion: pointer tilt, lift, sway, flip
  js/os.js         Navigation, backlight, sleep, hold, title bar
  js/views/        Every screen: menus, Now Playing, settings, extras, games
  js/player/       Local playback with EQ, the Spotify engine, queue/shuffle/repeat
  js/library/      Local library index and the Spotify Web API client
scripts/         Icon generator, test library generator and the end-to-end tests (npm run e2e)
test/            Unit tests (npm test)
```

The device is data-driven (`src/renderer/js/models.js`), so more iPod models can be added later as device themes.

## Credits

The 3D body is drawn with [three.js](https://threejs.org) (MIT licence, included in `src/renderer/vendor/three`).

## Legal

An unofficial fan project. It is not affiliated with, endorsed by or sponsored by Apple Inc. or Spotify AB. iPod and Click Wheel are trademarks of Apple Inc., and Spotify is a trademark of Spotify AB. The interface font is Source Sans 3 by Adobe, used under the SIL Open Font License 1.1 (`src/renderer/fonts/OFL.txt`).

MIT License.
