# Playlark glossary

Playlark is a music player for one folder of music files. It lists the songs from their own tags and plays them through a queue, in a desktop app, a browser, a NAS server's web page and a command-line tool.

## Language

### The library

**Music folder**: The one folder, with everything under it, that Playlark plays. Its files are the source of truth. _Avoid_: library folder, root, collection

**Song**: One audio file in the **Music folder** that Playlark can read: MP3, FLAC, M4A, Ogg Vorbis, Opus or WAV. Its title, artist, album and the rest come from the file's own tags. _Avoid_: track, file, item

**Library**: Every **Song** in the **Music folder**, with the **Albums** and **Artists** built from their tags. The sidebar's Library section browses it as Songs, Albums, Artists and Folders. _Avoid_: collection, catalog

**Album**: The **Songs** that share an album title and album artist (or artist). Its page has a cover, **Play** and **Shuffle**. _Avoid_: record, release

**Artist**: A name from the songs' artist or album artist tags. Its page lists its **Albums**. _Avoid_: band, performer

**Folder**: A folder inside the **Music folder**, as the Folders view shows it: its subfolders, then its **Songs**. _Avoid_: directory

**Unreadable file**: A file with a music extension whose tags or audio Playlark can't read. It is listed so you can find it, but it can't be played. _Avoid_: broken song, corrupt file

**Index**: What Playlark read from a **Music folder**, kept in its data folder (one per folder, the last three) or the browser's storage, so the **Library** shows at once. It is a cache: thrown away and rebuilt whenever it is missing or out of date. **Rescan** reads only the files that changed. _Avoid_: database, cache file

### Playing

**Queue**: The **Songs** Playlark plays, in order: the playing song and **Up Next**. Playing a song from a list queues the whole list from that song. _Avoid_: play order, now-playing list

**Up Next**: The part of the **Queue** after the playing song. **Play Next** adds songs at its start, **Add to Queue** at its end, and **Clear** empties it. _Avoid_: upcoming, next songs

**Now-playing bar**: The bar along the bottom of the window: the playing song, the playback buttons, the progress bar and the volume. _Avoid_: player bar, transport, footer

**Mini bar**: The **Now-playing bar** in the phone layout: the playing song with play and next. **⌃** opens the **Full-screen player**. _Avoid_: mini player

**Full-screen player**: The phone layout's page for the playing song: its cover, the seek bar, **Shuffle**, the loop modes, the ♥ and the **Queue**. _Avoid_: now-playing screen

**Shuffle**: A mode that plays **Up Next** in a random order. Turning it off puts the original order back. _Avoid_: random

**Loop This Song**: A mode that plays the same song again, without a gap, each time it ends. `Repeat` `'one'` in the code. _Avoid_: repeat one, repeat this song

**Loop Queue**: A mode that starts the **Queue** again after its last song. `Repeat` `'all'` in the code. _Avoid_: repeat all, repeat queue, loop all

**Gapless playback**: Each **Song** starts on the exact sample the last one ends, so a live album or a DJ mix plays without a gap or a click. _Avoid_: seamless playback

**Crossfade**: A setting of up to 12 seconds over which one **Song** fades out as the next fades in, except between consecutive songs of one **Album**. Off by default. _Avoid_: fade, overlap

**ReplayGain**: A setting that evens out loudness from the gain values in the songs' tags, per song (Track) or per **Album**, with a pre-amp. _Avoid_: volume levelling, normalisation

### Your own lists

**Playlist**: An `.m3u8` or `.m3u` file in the **Music folder** that names **Songs** in order. New playlists go in `Playlists/`. An entry whose song isn't in the folder is a missing entry: it stays in the file and is skipped. _Avoid_: mix, list

**Favourite**: A **Song** you marked with the ♥. Favourites are kept by Playlark, never written into the song file. _Avoid_: like, loved, starred, favorite

**Play count**: How many times a **Song** has been played: once it has played for half its length or 4 minutes, whichever comes first. _Avoid_: listens, plays (except as the Songs column label)

**Collection**: A list Playlark builds from the **Favourites**, **Play counts** and the dates songs were added: **Favourites**, **Recently Added** (the last 90 days) and **Most Played** (the top 100). Shown under Collections in the sidebar. _Avoid_: smart playlist

### Editing

**Song Info**: The dialog that shows the selected songs' tags and cover, and edits them in the desktop app and on a **Server**. _Avoid_: tag editor, properties, get info

**Trash**: Playlark's own folder in its data folder where a deleted **Playlist** or the original of a retagged **Song** stays for 30 days, so Undo can put it back. _Avoid_: recycle bin, backup

### The window

**Status bar**: The line along the bottom of the window for the latest notice (with Undo where an undo exists), scanning progress, the number of **Songs** and the **Music folder**'s name. Playlark has no pop-up toasts. _Avoid_: toast, snackbar

**Command menu**: The search field that ⌘K opens over the window, which runs any **Command** by name. _Avoid_: command palette, launcher

**Keyboard Shortcuts window**: The dialog (⌘/) that lists every **Command** with its keys. Its **Press a Shortcut…** mode names the **Command** a key runs without running it. _Avoid_: shortcut list, cheat sheet

**Cursor row**: The row in the song list or **Up Next** that the arrow keys move from. While the list has the keyboard it has the focus ring, also when several songs are selected. _Avoid_: focused row, current row

### Ways to run it

**Command**: One action in the command catalog, with a name, an optional shortcut and a description. Keys, ⌘K, right-click menus, the menu bar and the Keyboard Shortcuts window all run the same commands. _Avoid_: action, menu item

**Desktop app**: Playlark as an Electron app, with the **Music folder** on your computer and its settings in its data folder. _Avoid_: Electron app, native app

**Server**: The Playlark server that serves one **Music folder** and the web client to any browser on the network, usually on a NAS. _Avoid_: backend, NAS app

**CLI**: The `playlark` command, which works on the same **Music folder**, **Index**, **Favourites** and **Trash** as the **Desktop app**. _Avoid_: command-line app, tool

## Relationships

- A **Music folder** holds many **Songs** and **Playlists**, and has one **Index** per data folder.
- A **Song** belongs to one **Album** and one **Folder**, and an **Artist** has many **Albums**.
- A **Playlist** names many **Songs**, and a **Song** can be in many **Playlists**.
- The **Queue** holds the playing **Song** and **Up Next**; **Loop This Song** and **Loop Queue** can't both be on.
- A **Collection** is built from **Favourites**, **Play counts** and dates added; it is never a file.

## Flagged ambiguities

- "Repeat" was the UI's word for both modes, and the code's type is still `Repeat` (`'one'`, `'all'`). Resolved: the UI says **Loop This Song** and **Loop Queue**, and "repeat" is no longer used in the UI or docs.
- "Library" meant both the songs Playlark lists and the folder on disk. Resolved: the folder is the **Music folder**, what Playlark lists from it is the **Library**, and what it keeps of it is the **Index**.
- "Track" is a tag (the track number) and a ReplayGain mode, not a name for a song. Resolved: a playable file is a **Song**.
