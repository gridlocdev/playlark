/**
 * The web-standard globals the engine uses. Every target (browsers, Electron, Node) has them; declaring
 * only these keeps the DOM and Node types out of the engine.
 */
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare interface AbortSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}
