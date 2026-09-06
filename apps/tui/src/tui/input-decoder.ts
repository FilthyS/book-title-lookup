// Raw keyboard byte-stream decoder for the thin renderer (promoted from the
// issue #9 spike evidence).
//
// Deno.stdin in raw mode delivers bytes, not keys. This decoder maps UTF-8
// text plus the small control/CSI vocabulary a keyboard-first TUI needs into
// tokens. It is stateful across chunk boundaries so a UTF-8 code point or an
// escape sequence split between reads is reassembled. Chinese IME composition
// itself is a Windows Terminal/ConPTY concern exercised manually; committed
// composition text arrives here as ordinary UTF-8. The decoder is pure
// translation: it owns no bibliographic decisions (issue #13 section 6).

export type Token =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "enter" }
  | { readonly kind: "backspace" }
  | { readonly kind: "delete" }
  | { readonly kind: "up" }
  | { readonly kind: "down" }
  | { readonly kind: "left" }
  | { readonly kind: "right" }
  | { readonly kind: "home" }
  | { readonly kind: "end" }
  | { readonly kind: "escape" }
  | { readonly kind: "cancel" }
  | { readonly kind: "tab" }
  | { readonly kind: "unknown" };

const CTRL_C = 0x03;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const BS = 0x08;
const ESC = 0x1b;
const DEL = 0x7f;

function utf8Length(lead: number): number {
  if (lead < 0x80) {
    return 1;
  }
  if (lead >= 0xc2 && lead <= 0xdf) {
    return 2;
  }
  if (lead >= 0xe0 && lead <= 0xef) {
    return 3;
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    return 4;
  }
  return 0;
}

function isContinuation(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

export class KeyDecoder {
  #pending: number[] = [];
  #textRun: string[] = [];
  #decoder = new TextDecoder();

  /** Decode one read chunk into zero or more tokens. */
  push(chunk: Uint8Array): readonly Token[] {
    this.#pending.push(...chunk);
    const tokens: Token[] = [];
    while (this.#pending.length > 0) {
      const first = this.#pending[0];
      if (first === ESC) {
        this.#flushText(tokens);
        if (!this.#consumeEscape(tokens)) {
          // Incomplete escape/CSI sequence; no bytes were consumed. Wait for
          // the next chunk so the loop always makes progress.
          break;
        }
        continue;
      }
      if (first === DEL || first === BS) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "backspace" });
        continue;
      }
      if (first === CR || first === LF) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "enter" });
        continue;
      }
      if (first === CTRL_C) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "cancel" });
        continue;
      }
      if (first === TAB) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "tab" });
        continue;
      }
      if (first < 0x20) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "unknown" });
        continue;
      }
      const length = utf8Length(first);
      if (length === 0) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "unknown" });
        continue;
      }
      const available = Math.min(length, this.#pending.length);
      let malformed = false;
      for (let index = 1; index < available; index += 1) {
        if (!isContinuation(this.#pending[index])) {
          malformed = true;
          break;
        }
      }
      if (malformed) {
        this.#flushText(tokens);
        this.#pending.shift();
        tokens.push({ kind: "unknown" });
        continue;
      }
      if (this.#pending.length < length) {
        // Incomplete code point; wait for the next chunk.
        break;
      }
      const bytes = this.#pending.splice(0, length);
      this.#textRun.push(this.#decoder.decode(Uint8Array.from(bytes)));
    }
    // The chunk is exhausted; emit any completed text run before returning so
    // text-only chunks still produce their token. Bytes still pending (e.g. an
    // incomplete UTF-8 code point or escape sequence) are not decoded yet and
    // stay buffered for the next chunk.
    this.#flushText(tokens);
    return tokens;
  }

  #flushText(tokens: Token[]): void {
    if (this.#textRun.length === 0) {
      return;
    }
    tokens.push({ kind: "text", value: this.#textRun.join("") });
    this.#textRun = [];
  }

  /** Consume an escape sequence; returns false only when it made no progress. */
  #consumeEscape(tokens: Token[]): boolean {
    // Keep a trailing ESC until we know whether a sequence follows.
    if (this.#pending.length === 1) {
      return false;
    }
    const second = this.#pending[1];
    if (second === 0x5b /* [ */ || second === 0x4f /* O */) {
      // CSI (ESC [) or SS3 (ESC O): parameters, then a final byte 0x40-0x7e.
      let index = 2;
      while (index < this.#pending.length) {
        const byte = this.#pending[index];
        if (byte >= 0x40 && byte <= 0x7e) {
          break;
        }
        if (byte < 0x20 || byte > 0x3f) {
          // Malformed sequence; treat as an unknown token.
          this.#pending.shift();
          tokens.push({ kind: "unknown" });
          return true;
        }
        index += 1;
      }
      if (index >= this.#pending.length) {
        // Sequence is incomplete; wait for the next chunk.
        return false;
      }
      const final = this.#pending[index];
      this.#pending.splice(0, index + 1);
      tokens.push(this.#tokenForFinal(final));
      return true;
    }
    // Standalone ESC: the caller decides its meaning.
    this.#pending.shift();
    tokens.push({ kind: "escape" });
    return true;
  }

  #tokenForFinal(final: number): Token {
    switch (final) {
      case 0x41: // A
        return { kind: "up" };
      case 0x42: // B
        return { kind: "down" };
      case 0x43: // C
        return { kind: "right" };
      case 0x44: // D
        return { kind: "left" };
      case 0x48: // H
        return { kind: "home" };
      case 0x46: // F
        return { kind: "end" };
      case 0x7e: // ~ with a parameter prefix
        return { kind: "unknown" };
      default:
        return { kind: "unknown" };
    }
  }
}
