# Playlark — product requirements

Playlark is a music player for one person's own library: a folder of MP3, FLAC, M4A (AAC and ALAC), Ogg (Vorbis and Opus) and WAV files. It runs as a desktop app (Electron), in the browser from a self-hosted NAS server (installable on a phone), and as a `playlark` command line, all on the same engine. It replaces the Music app and YT Music for music the user owns. Code cites this document as `PRD §n`.

## §1 Goals

1. Point it at a music folder and see every song, album and artist within a minute, with cover art, without changing a file.
2. Play gaplessly: consecutive songs join sample-exactly, so live albums and mixes never click or pause.
3. Find anything fast: browse by artist, album, song or folder, and search as you type over 50,000 songs.
4. A queue that behaves like the Music app's: Play, Play Next, Add to Queue, shuffle, repeat, reorder.
5. Playlists are plain `.m3u8` files in the music folder that other players open.
6. Control playback from the keyboard's media keys and the macOS Now Playing widget, and from a phone's lock screen through the NAS.
7. Never lose music or edits: the music folder is only written by the user's own actions (playlists, tag edits), every write is atomic and checked, and a file whose tags are edited is kept in the trash first.

## §2 Non-goals for 1.0

- Streaming services, internet radio, podcasts, audiobooks (`.m4b`), video.
- Transcoding. A file a client can't decode is marked and skipped (§12); there is no ffmpeg anywhere.
- More than one library folder. Deleting, moving or renaming music files.
- ReplayGain analysis of untagged files (tags are used when present, §8.6). Equalizer, lyrics, smart playlists, scrobbling, BPM.
- Syncing favourites and play counts between the desktop app and the NAS (§10.1: each keeps its own).
- A native iOS app. The phone uses the NAS web app installed to the home screen (§18.5).
- Accounts or logins on the NAS server (it is for the home network, like the sibling apps).
- AirPlay or Cast pickers inside the app: playback goes to the system's output device.

## §3 The library

### §3.1 The music folder

- The library is one folder the user picks (§16.2, §17, §18). Playlark reads every supported file under it, recursively.
- Supported files, by extension (case-insensitive): `.mp3`, `.flac`, `.m4a`, `.ogg`, `.oga`, `.opus`, `.wav`. Everything else is ignored, except images used as cover art (§4.6) and playlists (§9).
- Skipped: names starting with `.` (files and folders), `@eaDir` and `#recycle` (Synology), `$RECYCLE.BIN`, `System Volume Information`. Symlinks are followed only when their target is inside the music folder; a link that leads out, or a loop, is skipped.
- Playlark writes into the music folder only: playlist files (§9) and tag edits (§11). Nothing else, no hidden folders, no cache files.

### §3.2 The index

- Scanning produces the index: one entry per song with its path relative to the music folder (always `/` separators), size, modified time, the tags read (§4), duration, format, and a cover reference.
- The index is a cache, not data. It lives in the app's data folder (desktop: `libraries/<key>/library.json` in Electron's userData, one per music folder (§16.2); NAS: the server's data folder; browser: IndexedDB), never in the music folder. A missing, corrupt or newer-format index is thrown away and rebuilt with no question asked.
- Cover images found during scanning are stored once per distinct image (named by SHA-256 of the bytes) in `covers/` beside the index. Images no longer used by any song are deleted after a scan.
- Format: JSON `{ "format": 1, "root": "<absolute path or folder name>", "scannedAt": "<ISO>", "songs": [...] }`, written atomically.

### §3.3 Scanning

- On start Playlark shows the index it has at once, then rescans in the background. **Rescan Library** (⌘R) runs it again by hand. The desktop app and the NAS also rescan when the folder changes (§16.4, §18.3).
- A rescan lists the folder, re-reads tags only for files whose size or modified time changed, drops songs whose files are gone and adds new ones. Re-reading 10,000 unchanged files takes under 3 s on an SSD; a first scan of 10,000 files under 60 s.
- While scanning, the status bar shows "Scanning… 1,204 of 5,330" and the lists update every 500 ms with what's found so far. The app stays usable; playback never waits for a scan.
- A song that is playing or queued and disappears in a rescan keeps playing; it's removed from the queue when its turn comes, with "Skipped <title>: the file is gone."
- A file that can't be read (bad header, permission denied) is still listed, with its file name as title and "Can't read this file" in its info. The status bar shows "3 files couldn't be read" as a link that opens a dialog listing each path and reason.
- A song whose file moved (gone at one path, a new file at another with the same size and the same title, artist, album and duration) keeps its favourite and play count (§10).

## §4 Reading tags

The engine reads tags itself, from byte ranges of the file (`read(offset, length)`), so the same code runs on the desktop, the NAS, the browser and the CLI. It reads as little as it can: the header, the end of the file when the format keeps information there, never the whole file.

### §4.1 Fields

