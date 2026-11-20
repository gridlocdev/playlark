# Playlark

Playlark is a music player for a folder of your own music files: MP3, FLAC, M4A, Ogg and WAV. It runs as a desktop app, in the browser, and from a small server on a NAS, so the same library plays on every device.

- **Your folder is the library.** Point Playlark at a folder and it lists every song from the files' own tags. Nothing is imported or copied.
- **Plays straight through.** Each song starts as the last one ends, with a queue you can see and jump around in.
- **Keyboard first.** Every command has a shortcut, and ⌘K runs any of them by name.

## Getting started

Playlark isn't released yet. To run it from source you need Node 22.18 or later, pnpm and [just](https://github.com/casey/just):

```bash
just setup
just run-desktop
```

`just run-server` serves the web client and a music folder on http://localhost:8830.

## Docs

- [Features](docs/features.md)
- [Controls](docs/controls.md)
- [Development](docs/development.md) and [Architecture](docs/architecture.md)

## License

[MIT](LICENSE)
