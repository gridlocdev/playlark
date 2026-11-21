/**
 * `tags show <song>` and `tags set <songs…> --title …` (PRD §20): the app's tag writers and its check after
 * writing (§11.3), the original kept in the trash. A song changed since the rescan is a conflict (exit 2).
 */
import {
  EDIT_NUMBER_FIELDS,
  EDIT_TEXT_FIELDS,
  type EditNumberField,
  type EditTextField,
  MAX_NUMBER,
  type Song,
  type TagEdit,
  canEditFormat,
  cleanEdit,
} from '@playlark/core';
import { tagResult, writeSongTags } from '@playlark/node-files';
import type { TagField } from './args.ts';
import { type Output, songJson, time } from './browse.ts';
import { CliError } from './errors.ts';
import type { Where } from './folder.ts';
import type { Loaded } from './library.ts';
import { songsNamed } from './paths.ts';

/** `--album-artist` → albumArtist. */
const camel = (option: string) => option.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** The edit the options ask for; an empty value takes the tag out. */
export function editFrom(values: Partial<Record<TagField, string>>): TagEdit {
  const out: Record<string, unknown> = {};
  for (const [option, value] of Object.entries(values)) {
    const field = camel(option);
    if ((EDIT_TEXT_FIELDS as readonly string[]).includes(field)) {
      out[field as EditTextField] = value.trim() === '' ? null : value;
    } else if ((EDIT_NUMBER_FIELDS as readonly string[]).includes(field)) {
      if (value.trim() === '') out[field as EditNumberField] = null;
      else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER)
          throw new CliError(`--${option} ${value} is not a whole number from 1 to ${MAX_NUMBER}.`);
        out[field] = n;
      }
    } else if (field === 'compilation') {
      const v = value.trim().toLowerCase();
      if (!['yes', 'no', 'true', 'false', ''].includes(v))
        throw new CliError(`--compilation takes yes or no, not ${value}.`);
      out['compilation'] = v === 'yes' || v === 'true';
    }
  }
  return cleanEdit(out as TagEdit);
}

function showLines(s: Song): string[] {
  const pair = (n?: number, total?: number) =>
    n === undefined ? '' : total === undefined ? String(n) : `${n} of ${total}`;
  const rows: [string, string][] = [
    ['Title', s.title],
    ['Artist', s.artist],
    ['Album', s.album],
    ['Album artist', s.albumArtist],
    ['Genre', s.genre ?? ''],
    ['Track', pair(s.track, s.trackTotal)],
    ['Disc', pair(s.disc, s.discTotal)],
    ['Year', s.year === undefined ? '' : String(s.year)],
    ['Compilation', s.compilation ? 'yes' : 'no'],
    ['Cover', s.cover ? (s.cover.kind === 'embedded' ? 'in the file' : s.cover.path) : 'none'],
    ['Time', time(s.duration)],
    ['Format', `${s.format ?? 'unknown'} (${s.codec})`],
  ];
  return [s.path, ...rows.map(([k, v]) => `  ${k.padEnd(13)}${v}`)];
}

export async function tagsCommand(
  args: readonly string[],
  values: Partial<Record<TagField, string>>,
  where: Where,
  cwd: string,
  loaded: Loaded,
  now = new Date(),
): Promise<Output> {
  const [sub, ...paths] = args;
  if (sub === 'show') {
    if (paths.length !== 1) throw new CliError('tags show needs one song.');
    const [song] = songsNamed(paths, where, cwd, loaded);
    if (song!.error) throw new CliError(`${song!.path} can’t be read: ${song!.error}`);
    return {
      lines: showLines(song!),
      json: { song: { ...songJson(song!), compilation: song!.compilation } },
    };
  }
  if (sub !== 'set') throw new CliError('tags needs show or set.');
  if (paths.length === 0) throw new CliError('tags set needs the songs to change.');
  const edit = editFrom(values);
  if (Object.keys(edit).length === 0)
    throw new CliError('tags set needs a tag to set, such as --title or --artist.');
  const songs = songsNamed(paths, where, cwd, loaded);
  for (const s of songs)
    if (s.error || !s.format || !canEditFormat(s.format))
      throw new CliError(`Playlark can’t change the tags in ${s.path}.`);
  const lines: string[] = [];
  const results: Record<string, unknown>[] = [];
  let worst: 0 | 1 | 2 = 0;
  for (const s of songs) {
    const result = await tagResult(s.path, () =>
      writeSongTags(where.folder, s.path, edit, { size: s.size, mtime: s.mtime }, where.data, now),
    );
    if (result.ok) {
      lines.push(`Saved ${s.path}`);
      results.push({ path: s.path, ok: true });
    } else {
      const exit = result.code === 'changed' ? 2 : 1;
      worst = Math.max(worst, exit) as 0 | 1 | 2;
      const message =
        result.code === 'changed'
          ? `${s.path} changed somewhere else; run the command again.`
          : result.message;
      lines.push(message);
      results.push({ path: s.path, ok: false, error: message, exit });
    }
  }
  if (worst !== 0) throw new CliError(lines.join('\n'), worst);
  return { lines, json: { saved: results } };
}