| Field | MP3 (ID3v2.2/2.3/2.4, ID3v1) | FLAC, Ogg (Vorbis comments) | M4A (MP4 `ilst`) | WAV |
| --- | --- | --- | --- | --- |
| Title | `TIT2`/`TT2` | `TITLE` | `©nam` | `id3 ` chunk, else `LIST/INFO INAM` |
| Artist | `TPE1` | `ARTIST` (several joined with ", ") | `©ART` | `id3 `, else `IART` |
| Album | `TALB` | `ALBUM` | `©alb` | `id3 `, else `IPRD` |
| Album artist | `TPE2` | `ALBUMARTIST`, `ALBUM ARTIST` | `aART` | `id3 ` |
| Track / of | `TRCK` (`3/12`) | `TRACKNUMBER` (`3` or `3/12`), `TRACKTOTAL`, `TOTALTRACKS` | `trkn` | `id3 `, else `ITRK` |
| Disc / of | `TPOS` | `DISCNUMBER`, `DISCTOTAL`, `TOTALDISCS` | `disk` | `id3 ` |
| Year | `TDRC`, `TYER` (first 4 digits) | `DATE`, `YEAR` | `©day` | `id3 `, else `ICRD` |
| Genre | `TCON` (`(17)` and `17` mapped to ID3v1 names) | `GENRE` | `©gen`, `gnre` | `id3 `, else `IGNR` |
| Compilation | `TCMP` = 1 | `COMPILATION` = 1 | `cpil` | `id3 ` |
| Sort names | `TSOP`, `TSO2`, `TSOA`, `TSOT` | `ARTISTSORT`, `ALBUMARTISTSORT`, `ALBUMSORT`, `TITLESORT` | `soar`, `soaa`, `soal`, `sonm` | `id3 ` |
| ReplayGain | `TXXX:REPLAYGAIN_*` | `REPLAYGAIN_*`; Opus `R128_TRACK_GAIN`, `R128_ALBUM_GAIN` | `----:com.apple.iTunes:replaygain_*` | `id3 ` |
| Cover | `APIC`/`PIC` | FLAC `PICTURE` block; Ogg `METADATA_BLOCK_PICTURE` | `covr` | `id3 ` |

- ID3v2: unsynchronisation (whole tag in 2.3, per frame in 2.4), extended headers, footers, compressed frames (skipped), text encodings ISO-8859-1, UTF-16 with BOM, UTF-16BE, UTF-8. ID3v2.4 multiple values (NUL-separated) are joined with ", ". ID3v1 is used only for fields ID3v2 doesn't have. APE tags are skipped over, not read.
- Text is trimmed; empty values are missing. Vorbis comment keys are case-insensitive.
- Missing title → the file name without extension. Missing artist → "Unknown Artist". Missing album → "Unknown Album".

### §4.2 Duration and stream facts

- MP3: Xing/Info or VBRI frame count when present, else (CBR) audio bytes ÷ bitrate of the first frame. FLAC: STREAMINFO total samples. M4A: `mdhd` of the audio track. Ogg: the last page's granule position (read from the last 64 KB) minus the Opus pre-skip. WAV: `data` size ÷ byte rate.
- Also recorded: codec (MP3, FLAC, AAC, ALAC, Vorbis, Opus, PCM), sample rate, channels, bitrate, bit depth where defined.

### §4.3 Gapless information

The exact number of real samples, so the player can trim what encoders add (§8.3):

- MP3: the LAME/Info header's encoder delay and padding (+ 529 decoder delay). No LAME header: no trimming.
- M4A: `iTunSMPB` (delay, padding, real sample count), else the `elst` edit list.
- Opus: pre-skip from the `OpusHead` header. FLAC, WAV, Vorbis: exact, no trimming.

### §4.4 Albums and artists

- An album is identified by its album artist plus album title, compared case- and accent-insensitively after trimming. The album artist is the album artist tag, else "Various Artists" when the song is a compilation, else the artist.
- Songs in an album are ordered by disc, then track number, then file name. Songs without track numbers come after numbered ones.
- The album's year is the most common year among its songs; its cover is §4.6's choice for its first song.
- The Artists list holds album artists. A song whose artist differs (a featured artist on a compilation) is found by search and in Songs, and its artist's page lists it under "Appears On".
- Sorting uses the sort-name tags when present, else the name with a leading "The " ignored, compared with `Intl.Collator` (numeric, base sensitivity).

### §4.5 Song identity

- A song is identified by its relative path. Favourites, play counts, queue entries and playlist entries all refer to the path.

### §4.6 Cover art

- The embedded picture of type "front cover" (3), else the first embedded picture, else an image file in the song's folder named (case-insensitively) `cover`, `folder`, `front` or `album`, with `.jpg`, `.jpeg` or `.png`, in that order of names. No cover: a neutral placeholder with a note glyph.
- Covers are shown scaled by the browser; no thumbnails are made in 1.0.

## §5 Engine

- `packages/core` holds the tag readers and writers, the index model (songs, albums, artists, folders), search, sorting, the queue model (§8), playlist parsing and writing (§9), stats rules (§10) and the gapless and ReplayGain arithmetic. No DOM, Node or Preact.
- Invariants checked by `checkInvariants` in tests: every queue entry names a song path; the current index is inside the queue or the queue is empty; the shuffled and original orders hold the same entries; a playlist written and read back gives the same entries; a tag write changes no audio bytes (§11.3).
- An edit that changes nothing (same tags, same playlist order) records no undo step and writes nothing.

