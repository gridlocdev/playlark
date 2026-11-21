# Playlark 1.0 slices

Each slice leaves `just check` green and the app working. Tick a slice when it lands; delete this file when every box is ticked.

- [x] **1. Skeleton and first playable slice** (PRD §3.1, §4.1 basic fields and duration, §6.2 Songs, §8.1, §8.2 Play, §8.4 Next/Previous, §16.3, §17, §21). Workspace, `AGENTS.md`, justfile, architecture test, e2e setup; generated fixtures for all five formats; tag readers for title, artist, album, track and duration; scan through the store (memory, browser folder, desktop bridge); the Songs table; Play from a song with a queue, Next and Previous, the now-playing bar; Web Audio player through the hidden `<audio>` element; desktop headless mode with the crash handlers and their test; web and desktop checked headless.
- [x] **2. Full tag reading and the index** (§3.2, §3.3, §4). Every field, ID3 edge cases, cover art (embedded and folder images), ReplayGain and gapless info, the index cache with incremental rescans, unreadable files, moved songs.
- [x] **3. Browsing and search** (§4.4, §6, §7). Albums, Artists, Folders, album and artist pages, sorting, back and forward, search, virtual lists for 50,000 songs.
- [x] **4. Gapless playback and the queue** (§8, §15). Gapless scheduling and trimming with the offline join test, seeking, volume, the queue panel, Play Next, Add to Queue, reorder, shuffle, repeat, queue restore, Media Session, ReplayGain, crossfade; Shuffle buttons on album, artist and folder pages; the song context menu (§14).
- [x] **5. Playlists** (§9). `.m3u8`/`.m3u` reading and writing, the sidebar, editing, undo, atomic saves with versions, conflicts, outside changes.
- [x] **6. Favourites and play counts** (§10). Stats file, hearts, counted plays, Favourites, Recently Added, Most Played. A moved song keeps its stats through `findMoves` (§3.3).
- [x] **7. Tag editing: MP3, FLAC, M4A** (§11). Writers, the Song Info dialog, the safety checks, the trash, undo.
- [x] **8. Tag editing: Ogg and WAV** (§11.2).
- [x] **9. NAS server** (§18). API, range streaming, server-side scan and watching, events, playlist and tag writes, stats, `--read-only`, the phone layout and PWA, Docker.
- [x] **10. CLI** (§20). Commands, `--json`, `play`, the agent skill file.
- [x] **11. Settings and release polish** (§19, §14). Settings window, desktop first-start question and folder switching, icon, docs, CHANGELOG, CI.
