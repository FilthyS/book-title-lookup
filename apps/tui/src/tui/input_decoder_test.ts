// Synthetic byte-stream tests for the thin renderer decoder (promoted from
// the issue #9 spike evidence): text-only chunk flushing, UTF-8 and
// escape/CSI reassembly across reads, and the control/arrow vocabulary.

import { assertEquals } from "@std/assert";
import { KeyDecoder, type Token } from "./input-decoder.ts";

function decode(bytes: number[]): readonly Token[] {
  return new KeyDecoder().push(new Uint8Array(bytes));
}

function tokenKinds(tokens: readonly Token[]): string[] {
  return tokens.map((token) => token.kind);
}

Deno.test("decoder turns ascii text into one text token", () => {
  const tokens = decode([0x68, 0x69, 0x21]);
  assertEquals(tokens, [{ kind: "text", value: "hi!" }]);
});

Deno.test("decoder reassembles UTF-8 Chinese input", () => {
  const encoder = new TextEncoder();
  const bytes = [...encoder.encode("百年孤独")];
  const tokens = decode(bytes);
  assertEquals(tokenKinds(tokens), ["text"]);
  assertEquals((tokens[0] as { value: string }).value, "百年孤独");
});

Deno.test("decoder reassembles emoji and combining sequences", () => {
  const encoder = new TextEncoder();
  const tokens = decode([...encoder.encode("e\u0301"), 0x7f]);
  assertEquals(tokens, [
    { kind: "text", value: "e\u0301" },
    { kind: "backspace" },
  ]);
});

Deno.test("UTF-8 code point split across chunks is reassembled", () => {
  const encoder = new TextEncoder();
  const bytes = [...encoder.encode("百")];
  const decoder = new KeyDecoder();
  const first = decoder.push(new Uint8Array(bytes.slice(0, 2)));
  const second = decoder.push(new Uint8Array(bytes.slice(2)));
  assertEquals(first, []);
  assertEquals(second, [{ kind: "text", value: "百" }]);
});

Deno.test("control keys map to tokens", () => {
  assertEquals(tokenKinds(decode([0x03])), ["cancel"]);
  assertEquals(tokenKinds(decode([0x0d])), ["enter"]);
  assertEquals(tokenKinds(decode([0x7f])), ["backspace"]);
  assertEquals(tokenKinds(decode([0x08])), ["backspace"]);
  assertEquals(tokenKinds(decode([0x09])), ["tab"]);
});

Deno.test("arrow keys and home/end decode from CSI sequences", () => {
  const tokens = decode([
    ESC(),
    0x5b,
    0x41, // up
    ESC(),
    0x5b,
    0x42, // down
    ESC(),
    0x5b,
    0x43, // right
    ESC(),
    0x5b,
    0x44, // left
    ESC(),
    0x5b,
    0x48, // home
    ESC(),
    0x5b,
    0x46, // end
  ]);
  assertEquals(tokenKinds(tokens), [
    "up",
    "down",
    "right",
    "left",
    "home",
    "end",
  ]);
});

Deno.test("escape sequence split across chunks is reassembled", () => {
  const decoder = new KeyDecoder();
  assertEquals(decoder.push(new Uint8Array([ESC(), 0x5b])), []);
  assertEquals(tokenKinds(decoder.push(new Uint8Array([0x41]))), ["up"]);
});

Deno.test("standalone escape is reported after the next byte", () => {
  const decoder = new KeyDecoder();
  assertEquals(decoder.push(new Uint8Array([ESC()])), []);
  const tokens = decoder.push(new Uint8Array([0x41]));
  assertEquals(tokenKinds(tokens), ["escape", "text"]);
});

Deno.test("text around controls is flushed in order", () => {
  const encoder = new TextEncoder();
  const tokens = decode([
    ...encoder.encode("ab"),
    0x7f,
    ...encoder.encode("cd"),
    0x0d,
  ]);
  assertEquals(tokenKinds(tokens), ["text", "backspace", "text", "enter"]);
  assertEquals((tokens[0] as { value: string }).value, "ab");
  assertEquals((tokens[2] as { value: string }).value, "cd");
});

function ESC(): number {
  return 0x1b;
}
