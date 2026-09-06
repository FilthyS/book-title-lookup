/**
 * Option and command grammar for the book-title CLI (issue #12 section 3).
 *
 * Parses the frozen surface for both the maintenance slice (cache/config)
 * and the lookup slice (search/resolve/titles). Grammar rules: only long
 * options; `--flag value` and `--flag=value` are equivalent; a single-value
 * option given more than once is a usage error except `--language`
 * (repeatable); unknown options/commands, missing required options,
 * conflicting options, unexpected positionals, and invalid values are usage
 * errors; `--version` is top-level only.
 */

import {
  canonicalizeBcp47,
  canonicalizeIsbn,
  isValidRequestedLanguage,
} from "../../../../packages/core/src/normalize.ts";
import type { ExternalReference } from "../../../../packages/core/src/module.ts";
import type {
  ExternalReferenceNamespace,
  LanguageTag,
} from "../../../../packages/core/src/domain.ts";

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

export interface SearchQueryOptions {
  readonly title: string;
  readonly author?: string;
  readonly isbn?: string;
  readonly year?: number;
}

export type ResolveTargetOptions =
  | { readonly kind: "isbn"; readonly value: string }
  | { readonly kind: "reference"; readonly reference: ExternalReference };

export type Invocation =
  | { readonly mode: "help"; readonly scope: HelpScope }
  | { readonly mode: "version" }
  | { readonly mode: "no_command"; readonly global: GlobalFlags }
  | {
      readonly mode: "lookup";
      readonly command: "search";
      readonly query: SearchQueryOptions;
      readonly global: GlobalFlags;
    }
  | {
      readonly mode: "lookup";
      readonly command: "resolve";
      readonly target: ResolveTargetOptions;
      readonly global: GlobalFlags;
    }
  | {
      readonly mode: "lookup";
      readonly command: "titles";
      readonly reference: ExternalReference;
      readonly languages: readonly LanguageTag[];
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

const PER_COMMAND_OPTIONS: Readonly<Record<LookupCommand, readonly string[]>> =
  {
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

const REFERENCE_NAMESPACES: readonly ExternalReferenceNamespace[] = [
  "openlibrary:work",
  "openlibrary:edition",
  "wikidata:item",
  "isbn",
];

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
      subcommand === undefined &&
      (command === "cache" || command === "config")
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

function parseReference(raw: string):
  | { readonly ok: true; readonly reference: ExternalReference }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  const lastColon = raw.lastIndexOf(":");
  if (lastColon <= 0 || lastColon === raw.length - 1) {
    return {
      ok: false,
      error: "malformed --reference: expected <namespace>:<value>",
    };
  }
  const namespace = raw.slice(0, lastColon);
  const value = raw.slice(lastColon + 1);
  if (!(REFERENCE_NAMESPACES as readonly string[]).includes(namespace)) {
    return {
      ok: false,
      error: `unsupported reference namespace: '${namespace}'`,
    };
  }
  if (value.trim() === "") {
    return { ok: false, error: "reference value must be non-empty" };
  }
  return {
    ok: true,
    reference: { namespace: namespace as ExternalReferenceNamespace, value },
  };
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
  const values = new Map<string, string | readonly string[]>();
  let command: CommandName | undefined;
  let operation: CacheOperation | undefined;
  const positionals: string[] = [];
  let versionRequested = false;

  const recordValue = (name: string, value: string): void => {
    const existing = values.get(name);
    if (name === "--language") {
      const list = Array.isArray(existing) ? existing : [];
      values.set(name, [...list, value]);
    } else {
      values.set(name, value);
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

      const globalDef = GLOBAL_OPTIONS[name];
      const perCommandAllowed =
        command !== undefined &&
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
      else if (value !== undefined) recordValue(name, value);
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

  const globalForReturn = (): GlobalFlags => ({
    ...global,
    ...(cacheDirValue !== undefined ? { cacheDir: cacheDirValue } : {}),
  });

  if (command === undefined) {
    if (versionRequested) return { ok: true, invocation: { mode: "version" } };
    return {
      ok: true,
      invocation: { mode: "no_command", global: globalForReturn() },
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
          global: globalForReturn(),
        },
      };
    }
    if (positionals.length > 0) {
      return usageError(`unexpected argument: '${positionals[0]}'`);
    }
    return {
      ok: true,
      invocation: { mode: "cache", operation, global: globalForReturn() },
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
      invocation: { mode: "config", global: globalForReturn() },
    };
  }

  const single = (name: string): string | undefined => {
    const value = values.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const listOf = (name: string): readonly string[] => {
    const value = values.get(name);
    return Array.isArray(value) ? value : [];
  };

  if (command === "search") {
    const title = single("--title")?.trim() ?? "";
    if (title === "") {
      return usageError(`missing required option: --title <text>`);
    }
    const author = single("--author")?.trim();
    if (author === "") {
      return usageError(`--author must be non-empty after trimming`);
    }
    const isbnRaw = single("--isbn");
    if (isbnRaw !== undefined && !isValidIsbnSyntax(isbnRaw)) {
      return usageError(
        `--isbn contains invalid characters (spaces and hyphens excepted)`,
      );
    }
    const yearRaw = single("--year");
    let year: number | undefined;
    if (yearRaw !== undefined) {
      if (!/^[0-9]+$/.test(yearRaw)) {
        return usageError(`--year must be an integer between 1 and 9999`);
      }
      year = Number(yearRaw);
      if (year < 1 || year > 9999) {
        return usageError(`--year must be an integer between 1 and 9999`);
      }
    }
    const languages = validateLanguages(listOf("--language"));
    if (!languages.ok) return usageError(languages.error);
    return {
      ok: true,
      invocation: {
        mode: "lookup",
        command: "search",
        query: {
          title,
          ...(author !== undefined ? { author } : {}),
          ...(isbnRaw !== undefined ? { isbn: canonicalizeIsbn(isbnRaw) } : {}),
          ...(year !== undefined ? { year } : {}),
        },
        global: globalForReturn(),
      },
    };
  }

  if (command === "resolve") {
    const hasIsbn = values.has("--isbn");
    const hasReference = values.has("--reference");
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
    if (hasIsbn) {
      const raw = single("--isbn") ?? "";
      if (!isValidIsbnSyntax(raw)) {
        return usageError(
          `--isbn contains invalid characters (spaces and hyphens excepted)`,
        );
      }
      return {
        ok: true,
        invocation: {
          mode: "lookup",
          command: "resolve",
          target: { kind: "isbn", value: canonicalizeIsbn(raw) },
          global: globalForReturn(),
        },
      };
    }
    const parsedRef = parseReference(single("--reference") ?? "");
    if (!parsedRef.ok) return usageError(parsedRef.error);
    return {
      ok: true,
      invocation: {
        mode: "lookup",
        command: "resolve",
        target: { kind: "reference", reference: parsedRef.reference },
        global: globalForReturn(),
      },
    };
  }

  // titles
  const parsedTitlesRef = parseReference(single("--reference") ?? "");
  if (!parsedTitlesRef.ok) return usageError(parsedTitlesRef.error);
  const languages = validateLanguages(listOf("--language"));
  if (!languages.ok) return usageError(languages.error);
  return {
    ok: true,
    invocation: {
      mode: "lookup",
      command: "titles",
      reference: parsedTitlesRef.reference,
      languages: languages.value,
      global: globalForReturn(),
    },
  };
}

function isValidIsbnSyntax(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^[0-9]{9}[0-9X]$/.test(cleaned) || /^[0-9]{13}$/.test(cleaned)) {
    return true;
  }
  return false;
}

function validateLanguages(raw: readonly string[]):
  | { readonly ok: true; readonly value: readonly LanguageTag[] }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  const out: LanguageTag[] = [];
  for (const tag of raw) {
    if (!isValidRequestedLanguage(tag)) {
      return {
        ok: false,
        error: `invalid language tag: '${tag}' (sentinels und/mul cannot be requested)`,
      };
    }
    out.push(canonicalizeBcp47(tag) as LanguageTag);
  }
  return { ok: true, value: out };
}
