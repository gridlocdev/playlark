import { useState } from 'preact/hooks';
import { fold, type Album, type Artist, type Folder, type Song } from '@playlark/core';
import { formatCount, formatTime, Icon, type CommandCatalog } from '@playlark/ui';
import { AlbumGrid, AlbumShelf, ArtistList, Cover, albumCount, roving, wrapKeys } from './Browse.tsx';
import type { AppController } from './controller.ts';
import { collection, type CollectionKind } from './Collections.tsx';
import { PlaylistsPage } from './Phone.tsx';
import { LIST_COLUMNS, SongList } from './SongList.tsx';
import { listFocusId } from './listFocus.ts';
import type { View } from './views.ts';

/** How many artists and albums search shows before "Show all" (§6.4). */
export const SEARCH_ARTISTS = 5;
export const SEARCH_ALBUMS = 10;

/** The view's title, for the toolbar and the window (§6.1). */
export function viewTitle(app: AppController, view: View): string {
  const lib = app.library.value;
  switch (view.kind) {
    case 'songs':
      return 'Songs';
    case 'albums':
      return 'Albums';
    case 'album':
      return lib.albumByKey.get(view.key)?.title ?? 'Album';
    case 'artists':
      return 'Artists';
    case 'artist':
      return lib.artistByKey.get(view.key)?.name ?? 'Artist';
    case 'folders':
      return view.path ? (view.path.split('/').at(-1) ?? 'Folders') : 'Folders';
    case 'search':
      return 'Search';
    case 'playlist':
      return app.playlists.nameOf(view.path);
    case 'favourites':
    case 'recent':
    case 'mostPlayed':
      return collection(view.kind).title;
    case 'playlists':
      return 'Playlists';
  }
}

