# Architecture

Playlark is one TypeScript code base that runs in three places: the browser, the NAS server's client and the Electron app. All three run the same UI. The only difference between them is where the songs come from.

```
     ┌───────────────── apps/web (Vite, Preact) ─────────────────┐
     │  App · Pages · SongList · NowPlaying · QueuePanel         │
     │  AppController (folder, library, views, selection,       │
     │                 search, notices) · views · selection      │
     │  Covers · QueueKeeper                                     │
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
     │                 ├─ serverLibrary        (NAS: /api)           │
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
     │  queue (shuffle, repeat, edits, saved queue) · playback   │
     │  (trim, ReplayGain, crossfade)                            │
     └──────────────────────────────────────────────────────────┘

 packages/node-files  Node only: folder listings confined to the folder, media replies with Range, atomic writes
 apps/server          node:http, GET and HEAD only: the static client + /api/{info,files,media}
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
- `Pages.tsx` draws each view; `SongList.tsx` is the one song table, drawing only the rows in view through `useVirtualRows`. Every row is 28 px, so the scroll position says which rows show.
- `main.tsx` picks the library source:
  - the desktop bridge when the app runs in Electron;
  - the server's `/api` when the server answers;
  - otherwise a folder the user picks.
- `mediaSession.ts` connects the system media keys and the Now Playing info.

## Server (`apps/server`)

- The server answers `GET` and `HEAD` only. Any other method gets 405.
- `/api/info` gives the folder's name. `/api/files` gives the music files with their sizes and modified times. `/api/media/<path>` gives a song's bytes, and supports `Range`.
- Every path is resolved inside the music folder, symlinks included. A path that leads outside the folder gets 403.
- A request whose `Host` header isn't allowed gets 421. The server has no sign-in, so it listens on loopback unless it is started with `--no-auth`.

## Desktop (`apps/desktop`)

- `crashGuard.ts` is registered first in the main process. An uncaught error or an unhandled rejection is logged, and the app exits with an error. Electron never shows it in a dialog.
- The renderer is sandboxed with context isolation. Its only native access is `window.playlarkNative`. It reaches songs at `app://playlark/media/<path>`, which only serves files inside the chosen folder, and stored covers at `app://playlark/cover/<sha256>`. The index is `library.json` in the data folder, with the covers in `covers/` beside it and the queue in `queue.json`.
- With `--headless`, the app runs with no window, no Dock icon and no sound, on a throwaway profile. It skips native dialogs and records each one in `globalThis.playlarkHeadless`.
