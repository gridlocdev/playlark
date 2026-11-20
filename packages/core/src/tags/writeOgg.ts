/**
 * Writing Ogg Vorbis and Opus tags (PRD §11.2): the comment packet is rewritten, the header pages laid out again,
 * and every later page renumbered with its CRC recomputed. The audio pages' bodies, lacing and granules are kept.
 */
import { FormatError, concatBytes, startsWith, u32le } from '../bytes.ts';
import type { ReadTags, TagEdit } from './edit.ts';
import {
  commentPictureTypes,
  editVorbisComments,
  joinVorbisComment,
  splitVorbisComment,
} from './writeVorbis.ts';

const PAGE_HEADER = 27;
const CONTINUED = 0x01;
/** At most this many segments to a page (one byte counts them). */
const MAX_SEGMENTS = 255;

interface Page {
  /** Where the page starts in the file. */
  readonly at: number;
  readonly flags: number;
  readonly serial: number;
  /** The granule position's 8 bytes, kept as they are. */
  readonly granule: Uint8Array;
  readonly lacing: Uint8Array;
  readonly body: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

/** Ogg's CRC-32: polynomial 0x04C11DB7, no reflection, starting at 0. */
export function oggCrc(b: Uint8Array): number {
  let crc = 0;
  for (const byte of b) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc;
}

function parsePages(file: Uint8Array): Page[] {
  const pages: Page[] = [];
  let at = 0;
  while (at < file.length) {
    if (at + PAGE_HEADER > file.length || !startsWith(file, 'OggS', at))
      throw new FormatError('The Ogg file has bytes Playlark doesn’t understand between its pages.');
    const segments = file[at + 26]!;
    const lacing = file.subarray(at + PAGE_HEADER, at + PAGE_HEADER + segments);
    const length = lacing.reduce((n, l) => n + l, 0);
    const start = at + PAGE_HEADER + segments;
    if (start + length > file.length) throw new FormatError('The Ogg file is cut short.');
    pages.push({
      at,
      flags: file[at + 5]!,
      serial: u32le(file, at + 14),
      granule: file.subarray(at + 6, at + 14),
      lacing,
      body: file.subarray(start, start + length),
    });
    at = start + length;
  }
  return pages;
}

function pageBytes(page: Omit<Page, 'at'>, sequence: number): Uint8Array {
  const out = new Uint8Array(PAGE_HEADER + page.lacing.length + page.body.length);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, page.flags], 0);
  out.set(page.granule, 6);
  const view = new DataView(out.buffer);
  view.setUint32(14, page.serial, true);
  view.setUint32(18, sequence, true);
  out[26] = page.lacing.length;
  out.set(page.lacing, PAGE_HEADER);
  out.set(page.body, PAGE_HEADER + page.lacing.length);
  view.setUint32(22, oggCrc(out), true);
  return out;
}

/** The header packets after the first, read from the pages after the first, and how many pages they fill. */
function headerPackets(pages: readonly Page[], count: number): { packets: Uint8Array[]; pageCount: number } {
  const packets: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  for (let p = 1; p < pages.length; p++) {
    const page = pages[p]!;
    let offset = 0;
    for (const [i, l] of page.lacing.entries()) {
      pending.push(page.body.subarray(offset, offset + l));
      offset += l;
      if (l === 255) continue;
      packets.push(concatBytes(pending));
      pending = [];
      if (packets.length === count) {
        // The headers must end their page: audio packets start on a page of their own.
        if (i !== page.lacing.length - 1)
          throw new FormatError('The Ogg file’s headers share a page with its audio.');
        return { packets, pageCount: p };
      }
    }
  }
  throw new FormatError('The Ogg file ends inside its headers.');
}

const NO_GRANULE = new Uint8Array(8).fill(0xff);

