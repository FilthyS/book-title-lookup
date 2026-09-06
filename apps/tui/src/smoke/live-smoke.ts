/**
 * Bounded opt-in live smoke for the Open Library vertical slice (product gate
 * G8 for OL; issue #8 live smoke). Coordinator-authorized only; never part of
 * routine `npm test`.
 *
 * The suite runs a low, serialized volume of real reads against
 * `https://openlibrary.org` with an identified User-Agent built from the
 * configured contact (`BOOK_TITLE_CONTACT`), through the same composition
 * root the CLI uses (cache + runtime + Core). It asserts connectivity,
 * decoding, the strong-reference resolve path, and the editions expansion
 * path, and records the evidence with a current-date fetch timestamp. A
 * missing contact aborts the run because an unidentifiable client is not an
 * acceptable etiquette posture.
 */

import { mkdir, rm } from "node:fs/promises";
import { resolveSettings } from "../settings/resolver.ts";
import {
  type EnvName,
  MemoryEnvironment,
} from "../../../../packages/providers/src/platform/env.ts";
import { NodeFileSystemSeam } from "../../../../packages/providers/src/cache/fs-seam.ts";
import { systemClock } from "../../../../packages/providers/src/cache/clock.ts";
import { systemRandomSource } from "../../../../packages/providers/src/cache/random.ts";
import { detectPlatformKind } from "../../../../packages/providers/src/platform/platform.ts";
import {
  canonicalPath,
  joinPath,
  styleFromPlatform,
} from "../../../../packages/providers/src/platform/paths.ts";
import { buildComposedOpenLibraryCatalog } from "../catalog/composed-catalog.ts";
import { VERSION } from "../version.ts";
import { formatUserAgent } from "../../../../packages/providers/src/openlibrary/config.ts";

const style = styleFromPlatform(detectPlatformKind(process.platform));

function log(line: string): void {
  console.log(line);
}

async function main(): Promise<number> {
  const platform = detectPlatformKind(process.platform);
  const scratch = canonicalPath(
    joinPath(style, process.cwd(), ".tmp", "live-smoke"),
    style,
  );
  const configRoot = joinPath(style, scratch, "config");
  const localRoot = joinPath(style, scratch, "local");
  await mkdir(configRoot, { recursive: true });
  await mkdir(localRoot, { recursive: true });

  const processContact = process.env.BOOK_TITLE_CONTACT;
  if (processContact === undefined || processContact.trim() === "") {
    log("live-smoke aborted: BOOK_TITLE_CONTACT must identify the run");
    await cleanup(scratch);
    return 2;
  }

  // The smoke is hermetic: platform roots point into the scratch cache so no
  // user config is read and the only filesystem grants needed are the
  // workspace scratch paths. Providers still never read the environment
  // directly; the composition root owns this reader.
  const envValues: Partial<Record<EnvName, string>> = {
    BOOK_TITLE_CONTACT: processContact.trim(),
    BOOK_TITLE_CACHE_DIR: joinPath(style, scratch, "cache"),
  };
  if (platform === "windows") {
    envValues.APPDATA = configRoot;
    envValues.LOCALAPPDATA = localRoot;
    envValues.USERPROFILE = joinPath(style, scratch, "userprofile");
  } else {
    envValues.HOME = joinPath(style, scratch, "home");
    envValues.XDG_CONFIG_HOME = configRoot;
    envValues.XDG_CACHE_HOME = localRoot;
  }

  const settingsResult = await resolveSettings({
    env: new MemoryEnvironment(envValues),
    platform,
    fs: new NodeFileSystemSeam(),
    cli: { cacheDir: joinPath(style, scratch, "cache") },
  });
  if (!settingsResult.ok) {
    log(`live-smoke settings failed: ${settingsResult.failure.kind}`);
    await cleanup(scratch);
    return 2;
  }
  const settings = settingsResult.settings;
  const contact = settings.contact ?? "";

  const userAgent = formatUserAgent({ version: VERSION, contact });
  log(`live-smoke user-agent: ${userAgent}`);
  log(`live-smoke fetched-at: ${systemClock.now()}`);

  const catalog = buildComposedOpenLibraryCatalog({
    settings: { ...settings, cacheRoot: scratch },
    clock: systemClock,
    fs: new NodeFileSystemSeam(),
    random: systemRandomSource,
    platform,
  });

  try {
    const search = await catalog.search({ title: "百年孤独" });
    if (search.status !== "found") {
      const detail =
        search.status === "failed"
          ? search.failures
              .map((f) => `${f.code}:${JSON.stringify(f.details)}`)
              .join(";")
          : search.status;
      log(`live-smoke FAIL search 百年孤独: ${detail}`);
      await cleanup(scratch);
      return 1;
    }
    log(
      `live-smoke ok search 百年孤独 -> ${search.candidates.length} candidate(s)`,
    );

    const resolved = await catalog.resolve({
      kind: "externalReference",
      reference: { namespace: "openlibrary:work", value: "OL274505W" },
    });
    if (resolved.status !== "resolved") {
      log(`live-smoke FAIL resolve OL274505W: ${resolved.status}`);
      await cleanup(scratch);
      return 1;
    }
    log(
      `live-smoke ok resolve OL274505W -> ${resolved.work.title} [${resolved.work.references
        .map((r) => `${r.namespace}:${r.value}`)
        .join(",")}]`,
    );

    const titles = await catalog.findTitles(resolved.work.ref, {
      targetLanguages: ["zh"],
    });
    if (titles.status !== "found" && titles.status !== "no_attested_titles") {
      log(`live-smoke FAIL titles zh for OL274505W: ${titles.status}`);
      await cleanup(scratch);
      return 1;
    }
    if (titles.status === "found") {
      const zh = titles.groups.filter((g) => g.language === "zh");
      log(
        `live-smoke ok titles zh for OL274505W -> ${zh
          .map((g) => g.title)
          .join(" | ")}`,
      );
    } else {
      log("live-smoke ok titles zh for OL274505W -> no_attested_titles");
    }
    log("live-smoke PASS");
    await cleanup(scratch);
    return 0;
  } catch (error) {
    log(`live-smoke FAIL unexpected: ${String(error)}`);
    await cleanup(scratch);
    return 1;
  }
}

async function cleanup(scratch: string): Promise<void> {
  try {
    await rm(scratch, { recursive: true });
  } catch {
    // Best-effort; .tmp is disposable.
  }
}

process.exitCode = await main();