## §6 Browsing and search

### §6.1 Window

- Left sidebar: **Library** (Songs, Albums, Artists, Folders), **Collections** (Favourites, Recently Added, Most Played), **Playlists** (each playlist, alphabetical). The sidebar can hide (⌥⌘S).
- Toolbar: back and forward through views (⌘[ and ⌘]), the view title, and the search field.
- Middle: the current view. Bottom: the now-playing bar (§8.1). Right: the queue panel when open (§8.4).
- Status bar: scanning progress, unreadable files, the folder's name (its path on hover), notices.
- Every list draws only its visible rows; 50,000 songs scroll at 60 fps.

### §6.2 Views

- **Songs**: a table with columns ♥, Title, Artist, Album, Time, Plays. Clicking a header sorts by it (again: reverse). Default sort: artist, album, disc, track.
- **Albums**: a grid of covers with title and album artist, sorted by album artist then year then title. Opening one shows the album page: cover, title, album artist, year, song count and total time, Play and Shuffle buttons, and the songs grouped by disc when it has more than one.
- **Artists**: an alphabetical list of album artists with their album counts. Opening one shows the artist page: Play and Shuffle buttons, their albums by year (newest first), then "Appears On".
- **Folders**: the music folder as a tree. Selecting a folder shows its subfolders first, then its songs in file-name order. Play and Shuffle play the folder and everything under it.
- **Favourites**, **Recently Added** (songs added in the last 90 days, newest first, by the time the song first entered the index; a first scan uses the file's modified time), **Most Played** (top 100 by play count, ties by last played).
- Empty states: no folder chosen → "Choose a music folder to start." with **Open Music Folder…**; no songs in the folder → "No music found in <folder>. Playlark plays MP3, FLAC, M4A, Ogg and WAV files."; an empty collection → one line saying how to fill it ("Songs you favourite appear here.").

### §6.3 Selection and keys in lists

- ↑/↓ move, ⇧↑/⇧↓ and ⇧-click extend, ⌘-click toggles, ⌘A selects all. Return plays the selection (§8.2 Play). Double-click plays the song.
- Selection upkeep follows the house rule: ids that leave the view are dropped, the cursor moves to the next row.

### §6.4 Search

- ⌘F focuses the search field. Typing filters as you type (after 100 ms idle), over title, artist, album, album artist, genre and file name.
- Matching is case- and accent-insensitive; every word typed must match the start of a word in some field ("beat abb" finds "Abbey Road" by the Beatles).
- Results show in three sections: Artists (up to 5), Albums (up to 10), Songs (all, as a table), each with "Show all" when cut. Escape clears the search and returns to the previous view.
- 50,000 songs: results update within 50 ms of the idle delay (search keys are prepared at index time).

## §7 Look

- Calm and neutral like the sibling apps: neutral greys, one accent colour for selection, focus and the playing song, cover art as the only large colour. Light, dark, or follow the system (§19).
- The playing song shows a small animated bars glyph in every list it appears in (still bars with reduced motion).

## §8 Playback

### §8.1 Now-playing bar

- Cover, title and artist (click: go to the album; artist: go to the artist), Previous, Play/Pause, Next, a seek bar with elapsed and remaining time, Shuffle, Repeat This Song, Repeat Queue, a volume slider, the favourite heart, and the queue button.
- While a song loads (§8.3): the play button shows a spinner and the bar shows "Loading…". Nothing playing: the bar shows no song and its buttons are disabled except Play, which plays the current view from the top.

### §8.2 Starting playback

- **Play** (Return, double-click) replaces the queue with the songs of the current view in their shown order, starting at the chosen song. With several selected, the queue is just the selection.
- **Play Next** puts the songs right after the current one. **Add to Queue** puts them at the end. Neither interrupts what's playing; both say "Playing next: <title>" / "Added 3 songs to the queue."
- **Shuffle** buttons on album, artist, folder and playlist pages turn shuffle on and play that context from a random song.

### §8.3 The audio engine (gapless)

- Playback uses Web Audio. A song's file is read whole and decoded (`decodeAudioData`) into memory; playback starts once it's decoded (a typical 40 MB FLAC: under 1 s on the desktop).
- The next song in the queue is read and decoded when the current one has 30 s left (or at once if it's shorter), and is scheduled to start at the exact sample the current one ends. At most two decoded songs are held at once.
- Trimming (§4.3): the decoder's output is compared with the real sample count. If it's longer, the encoder delay is cut from the start and the rest from the end; if it already matches, nothing is cut. So songs join without a gap whether or not the decoder trims for us.
- The graph is: buffer source → the song's own gain (its ReplayGain level, §8.6, shaped by the crossfade curve while it fades, §8.7) → volume gain → the context's own output. Beside it, one hidden `<audio>` element loops 6 s of silence: that element is what the system sees as playing, which is what Media Session (§15) needs. The sound doesn't go through it: Chromium plays a MediaStream through a buffer that changes speed to catch up after a stall, which puts songs slightly out of tune.
- Seeking restarts the buffer at the new position (no gap in the UI, a 10 ms ramp to avoid a click). Pause and resume use `AudioContext.suspend()`/`resume()`.
- A song that can't be decoded (§12) is skipped with "Skipped <title>: can't play this format here." Three failures in a row stop playback with "Playback stopped: 3 songs in a row couldn't be played."
- Volume: 0–100 % on a perceptual curve, remembered (§19). ⌘↑/⌘↓ change it by 10 %.

### §8.4 The queue

- The queue panel (⌥⌘U) lists the current song and **Up Next**. Up Next rows can be dragged to reorder, removed (Delete, or the row's ×), and played (double-click jumps there). **Clear** empties Up Next. History isn't kept in 1.0.
- **Next** (⌘→) goes to the next entry. **Previous** (⌘←) restarts the song if more than 3 s in, else goes to the previous entry (the first entry restarts).
- At the end of the queue with repeat off, playback stops; the last song stays shown, paused at 0:00.
- The queue (paths), the current entry, the position, shuffle and repeat are saved every 5 s while playing and on every change (desktop: `queue.json` in the app's data folder, beside the library index; browser and NAS client: the browser's storage, per device). A saved queue belongs to one music folder and is ignored for any other, and restored paused on start. Entries whose files are gone are dropped with "2 songs in your queue are gone and were removed."

### §8.5 Shuffle and repeat

- **Shuffle** (⌘S) shuffles the entries after the current one (seeded Fisher–Yates) and remembers the original order. Turning it off restores the original order after the current song. Songs added with Play Next go right after the current song in both orders; Add to Queue goes at the end of both.
- Two toggles, each its own button in the now-playing bar; at most one is on, and turning one on turns the other off.
  - **Repeat This Song** (⌥⌘R; hover text "Repeat this song"): the current song repeats (gaplessly, §8.3); Next and Previous still move.
  - **Repeat Queue** (⌥⇧⌘R): after the last entry the queue starts again in the same order.

### §8.6 ReplayGain

- Setting: Off, Track, Album (default Album). Album uses the album gain when present, else the track gain; Track the reverse. Opus R128 gains are converted (+5 dB to the ReplayGain reference).
- Pre-amp −6 to +6 dB (default 0). The gain is limited so the peak tag × gain ≤ 1 (no clipping). Songs without tags play unchanged.

### §8.7 Crossfade

- Setting: Off (default), or 1–12 s. An equal-power fade between songs.
- Never between consecutive tracks of the same album (same album, track n then n+1): those always join gaplessly. Never on Repeat This Song.
- Next and Previous pressed by hand cut over with a 10 ms ramp, no crossfade. When the song they go to was already decoded ahead (§8.3), it starts at once.

## §9 Playlists

### §9.1 Files

- New playlists are written to `Playlists/` at the top of the music folder (created when the first one is made), named `<name>.m3u8`, with characters not allowed in file names replaced by `-` and ` 2`, ` 3`… added when taken.
- Every `.m3u8` and `.m3u` anywhere in the music folder is listed as a playlist, named after its file.
- Written as UTF-8 without BOM, LF line endings: `#EXTM3U`, then per entry `#EXTINF:<seconds>,<artist> - <title>` and the path relative to the playlist file with `/` separators.
- Read: UTF-8 (BOM stripped), falling back to Windows-1252 for `.m3u` files that aren't valid UTF-8; CRLF or LF; relative paths with `/` or `\`; absolute paths and `file://` URLs inside the music folder; percent-encoded paths. Lines starting `#` other than `#EXTM3U`/`#EXTINF` are kept and written back before the entry they preceded.
- An entry whose file isn't in the library shows greyed as "Missing: <path>" and stays in the file; it's skipped when played.
- An `.m3u` file edited in Playlark is written back as `.m3u` in the same encoding it was read in.

### §9.2 Editing

- **New Playlist** (⌘N): created with the selected songs (or empty), named "New Playlist", name field focused for renaming.
- Add songs: **Add to Playlist…** in the context menu or ⌘K (a list of the playlists to pick from by typing, with New Playlist first), or drag songs onto a playlist in the sidebar. Duplicates are allowed. Notice: "Added 3 songs to <playlist>."
- In a playlist: drag to reorder, Delete removes the selected entries from the playlist (never the files).
- **Rename** changes the file name. **Delete Playlist** moves the file to Playlark's trash (§11.4) with "Deleted <playlist>." and Undo.
- Every playlist edit is an undo step (⌘Z / ⇧⌘Z), saved at once. In a text field ⌘Z undoes the typing instead.
- On a playlist in the sidebar, the right-click menu has **Play Playlist**, **Shuffle Playlist**, **Rename Playlist** and **Delete Playlist**; they act on the playlist shown when chosen from ⌘K or the menu bar.

### §9.3 Saving and conflicts

- Saves are atomic (temp file, flush, rename; a symlink stays a symlink) and carry the version (SHA-256 of the bytes) last read. A lock file (`.<name>.lock`, taken over after 10 s) keeps the desktop app, the NAS server and the CLI from writing at once.
- A playlist changed elsewhere while Playlark has unsaved changes (or whose save finds it changed) opens "<Playlist> changed somewhere else" with **Keep Mine** (write mine over it) and **Use Theirs** (an undo step, so Undo brings mine back). Escape leaves both as they are, unsaved, and the next save or check asks again. Nothing merges or overwrites without the choice.
- Changes made elsewhere are picked up when the window comes to the front and every 15 s, as one undo step with "Updated <playlist> with changes made elsewhere."
- A failed save is retried twice (300 ms, 600 ms), then the status bar shows "Couldn't save <playlist>." with **Try Again**.

## §10 Favourites and play counts

### §10.1 Storage

- Kept in `stats.json` in the app's data folder (desktop) or the server's data folder (NAS, shared by every browser using that server), keyed by song path: `favourite`, `plays`, `lastPlayed`, `added`. Not in the music files. The desktop app and the NAS keep separate stats. The app and the CLI write it under the same lock file (§9.3); the app's stats win, but an `added` time only the file has (the CLI dated a new song) is kept. A folder opened in the browser keeps its stats in IndexedDB, beside its index.
- Written atomically, at most every 2 s, and when the window closes.
- Unlike the index, the stats are the user's data: a stats file that can't be read is never written over. The status bar says "Favourites and play counts won’t be kept: <reason>" and nothing is saved until the next start.

### §10.2 Rules

- **Favourite** (⌥⌘F, the heart in lists and the now-playing bar) toggles; it's an undo step.
- A play counts when a song has played for half its length or 4 minutes, whichever comes first, once per time it's started. Seeking doesn't add listened time.
- A song moved within the library keeps its stats (§3.3).
- With several songs selected, Favourite turns them all on when any is off, else all off. With nothing selected it acts on the song playing.
- The Songs table has ♥ and Plays columns, both sorting the most first. An empty heart shows only on hover and in selected rows.
- An empty collection says what fills it ("Songs you favourite appear here.").

## §11 Tag editing

### §11.1 The Song Info dialog

- **Song Info…** (⌘I) on one or more selected songs. Fields: Title, Artist, Album, Album Artist, Track (n of m), Disc (n of m), Year, Genre, Compilation, and the cover (Choose Image…, Paste, Remove). The dialog also shows the read-only file facts (§4.2) and path.
- With several songs, fields that differ show "Mixed"; only fields the user changes are written. Title and track can't be changed for several songs at once.
- **Save** writes the files; the dialog shows progress for more than 5 songs ("Saving 3 of 12…"). Errors are listed per file at the end; files that were written stay written.
- Every format can be edited: MP3, FLAC, M4A, Ogg (Vorbis and Opus) and WAV. A selection mixing formats Playlark can and can't edit writes the ones it can and lists the others.
- Numbers (track, disc, their totals, year) are whole numbers from 1 to 65535; an empty field takes the tag out. Text fields are trimmed, and an empty one takes the tag out.
- The cover is a JPEG or PNG. A new cover replaces the front covers (every picture when none is marked front cover); Remove takes every picture out.
- Where tags can't be saved (§11.5), the dialog shows them read-only with "Edit tags in the desktop app or through the NAS server."

### §11.2 Writers

- Only the fields changed are touched; every other frame, comment, atom and chunk is kept as it was, in order.
- MP3: an ID3v2.3 tag stays 2.3 (UTF-16 text); 2.4 stays 2.4 (UTF-8); a file without ID3v2 gets 2.4. An ID3v2.2 tag isn't edited ("Playlark can’t edit ID3v2.2 tags."). An existing ID3v1 tag is updated too (truncated to its 30-byte fields). Existing padding is used when the new tag fits, else the tag is rewritten with 2 KB padding.
- FLAC: the `VORBIS_COMMENT` and `PICTURE` blocks are replaced, using `PADDING` when it fits.
- M4A: `moov/udta/meta/ilst` is rewritten; when `moov` grows or shrinks and sits before `mdat`, every `stco`/`co64` chunk offset is shifted by the difference. A `free` atom next to `moov` is used when it fits. A fragmented MP4 (`moof`) isn't edited.
- Ogg: the comment header packet is rewritten, pages re-laid, every later page renumbered and its CRC recomputed. The Opus `OpusTags` and Vorbis comment packet (with its framing bit) follow their specs. Header pages carry granule 0 where a packet ends and -1 otherwise; audio pages keep their bodies, lacing and granules. An Ogg file with more than one logical stream isn't edited ("Playlark can’t edit an Ogg file with more than one stream."), nor one whose headers share a page with audio.
- WAV: the `id3 ` chunk is written (created when missing; `LIST/INFO` is updated for the fields it has), the RIFF size fixed, chunks kept word-aligned. `LIST/INFO` fields are written as UTF-8 with a trailing NUL.

### §11.3 Safety

- The new file is written to a temp file in the same folder, read back, and checked: its tags must read as intended, and its audio bytes (MP3 frames; FLAC frames; the `mdat` payload; Ogg audio packets; WAV `data`) must hash the same as the original's. A failed check deletes the temp file and reports "Couldn't save <file>: the check after writing failed. The file wasn't changed."
- The original's size and modified time are checked against what was read before the swap; a file changed in the meantime reports "<file> changed somewhere else. Close Song Info and try again." and isn't written.
- The original is moved to Playlark's trash (§11.4), then the temp file is renamed into place.
- Tag edits are undo steps: ⌘Z writes the previous tags back with the same checks. The undo history lasts until the app closes.

### §11.4 Trash

- Desktop: `trash/` in the app's data folder; NAS: `trash/` in the server's data folder; CLI: the desktop's. Each item keeps its relative path under a dated folder (`trash/2026-11-19/Artist/Album/01 Song.flac`).
- Items older than 30 days are deleted on start. **Open Trash** (desktop) shows the folder in Finder; no in-app trash browser in 1.0.

### §11.5 Where it's available

- Desktop and the NAS (unless started `--read-only`) and the CLI. The browser-folder mode (§17) can't edit tags or playlists.

## §12 Formats per target

Playlark checks each format at runtime (`decodeAudioData` succeeds or fails) and remembers the answer per codec for the session. Expected:

| Format     | Desktop (Electron/Chromium) | Chrome/Edge   | Firefox | Safari (macOS, iPhone) |
| ---------- | --------------------------- | ------------- | ------- | ---------------------- |
| MP3        | ✓                           | ✓             | ✓       | ✓                      |
| FLAC       | ✓                           | ✓             | ✓       | ✓                      |
| M4A (AAC)  | ✓                           | ✓             | ✓       | ✓                      |
| M4A (ALAC) | runtime check               | runtime check | ✗       | ✓                      |
| Ogg Vorbis | ✓                           | ✓             | ✓       | ✗ (most versions)      |
| Ogg Opus   | ✓                           | ✓             | ✓       | runtime check          |
| WAV (PCM)  | ✓                           | ✓             | ✓       | ✓                      |

- A codec that failed shows its songs greyed with "Can't play this format here" in their info, and they are skipped in the queue (§8.3). The e2e fixtures (§21) confirm the desktop column; the table is corrected when a check disagrees.

## §13 Errors and notices

- Notices appear in the status bar (house rule: no toasts), each with Undo where an undo exists.
- Unreadable files, decoding failures, missing playlist entries and save failures are as written in their sections. Nothing fails silently.

## §14 Commands and shortcuts

Every command is in the command catalog and reachable from ⌘K; the native menu, context menus, the Keyboard Shortcuts window (⌘/) and `docs/controls.md` come from it.

| Group    | Command                                         | Shortcut                    |
| -------- | ----------------------------------------------- | --------------------------- |
| File     | Open Music Folder… (desktop)                    | ⌘O                          |
| File     | New Playlist                                    | ⌘N                          |
| File     | Rescan Library                                  | ⌘R                          |
| File     | Show in Finder (desktop)                        | ⇧⌘R                         |
| Edit     | Undo / Redo                                     | ⌘Z / ⇧⌘Z                    |
| Edit     | Select All                                      | ⌘A                          |
| Edit     | Find                                            | ⌘F                          |
| Song     | Song Info…                                      | ⌘I                          |
| Song     | Favourite                                       | ⌥⌘F                         |
| Song     | Play Next / Add to Queue                        | —                           |
| Song     | Add to Playlist…                                | —                           |
| Song     | Go to Album / Go to Artist / Go to Current Song | — / — / ⌘L                  |
| Controls | Play / Pause                                    | Space (outside text fields) |
| Controls | Next / Previous                                 | ⌘→ / ⌘←                     |
| Controls | Seek Forward / Back 10 s                        | ⌥⌘→ / ⌥⌘←                   |
| Controls | Volume Up / Down                                | ⌘↑ / ⌘↓                     |
| Controls | Shuffle                                         | ⌘S                          |
| Controls | Repeat This Song / Repeat Queue                 | ⌥⌘R / ⌥⇧⌘R                  |
| View     | Songs / Albums / Artists / Folders              | ⌘1 / ⌘2 / ⌘3 / ⌘4           |
| View     | Back / Forward                                  | ⌘[ / ⌘]                     |
| View     | Show Queue                                      | ⌥⌘U                         |
| View     | Show Sidebar                                    | ⌥⌘S                         |
| Help     | Keyboard Shortcuts                              | ⌘/                          |
| App      | Settings…                                       | ⌘,                          |
| App      | Command Menu                                    | ⌘K                          |

- Shuffle is ⌘S because Playlark has nothing to save by hand.
- Select All (⌘A) selects the text in a text field, else every song in the view. In the desktop app it replaces the Edit menu's built-in Select All, so one command does both.
- Find (⌘F) and Select All work while the search field has focus; the other shortcuts with ⌘ wait until it hasn't.
- Context menu on songs: Play, Play Next, Add to Queue, Add to Playlist…, Favourite, Song Info…, Go to Album, Go to Artist, Show in Finder (desktop), and Remove from Playlist inside a playlist. On playlists in the sidebar: Play, Shuffle, Rename, Delete Playlist, Show in Finder.

## §15 Media keys and Now Playing

- Every target sets `navigator.mediaSession` metadata (title, artist, album, cover) and position state, and handles play, pause, stop, previous track, next track, seek to, seek forward and seek backward (10 s).
- Desktop: Electron's Chromium routes this to the macOS Now Playing widget, Control Center and the keyboard's media keys (hardware media key handling stays on). No `globalShortcut` registrations.
- Phone (NAS web app): the same gives lock-screen and Control Center controls.

## §16 Desktop app

### §16.1 Window and security

- One window, standard house rules: sandboxed renderer, context isolation, the `playlarkNative` bridge as the only native access, confined to the music folder; native menu from the catalog; unified toolbar.
- Song audio and covers reach the renderer through the app's own protocol, at `app://playlark/media/<path>`, with range support, confined to the music folder and the covers folder, not through IPC.
- Closing the window quits the app (no background playback with no window in 1.0).

### §16.2 The folder

- First start asks before showing anything: **Use Music folder** (`~/Music`) or **Choose Folder…**. The choice is remembered in `folder.json` in the app's data folder. **Open Music Folder…** (⌘O) switches libraries (stopping playback and starting a fresh index for that folder; one index per folder is kept, up to 3).
- Each folder's index, covers, queue and stats are in `libraries/<first 16 hex digits of the SHA-256 of the folder's real path>/` in the data folder. Opening a folder marks its index as used; beyond the 3 used last, the oldest are deleted, never the remembered folder's. The CLI uses the same place for the same folder.
- The question is a dialog in the page, not a system one. **Choose Folder…** then shows the system's folder picker (skipped and logged in a headless run); **Use Music folder** with no `~/Music` says so and asks again. A headless run has no Music folder unless `PLAYLARK_USUAL_MUSIC` names one.
- A remembered folder that's gone (an unplugged drive) asks the same question, naming it; nothing is created in its place.

### §16.3 Headless mode

- `PLAYLARK_HEADLESS=1` or `--headless`: `show: false`, no Dock icon, audio muted, a temporary userData folder (or `PLAYLARK_USER_DATA`), the folder from `PLAYLARK_MUSIC`, and every native dialog skipped and logged (open-folder pickers, the first-start question, message boxes). `uncaughtException` and `unhandledRejection` handlers are registered first thing in the main process, log to stderr and exit non-zero, so Electron's error dialog never appears. A test covers this.

### §16.4 Watching the folder

- The folder is watched (`fs.watch`, recursive); changes trigger a rescan 2 s after the last change.

## §17 Browser (no server)

- Chrome and Edge: **Open Music Folder…** uses the File System Access API; the permission is remembered and asked again on the next visit with one click. The index is kept in IndexedDB. Tag and playlist editing are off in this mode ("Edit tags and playlists in the desktop app or through the NAS server").
- Other browsers show: "Opening a music folder needs Chrome or Edge. Use the desktop app or a Playlark server instead."

## §18 NAS server

### §18.1 Running

- `node apps/server/src/main.ts --dir /music --data /data [--port 8830] [--read-only] [--poll]`, and a Docker image (`compose.example.yaml` mounts the music folder and a data volume). `--read-only` turns off playlist and tag writes; stats still save. Each option has a `PLAYLARK_*` environment variable. The data folder defaults to `$XDG_DATA_HOME/playlark-server` (`~/.local/share/playlark-server`).
- With no accounts, the server listens on loopback unless started with `--no-auth`, meant for a reverse proxy that asks for a login.
- The server checks `Host` against localhost, IP addresses and `PLAYLARK_HOSTS`, like the sibling apps. No accounts.

### §18.2 API

- `GET /api/library`: the index (ETag; `If-None-Match` → 304; 204 before the first scan finishes). `GET /api/events`: server-sent events for scan progress and library changes.
- `GET /api/media/<path>`: the song's bytes with `Range` support, `Content-Type` by format, ETag. `GET /api/covers/<sha256>`: a cover, cached for a year (immutable).
- Playlists: `PUT /api/playlists/<path>` with `If-None-Match: *` (create) or `If-Match: "<sha256>"` (write over the version read), `POST {to}` (rename), `DELETE` with `If-Match` (to the trash in the data folder) (§9.3). A stale version gets 412, a name taken 409. Tags: `POST /api/tags` with edits per path and the size/modified time read; the server runs the same writer and checks (§11.3).
- Stats: `GET /api/stats`, `POST /api/stats` with the changes since the device last read or sent (favourite set, plays to add, latest play, added time, removed), shared by every device: plays add up, the latest play wins, the first added time stays.
- Writes must come from the server's own page (`Origin` matching `Host`, else 403) and JSON bodies must say `application/json` (else 415).
- Paths are confined to the music folder, symlinks included; `..` is refused.

### §18.3 Scanning

- The server scans on start (the page shows the server's index, and its own rescans start from it), watches the folder (polling every 60 s when `fs.watch` isn't reliable, as on SMB/NFS mounts; `--poll` forces polling) and rescans on changes.

### §18.4 Streaming

- The web app on a NAS reads each song whole before playing (§8.3), so a song starts once it has downloaded; the next song is fetched 30 s ahead. The bar shows "Loading…" until then.

### §18.5 Phone app (PWA)

- A web app manifest and icons, so "Add to Home Screen" gives a full-screen app. A service worker keeps the app's own files at install and answers from them only while offline, never for `/api`; only a server's page registers it. Media Session gives lock-screen controls (§15).
- A narrow layout below 700 px: the sidebar becomes a bottom tab bar (Songs, Albums, Artists, Playlists, Search; Playlists is a page with the collections and playlists), the now-playing bar shrinks to a mini bar (play, next) that opens a full-screen player, and the queue covers the screen. A tap on a song plays it.

## §19 Settings

- Settings window (⌘,): Appearance (System, Light, Dark), ReplayGain (Off, Track, Album) and pre-amp, Crossfade (Off, 1–12 s), Rescan on start (on).
- Stored in `settings.json` in the app's data folder (desktop), the browser's storage (web and NAS client). Volume is remembered the same way.
- Each change takes effect at once and is saved; there is no OK button. ReplayGain, pre-amp and crossfade apply from the next song. Pre-amp is off while ReplayGain is Off. Settings… is in the File group of the command list, which the macOS menu bar shows in the app menu.
- Appearance also sets Electron's `nativeTheme.themeSource`, read from `settings.json` before the window opens, so menus and the title bar match.
- With Rescan on start off, the index from last time is shown and the folder isn't read until Rescan (⌘R); a folder with no index yet is read anyway.

## §20 CLI

- `playlark [--dir <folder>] [--json] <command>`. The folder defaults to `PLAYLARK_DIR`, else the desktop app's remembered folder. The CLI shares the desktop app's index, stats and trash, with the same lock files.
- `scan`: rescan and report counts (songs, albums, artists, unreadable).
- `songs`, `albums`, `artists` with `--artist`, `--album`, `--genre`, `--year` filters; `search <words>` (§6.4 matching).
- `playlist list | show <name> | create <name> [paths…] | add <name> <paths…> | remove <name> <positions…> | check [<name>]` (check lists missing entries).
- `check`: songs missing title, artist, album or track number; albums without cover art; likely duplicates (same artist and title, durations within 2 s); unreadable files.
- `tags show <path>`, `tags set <path…> --title … --artist …` (same writers and checks, §11).
- `play <song path | playlist name | search words>`: plays through the system player one song after another (`afplay` on macOS, else `ffplay -nodisp -autoexit` or `paplay` when on `PATH`, else an error naming them). Ctrl-C stops. Not gapless.
- Exit codes: 0 success, 1 error or usage, 2 conflict. `--json` errors are `{ "ok": false, "error": "...", "exit": n }`.
- Every command rescans first, reusing every file whose size and time haven't changed (§3.3). Each folder's index and stats are where the desktop app keeps them (§16.2), so the CLI and the app share them for every folder. Moved songs keep their stats (§10.1).
- Filters match the way search does: each word must start a word in that field (`--artist beat` finds the Beatles); `--year` is exact.
- `playlist create` with a name already taken is a conflict (exit 2). Positions count from 1, as `playlist show` numbers them. A song is a path in the music folder, or a path from the current folder to a file inside it.
- `tags set` takes `--title`, `--artist`, `--album`, `--album-artist`, `--genre`, `--track`, `--track-total`, `--disc`, `--disc-total`, `--year` and `--compilation yes|no`; an empty value takes the tag out. A song changed since the rescan read it is a conflict (exit 2).
- `--json` answers are one object: `{ "ok": true, … }` with the command's fields, or the error above. While `play` runs, the song names go to standard output (standard error with `--json`).
- `apps/cli/skill/SKILL.md` teaches an agent to use it.

## §21 Testing

- Audio fixtures are generated (short sine tones and silence, with known tags and known gapless padding) by a script using ffmpeg and lame on the developer's machine, and committed (a few KB each). Tests and headless runs never touch the user's real music library.
- Tag readers and writers: round trips per format and per tag version, odd cases (unsynchronised ID3, UTF-16 without BOM, `moov` after `mdat`, Ogg comments across pages), and "audio bytes unchanged" after every write. Random tag-edit sequences check the invariant.
- Queue, shuffle and repeat: unit and random-operation tests against a simple reference model.
- Gapless: an offline test decodes two fixtures that make one continuous sine when joined and checks the join has no gap or click (sample-exact).
- Playwright scenarios run the web build headless on a fixture library; a desktop smoke test runs Electron headless and kills every Electron process it starts.

## §22 Open questions

None at the moment; answers from review go into the sections above.