/** Packets laid out as header pages: granule 0 where a packet ends, else -1 (§11.2). */
function layPages(packets: readonly Uint8Array[], serial: number): Omit<Page, 'at'>[] {
  const pages: Omit<Page, 'at'>[] = [];
  let lacing: number[] = [];
  let parts: Uint8Array[] = [];
  let continued = false;
  let ended = false;
  const flush = (next: boolean) => {
    pages.push({
      flags: continued ? CONTINUED : 0,
      serial,
      granule: ended ? new Uint8Array(8) : NO_GRANULE,
      lacing: Uint8Array.from(lacing),
      body: concatBytes(parts),
    });
    lacing = [];
    parts = [];
    continued = next;
    ended = false;
  };
  for (const packet of packets) {
    let offset = 0;
    for (;;) {
      // A page full mid-packet goes on as a continued page; one full between packets doesn't.
      if (lacing.length === MAX_SEGMENTS) flush(offset > 0);
      const take = Math.min(255, packet.length - offset);
      lacing.push(take);
      parts.push(packet.subarray(offset, offset + take));
      offset += take;
      if (take < 255) break;
    }
    ended = true;
  }
  flush(false);
  return pages;
}

/** The comment packet's codec: its magic and where its comments start. */
function commentKind(head: Uint8Array): { magic: Uint8Array; headers: number } {
  if (head[0] === 1 && startsWith(head, 'vorbis', 1))
    return { magic: Uint8Array.of(3, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73), headers: 2 };
  if (startsWith(head, 'OpusHead'))
    return { magic: Uint8Array.from('OpusTags', (c) => c.charCodeAt(0)), headers: 1 };
  throw new FormatError('Playlark can only edit the tags of Ogg Vorbis and Opus files.');
}

export function writeOggTags(file: Uint8Array, read: ReadTags, edit: TagEdit): Uint8Array {
  const pages = parsePages(file);
  const first = pages[0];
  if (!first) throw new FormatError('The Ogg file is empty.');
  if (pages.some((p) => p.serial !== first.serial))
    throw new FormatError('Playlark can’t edit an Ogg file with more than one stream.');
  const { magic, headers } = commentKind(first.body);
  const { packets, pageCount } = headerPackets(pages, headers);
  const comment = packets[0]!;
  if (!startsWith(comment, String.fromCharCode(...magic)))
    throw new FormatError('The Ogg file’s tags are damaged.');
  const body = comment.subarray(magic.length);
  const raw = splitVorbisComment(body);
  if (!raw) throw new FormatError('The Ogg file’s tags are damaged.');
  // Bytes after the comments (Vorbis's framing bit, Opus's padding) stay as they were.
  const tail = body.subarray(joinVorbisComment(raw).length);
  const hasFront = commentPictureTypes(raw).includes(3);
  const dropPicture = (type: number | null) =>
    edit.cover !== undefined && (edit.cover === null || !hasFront || type === 3);
  const newComment = concatBytes([
    magic,
    joinVorbisComment(editVorbisComments(raw, read, edit, 'comments', dropPicture)),
    tail,
  ]);
  const laid = layPages([newComment, ...packets.slice(1)], first.serial);
  const out: Uint8Array[] = [file.subarray(0, pages[1]!.at)];
  laid.forEach((p, i) => out.push(pageBytes(p, i + 1)));
  const shift = laid.length - pageCount;
  for (let p = pageCount + 1; p < pages.length; p++) {
    const page = pages[p]!;
    const end = p + 1 < pages.length ? pages[p + 1]!.at : file.length;
    if (shift === 0) out.push(file.subarray(page.at, end));
    else out.push(pageBytes(page, u32le(file, page.at + 18) + shift));
  }
  return concatBytes(out);
}

/** The audio pages' bodies, lacing and granules: what a tag edit must leave as they were. */
export function oggAudio(file: Uint8Array): Uint8Array {
  const pages = parsePages(file);
  const head = pages[0];
  if (!head) return new Uint8Array();
  const { pageCount } = headerPackets(pages, commentKind(head.body).headers);
  return concatBytes(pages.slice(pageCount + 1).flatMap((p) => [p.granule, p.lacing, p.body]));
}