/** The middle of the window: the current view (§6.2), or why there is nothing to show. */
export function CurrentView({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const empty = emptyText(app);
  if (empty)
    return (
      <div class="pl-empty">
        <p>{empty}</p>
        {!app.source.value && app.folders && (
          <button
            type="button"
            class="pl-button pl-button-primary"
            onClick={() => catalog.run('file.openFolder')}
          >
            Open Music Folder…
          </button>
        )}
      </div>
    );
  const view = app.view.value;
  const lib = app.library.value;
  switch (view.kind) {
    case 'songs':
      return <SongList app={app} label="Songs" columns={[...LIST_COLUMNS, 'plays']} sortable />;
    case 'albums':
      return <AlbumGrid app={app} albums={lib.albums} label="Albums" />;
    case 'album': {
      const album = lib.albumByKey.get(view.key);
      return album ? (
        <AlbumPage app={app} album={album} />
      ) : (
        <Gone text="This album is no longer in the library." />
      );
    }
    case 'artists':
      return <ArtistList app={app} artists={lib.artists} />;
    case 'artist': {
      const artist = lib.artistByKey.get(view.key);
      return artist ? (
        <ArtistPage app={app} artist={artist} />
      ) : (
        <Gone text="This artist is no longer in the library." />
      );
    }
    case 'folders': {
      const folder = lib.folderByPath.get(view.path);
      return folder ? (
        <FolderPage app={app} folder={folder} />
      ) : (
        <Gone text="This folder has no music any more." />
      );
    }
    case 'search':
      return <SearchPage app={app} query={view.query} />;
    case 'playlist':
      return app.playlists.list.value.some((p) => p.path === view.path) ? (
        <PlaylistPage app={app} path={view.path} />
      ) : (
        <Gone text="This playlist is no longer in the music folder." />
      );
    case 'favourites':
    case 'recent':
    case 'mostPlayed':
      return <CollectionPage app={app} kind={view.kind} />;
    case 'playlists':
      return <PlaylistsPage app={app} catalog={catalog} />;
  }
}

export function Gone({ text }: { readonly text: string }) {
  return (
    <div class="pl-empty">
      <p>{text}</p>
    </div>
  );
}

/** The empty states (§6.2, §17), or null when there are songs to show. */
function emptyText(app: AppController): string | null {
  const source = app.source.value;
  if (!source) return app.cannotOpen ?? 'Choose a music folder to start.';
  if (app.songs.value.length > 0) return null;
  if (!app.scanned.value) {
    const p = app.scanning.value;
    return p && p.total > 0
      ? `Reading ${formatCount(p.done)} of ${formatCount(p.total)} files…`
      : 'Reading the music folder…';
  }
  return `No music found in ${source.name}. Playlark plays MP3, FLAC, M4A, Ogg and WAV files.`;
}

/** A page's Play and Shuffle buttons (§8.2). `songs` is read on the click, so it's the page's songs then. */
export function PlayButtons({
  app,
  name,
  songs,
}: {
  readonly app: AppController;
  readonly name: string;
  readonly songs: () => readonly Song[];
}) {
  return (
    <>
      <button
        type="button"
        class="pl-button pl-button-primary"
        aria-label={`Play ${name}`}
        onClick={() => void app.playSongs(songs())}
      >
        <Icon name="play" /> Play
      </button>
      <button
        type="button"
        class="pl-button"
        aria-label={`Shuffle ${name}`}
        onClick={() => void app.shuffleSongs(songs())}
      >
        <Icon name="shuffle" /> Shuffle
      </button>
    </>
  );
}

/** A playlist (§9.1): its entries in order, missing ones greyed; drag to reorder when it can be edited (§9.2). */
function PlaylistPage({ app, path }: { readonly app: AppController; readonly path: string }) {
  const name = app.playlists.nameOf(path);
  const loaded = app.playlists.files.value.has(path);
  const songs = app.rows.value;
  const editable = app.playlists.editable.value;
  return (
    <div class="pl-page">
      <header class="pl-page-head pl-page-head-plain">
        <div class="pl-page-text">
          <h2>{name}</h2>
          <p class="pl-page-facts">{loaded ? songCount(songs.length) : 'Reading…'}</p>
          <div class="pl-page-actions">
            <PlayButtons app={app} name={name} songs={() => app.rows.peek()} />
          </div>
        </div>
      </header>
      {loaded && songs.length === 0 ? (
        <Gone
          text={
            editable
              ? 'This playlist is empty. Drag songs onto it in the sidebar, or use Add to Playlist.'
              : 'This playlist is empty.'
          }
        />
      ) : (
        <SongList
          app={app}
          label={name}
          columns={LIST_COLUMNS}
          onMove={editable ? (indexes, to) => void app.playlists.move(path, indexes, to) : undefined}
        />
      )}
    </div>
  );
}

export const songCount = (n: number) => (n === 1 ? '1 song' : `${formatCount(n)} songs`);

function AlbumPage({ app, album }: { readonly app: AppController; readonly album: Album }) {
  const lib = app.library.value;
  const artistKey = lib.artistByKey.has(fold(album.artist)) ? fold(album.artist) : null;
  const mixed = album.songs.some((s) => s.artist !== album.artist);
  const facts = [
    album.year !== undefined ? String(album.year) : null,
    songCount(album.songs.length),
    formatTime(album.duration),
  ].filter(Boolean);
  return (
    <div class="pl-page">
      <header class="pl-page-head">
        <Cover app={app} cover={album.cover} large />
        <div class="pl-page-text">
          <h2>{album.title}</h2>
          {artistKey ? (
            <button
              type="button"
              class="pl-link-button pl-page-artist"
              onClick={() => app.navigate({ kind: 'artist', key: artistKey })}
            >
              {album.artist}
            </button>
          ) : (
            <p class="pl-page-artist">{album.artist}</p>
          )}
          <p class="pl-page-facts">{facts.join(' · ')}</p>
          <div class="pl-page-actions">
            <PlayButtons app={app} name={album.title} songs={() => album.songs} />
          </div>
        </div>
      </header>
      <SongList
        app={app}
        label={album.title}
        columns={
          mixed ? ['favourite', 'track', 'title', 'artist', 'time'] : ['favourite', 'track', 'title', 'time']
        }
        discs={album.discs > 1}
      />
    </div>
  );
}

function ArtistPage({ app, artist }: { readonly app: AppController; readonly artist: Artist }) {
  return (
    <div class="pl-page pl-page-scroll">
      <header class="pl-page-head pl-page-head-plain">
        <div class="pl-page-text">
          <h2>{artist.name}</h2>
          <p class="pl-page-facts">{albumCount(artist.albums.length)}</p>
          <div class="pl-page-actions">
            <PlayButtons app={app} name={artist.name} songs={() => app.rows.peek()} />
          </div>
        </div>
      </header>
      <h3 class="pl-section-title">Albums</h3>
      <AlbumShelf
        app={app}
        albums={artist.albums}
        label="Albums"
        id={listFocusId({ kind: 'artist', key: artist.key })!}
      />
      {artist.appearsOn.length > 0 && (
        <>
          <h3 class="pl-section-title">Appears On</h3>
          <AlbumShelf
            app={app}
            albums={artist.appearsOn}
            label="Appears On"
            id={`artist:${artist.key}:appearsOn`}
          />
        </>
      )}
    </div>
  );
}

/** A folder: where it is, its subfolders, then its songs (§6.2 Folders). */
function FolderPage({ app, folder }: { readonly app: AppController; readonly folder: Folder }) {
  const parts = folder.path ? folder.path.split('/') : [];
  const top = app.source.value?.name ?? 'Music';
  const folders = app.lists.get(listFocusId({ kind: 'folders', path: folder.path })!);
  return (
    <div class="pl-page">
      <header class="pl-folder-head">
        <nav class="pl-crumbs" aria-label="Folder path">
          <button
            type="button"
            class="pl-link-button"
            onClick={() => app.navigate({ kind: 'folders', path: '' })}
          >
            {top}
          </button>
          {parts.map((part, i) => (
            <span key={i}>
              <span class="pl-crumb-sep" aria-hidden="true">
                ›
              </span>
              <button
                type="button"
                class="pl-link-button"
                aria-current={i === parts.length - 1 ? 'page' : undefined}
                onClick={() => app.navigate({ kind: 'folders', path: parts.slice(0, i + 1).join('/') })}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <div class="pl-page-actions">
          <PlayButtons app={app} name={folder.name || top} songs={() => app.folderSongs(folder.path)} />
        </div>
      </header>
      {folder.folders.length > 0 && (
        <ul
          class="pl-folders"
          aria-label="Folders"
          onKeyDown={(e) => folders.keyDown(e, folder.folders.length)}
        >
          {folder.folders.map((f, i) => (
            <li key={f.path}>
              <button
                type="button"
                {...roving(folders, i, folder.folders.length)}
                onClick={() => app.navigate({ kind: 'folders', path: f.path })}
              >
                <Icon name="folder" /> {f.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {folder.songs.length > 0 && <SongList app={app} label={folder.name || top} columns={LIST_COLUMNS} />}
    </div>
  );
}

/** Search results: artists, albums, then every matching song (§6.4). */
function SearchPage({ app, query }: { readonly app: AppController; readonly query: string }) {
  const [allArtists, setAllArtists] = useState(false);
  const [allAlbums, setAllAlbums] = useState(false);
  const results = app.results.value;
  if (!results || (!results.artists.length && !results.albums.length && !results.songs.length))
    return <Gone text={`Nothing matches “${query}”.`} />;
  const artists = allArtists ? results.artists : results.artists.slice(0, SEARCH_ARTISTS);
  const albums = allAlbums ? results.albums : results.albums.slice(0, SEARCH_ALBUMS);
  const chips = app.lists.get('search:artists');
  return (
    <div class="pl-page">
      <div class="pl-search-top">
        {artists.length > 0 && (
          <section aria-label="Artists">
            <h3 class="pl-section-title">
              Artists
              {!allArtists && results.artists.length > SEARCH_ARTISTS && (
                <button type="button" class="pl-link-button" onClick={() => setAllArtists(true)}>
                  Show all {formatCount(results.artists.length)}
                </button>
              )}
            </h3>
            <ul class="pl-chips" onKeyDown={wrapKeys(chips, artists.length)}>
              {artists.map((a, i) => (
                <li key={a.key}>
                  <button
                    type="button"
                    {...roving(chips, i, artists.length)}
                    onClick={() => app.navigate({ kind: 'artist', key: a.key })}
                  >
                    {a.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {albums.length > 0 && (
          <section aria-label="Albums">
            <h3 class="pl-section-title">
              Albums
              {!allAlbums && results.albums.length > SEARCH_ALBUMS && (
                <button type="button" class="pl-link-button" onClick={() => setAllAlbums(true)}>
                  Show all {formatCount(results.albums.length)}
                </button>
              )}
            </h3>
            <AlbumShelf app={app} albums={albums} label="Albums" id="search:albums" />
          </section>
        )}
        {results.songs.length > 0 && <h3 class="pl-section-title">Songs</h3>}
      </div>
      {results.songs.length > 0 && <SongList app={app} label="Songs" columns={LIST_COLUMNS} />}
    </div>
  );
}

/** Favourites, Recently Added or Most Played (§6.2), with Play and Shuffle. */
function CollectionPage({ app, kind }: { readonly app: AppController; readonly kind: CollectionKind }) {
  const { title, empty } = collection(kind);
  const songs = app.rows.value;
  return (
    <div class="pl-page">
      <header class="pl-page-head pl-page-head-plain">
        <div class="pl-page-text">
          <h2>{title}</h2>
          <p class="pl-page-facts">{songCount(songs.length)}</p>
          <div class="pl-page-actions">
            <PlayButtons app={app} name={title} songs={() => app.rows.peek()} />
          </div>
        </div>
      </header>
      {songs.length === 0 ? (
        <Gone text={empty} />
      ) : (
        <SongList
          app={app}
          label={title}
          columns={kind === 'mostPlayed' ? [...LIST_COLUMNS, 'plays'] : LIST_COLUMNS}
        />
      )}
    </div>
  );
}
