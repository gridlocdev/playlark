---
name: playlark
description: Use the playlark command to list, search and check a local music folder (MP3, FLAC, M4A, Ogg, WAV), edit song tags, make and edit .m3u8 playlists, and play songs from a terminal. Use when someone asks about their music library, wants tags fixed, playlists made or changed, duplicates or missing covers found, or a song played, and the playlark command is installed.
---

# playlark

`playlark` works on one music folder: the one the Playlark app has open, `PLAYLARK_DIR`, or `--dir <folder>`. It shares the app's library index, favourites, play counts and trash, so changes show in the app.

## Ground rules

- Always pass `--json`. Every command prints one JSON object: `{ "ok": true, … }`, or `{ "ok": false, "error": "…", "exit": n }`.
- Exit codes: 0 done, 1 error or usage mistake, 2 conflict (the file changed elsewhere, or a playlist with that name exists). On 2, read again and retry once; don't force anything.
- Songs are named by their path in the music folder (as `songs --json` gives it, with `/`), or by a path to the file.
- Read before you write: find paths with `songs` or `search`, look at a playlist with `playlist show`, look at tags with `tags show`.
- Tag edits rewrite the user's files (the original goes to the app's trash). Confirm with the user before changing more than a few songs, and say which.
- `play` makes sound on the user's speakers. Only run it when asked to play something.

## Commands

| Command | What it gives |
| --- | --- |
| `scan` | `songs`, `albums`, `artists`, `unreadable` counts |
| `songs [--artist A] [--album B] [--genre G] [--year Y]` | `songs`: path, title, artist, album, albumArtist, track, disc, year, genre, duration (s), format |
| `albums [filters]` | `albums`: title, artist, year, songs, duration, cover |
| `artists [filters]` | `artists`: name, albums |
| `search <words…>` | `artists`, `albums`, `songs`; every word must start a word in a title, artist, album, genre or file name |
| `check` | `missingTags`, `albumsWithoutCover`, `likelyDuplicates` (same artist and title, within 2 s), `unreadable` |
| `playlist list` | `playlists`: name, path, entries, missing |
| `playlist show <name>` | `entries`: position (from 1), entry, path (null when missing), title, artist |
| `playlist create <name> [songs…]` | `path` of the new file, in `Playlists/` |
| `playlist add <name> <songs…>` | `path`, `entries` |
| `playlist remove <name> <positions…>` | positions as `playlist show` numbers them |
| `playlist check [<name>]` | per playlist, the entries whose song isn't in the folder |
| `tags show <song>` | `song` with its tags |
| `tags set <songs…> --title … --artist … --album … --album-artist … --genre … --track n --track-total n --disc n --disc-total n --year n --compilation yes\|no` | `saved`; an empty value (`--genre ""`) removes the tag |
| `play <song \| playlist name \| search words>` | plays them in order through afplay, ffplay or paplay; `played`, `stopped` |

Filters match words the way search does: `--artist beat` matches "The Beatles".

## Examples

```bash
playlark --json search harbour lights
playlark --json tags set "Northwind Quartet/Harbour Lights/01 Morning Tide.mp3" --track 1 --track-total 3
playlark --json playlist create "Road Trip" "Northwind Quartet/Harbour Lights/01 Morning Tide.mp3"
playlark --json check
```
