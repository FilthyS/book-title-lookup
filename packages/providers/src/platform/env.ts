/**
 * Closed environment surface (issue #5 D6, issue #10 section 16.1).
 *
 * Every environment variable application code may read is named by the single
 * ENV_ALLOWLIST constant. Node does not enforce this list as a runtime
 * permission boundary; the narrow reader remains the first-party source of
 * truth and keeps unrestricted `process.env` access out of domain code.
 */

export const ENV_ALLOWLIST = [
  // Product settings, MVP.
  "BOOK_TITLE_CONTACT",
  "BOOK_TITLE_CACHE_DIR",
  "BOOK_TITLE_OFFLINE",
  "BOOK_TITLE_LOG_LEVEL",
  // Platform discovery.
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
] as const;

export type EnvName = (typeof ENV_ALLOWLIST)[number];

export type EnvReadResult =
  | { readonly ok: true; readonly value: string | undefined }
  | {
      readonly ok: false;
      readonly error: "permission_denied";
      readonly name: EnvName;
    };

export interface EnvironmentReader {
  read(name: EnvName): EnvReadResult;
}

export function isAllowlistedEnvName(name: string): name is EnvName {
  return (ENV_ALLOWLIST as readonly string[]).includes(name);
}

/**
 * Production reader over the real process environment. Normal Node environment
 * reads do not produce permission failures; the result union remains because
 * injected readers use it to verify typed failure handling.
 */
export const systemEnvironment: EnvironmentReader = {
  read(name: EnvName): EnvReadResult {
    return { ok: true, value: process.env[name] };
  },
};

/**
 * Deterministic reader for fixtures. Supply values and optionally deny
 * specific allowlisted names to simulate a denied process grant.
 */
export class MemoryEnvironment implements EnvironmentReader {
  #values: ReadonlyMap<string, string>;
  #denied: ReadonlySet<EnvName>;

  constructor(
    values: Readonly<Partial<Record<EnvName, string>>> = {},
    options: { readonly deny?: readonly EnvName[] } = {},
  ) {
    this.#values = new Map(Object.entries(values));
    this.#denied = new Set(options.deny ?? []);
  }

  read(name: EnvName): EnvReadResult {
    if (this.#denied.has(name)) {
      return { ok: false, error: "permission_denied", name };
    }
    return { ok: true, value: this.#values.get(name) };
  }

  entries(): ReadonlyMap<string, string> {
    return this.#values;
  }
}
