# Architecture

Playlark is one TypeScript code base that runs in three places: the browser, the NAS server's client and the Electron app. All three run the same UI. The only difference between them is where the songs come from.

```
     ┌───────────────── apps/web (Vite, Preact) ─────────────────┐
     │  App · Pages · SongList · NowPlaying · QueuePanel         │
     │  AppController (folder, library, views, selection,       │
     │                 search, notices) · views · selection      │
     │  Playlists · UndoStack · Notices · Covers · QueueKeeper   │
     │  commands.ts · nativeMenu.ts · mediaSession.ts            │
     └─────────────────────────────┬─────────────────────────────┘
                                   │ imports
     ┌──────────────── packages/ui (Preact + signals) ───────────────┐
     │  CommandCatalog · shortcuts · Dialog · ListPopup · PopupMenu  │
     │  Player (queue, state, position) ── AudioEngine               │
     │                                     └─ WebAudioEngine         │
     │  LibrarySource ─┬─ memoryLibrary        (tests, demo)         │
     │                 ├─ browserFolderLibrary (a folder the browser │
     │                 │                        was given)           │
     │                 ├─ connectServer        (NAS: /api)           │
     │                 └─ urlLibrary           (desktop: app://)     │
     │  IndexStore ─┬─ memoryIndexStore  (tests)                     │
     │              ├─ browserIndexStore (IndexedDB)                 │
     │              └─ bridgeIndexStore  (desktop: data folder)      │
     │  settings (localStorage)                                      │
     └─────────────────────────────┬─────────────────────────────────┘
                                   │
     ┌──────────────── packages/core (pure TS) ─────────────────┐
     │  tags: ID3v1/v2, MP3 stream, FLAC, MP4, Ogg, WAV          │
     │  library: files, songs, sort, scanLibrary, index, covers  │
     │           browse (albums, artists, folders), search       │
     │  playlists: .m3u8/.m3u read and write, entry edits        │
     │  queue (shuffle, repeat, edits, saved queue) · playback   │
     │  (trim, ReplayGain, crossfade)                            │
     └──────────────────────────────────────────────────────────┘

 packages/node-files  Node only: folder listings confined to the folder, media replies with Range, atomic writes,
                      playlist writes under a lock file with versions, the trash
 apps/server          node:http: the static client and /api; scans and watches the folder itself (ServerLibrary)
 apps/cli             the playlark command: the same scan, index, stats and writers, from a terminal
 apps/desktop         Electron main + sandboxed preload; loads the apps/web build from app://playlark/
```

## Layering

- `@playlark/core` uses no DOM or Node APIs and imports no UI library. ESLint enforces this, so the code runs in a browser, in a worker and in Node.
- `@playlark/ui` holds everything that touches the page: signals, Web Audio, `fetch`, `localStorage`, and the shared components.
- The apps are thin. Each app picks a library source, puts the UI on the page, and connects the parts that are native to its host.
- Each package's `src/index.ts` names what the package exports, with no `export *`. Its `package.json` `exports` field allows only that file. Tests import through it too.
- The architecture test (`test/architecture.test.ts`) enforces these rules. It also keeps `fetch` in `packages/ui/src/library/sources.ts`, `localStorage` in `packages/ui/src/settings.ts`, and IndexedDB in `packages/ui/src/library/indexStore.ts`.

## Core (`packages/core`)

- **Tags (§4).** `readTags` takes the format from the file's extension and first bytes. It reads the tags and the stream facts through a `ByteSource`, which reads ranges of bytes, so a song on the NAS is never downloaded whole. The readers are:
  - MP3 uses ID3v2 and then ID3v1. It finds the duration and the encoder delay from the Xing, Info, LAME or VBRI header.
  - FLAC uses `STREAMINFO` and its Vorbis comments.
  - M4A uses `ilst` atoms and the `mdhd` duration.
  - Ogg uses Vorbis or Opus comments, and the last granule position.
  - WAV uses `fmt `, `LIST INFO` and `id3 `.
