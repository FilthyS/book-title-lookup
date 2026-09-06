/**
 * Deterministic human text for the issue #32 maintenance surface (issue #12
 * section 10.4). stdout text is plain by default; this build never styles
 * maintenance output, so `--color`/`--no-color` change nothing here and JSON
 * is never affected.
 */

import type { ResolvedSettings } from "../settings/resolver.ts";
import type { CacheEntrySummary } from "../../../../packages/providers/src/cache/store.ts";
import {
  bodyBytesOf,
  bodyTextOf,
} from "../../../../packages/providers/src/cache/envelope.ts";

export function configShowHuman(settings: ResolvedSettings): string {
  const origin = (source: string): string => `(${source})`;
  const lines: string[] = [
    `config root:  ${settings.configRoot} ${origin("default")}`,
    `cache root:   ${settings.cacheRoot} ${origin(settings.sources.cacheRoot)}`,
    `offline:      ${String(settings.offline)} ${origin(
      settings.sources.offline,
    )}`,
    `log level:    ${settings.logLevel} ${origin(settings.sources.logLevel)}`,
  ];
  if (settings.contact !== undefined) {
    lines.push(
      `contact:      ${settings.contact} ${origin(settings.sources.contact)}`,
    );
  }
  return lines.join("\n") + "\n";
}

export function cacheListHuman(entries: readonly CacheEntrySummary[]): string {
  const lines = entries.map(
    (entry) =>
      `${entry.digest}  ${entry.provider}  ${entry.freshnessClass}  ${entry.state}  ` +
      `${entry.fetchedAt}  ${entry.byteLength} B  ${entry.url}`,
  );
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}

export function cacheClearHuman(
  removedEntries: number,
  removedBytes: number,
): string {
  return `Removed ${removedEntries} cache entries and ${removedBytes} bytes.\n`;
}

/**
 * Envelope summary line(s) for `cache show`. The body is included only under
 * `--debug`, always with its declared encoding.
 */
export function cacheShowHuman(
  digest: string,
  envelope: {
    readonly envelopeVersion: number;
    readonly key: { readonly algorithm: string; readonly digest: string };
    readonly request: {
      readonly provider: string;
      readonly method: string;
      readonly url: string;
      readonly decoderSchemaVersion: number;
    };
    readonly response: {
      readonly status: number;
      readonly contentType?: string;
      readonly body: unknown;
    };
    readonly freshness: {
      readonly freshnessClass: string;
      readonly negative: boolean;
      readonly fetchedAt: string;
      readonly freshUntil: string;
    };
  },
  includeBody: boolean,
): string {
  const lines = [
    `digest:        ${digest}`,
    `algorithm:     ${envelope.key.algorithm}`,
    `provider:      ${envelope.request.provider}`,
    `method:        ${envelope.request.method}`,
    `url:           ${envelope.request.url}`,
    `decoder:       ${envelope.request.decoderSchemaVersion}`,
    `status:        ${envelope.response.status}`,
  ];
  if (envelope.response.contentType !== undefined) {
    lines.push(`content-type:  ${envelope.response.contentType}`);
  }
  lines.push(
    `freshness:     ${envelope.freshness.freshnessClass}` +
      `${envelope.freshness.negative ? " (negative)" : ""} fetched ` +
      `${envelope.freshness.fetchedAt} until ${envelope.freshness.freshUntil}`,
  );
  const body = envelope.response.body as
    | { readonly encoding: "utf8"; readonly text: string }
    | { readonly encoding: "base64"; readonly base64: string };
  if (!includeBody) {
    lines.push(`body:          omitted (use --debug to include)`);
  } else {
    const bytes = bodyBytesOf(body);
    lines.push(`body:          ${body.encoding}, ${bytes.byteLength} bytes`);
    lines.push(bodyTextOf(body));
  }
  return lines.join("\n") + "\n";
}
