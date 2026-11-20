# Changelog

## Unreleased

- Open a music folder and see every MP3, FLAC, M4A (AAC and ALAC), Ogg Vorbis, Opus and WAV file in it, with titles, artists, albums and lengths read from the files' own tags.
- Play songs with play, pause, next, previous, skip and volume, from the now-playing bar, the keyboard, media keys and the lock screen. Playing a song queues the list from there, and the queue panel shows what comes next.
- The command menu (⌘K), the Keyboard Shortcuts window (⌘/) and the menu bar, all from one list of commands.
- Cover art beside the playing song and on the lock screen: the picture inside the file, or the folder's cover image.
- The library is remembered between runs and shown at once; a rescan reads only what changed, and the list fills in as it goes.
- Browse by Albums, Artists and Folders, with album and artist pages, back and forward (⌘[ ⌘]), and a sidebar (⌥⌘S). Sort the song list by any column.
- Search (⌘F) finds artists, albums and songs as you type, ignoring case and accents.
- Select several songs with ⇧ and ⌘, or all of them (⌘A), and play just those. Go to Album, Go to Artist and Go to Current Song (⌘L).
- Gapless playback: each song starts on the exact sample the last one ends, in every format, with ReplayGain (Album by default) and an optional crossfade.
- The queue panel: drag to reorder, Delete or × to remove, Clear Up Next. Play Next and Add to Queue from the song's right-click menu. Shuffle (⌘S), Repeat Off/All/One (⌥⌘R), and Shuffle buttons on album, artist and folder pages.
- The queue comes back paused, on the same song and second, the next time the folder is opened.
- Lists draw only the rows in view, so very large libraries scroll smoothly.
- Files that can't be read stay listed, and the status bar's **Show** lists each one with the reason.
- Sort names (artist, album artist, album, title) and ReplayGain values are read from every format.
- Playlists: every `.m3u8` and `.m3u` file in the folder is in the sidebar; missing songs show greyed and are skipped. In the desktop app, New Playlist (⌘N), Add to Playlist… or a drag onto the sidebar, reorder by dragging, Delete to take songs out, Rename and Delete Playlist (to the trash), all with Undo (⌘Z) and saved at once. A playlist changed by another app is picked up, or asks Keep Mine or Use Theirs while you are editing it.
- Favourites (♥, ⌥⌘F) and play counts, with Favourites, Recently Added and Most Played in the sidebar. A play counts after half the song or 4 minutes; a moved song keeps its stats.
- The desktop app (Electron), the browser build (Chrome and Edge open a folder directly), and a server that plays a NAS folder in any browser.
