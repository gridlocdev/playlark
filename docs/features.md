# Features

What Playlark does today, named the way the scenarios in `e2e/` name them. The [product requirements](plans/prd.md) describe everything planned.

## Opening a music folder

Playlark plays one folder of music and everything under it. The desktop app asks for the folder on first start (**Open Music Folder…**, ⌘O) and remembers it. A Playlark server opens the folder it serves by itself. In Chrome and Edge the browser build opens a folder you pick. MP3, FLAC, M4A (AAC and ALAC), Ogg Vorbis, Opus and WAV files are listed; other files and hidden folders are skipped.

## The song list

Every song, with its title, artist, album and length, read from the file's own tags (the file name when it has none). Songs sort by artist, album, disc and track; click a column header to sort by it, and again to reverse. Click to select, use the arrow keys, Page Up/Down, Home and End to move, and press Return or double-click to play. A file that can't be read stays in the list, greyed out, with the reason on hover.

## Selecting songs

⇧↑, ⇧↓ and ⇧-click extend the selection, ⌘-click adds or removes one song, and ⌘A selects every song in the view. Return plays the selection: one song plays the list from there, several play just those.

## Long lists

Lists draw only the rows in view, so a library of 50,000 songs scrolls smoothly.

## Albums

The sidebar's **Albums** (⌘2) shows every album as a cover with its title and album artist. An album's page shows its cover, artist, year, song count and length, a **Play** button, and its songs grouped by disc when it has more than one.

## Artists

**Artists** (⌘3) lists each album artist with their album count. An artist's page has **Play**, their albums newest first, and the albums they appear on.

## Folders

**Folders** (⌘4) follows the music folder on disk: a folder shows its subfolders, then its songs. **Play** plays the folder and everything under it.

## Back and forward

The toolbar's arrows, ⌘[ and ⌘] walk back and forward through the views you opened. ⌥⌘S hides the sidebar. **Go to Album**, **Go to Artist** and **Go to Current Song** (⌘L) jump from a song to where it belongs.

## Search

⌘F goes to the search field. As you type, Playlark finds artists, albums and songs whose title, artist, album, album artist, genre or file name has a word starting with each word you typed, ignoring case and accents ("north har" finds Harbour Lights by Northwind Quartet). Escape clears the search and goes back.

## Playing songs

Play, pause, next, previous, skip 10 seconds and volume, from the now-playing bar, the keyboard, the media keys or the lock screen. Playing a song queues the whole list from there, and each song starts as the last one ends. Previous goes back to the start of the song after 3 seconds. The volume is remembered.

## Gapless playback

Each song starts on the exact sample the last one ends, so a live album or a DJ mix plays without a gap or a click, in every format. The next song is read and decoded while the current one has 30 seconds left. ReplayGain (Album by default) evens out loudness, and an optional crossfade blends songs, except consecutive tracks of one album.

## The queue

The queue panel (⌥⌘U) shows the playing song and **Up Next**. Double-click or press Return to jump to a song, drag one to move it, press Delete or click its × to take it out, and **Clear** to empty Up Next.

## Play Next and Add to Queue

Right-click a song, or the selected songs, for **Play Next** (right after the playing song) or **Add to Queue** (at the end). Neither stops what's playing, and the status bar says what was added.

## Shuffle and repeat

**Shuffle** (⌘S) shuffles what comes after the playing song; turning it off puts the original order back. The **Shuffle** buttons on album, artist and folder pages play them shuffled. **Repeat** (⌥⌘R) goes Off, All, One: All starts the queue again after the last song, and One plays the song again without a gap.

## Picking up where you left off

The queue, the song and the place in it, shuffle and repeat are kept, and come back paused the next time Playlark opens the same folder. Songs that are gone by then are dropped, and the status bar says how many.

## Desktop app

The Electron app for macOS, Windows and Linux, with the menu bar built from the same commands, and the folder kept between starts.

## Cover art

The playing song's cover shows in the now-playing bar and on the lock screen. A picture inside the file wins; otherwise Playlark uses an image in the song's folder named `cover`, `folder`, `front` or `album` (`.jpg`, `.jpeg` or `.png`). Each picture is stored once beside the library index, never in the music folder.

## Files that can’t be read

A file that can't be read stays in the list, greyed out. The status bar says how many there are; **Show** lists each one with the reason.

## Remembering the library

Playlark keeps what it read from the folder (the desktop app in its data folder, the browser in its own storage) and shows it at once the next time. A rescan then reads only the files that changed, and the list fills in every half second while it runs.

## Playlists

Every `.m3u8` and `.m3u` file in the music folder shows under **Playlists** in the sidebar, named after its file. A playlist plays like any other list. A song it names that isn't in the folder shows greyed as "Missing: <path>", stays in the file and is skipped when played.

## Editing playlists

In the desktop app, **New Playlist** (⌘N) makes `Playlists/New Playlist.m3u8` with the selected songs and lets you name it. Drag songs onto a playlist in the sidebar, or use **Add to Playlist…**, to add them at the end. Inside a playlist, drag songs to reorder them and press Delete to take them out. Rename and delete a playlist from its right-click menu. A deleted playlist goes to Playlark's trash in its data folder for 30 days. Every change is saved at once and can be undone with ⌘Z. If another app changes a playlist while you are editing it, Playlark asks whether to keep yours or take theirs.

## Favourites and play counts

The **♥** in a song's row, in the now-playing bar or **Favourite** (⌥⌘F) marks the selected songs, or the song playing, as favourites; Undo takes it back. A song counts as played once it has played for half its length or 4 minutes, whichever comes first; seeking past that doesn't count. The Songs table shows the plays and sorts by ♥ and Plays. Under **Collections** in the sidebar, **Favourites**, **Recently Added** (the last 90 days) and **Most Played** (the top 100) list them. A song moved within the folder keeps its stats. The desktop app keeps them in `stats.json` in its data folder, the browser in its own storage; never in the music files.
