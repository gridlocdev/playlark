#!/usr/bin/env bash
# Generates the audio fixtures: short sine tones with made-up tags, in every format Playlark reads.
# Needs ffmpeg (with libmp3lame and libopus). Commit what it writes; tests never generate audio themselves.
set -euo pipefail
cd "$(dirname "$0")/.."

LIB=e2e/fixtures/basic
COVERS=e2e/fixtures/covers
CORE=packages/core/test/fixtures/audio
rm -rf "$LIB" "$COVERS" "$CORE"
mkdir -p "$LIB" "$COVERS" "$CORE"

# tone <seconds> <frequency> <sample rate> <out> [ffmpeg options…]
tone() {
  local seconds=$1 freq=$2 rate=$3 out=$4
  shift 4
  mkdir -p "$(dirname "$out")"
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=$freq:duration=$seconds:sample_rate=$rate" \
    -map_metadata -1 -fflags +bitexact -flags:a +bitexact "$@" "$out"
}

# tone_cover <seconds> <out> <image> [ffmpeg options…]: a tone with the image attached as its front cover.
tone_cover() {
  local seconds=$1 out=$2 image=$3
  shift 3
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=$seconds:sample_rate=44100" \
    -i "$image" -map 0:a -map 1:v -c:v copy -disposition:v attached_pic -metadata:s:v comment="Cover (front)" \
    -map_metadata -1 -fflags +bitexact -flags:a +bitexact "$@" "$out"
}

# image <colour> <out>: an 8×8 picture in one colour.
image() {
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=$1:s=8x8" -frames:v 1 "$2"
}

# ── The fixture library the browser and desktop checks open ──────────────────────────────────────────
NW="$LIB/Northwind Quartet/Harbour Lights"
tone 2 440 44100 "$NW/01 Morning Tide.mp3" -c:a libmp3lame -b:a 64k -id3v2_version 4 \
  -metadata title="Morning Tide" -metadata artist="Northwind Quartet" -metadata album="Harbour Lights" \
  -metadata album_artist="Northwind Quartet" -metadata track="1/3" -metadata date=2021 -metadata genre=Jazz
tone 2 494 44100 "$NW/02 Salt Air.flac" -c:a flac \
  -metadata title="Salt Air" -metadata artist="Northwind Quartet" -metadata album="Harbour Lights" \
  -metadata album_artist="Northwind Quartet" -metadata track=2 -metadata TRACKTOTAL=3 -metadata date=2021 -metadata genre=Jazz
tone 2 523 44100 "$NW/03 Lantern Walk.m4a" -c:a aac -b:a 64k \
  -metadata title="Lantern Walk" -metadata artist="Northwind Quartet" -metadata album="Harbour Lights" \
  -metadata album_artist="Northwind Quartet" -metadata track="3/3" -metadata date=2021 -metadata genre=Jazz

PK="$LIB/Paper Kites Club/Small Hours"
tone 2 587 44100 "$PK/1-01 Static Bloom.ogg" -c:a vorbis -strict -2 -ac 2 \
  -metadata title="Static Bloom" -metadata artist="Paper Kites Club" -metadata album="Small Hours" \
  -metadata track=1 -metadata disc="1/2" -metadata date=2019
tone 2 659 48000 "$PK/2-01 Night Bus.opus" -c:a libopus -b:a 32k \
  -metadata title="Night Bus" -metadata artist="Paper Kites Club" -metadata album="Small Hours" \
  -metadata track=1 -metadata disc="2/2" -metadata date=2019

tone 2 330 22050 "$LIB/Field Recordings/rain-on-tin.wav" -c:a pcm_s16le \
  -metadata title="Rain on Tin" -metadata artist="Field Recordings"
tone 2 392 44100 "$LIB/Loose/untagged.mp3" -c:a libmp3lame -b:a 64k -write_id3v2 0
printf 'Not music.\n' > "$LIB/notes.txt"
image teal "$PK/cover.jpg"
tone 1 300 44100 "$LIB/.hidden/secret.mp3" -c:a libmp3lame -b:a 64k

# ── Format edge cases for the tag reader tests ──────────────────────────────────────────────────────
tone 1 440 44100 "$CORE/id3v23.mp3" -c:a libmp3lame -b:a 64k -id3v2_version 3 \
  -metadata title="Ünïcödé Title" -metadata artist="Artist 2.3" -metadata album="Album 2.3" \
  -metadata track="7/9" -metadata disc="1/1" -metadata date=1999 -metadata genre="(17)" -metadata compilation=1
tone 1 440 44100 "$CORE/cbr-no-xing.mp3" -c:a libmp3lame -b:a 128k -write_xing 0 -id3v2_version 4 \
  -metadata title="Constant"
tone 1 440 44100 "$CORE/alac.m4a" -c:a alac -metadata title="Lossless" -metadata artist="ALAC Artist" \
  -metadata track="2/5" -metadata disc="1/2" -metadata compilation=1
tone 1 440 44100 "$CORE/wav-id3.wav" -c:a pcm_s16le -write_id3v2 1 -metadata title="WAV With ID3" \
  -metadata artist="Chunk Artist" -metadata album="Chunk Album"
tone 1 440 48000 "$CORE/stereo.opus" -c:a libopus -b:a 32k -ac 2 -metadata title="Opus Stereo" \
  -metadata ARTIST="First" -metadata album="Two Artists"

# Covers, sort names and ReplayGain in each format that carries them.
image orange "$CORE/cover.png"
tone_cover 1 "$CORE/apic.mp3" "$CORE/cover.png" -c:a libmp3lame -b:a 64k -id3v2_version 4 \
  -metadata title="With Cover" -metadata artist="The Sorters" -metadata artist-sort="Sorters, The" \
  -metadata album-sort="Album Sort" -metadata title-sort="Cover, With" \
  -metadata REPLAYGAIN_TRACK_GAIN="-6.54 dB" -metadata REPLAYGAIN_TRACK_PEAK="0.988525" \
  -metadata REPLAYGAIN_ALBUM_GAIN="-5.20 dB"
tone_cover 1 "$CORE/picture.flac" "$CORE/cover.png" -c:a flac \
  -metadata title="FLAC Cover" -metadata ARTISTSORT="Sorters, The" -metadata ALBUMARTISTSORT="Band, A" \
  -metadata REPLAYGAIN_TRACK_GAIN="+1.25 dB" -metadata REPLAYGAIN_ALBUM_PEAK="0.5"
tone_cover 1 "$CORE/covr.m4a" "$CORE/cover.png" -c:a aac -b:a 64k \
  -metadata title="M4A Cover" -metadata artist="M4A Artist"

# ── A second library: a song with its own cover, and a file that can't be read ──────────────────────
mkdir -p "$COVERS/Gallery"
tone_cover 1 "$COVERS/Gallery/framed.mp3" "$CORE/cover.png" -c:a libmp3lame -b:a 64k -id3v2_version 4 \
  -metadata title="Framed" -metadata artist="The Painters" -metadata album="Gallery"
printf 'This is not a FLAC file.' >"$COVERS/Gallery/broken.flac"

echo "Fixtures written to $LIB, $COVERS and $CORE."
