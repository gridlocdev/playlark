# Changelog

## Unreleased

- Firefox and Safari open a music folder in the browser build too, through the browser's folder picker.
- **Press a Shortcut…** in the Keyboard Shortcuts window (⌘/) shows which command a key runs, without running it. Esc or **Stop** ends it.
- Keyboard focus is drawn by the app in one ring, in light and dark. The song list rings the row the arrow keys move from, album covers, artists and subfolders are one Tab stop each with the arrow keys inside, and closing a dialog puts focus back on the song or album it was opened from, even when it was opened from ⌘K.
- The desktop app turns off Electron's Node.js switches (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`) and loads only its own code.
- If you build Playlark yourself, `just install-desktop` offers to quit a running copy and opens it again after installing.

## 1.0.0 (2026-11-22)

- Open a music folder and see every MP3, FLAC, M4A (AAC and ALAC), Ogg Vorbis, Opus and WAV file in it, with titles, artists, albums and lengths read from the files' own tags.
- Play songs with play, pause, next, previous, skip and volume, from the now-playing bar, the keyboard, media keys and the lock screen. Playing a song queues the list from there, and the queue panel shows what comes next.
- The command menu (⌘K), the Keyboard Shortcuts window (⌘/) and the menu bar, all from one list of commands.
- Cover art beside the playing song and on the lock screen: the picture inside the file, or the folder's cover image.
- The library is remembered between runs and shown at once; a rescan reads only what changed, and the list fills in as it goes.
- Browse by Albums, Artists and Folders, with album and artist pages, back and forward (⌘[ ⌘]), and a sidebar (⌥⌘S). Sort the song list by any column.
- Search (⌘F) finds artists, albums and songs as you type, ignoring case and accents.
- Select several songs with ⇧ and ⌘, or all of them (⌘A), and play just those. Go to Album, Go to Artist and Go to Current Song (⌘L).
- Gapless playback: each song starts on the exact sample the last one ends, in every format, with ReplayGain (Album by default) and an optional crossfade.
- The queue panel: drag to reorder, Delete or × to remove, Clear Up Next. Play Next and Add to Queue from the song's right-click menu. In the desktop app, Show in Finder (Show in File Explorer on Windows, Show in File Manager on Linux) from the same menu. Shuffle (⌘S), Loop This Song (⌥⌘R) and Loop Queue (⌥⇧⌘R) as two buttons, and Shuffle buttons on album, artist and folder pages.
- The queue comes back paused, on the same song and second, the next time the folder is opened.
- Lists draw only the rows in view, so very large libraries scroll smoothly.
- Files that can't be read stay listed, and the status bar's **Show** lists each one with the reason.
- Sort names (artist, album artist, album, title) and ReplayGain values are read from every format.
- Playlists: every `.m3u8` and `.m3u` file in the folder is in the sidebar; missing songs show greyed and are skipped. In the desktop app, New Playlist (⌘N), Add to Playlist… or a drag onto the sidebar, reorder by dragging, Delete to take songs out, Rename and Delete Playlist (to the trash), all with Undo (⌘Z) and saved at once. A playlist changed by another app is picked up, or asks Keep Mine or Use Theirs while you are editing it.
- Favourites (♥, ⌥⌘F) and play counts, with Favourites, Recently Added and Most Played in the sidebar. A play counts after half the song or 4 minutes; a moved song keeps its stats.
- Song Info (⌘I): see a song's tags, cover and file facts, and in the desktop app edit the tags and cover of MP3, FLAC, M4A, Ogg Vorbis, Opus and WAV files, one song or many at once. Only changed fields are written, each file is checked after writing, the original goes to the trash, and ⌘Z puts the old tags back.
- The desktop app (Electron), the browser build (Chrome and Edge open a folder directly), and a server that plays a NAS folder in any browser.
- The NAS server reads its folder itself, keeps the library, covers, favourites and play counts in its data folder, and notices changes to the folder (or reads it every minute with `--poll`). Every device that plays from it shares favourites and play counts, and can edit playlists and tags; `--read-only` turns those writes off.
- On a phone: a bottom tab bar, a mini player that opens full screen, tap to play, and Add to Home Screen for an app that opens offline.
- A Docker image and `compose.example.yaml` for running the server on a NAS.
- An app icon.
- Settings (⌘,): Light, Dark or System appearance, ReplayGain mode and pre-amp, crossfade, and Rescan on start.
- The desktop app asks at first start whether to use your Music folder or choose one, and asks again, naming it, when that folder is gone. The last three folders keep their library index, so switching back with Open Music Folder… is quick.
- The `playlark` command: list songs, albums and artists, search, check for missing tags, missing covers, duplicates and unreadable files, edit tags, make and change playlists, and play from a terminal, with `--json` output for scripts and an agent skill file.
