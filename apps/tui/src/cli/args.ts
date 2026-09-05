/**
 * Option and command grammar for the issue #32 build.
 *
 * Parses the frozen issue #12 surface for the maintenance slice: the global
 * options, the cache/config subcommand grammar, and the lookup commands'
 * grammar (so their help and option validation stay exact) without
 * dispatching lookup execution, which arrives in a later slice.
 *
 * Grammar rules applied here (issue #12 section 3.4): only long options;
 * `--flag value` and `--flag=value` are equivalent; a single-value option
 * given more than once is a usage error except `--language` (repeatable);
 * unknown options/commands, missing required options, conflicting options,
 * and unexpected positionals are usage errors; `--version` is top-level only.
 */

export type CommandName = "search" | "resolve" | "titles" | "cache" | "config";
export type LookupCommand = "search" | "resolve" | "titles";
export type CacheOperation = "list" | "show" | "clear";

export type HelpScope =
  | { readonly kind: "top" }
  | { readonly kind: "command"; readonly command: CommandName }
  | { readonly kind: "cache_operation"; readonly operation: CacheOperation }
  | { readonly kind: "config_show" };

export interface GlobalFlags {
  json: boolean;
  debug: boolean;
  offline: boolean;
  cacheDir?: string;
  noColor: boolean;
  color: boolean;
}

export type Invocation =
  | { readonly mode: "help"; readonly scope: HelpScope }
  | { readonly mode: "version" }
  | { readonly mode: "no_command"; readonly global: GlobalFlags }
  | {
    readonly mode: "lookup";
    readonly command: LookupCommand;
    readonly global: GlobalFlags;
  }
  | {
    readonly mode: "cache";
    readonly operation: CacheOperation;
    readonly digest?: string;
    readonly global: GlobalFlags;
  }
  | { readonly mode: "config"; readonly global: GlobalFlags };

export type ParseResult =
  | { readonly ok: true; readonly invocation: Invocation }
  | { readonly ok: false; readonly error: string };

const COMMAND_NAMES: readonly CommandName[] = [
  "search",
  "resolve",
  "titles",
  "cache",
  "config",
];
const LOOKUP_COMMANDS: readonly LookupCommand[] = [
  "search",
  "resolve",
  "titles",
];
const CACHE_OPERATIONS: readonly CacheOperation[] = ["list", "show", "clear"];

function isCommandName(value: string): value is CommandName {
  return (COMMAND_NAMES as readonly string[]).includes(value);
}

function isLookupCommand(value: string): value is LookupCommand {
  return (LOOKUP_COMMANDS as readonly string[]).includes(value);
}

function isCacheOperation(value: string): value is CacheOperation {
  return (CACHE_OPERATIONS as readonly string[]).includes(value);
}

type OptionValueKind = "none" | "required";

const GLOBAL_OPTIONS: Readonly<
  Record<string, { readonly value: OptionValueKind }>
> = {
  "--json": { value: "none" },
  "--debug": { value: "none" },
  "--offline": { value: "none" },
  "--cache-dir": { value: "required" },
  "--no-color": { value: "none" },
  "--color": { value: "none" },
  "--version": { value: "none" },
};

const PER_COMMAND_OPTIONS: Readonly<
  Record<LookupCommand, readonly string[]>
> = {
  search: ["--title", "--author", "--isbn", "--year", "--language"],
  resolve: ["--isbn", "--reference"],
  titles: ["--reference", "--language"],
};

const REPEATABLE_OPTIONS: ReadonlySet<string> = new Set(["--language"]);

const VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "--cache-dir",
  "--title",
  "--author",
  "--isbn",
  "--year",
  "--language",
  "--reference",
]);

function usageError(message: string): ParseResult {
  return { ok: false, error: message };
}

function findHelpScope(argv: readonly string[]): HelpScope {
  let command: CommandName | undefined;
  let subcommand: string | undefined;
  let skipNext = false;
  for (const token of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      if (eq === -1 && VALUE_OPTIONS.has(name)) skipNext = true;
      continue;
    }
    if (command === undefined) {
      if (isCommandName(token)) command = token;
      continue;
    }
    if (
      subcommand === undefined && (command === "cache" || command === "config")
    ) {
      subcommand = token;
    }
  }
  if (command === undefined) return { kind: "top" };
  if (command === "cache") {
    if (subcommand !== undefined && isCacheOperation(subcommand)) {
      return { kind: "cache_operation", operation: subcommand };
    }
    return { kind: "command", command: "cache" };
  }
  if (command === "config") {
    if (subcommand === "show") return { kind: "config_show" };
    return { kind: "command", command: "config" };
  }
  return { kind: "command", command };
}

