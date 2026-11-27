/**
 * The Song Info dialog (PRD §11.1): the tags of the selected songs, the cover, and for one song its file facts.
 * Its state and saving live in `TagEditor`.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { pictureMime, type Picture, type Song } from '@playlark/core';
import { Dialog, formatTime } from '@playlark/ui';
import type { AppController } from './controller.ts';
import { FIELD_NAMES, type InfoField, type TagEditor } from './tagEditor.ts';

/** Fields laid out as rows; a pair shares a row ("Track 3 of 12"). */
const ROWS: readonly (readonly [InfoField] | readonly [InfoField, InfoField])[] = [
  ['title'],
  ['artist'],
  ['album'],
  ['albumArtist'],
  ['track', 'trackTotal'],
  ['disc', 'discTotal'],
  ['year'],
  ['genre'],
];
const NUMBER_FIELDS = new Set<InfoField>(['track', 'trackTotal', 'disc', 'discTotal', 'year']);
const IMAGE_TYPES = ['image/jpeg', 'image/png'];

/** A picture from an image file or a pasted image, or null when it isn't a JPEG or PNG. */
async function pictureFrom(file: Blob): Promise<Picture | null> {
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = pictureMime(data, file.type);
  return IMAGE_TYPES.includes(mime) ? { mime, type: 3, data } : null;
}

/** A picture as a `data:` URL, which needs no revoking when the dialog closes. */
function pictureUrl(picture: Picture): string {
  let text = '';
  for (let i = 0; i < picture.data.length; i += 0x8000)
    text += String.fromCharCode(...picture.data.subarray(i, i + 0x8000));
  return `data:${picture.mime};base64,${btoa(text)}`;
}

export function SongInfoDialog({ app }: { readonly app: AppController }) {
  const tags = app.tags;
  const songs = tags.songs.value;
  const fields = tags.fields.value;
  const readOnly = tags.readOnly.value;
  const saving = tags.saving.value;
  const progress = tags.progress.value;
  const errors = tags.errors.value;
  const title =
    songs.length > 1
      ? `Song Info: ${songs.length} songs`
      : `Song Info${songs[0] ? `: ${songs[0].title}` : ''}`;
  const disabled = readOnly !== null || saving || fields === null;
  return (
    <Dialog
      title={title}
      class="pl-dialog-wide pl-song-info"
      onClose={() => app.close()}
      {...(readOnly === null ? { onSubmit: () => void tags.save() } : {})}
      actions={
        readOnly === null ? (
          <>
            {progress && (
              <span class="pl-info-progress" role="status">
                Saving {Math.min(progress.done + 1, progress.total)} of {progress.total}…
              </span>
            )}
            <button type="button" class="pl-button" onClick={() => app.close()}>
              Cancel
            </button>
            <button type="submit" class="pl-button pl-button-primary" disabled={disabled}>
              Save
            </button>
          </>
        ) : (
          <button type="button" class="pl-button pl-button-primary" onClick={() => app.close()}>
            Close
          </button>
        )
      }
    >
      {readOnly && <p class="pl-info-note">{readOnly}</p>}
      {errors.length > 0 && (
        <ul class="pl-info-errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {fields === null ? (
        <p>Reading the tags…</p>
      ) : (
        <div class="pl-info">
          <div class="pl-info-fields">
            {ROWS.map((row) => (
              <label key={row[0]} class="pl-field">
                <span>{FIELD_NAMES[row[0]]}</span>
                <span class="pl-info-row">
                  <FieldInput tags={tags} field={row[0]} disabled={disabled} />
                  {row[1] && (
                    <>
                      <span class="pl-info-of">of</span>
                      <FieldInput
                        tags={tags}
                        field={row[1]}
                        disabled={disabled}
                        label={FIELD_NAMES[row[1]]}
                      />
                    </>
                  )}
                </span>
              </label>
            ))}
            <label class="pl-field">
              <span>Compilation</span>
              <input
                type="checkbox"
                checked={tags.compilation.value.value}
                indeterminate={tags.compilation.value.mixed}
                disabled={disabled}
                onChange={(e) => tags.setCompilation(e.currentTarget.checked)}
              />
            </label>
          </div>
          <CoverBox tags={tags} disabled={disabled} />
        </div>
      )}
      {songs.length === 1 && songs[0] && <FileFacts song={songs[0]} />}
    </Dialog>
  );
}

