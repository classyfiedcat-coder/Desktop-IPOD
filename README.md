# iPod for Desktop

A free-floating iPod (5th generation) that lives on your Windows desktop. There's no window frame, just the iPod. Drag it anywhere, spin the click wheel with your mouse, and play your music or your Spotify library.

<p align="center">
  <img src="docs/white-nowplaying.png" width="300" alt="White iPod showing Now Playing" />
  <img src="docs/black-menu.png" width="300" alt="Black iPod showing the main menu" />
</p>

## Features

**It feels like the real thing**
- A frameless, transparent window shaped like the iPod. Clicks pass through the empty space around it, and you drag it by its body.
- The click wheel works like the real one: drag around it to scroll, click MENU, ⏮, ⏭ or ▶❚❚, and press the centre button. It makes the clicker sound, and the part you press visibly sinks.
- Long presses behave like an iPod: hold ▶❚❚ to turn it off, hold MENU to jump to the main menu, hold ⏮/⏭ to rewind or fast-forward, and hold the centre button on a song to add it to On-The-Go.
- A working hold switch on the top edge, with the orange stripe and a lock on screen.
- The backlight turns off after the timeout. Screens slide in and out, long titles scroll, and spinning fast through a long list shows a big letter.
- The 5th generation screen: full-width menus with the blue highlight, and Now Playing with "6 of 15", album art and the glossy progress bar.
- White or Black, in four sizes.

**Music**
- Local library: Playlists (including `.m3u`), Artists, Albums, Compilations, Songs, Podcasts, Genres, Composers, Audiobooks and Search.
- Smart playlists: Recently Added, Top 25 Most Played, Recently Played and My Top Rated, plus On-The-Go.
- Now Playing: turn the wheel for volume. Click the centre button to cycle through the scrubber, the star rating and lyrics (including synced `.lrc` lyrics).
- Shuffle (Songs/Albums), Repeat (One/All), the 24 classic EQ presets, Sound Check, Volume Limit and audiobook speed.
- Remembers where you left off, counts plays, and works with the Windows media keys and media overlay.

**Spotify**
- Playlists, Liked Songs, saved Albums, followed Artists, Podcasts, Recently Played, Search and Devices.
- Like songs from Now Playing.
- Plays through the Spotify app on your PC, or any Spotify Connect speaker, with the iPod as the remote. If Spotify isn't open, the iPod opens it for you.

**Extras**
- Games: Brick, Parachute and Music Quiz.
- Clocks (world clocks with a day/night analog face), Alarms with snooze, a Sleep Timer, Stopwatch with laps, Screen Lock (4-digit combination), Calendar and Notes.
- Photos (thumbnail grid, viewer, Ken Burns slideshow) and Videos.

## Install

Download the latest `iPod-Setup-x.y.z.exe` (installer) or `iPod-Portable-x.y.z.exe` from the [Releases page](../../releases), or from the **Build** workflow's artifacts on the Actions tab.

Windows SmartScreen may warn you because the app isn't code-signed. Click **More info → Run anyway**.

### Run from source

```bash
npm install
npm start
```

Build the Windows installer and portable exe yourself (on Windows):

```bash
npm run dist
```

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
| Right-click | | Options: always on top, hide, quit… |

The iPod also has a tray icon. Click it to show or hide the iPod.

## Your music

By default the iPod reads your Windows **Music** folder. To add more folders, go to **Settings › Music Library › Add Music Folder…**. The photo, video and notes folders are set there too.

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
- Sign-in uses PKCE (no client secret). Tokens are stored encrypted with Windows' DPAPI. Spotify asks you to sign in again after about six months.
- *Playing audio from the iPod itself:* stock Electron can't play Spotify's protected streams, so by default the iPod drives the Spotify app instead. If you build with a Widevine-enabled Electron (such as [castLabs Electron](https://github.com/castlabs/electron-releases)), the iPod detects it and registers itself as a Spotify Connect speaker named "iPod".

## Project layout

```
src/main/        Electron main process: frameless window, tray, app:// file server, library scanner, Spotify sign-in
src/preload/     The safe bridge between the iPod UI and the main process
src/renderer/    The iPod itself (no framework, plain ES modules)
  js/device.js     The physical iPod: case, click wheel and hold switch input
  js/os.js         Navigation, backlight, sleep, hold, title bar
  js/views/        Every screen: menus, Now Playing, settings, extras, games
  js/player/       Local playback with EQ, the Spotify engine, queue/shuffle/repeat
  js/library/      Local library index and the Spotify Web API client
scripts/         Icon generator and the development screenshot tour (scripts/e2e.js)
```

The device is data-driven (`src/renderer/js/models.js`), so more iPod models can be added later as device themes.

## Legal

An unofficial fan project. It is not affiliated with, endorsed by or sponsored by Apple Inc. or Spotify AB. iPod and Click Wheel are trademarks of Apple Inc., and Spotify is a trademark of Spotify AB. The interface font is Source Sans 3 by Adobe, used under the SIL Open Font License 1.1 (`src/renderer/fonts/OFL.txt`).

MIT License.
