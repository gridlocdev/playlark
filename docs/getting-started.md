# Getting started

Playlark runs as a desktop app, as a web page that opens a folder on your computer, and as a server on a NAS that any browser on your network can use. There is also a `playlark` command for the terminal.

## What you need

- Your music as files in one folder: MP3, FLAC, M4A (AAC and ALAC), Ogg Vorbis, Opus or WAV.
- To run it from source: Node 22.18 or later, pnpm (through corepack) and [just](https://github.com/casey/just).

## Download

There are no prebuilt desktop downloads yet. The web client runs at https://gridloc.dev/apps/playlark/ in any current desktop browser. To build the desktop app yourself, run `just package-desktop` after `just setup`: it writes a `.dmg` and `.zip` on macOS, an `.exe` on Windows or an AppImage on Linux into `apps/desktop/release`. On macOS, `just install-desktop` copies it to `/Applications`.

## Run it from source

```bash
just setup         # corepack enable, then pnpm install
just run-desktop   # build the web client and open the desktop app
```

Without just, run `corepack enable && pnpm install`, then the commands in the `justfile`.

## In the browser

`just run-web` serves the web client on http://localhost:5173. It opens a folder you pick from your computer. It works in Chrome, Edge, Firefox and Safari, and your files stay on your computer.

## Run it on a NAS (Docker)

`just run-server ~/Music` serves the web client and a music folder on http://localhost:8830. To run it on a NAS with Docker, copy `compose.example.yaml` to `compose.yaml`, set the music folder's path and run `docker compose up -d`. [Running on a NAS](guides/nas.md) lists every option and explains why there are no accounts. On a phone, open the server's address and use **Add to Home Screen**.

## The command line

`just cli songs` runs the `playlark` command on the desktop app's folder. It lists, searches and checks the folder, edits tags and playlists, and plays songs from a terminal. See [The command line](guides/cli.md).

## First run

At first start the desktop app asks whether to use your Music folder or choose another, then lists every song in it. Double-click a song to play it, or press ⌘K and type the name of any command. **Open Music Folder…** (⌘O) switches folders later.

The desktop app keeps its settings (`settings.json`), the chosen folder (`folder.json`), its window size and one library index per music folder in its data folder: `~/Library/Application Support/Playlark` on macOS, `~/.config/Playlark` on Linux and `%APPDATA%\Playlark` on Windows. Nothing is written into your music folder except the playlists and tags you edit. The browser keeps the same things in its own storage, and the server in its `--data` folder.
