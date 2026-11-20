/** What reading a music file gives (PRD §4). */

/** The container, from the file's extension and first bytes. */
export type AudioFormat = 'mp3' | 'flac' | 'm4a' | 'ogg' | 'wav';

/** What decodes the audio; decides which targets can play it (PRD §12). */
export type Codec = 'mp3' | 'flac' | 'aac' | 'alac' | 'vorbis' | 'opus' | 'pcm' | 'unknown';

/** The tag fields Playlark uses (PRD §4.1). Missing fields are left out; text is trimmed and never empty. */
export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  trackTotal?: number;
  disc?: number;
  discTotal?: number;
  year?: number;
  genre?: string;
  compilation?: boolean;
}

/** Facts about the audio stream (PRD §4.2, §4.3). */
export interface StreamInfo {
  codec: Codec;
  /** Seconds, 0 when the file doesn't say. */
  duration: number;
  sampleRate: number;
  channels: number;
  /** Bits per second, when known. */
  bitrate?: number;
  bitsPerSample?: number;
  /** Samples the encoder added at the start, to cut for gapless playback. */
  encoderDelay?: number;
  /** Samples the encoder added at the end. */
  encoderPadding?: number;
}

export type ReadResult =
  | { readonly ok: true; readonly format: AudioFormat; readonly tags: Tags; readonly stream: StreamInfo }
  | { readonly ok: false; readonly error: string };

/** Sets a text field when the value has something in it once trimmed. */
export function setText(
  tags: Tags,
  field: 'title' | 'artist' | 'album' | 'albumArtist' | 'genre',
  value: string | undefined,
): void {
  const v = value?.replace(/\0+$/, '').trim();
  if (v) tags[field] = v;
}

/** "3", "3/12", "03 of 12": the number and the total, when they're positive whole numbers. */
export function parsePair(value: string | undefined): { n?: number; of?: number } {
  const m = /^\s*(\d+)\s*(?:(?:\/|of)\s*(\d+))?/.exec(value ?? '');
  if (!m) return {};
  const n = Number(m[1]);
  const of = m[2] === undefined ? undefined : Number(m[2]);
  return { ...(n > 0 ? { n } : {}), ...(of !== undefined && of > 0 ? { of } : {}) };
}

/** The first four-digit year in a date ("2021", "2021-05-01", "2021-05-01T10:00"). */
export function parseYear(value: string | undefined): number | undefined {
  const m = /(\d{4})/.exec(value ?? '');
  const y = m ? Number(m[1]) : NaN;
  return y > 0 ? y : undefined;
}

/** "1", "true", "yes" mean a compilation. */
export function parseFlag(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === undefined || v === '') return undefined;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Puts "3/12" style numbers into the tags. */
export function setPair(tags: Tags, field: 'track' | 'disc', value: string | undefined): void {
  const { n, of } = parsePair(value);
  if (n !== undefined) tags[field] = n;
  if (of !== undefined) tags[field === 'track' ? 'trackTotal' : 'discTotal'] = of;
}

/** Sets a total ("TRACKTOTAL=12") when it's a positive whole number. */
export function setTotal(tags: Tags, field: 'trackTotal' | 'discTotal', value: string | undefined): void {
  const n = parsePair(value).n;
  if (n !== undefined) tags[field] = n;
}