function FieldInput({
  tags,
  field,
  disabled,
  label,
}: {
  readonly tags: TagEditor;
  readonly field: InfoField;
  readonly disabled: boolean;
  readonly label?: string;
}) {
  const state = tags.fields.value?.[field];
  if (!state) return null;
  const number = NUMBER_FIELDS.has(field);
  return (
    <input
      type="text"
      inputMode={number ? 'numeric' : undefined}
      class={number ? 'pl-info-number' : 'pl-info-text'}
      name={field}
      aria-label={label}
      value={state.value}
      placeholder={state.mixed && !state.changed ? 'Mixed' : ''}
      disabled={disabled || !tags.canChange(field)}
      onInput={(e) => tags.setField(field, e.currentTarget.value)}
    />
  );
}

function CoverBox({ tags, disabled }: { readonly tags: TagEditor; readonly disabled: boolean }) {
  const chosen = tags.newCover.value;
  const current = tags.currentCover.value;
  const shown = chosen !== undefined ? chosen : current === 'mixed' ? null : current;
  const url = useMemo(() => (shown ? pictureUrl(shown) : null), [shown]);
  const input = useRef<HTMLInputElement>(null);
  const take = async (file: Blob | null | undefined) => {
    if (!file) return;
    const picture = await pictureFrom(file);
    if (picture) tags.setCover(picture);
    else tags.errors.value = ['The cover must be a JPEG or PNG image.'];
  };
  return (
    <div
      class="pl-info-cover"
      onPaste={(e) => {
        if (disabled) return;
        const item = Array.from(e.clipboardData?.items ?? []).find((i) => IMAGE_TYPES.includes(i.type));
        if (!item) return;
        e.preventDefault();
        void take(item.getAsFile());
      }}
    >
      <div class="pl-info-art" aria-label="Cover">
        {url ? (
          <img src={url} alt="Cover" />
        ) : (
          <span>{chosen === undefined && current === 'mixed' ? 'Mixed' : 'No cover'}</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        hidden
        onChange={(e) => {
          void take(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <button type="button" class="pl-button" disabled={disabled} onClick={() => input.current?.click()}>
        Choose Image…
      </button>
      <button
        type="button"
        class="pl-button"
        disabled={disabled}
        onClick={() =>
          void navigator.clipboard
            ?.read?.()
            .then(async (items) => {
              for (const item of items) {
                const type = item.types.find((t) => IMAGE_TYPES.includes(t));
                if (type) return take(await item.getType(type));
              }
              tags.errors.value = ['The clipboard has no JPEG or PNG image.'];
            })
            .catch(() => {
              tags.errors.value = ['Couldn’t read the clipboard. Press ⌘V on the cover instead.'];
            })
        }
      >
        Paste
      </button>
      <button
        type="button"
        class="pl-button"
        disabled={disabled || !shown}
        onClick={() => tags.setCover(null)}
      >
        Remove
      </button>
    </div>
  );
}

/** A path that wraps only after a "/" while each folder or file name fits the line. */
function PathParts({ path }: { readonly path: string }) {
  const parts = path.split('/');
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} class="pl-path-part">
          {i < parts.length - 1 ? `${p}/` : p}
        </span>
      ))}
    </>
  );
}

/** The read-only facts of one file (§4.2) and its path. */
function FileFacts({ song }: { readonly song: Song }) {
  const facts: [string, ComponentChildren][] = [
    ['Format', `${song.format?.toUpperCase() ?? '?'} (${song.codec.toUpperCase()})`],
    ['Length', formatTime(song.duration)],
    ['Sample rate', `${(song.sampleRate / 1000).toFixed(1)} kHz`],
    ['Channels', song.channels === 1 ? 'Mono' : song.channels === 2 ? 'Stereo' : String(song.channels)],
  ];
  if (song.bitsPerSample) facts.push(['Bit depth', `${song.bitsPerSample}-bit`]);
  if (song.bitrate) facts.push(['Bit rate', `${Math.round(song.bitrate / 1000)} kbps`]);
  facts.push(['Size', `${(song.size / 1_000_000).toFixed(1)} MB`], ['Path', <PathParts path={song.path} />]);
  return (
    <dl class="pl-info-facts">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
