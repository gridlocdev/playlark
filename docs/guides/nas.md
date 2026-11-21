# Running on a NAS

The Playlark server plays one music folder in any browser on your network, phones included. It reads the folder itself, keeps the library, covers, favourites and play counts in its own data folder, and notices when files change.

## With Docker

Copy `compose.example.yaml` to `compose.yaml` on the NAS, change the music folder's path, and start it:

```bash
docker compose up -d
```

The image runs as uid 1000. If your music share belongs to another user, set `user:` in the compose file. The example publishes the port on 127.0.0.1 only, for a reverse proxy on the same machine.

## Without Docker

```bash
node apps/server/src/main.ts --dir /volume1/music --data /volume1/playlark
```

## Options

Each option can also come from the environment, which is how the Docker image sets them.

| Option | Environment | What it does |
| --- | --- | --- |
| `--dir <folder>` | `PLAYLARK_MUSIC` | The music folder. Without one, the server serves the web client alone. |
| `--data <folder>` | `PLAYLARK_DATA` | The index, covers, favourites and play counts, and the trash of replaced files. Default `~/.local/share/playlark-server`. |
| `--port <n>` | `PLAYLARK_PORT` | Default 8830. |
| `--host <address>` | `PLAYLARK_HOST` | Default 127.0.0.1. |
| `--read-only` | `PLAYLARK_READ_ONLY=1` | No playlist or tag saves into the music folder. |
| `--poll` | `PLAYLARK_POLL=1` | Read the folder every minute instead of watching it. Use it for SMB and NFS mounts, which don't report changes. |
| `--no-auth` | `PLAYLARK_NO_AUTH=1` | Listen on an address other machines reach. |
|  | `PLAYLARK_HOSTS` | The host names you browse to, comma-separated. localhost and IP addresses always work. |

## No accounts

Playlark has no sign-in: anyone who reaches the server can play and edit the folder. It listens on 127.0.0.1 unless you pass `--no-auth`. Do that only behind a reverse proxy that asks for a login, or on a network you trust. A write must come from Playlark's own page, so another website can't change your files through your browser.

## On a phone

Open the server's address in Safari or Chrome, then use **Add to Home Screen**. Playlark opens full screen with its own icon, keeps its own files so it opens even offline, and shows the phone layout. Songs still stream from the server.
