# Playlark

Playlark plays a folder of your own music files: MP3, FLAC, M4A, Ogg Vorbis, Opus and WAV. Use it as a desktop app, in the browser, or from a small server on your NAS, so the same library plays on every device.

![Playlark in light mode. A sidebar on the left lists the library (Songs, Albums, Artists, Folders), the collections (Favourites, Recently Added, Most Played) and an empty Playlists section. The middle shows the album Harbour Lights by Northwind Quartet, from 2021, with a Play and a Shuffle button above its three songs; the second song, Salt Air, is highlighted and playing. On the right, the Queue panel shows Salt Air under Now Playing and Lantern Walk under Up Next. The bar along the bottom shows the playing song, the shuffle, previous, pause, next and loop buttons over a progress bar, and the volume slider.](docs/images/playlark.webp)

- **Your folder is the library.** Point Playlark at a folder and it lists every song from the files' own tags. Nothing is imported or copied.
- **Plays straight through.** Each song starts as the last one ends, with a queue you can see and change.
- **Keyboard first.** Every command has a shortcut, and ⌘K runs any of them by name.

## Getting started

Playlark isn't released yet. With Node 22.18 or later, pnpm and [just](https://github.com/casey/just), run it from source:

```bash
just setup && just run-desktop
```

[Getting started](docs/getting-started.md) covers the browser, the NAS server and the command line too.

## Learn more

[Features](docs/features.md) · [Controls](docs/controls.md) · [Running on a NAS](docs/guides/nas.md) · [The command line](docs/guides/cli.md)

All the docs are in [docs/](docs/README.md). To work on Playlark, start with [Development](docs/development.md).

## License

[MIT](LICENSE). The icons have their own license, listed in [Credits](docs/credits.md).
