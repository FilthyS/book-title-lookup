/**
 * Closed environment surface (issue #5 D6, issue #10 section 16.1).
 *
 * Every environment variable any code may read is named by the single
 * ENV_ALLOWLIST constant. The permission manifest for `deno run`, tests, and
 * compile flags is derived from the same constant so runtime reads and grants
 * cannot drift (verified by the permission-manifest drift test). Reads use
 * only `Deno.env.get(name)` through EnvironmentReader; `Deno.env.toObject()`
 * is never used.
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
 * Production reader over the real process environment. A missing permission
 * grant maps to the typed permission_denied failure the settings and locator
 * seams report; it is never a thrown stack trace.
 */
export const systemEnvironment: EnvironmentReader = {
  read(name: EnvName): EnvReadResult {
    try {
      return { ok: true, value: Deno.env.get(name) };
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        return { ok: false, error: "permission_denied", name };
      }
      throw error;
    }
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
