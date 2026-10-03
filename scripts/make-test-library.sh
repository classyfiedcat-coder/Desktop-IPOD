#!/usr/bin/env bash
# Test library for e2e: 19 tagged MP3s in 4 albums, an iTunes XML, photos, a video, a profile.
#   scripts/make-test-library.sh <dir>   (needs ffmpeg)
set -euo pipefail
OUT="${1:?usage: make-test-library.sh <dir>}"
mkdir -p "$OUT/music" "$OUT/pictures/Holiday" "$OUT/videos" "$OUT/covers"
ff() { ffmpeg -nostdin -loglevel error -y "$@"; }

cover() { # name c0 c1 c2
  ff -f lavfi -i "gradients=s=500x500:c0=$2:c1=$3:c2=$4:x0=0:y0=0:x1=500:y1=500:n=3:type=radial" -frames:v 1 "$OUT/covers/$1.jpg"
}
cover a 0xff5f6d 0xffc371 0x2b1055
cover b 0x00c6ff 0x0072ff 0x0b0b2b
cover c 0x56ab2f 0xa8e063 0x1d3b0f
cover d 0xf7971e 0xffd200 0x6a0d83

i=0
while IFS='|' read -r artist album cover year genre titles; do
  dir="$OUT/music/$artist/$album"
  mkdir -p "$dir"
  n=1
  IFS=',' read -ra TT <<< "$titles"
  for t in "${TT[@]}"; do
    f=$((220 + (i * 37 + n * 53) % 500))
    d=$((24 + (n * 7) % 20))
    ff -f lavfi -i "sine=frequency=$f:duration=$d" -i "$OUT/covers/$cover.jpg" \
      -map 0:a -map 1:v -c:a libmp3lame -b:a 96k -c:v mjpeg -id3v2_version 3 \
      -metadata title="$t" -metadata artist="$artist" -metadata album="$album" -metadata album_artist="$artist" \
      -metadata track="$n/${#TT[@]}" -metadata date="$year" -metadata genre="$genre" \
      -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" \
      "$dir/$(printf %02d $n) $t.mp3"
    n=$((n + 1))
  done
  i=$((i + 1))
done <<'LIST'
The Glass Arcade|Neon Skyline|a|2005|Electronic|Feel the Static,Neon Skyline,Afterglow,Signal Lost,Night Bus Home
Polaroid Kids|Summer Static|b|2006|Indie|Paper Moons,Coastline,Holiday Tapes,Cassette Hearts
Velvet Echo|Midnight Drive|c|2004|Rock|Highway Lights,Rearview,Tunnel Vision,Last Exit,Open Road,Dashboard Glow
Juniper|Paper Planets|d|2007|Pop|Orbit,Satellite Love,Gravity,Stardust Avenue
LIST

cp "$OUT"/covers/*.jpg "$OUT/pictures/"
for k in 1 2 3; do
  ff -f lavfi -i "mandelbrot=s=640x480:start_scale=$((k * 2))" -frames:v 1 "$OUT/pictures/Holiday/photo$k.jpg"
done
ff -f lavfi -i "testsrc=size=640x360:rate=25:duration=6" -f lavfi -i "sine=frequency=440:duration=6" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/videos/Test Pattern.mp4"

# An iTunes library that knows these songs (ratings, play counts, playlists).
node "$(dirname "$0")/make-test-itunes.js" "$OUT/music" "$OUT/iTunes/iTunes Music Library.xml" > /dev/null

mkdir -p "$OUT/profile"
cat > "$OUT/profile/state.json" <<JSON
{"app":{"settings":{"folders":["$OUT/music"],"photosFolder":"$OUT/pictures","videosFolder":"$OUT/videos","itunesFile":"$OUT/iTunes/iTunes Music Library.xml"},"user":{}}}
JSON
echo "test library ready in $OUT"
