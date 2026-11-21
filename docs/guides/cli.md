# The command line

`playlark` works on your music folder from a terminal. It reads the same files as the app, keeps its library, favourites, play counts and trash in the desktop app's data folder, and writes playlists and tags with the same checks, so whatever it changes shows in the app.

## Running it

From the source folder, `just cli <command>` runs it. To have `playlark` on your path, link the bin: `ln -s "$PWD/apps/cli/bin/playlark.mjs" ~/.local/bin/playlark`. It needs Node 22.18 or later.

The folder is `--dir <folder>`, else `PLAYLARK_DIR`, else the folder the Playlark app has open. `PLAYLARK_USER_DATA` points it at a data folder other than the desktop app's.

## Commands

| Command | What it does |
| --- | --- |
| `scan` | Rescans and counts songs, albums, artists and unreadable files |
| `songs`, `albums`, `artists` | Lists them; `--artist`, `--album`, `--genre` and `--year` narrow the list |
| `search <words…>` | Finds artists, albums and songs, like the app's search |
| `check` | Songs missing a title, artist, album or track number; albums without cover art; likely duplicates (same artist and title, within 2 s); unreadable files |
| `playlist list` | Every playlist, with how many songs and how many are missing |
| `playlist show <name>` | A playlist's songs, numbered |
| `playlist create <name> [songs…]` | A new playlist in `Playlists/` |
| `playlist add <name> <songs…>` | Adds songs at the end |
| `playlist remove <name> <positions…>` | Takes out the songs at those numbers |
| `playlist check [<name>]` | Entries whose song isn't in the folder |
| `tags show <song>` | A song's tags |
| `tags set <songs…> --title … --artist …` | Changes tags: `--title`, `--artist`, `--album`, `--album-artist`, `--genre`, `--track`, `--track-total`, `--disc`, `--disc-total`, `--year`, `--compilation yes\|no`. `""` takes a tag out |
| `play <song \| playlist \| words>` | Plays a song, a playlist or what a search finds, one after another, through `afplay` (macOS), `ffplay` or `paplay`. Ctrl-C stops. Not gapless |

A song is its path in the music folder (`"Artist/Album/01 Song.flac"`) or a path from where you are to the file. Every command rescans first, which takes a moment only when files changed.

## Scripts and agents

`--json` prints every answer as one JSON object, `{ "ok": true, … }`, and every error as `{ "ok": false, "error": "…", "exit": n }`. Exit codes: 0 done, 1 an error or a mistake on the command line, 2 a conflict (the file changed somewhere else in the meantime, or a playlist with that name exists).

[`apps/cli/skill/SKILL.md`](../../apps/cli/skill/SKILL.md) is a skill file that teaches an AI agent to use the command.
