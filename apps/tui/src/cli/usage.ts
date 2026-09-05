/**
 * Deterministic help and usage text (issue #12 section 10.5).
 *
 * Top-level help lists the modes and every global option; command help lists
 * that command's options and validation rules. Help is always written to
 * stdout and is never a JSON document. `usage.ts` documents the shared option
 * fragments so help stays in lockstep with the parser grammar.
 */

import { APP_NAME, VERSION } from "../version.ts";
import type { CacheOperation, CommandName, HelpScope } from "./args.ts";

function line(text = ""): string {
  return text + "\n";
}

export function diagnosticLine(message: string): string {
  return line(`${APP_NAME}: ${message}`);
}

export function tryHelpLine(): string {
  return line(`Run '${APP_NAME} --help' for usage.`);
}

export function usageErrorText(message: string): string {
  return diagnosticLine(message) + tryHelpLine();
}

function globalOptionsBlock(): string {
  return [
    line("Global options:"),
    line("  --json              Emit one JSON document on stdout"),
    line("  --debug             Verbose diagnostics on stderr"),
    line("  --offline           Force offline mode"),
    line("  --cache-dir <path>  Override the cache root (absolute path)"),
    line("  --no-color          Disable ANSI styling"),
    line("  --color             Force ANSI styling"),
    line("  --help              Print usage for the current scope and exit 0"),
    line("  --version           Print the version and exit 0 (top level only)"),
  ].join("");
}

export function topLevelHelp(): string {
  return [
    line(
      `${APP_NAME} - find attested titles of the same book across languages`,
    ),
    line(),
    line(`Version ${VERSION}.`),
    line(),
    line("Usage:"),
    line(`  ${APP_NAME} [options] <command> [arguments]`),
    line(`  ${APP_NAME} --help`),
    line(`  ${APP_NAME} --version`),
    line(),
    line("Commands:"),
    line("  search    Find candidate works from a title query"),
    line("  resolve   Resolve an ISBN or external reference to one work"),
    line("  titles    List attested titles of a resolved work"),
    line("  cache     Inspect and clear the local response cache"),
    line("  config    Show the resolved settings"),
    line(),
    line("search/resolve/titles run one-shot directed sessions over the"),
    line("coordinator; the full-screen TUI is a later slice."),
    line(),
    line("Run '<command> --help' for command-specific usage."),
    line(),
    globalOptionsBlock(),
  ].join("");
}

function lookupOptions(command: "search" | "resolve" | "titles"): string {
  if (command === "search") {
    return [
      line("Options:"),
      line(
        "  --title <text>       Required title text, non-empty after trimming",
      ),
      line("  --author <text>      Optional author text"),
      line("  --isbn <text>        Optional ISBN text"),
      line("  --year <integer>     Optional publication year (1..9999)"),
      line(
        "  --language <tag>     Repeatable; zero means all discovered languages",
      ),
    ].join("");
  }
  if (command === "resolve") {
    return [
      line("Options:"),
      line(
        "  --isbn <text>        ISBN to resolve (exactly one of --isbn/--reference)",
      ),
      line("  --reference <namespace>:<value>  External reference to resolve"),
    ].join("");
  }
  return [
    line("Options:"),
    line("  --reference <namespace>:<value>  Required external reference"),
    line(
      "  --language <tag>      Repeatable; zero means all discovered languages",
    ),
  ].join("");
}

export function commandHelp(command: CommandName): string {
  if (command === "cache") return cacheCommandHelp();
  if (command === "config") return configCommandHelp();
  const intro = command === "search"
    ? "Find candidate works from a title query."
    : command === "resolve"
    ? "Resolve an ISBN or external reference to one work."
    : "List attested titles of a resolved work.";
  return [
    line(
      `${APP_NAME} ${command} ${
        command === "resolve"
          ? "--isbn <text> | --reference <namespace>:<value>"
          : command === "titles"
          ? "--reference <namespace>:<value>"
          : "--title <text>"
      } [options]`,
    ),
    line(),
    line(intro),
    line(),
    lookupOptions(command),
    line(),
    line("Global options apply before or after the command; see"),
    line(`'${APP_NAME} --help'.`),
  ].join("");
}

function cacheCommandHelp(): string {
  return [
    line(`Usage: ${APP_NAME} cache list|show|clear [options]`),
    line(),
    line("Inspect and clear the local response cache."),
    line(),
    line("Commands:"),
    line("  cache list          List cached entries sorted by digest"),
    line("  cache show <digest> Show one cached envelope"),
    line("  cache clear         Remove cached entries beneath the cache root"),
    line(),
    line("cache show <digest> requires exactly one 64-character lowercase"),
    line("hexadecimal digest. cache clear never touches the config root."),
    line(),
    line("Global options: --json, --debug, --offline, --cache-dir <path>,"),
    line("--no-color, --color. See 'book-title --help' for details."),
  ].join("");
}

export function cacheOperationHelp(operation: CacheOperation): string {
  const usage = operation === "list"
    ? `${APP_NAME} cache list [options]`
    : operation === "show"
    ? `${APP_NAME} cache show <digest> [options]`
    : `${APP_NAME} cache clear [options]`;
  return [
    line(`Usage: ${usage}`),
    line(),
    cacheCommandHelp(),
  ].join("");
}

function configCommandHelp(): string {
  return [
    line(`Usage: ${APP_NAME} config show [options]`),
    line(),
    line("Show the resolved settings with their origin (cli, environment,"),
    line("config_file, or default). Prints resolved settings only, never raw"),
    line("config file content and never reserved secrets."),
    line(),
    line("Global options: --json, --debug, --offline, --cache-dir <path>,"),
    line("--no-color, --color. See 'book-title --help' for details."),
  ].join("");
}

export function configShowHelp(): string {
  return [
    line(`Usage: ${APP_NAME} config show [options]`),
    line(),
    configCommandHelp(),
  ].join("");
}

export function helpTextForScope(scope: HelpScope): string {
  switch (scope.kind) {
    case "top":
      return topLevelHelp();
    case "command":
      return commandHelp(scope.command);
    case "cache_operation":
      return cacheOperationHelp(scope.operation);
    case "config_show":
      return configShowHelp();
  }
}
