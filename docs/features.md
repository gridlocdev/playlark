# Features

What Playlark does today, named the way the scenarios in `e2e/` name them. The [product requirements](plans/prd.md) describe everything planned.

## Opening a music folder

Playlark plays one folder of music and everything under it. The desktop app asks for the folder on first start (**Open Music Folder…**, ⌘O) and remembers it. A Playlark server opens the folder it serves by itself. In Chrome and Edge the browser build opens a folder you pick. MP3, FLAC, M4A (AAC and ALAC), Ogg Vorbis, Opus and WAV files are listed; other files and hidden folders are skipped.

## The song list

Every song, with its title, artist, album and length, read from the file's own tags (the file name when it has none). Songs sort by artist, album, disc and track. Click to select, use the arrow keys, Page Up/Down, Home and End to move, and press Return or double-click to play. A file that can't be read stays in the list, greyed out, with the reason on hover.

## Playing songs

Play, pause, next, previous, skip 10 seconds and volume, from the now-playing bar, the keyboard, the media keys or the lock screen. Playing a song queues the whole list from there, and each song starts as the last one ends. Previous goes back to the start of the song after 3 seconds. The volume is remembered.

## The queue

The queue panel (⌥⌘U) shows the playing song and what comes after it. Click a song in it to jump there.

## Desktop app

The Electron app for macOS, Windows and Linux, with the menu bar built from the same commands, and the folder kept between starts.