export function parseArgs(argv: readonly string[]): ParseResult {
  // --help is processed before other behavior and prints the current scope.
  if (argv.includes("--help")) {
    return {
      ok: true,
      invocation: { mode: "help", scope: findHelpScope(argv) },
    };
  }

  const global: GlobalFlags = {
    json: false,
    debug: false,
    offline: false,
    noColor: false,
    color: false,
  };
  let cacheDirValue: string | undefined;
  const seenGlobal = new Set<string>();
  const seenPerCommand = new Set<string>();
  let command: CommandName | undefined;
  let operation: CacheOperation | undefined;
  const positionals: string[] = [];
  let versionRequested = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

      const globalDef = GLOBAL_OPTIONS[name];
      const perCommandAllowed = command !== undefined &&
        isLookupCommand(command) &&
        PER_COMMAND_OPTIONS[command].includes(name);

      if (globalDef === undefined && !perCommandAllowed) {
        return usageError(`unknown option: ${name}`);
      }

      if (globalDef !== undefined) {
        if (seenGlobal.has(name)) {
          return usageError(`option ${name} may only be given once`);
        }
        seenGlobal.add(name);
      } else {
        if (!REPEATABLE_OPTIONS.has(name)) {
          if (seenPerCommand.has(name)) {
            return usageError(`option ${name} may only be given once`);
          }
          seenPerCommand.add(name);
        }
      }

      const valueKind: OptionValueKind = globalDef?.value ?? "required";
      let value: string | undefined = inlineValue;
      if (valueKind === "none") {
        if (inlineValue !== undefined) {
          return usageError(`option ${name} does not take a value`);
        }
      } else if (value === undefined) {
        if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
          return usageError(`option ${name} requires a value`);
        }
        value = argv[++i];
      }

      if (name === "--json") global.json = true;
      else if (name === "--debug") global.debug = true;
      else if (name === "--offline") global.offline = true;
      else if (name === "--cache-dir") cacheDirValue = value;
      else if (name === "--no-color") global.noColor = true;
      else if (name === "--color") global.color = true;
      else if (name === "--version") versionRequested = true;
      continue;
    }

    // Positional token.
    if (command === undefined) {
      if (!isCommandName(token)) {
        return usageError(`unknown command: '${token}'`);
      }
      command = token;
      continue;
    }
    if (isLookupCommand(command)) {
      return usageError(`unexpected argument: '${token}'`);
    }
    if (operation === undefined) {
      const expected = command === "cache" ? "list, show, or clear" : "show";
      if (command === "cache" && isCacheOperation(token)) {
        operation = token;
        continue;
      }
      if (command === "config" && token === "show") {
        operation = token;
        continue;
      }
      return usageError(
        `unknown subcommand: '${token}' for '${command}' (expected ${expected})`,
      );
    }
    positionals.push(token);
  }

  if (command === undefined) {
    if (versionRequested) return { ok: true, invocation: { mode: "version" } };
    return {
      ok: true,
      invocation: {
        mode: "no_command",
        global: {
          ...global,
          ...(cacheDirValue !== undefined ? { cacheDir: cacheDirValue } : {}),
        },
      },
    };
  }

  if (versionRequested) {
    return usageError(`option --version is only valid at the top level`);
  }

  if (command === "cache") {
    if (operation === undefined) {
      return usageError(
        `missing subcommand for 'cache' (list, show, or clear)`,
      );
    }
    if (operation === "show") {
      if (positionals.length === 0) {
        return usageError(
          `cache show requires a digest (64 lowercase hex characters)`,
        );
      }
      if (positionals.length > 1) {
        return usageError(`unexpected argument: '${positionals[1]}'`);
      }
      if (!/^[0-9a-f]{64}$/.test(positionals[0])) {
        return usageError(
          `invalid cache digest: expected exactly 64 lowercase hexadecimal characters`,
        );
      }
      return {
        ok: true,
        invocation: {
          mode: "cache",
          operation: "show",
          digest: positionals[0],
          global: {
            ...global,
            ...(cacheDirValue !== undefined ? { cacheDir: cacheDirValue } : {}),
          },
        },
      };
    }
    if (positionals.length > 0) {
      return usageError(`unexpected argument: '${positionals[0]}'`);
    }
    return {
      ok: true,
      invocation: {
        mode: "cache",
        operation,
        global: {
          ...global,
          ...(cacheDirValue !== undefined ? { cacheDir: cacheDirValue } : {}),
        },
      },
    };
  }

  if (command === "config") {
    if (operation === undefined) {
      return usageError(`missing subcommand for 'config' (show)`);
    }
    if (positionals.length > 0) {
      return usageError(`unexpected argument: '${positionals[0]}'`);
    }
    return {
      ok: true,
      invocation: {
        mode: "config",
        global: {
          ...global,
          ...(cacheDirValue !== undefined ? { cacheDir: cacheDirValue } : {}),
        },
      },
    };
  }

  if (command === "search") {
    if (!seenPerCommand.has("--title")) {
      return usageError(`missing required option: --title <text>`);
    }
  } else if (command === "resolve") {
    const hasIsbn = seenPerCommand.has("--isbn");
    const hasReference = seenPerCommand.has("--reference");
    if (hasIsbn && hasReference) {
      return usageError(
        `options --isbn and --reference conflict; supply exactly one`,
      );
    }
    if (!hasIsbn && !hasReference) {
      return usageError(
        `missing required option: --isbn <text> or --reference <namespace>:<value>`,
      );
    }
  } else if (command === "titles") {
    if (!seenPerCommand.has("--reference")) {
      return usageError(
        `missing required option: --reference <namespace>:<value>`,
      );
    }
  }

  return {
    ok: true,
    invocation: {
      mode: "lookup",
      command,
      global: {
        ...global,
        ...(cacheDirValue !== undefined ? { cacheDir: cacheDirValue } : {}),
      },
    },
  };
}