- **Songs (§4.4).** `songFrom` fills in what the tags leave out: the title from the file name, Unknown Artist and Unknown Album. A file that can't be read becomes an unreadable song with its error. It isn't dropped.
- **Scans (§3).** `scanLibrary` reads a few files at a time and reports its progress and each song as it is read. It reuses each song whose size and modified time haven't changed. Each embedded picture is named by the SHA-256 of its bytes (`sha256.ts`, since Web Crypto is missing on plain HTTP) and handed out once; a song without one gets its folder's cover image.
- **The index (§3.2).** `makeIndex` and `parseIndex` write and read the cached scan; anything wrong with it means a full scan. `coverIds` says which stored covers are still used, and `findMoves` matches a song that moved to its new path.
- **Sorting (§5).** The sort is natural and ignores case and a leading "The ". Sort names win when a song has them. `sortSongsBy` sorts by a column for the Songs view.
- **Browsing (§4.4, §6.2).** `buildLibrary` groups the songs into albums (by album artist and title, folded for case and accents), artists with their own albums and the ones they appear on, and the folder tree. Unreadable songs stay out of albums and artists.
- **Search (§6.4).** `prepareSearch` folds each song's words once; `search` keeps the artists, albums and songs where every query word starts some word.
- **The queue (§8.4, §8.5).** The queue is immutable: every edit returns a new one. It holds the paths in play order, the playing index, repeat, and with shuffle on each entry's rank in the original order, so turning shuffle off sorts them back. `next(q, auto)` knows that Repeat One replays only when a song ends by itself; `following` says what plays after the current song. `saveQueue` and `parseSavedQueue` write and read it, tied to one music folder.
- **Playlists (§9.1, §9.2).** `parsePlaylist` reads an `.m3u8` or `.m3u` file (UTF-8, else Windows-1252 for `.m3u`; relative, absolute and `file://` paths) into entries that keep their `#` lines and the path as written; `writePlaylist` writes it back in the same encoding. `addEntries`, `removeEntries` and `moveEntries` return the same object when nothing changes, so an edit that changes nothing records no undo step.
- **Stats (§10).** `parseStatsFile` and `writeStatsFile` read and write `stats.json`, every folder's favourites, plays, last played and added times by song path; text it can't read in full gives null, so the caller never writes over it. `listen` turns samples of the player into time heard and says once per start when a play counts. `moveStats` follows `findMoves`; `noteAdded` dates new songs; `favourites`, `recentlyAdded` and `mostPlayed` make the collections.
- **Tag writing (§11).** A `TagEdit` names only the fields that change (null takes one out). `writeId3.ts`, `writeFlac.ts`, `writeMp4.ts`, `writeOgg.ts` (comment packet, header pages re-laid, later pages renumbered with new CRCs) and `writeWav.ts` (`id3 ` chunk, `LIST/INFO`, RIFF size) rewrite the tag in a whole file in memory and keep every other frame, block or atom byte for byte, using the padding when the tag fits. `rewriteTags` writes, reads the result back and throws `TagCheckError` unless its tags equal `applyEdit` of the old ones, its stream facts (bit rate aside, which Ogg derives from the file size) and audio bytes are unchanged and (M4A) every chunk offset still points at the same bytes. It also gives the undo edit. `parseTagEdit` checks an edit arriving over IPC or HTTP.
- **Playback (§8.3, §8.6, §8.7).** `trimFor` works out how much of a decoded buffer is the song (cutting the encoder delay and padding only when the decoder didn't), `replayGainFactor` the song's level, and `crossfadeFor` and `fadeCurves` the equal-power fade.

## UI (`packages/ui`)

- **`Player`** holds the queue, the play state (`stopped`, `loading`, `playing`, `paused`), the position, the duration and the volume, as signals. It reads song bytes through the library source and hands them to an `AudioEngine`. After `MAX_FAILURES` songs in a row fail, it stops. If the browser keeps the sound off until the user acts, the player pauses and says so.
- **`Player`** decodes the following song once 30 s are left and hands it to the engine to start where the current one ends; Next by hand reuses that buffer. Edits to the queue take back and requeue what was handed over.
- **`WebAudioEngine`** decodes and trims songs and plays each through its own gain into the volume gain. The queued song's source is started at the exact context time the playing one ends, and with a crossfade both gains follow the fade curves. It takes an `EngineContext` and an `EngineOutput`, so the gapless scenario (`e2e/gapless.spec.ts`) renders it into an `OfflineAudioContext` and checks the join sample by sample.
- **Library sources** list the music files and give each one a `ByteSource` and a URL to play from.
- **Index stores** keep the index and its covers between runs: IndexedDB in the browser, the data folder over the bridge on the desktop.
- **Commands.**
  - `CommandCatalog` holds every command, with its shortcuts, its group and its enabled check.
  - Shortcuts use `mod`, which is ⌘ on a Mac and Ctrl elsewhere. Key names are canonical, such as `right` and `esc`.
  - The catalog feeds the keys, ⌘K, the native menu and the Keyboard Shortcuts window. `test/controls.test.ts` keeps `docs/controls.md` in step with it.

## Web app (`apps/web`)

- **`AppController`** holds the window's state as signals: the open folder, its songs and the library built from them, the scan, the view history (`views.ts`: back and forward), the songs the view shows and their selection (`selection.ts`), the search, the covers, the open dialog and the status-bar notice. Components read the signals, and commands call the controller's methods. Opening a folder shows its saved index at once, then rescans, updating the list every 500 ms, and saves the result. `Covers` turns cover references into URLs once each, and `QueueKeeper` saves the queue for the open folder (called every second; it writes when the queue changed or the position moved 5 s) and puts it back paused.
- **`Playlists`** (`playlists.ts`) holds the sidebar's list and the entries of each playlist read so far. Each edit shows at once, becomes an `UndoStack` step and is saved through the source's `PlaylistWriter` with the version last read. Saves of one playlist run one at a time; a failed one is retried at 300 and 600 ms, then the notice offers Try Again. A save refused as changed, deleted or existing sets `conflict`, which shows "<Playlist> changed somewhere else" and holds the keys until Keep Mine or Use Theirs. `checkOutside` runs when the window comes to the front and every 15 s. Sources with no writer (a folder in the browser) show the playlists but can't change them. Song rows in a playlist are keyed by `<index>\0<path>`, since a playlist may hold a song twice.
- **`Stats`** (`stats.ts`) holds the open folder's stats. The heart is an `UndoStack` step; `sample` runs with the player's tick and counts a play; `flush` writes through the index store every 2 s and when the page goes away, and never after a read failed. `viewRows.ts` works out the songs each view shows, the collections included.
- **`TagEditor`** (`tagEditor.ts`) is Song Info's state: it reads the selected songs' own tags (a `Song` holds fallbacks), tracks which fields changed, and saves through the source's `TagWriter` one file at a time with the size and time from the scan. The files written become one `UndoStack` step, whose undo and redo write back what the last write replaced, then rescan. `SongInfo.tsx` draws it.
- `Pages.tsx` draws each view; `SongList.tsx` is the one song table, drawing only the rows in view through `useVirtualRows`. Every row is 28 px, so the scroll position says which rows show.
- `main.tsx` picks the library source:
  - the desktop bridge when the app runs in Electron;
  - the server's `/api` when the server answers;
  - otherwise a folder the user picks.
- `mediaSession.ts` connects the system media keys and the Now Playing info.

## Server (`apps/server`)

- `ServerLibrary` (`library.ts`) scans the music folder on start with the same `scanLibrary` the page uses, reading only files whose size or time changed. It keeps the index and covers in the data folder (`--data`), and rescans 2 s after `fs.watch` reports a change, or every 60 s with `--poll` or where the folder can't be watched (SMB, NFS). One scan runs at a time.
- Reads: `/api/info` (the folder's name, `readOnly`), `/api/files`, `/api/media/<path>` (with `Range`), `/api/library` (the index with an `ETag`; 304 when the page has it, 204 before the first scan), `/api/covers/<sha256>` (cached for a year) and `/api/events` (server-sent events: `scan` with progress, `library` with the new ETag; a comment every 25 s keeps the stream open).
- Writes (`api.ts`): playlists at `/api/playlists/<path>` — `PUT` with `If-None-Match: *` to create or `If-Match: "<sha256>"` to write over the version read, `POST {to}` to rename, `DELETE` with `If-Match` to trash; `POST /api/tags` with the edit and the size and time read; `POST /api/stats` with what changed since the device last sent (`StatsChange`: plays add up, the latest play wins). Each runs the same `node-files` writers and checks as the desktop app. A stale version gets 412 and a clash 409, each with the reason in the body.
- A write must come from the server's own page (`Origin` matching `Host`, else 403) and send `application/json` where it sends JSON (else 415), so another site can't post a form to it. `--read-only` refuses playlist and tag writes with 403; stats still save.
- Every path is resolved inside the music folder, symlinks included. A path that leads outside the folder gets 403.
- A request whose `Host` header isn't allowed gets 421. The server has no sign-in, so it listens on loopback unless it is started with `--no-auth`.
- The page (`connectServer` in `sources.ts`) reads the index from the server and shows covers from `/api/covers`. It keeps the queue in the browser and sends stats as changes. When the event stream reports a new ETag, it rescans, starting from the songs the server read.
- `apps/web/src/sw.ts` is the phone app's service worker, built as `sw.js` with the build's file list written in. It keeps the app's own files at install and answers from them only while offline; it never handles `/api`. Only a server's page registers it.

## CLI (`apps/cli`)

- `run.ts` parses the line (`args.ts`, node:util `parseArgs`), finds the folder (`folder.ts`: `--dir`, `PLAYLARK_DIR`, else the desktop app's `folder.json`) and runs one command. Each command gives lines for people and an object for `--json`; errors are `CliError`s with exit 1, and conflicts (`FolderError` `changed`, `deleted`, `exists`) exit 2.
- Every command rescans first (`library.ts`), reusing every file whose size and time haven't changed. For the desktop app's own folder the index is its `library.json`; another folder's index goes in `cli/<hash>/` in the same data folder. Moved songs keep their stats in the shared `stats.json`, written under its lock file.
- Playlists and tags go through the same `node-files` writers as the desktop app and the server, with the version or size and time read in this run, so a change made elsewhere in between is a conflict.
- `play.ts` plays through afplay, ffplay or paplay, one song at a time. The `Player` interface is passed in, so the tests run with one that makes no sound.
- `skill/SKILL.md` teaches an agent the commands and their JSON.

## Desktop (`apps/desktop`)

- `crashGuard.ts` is registered first in the main process. An uncaught error or an unhandled rejection is logged, and the app exits with an error. Electron never shows it in a dialog.
- The renderer is sandboxed with context isolation. Its only native access is `window.playlarkNative`. It reaches songs at `app://playlark/media/<path>`, which only serves files inside the chosen folder, and stored covers at `app://playlark/cover/<sha256>`. The index is `library.json` in the data folder, with the covers in `covers/` beside it the queue in `queue.json` and the favourites and play counts in `stats.json`.
- Playlist writes go over IPC to `node-files`: written atomically under `.<name>.lock` if the file is still at the version the page read, renamed, or moved to `trash/<YYYY-MM-DD>/` in the data folder. Trash older than 30 days is deleted on start.
- Tag saves go over IPC to `writeSongTags` in `node-files`: under the lock file, if the song still has the size and time the page read, the new bytes go to a temp file beside it, are read back and compared, the original moves to the trash, and the temp file is renamed into place.
- With `--headless`, the app runs with no window, no Dock icon and no sound, on a throwaway profile. It skips native dialogs and records each one in `globalThis.playlarkHeadless`.
