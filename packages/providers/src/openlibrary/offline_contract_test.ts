/**
 * Cache/offline smoke through the real file store and the OL evidence source
 * (issue #10 rows 9/10/18 exercised through the runtime). No live service is
 * contacted: the first search fetches from fixtures and warms the file cache;
 * an offline catalog then serves the stale search page with stale labels and
 * never issues a network request.
 */

import { assert, assertEquals } from "@std/assert";
import { ProviderRuntime } from "../runtime/runtime.ts";
import {
  FakeEffects,
  requestRecorder,
  scriptedFetch,
} from "../runtime/test-util.ts";
import { epochMsOf, FixedClock } from "../cache/clock.ts";
import { DenoFileSystemSeam } from "../cache/fs-seam.ts";
import { systemRandomSource } from "../cache/random.ts";
import { FileEntryStore } from "../cache/file-entry-store.ts";
import { detectPlatformKind } from "../platform/platform.ts";
import { createOpenLibraryCatalog } from "../federated/composition.ts";
import {
  openLibraryRuntimeConfig,
  PROVIDER_DECODER_SCHEMA_VERSIONS,
} from "./config.ts";
import { findOpenLibraryFixture } from "../../../../fixtures/providers/openlibrary/fixtures.ts";
import { freshTestDir, removeTestDir } from "../cache/cache_test_util.ts";

const START = "2026-09-05T00:00:00.000Z";

function fixtureFetch() {
  const recorder = requestRecorder();
  const fetch = scriptedFetch({
    fallback: (url) => {
      const fixture = findOpenLibraryFixture(url);
      if (fixture === undefined) {
        throw new TypeError(`no fixture for ${url}`);
      }
      return {
        status: fixture.status,
        headers: {
          "Content-Type": fixture.contentType,
          ...(fixture.location !== undefined
            ? { Location: fixture.location }
            : {}),
        },
        body: fixture.body,
      };
    },
    onRequest: (url) => recorder.urls.push(url),
  });
  return { fetch, recorder };
}

Deno.test("offline search serves a stale cached page without network", async () => {
  const scratch = await freshTestDir("ol-offline");
  try {
    const clock = new FixedClock(START);
    const store = new FileEntryStore({
      cacheRoot: scratch,
      clock,
      fs: new DenoFileSystemSeam(),
      random: systemRandomSource,
      decoderSchemaVersions: PROVIDER_DECODER_SCHEMA_VERSIONS,
      platform: detectPlatformKind(Deno.build.os),
    });
    const effects = new FakeEffects({ startMs: epochMsOf(START) });
    const { fetch, recorder } = fixtureFetch();

    const onlineRuntime = new ProviderRuntime(
      effects,
      store,
      openLibraryRuntimeConfig({
        version: "0.1.0",
        contact: "offline@example.com",
        fetch,
      }),
    );
    const online = createOpenLibraryCatalog({
      runtime: onlineRuntime,
      pageSize: 2,
      maxPages: 2,
    });
    const found = await online.search({ title: "百年孤独" });
    assertEquals(found.status, "found");
    assert(recorder.total > 0, "the warm-up search fetched the fixture");

    // Expire the 24h search entry.
    const gapMs = 25 * 60 * 60 * 1000;
    clock.advance(gapMs);
    effects.advance(gapMs);

    // Offline catalog: any fetch attempt is a programming error.
    const networkGuard = scriptedFetch({
      fallback: () => {
        throw new TypeError("offline mode must not fetch");
      },
    });
    const offlineRuntime = new ProviderRuntime(
      effects,
      store,
      openLibraryRuntimeConfig({
        version: "0.1.0",
        contact: "offline@example.com",
        fetch: networkGuard,
      }),
    );
    const offline = createOpenLibraryCatalog({
      runtime: offlineRuntime,
      offline: true,
      pageSize: 2,
      maxPages: 2,
    });
    const stale = await offline.search({ title: "百年孤独" });
    assertEquals(stale.status, "found");
    if (stale.status === "found") {
      assert(
        stale.candidates.length > 0,
        "stale cached search still yields candidates",
      );
    }
  } finally {
    await removeTestDir(scratch);
  }
});

Deno.test("offline miss with no cache fails as source failure", async () => {
  const scratch = await freshTestDir("ol-offline-empty");
  try {
    const clock = new FixedClock(START);
    const store = new FileEntryStore({
      cacheRoot: scratch,
      clock,
      fs: new DenoFileSystemSeam(),
      random: systemRandomSource,
      decoderSchemaVersions: PROVIDER_DECODER_SCHEMA_VERSIONS,
      platform: detectPlatformKind(Deno.build.os),
    });
    const effects = new FakeEffects({ startMs: epochMsOf(START) });
    const networkGuard = scriptedFetch({
      fallback: () => {
        throw new TypeError("offline mode must not fetch");
      },
    });
    const runtime = new ProviderRuntime(
      effects,
      store,
      openLibraryRuntimeConfig({
        version: "0.1.0",
        contact: "offline@example.com",
        fetch: networkGuard,
      }),
    );
    const catalog = createOpenLibraryCatalog({
      runtime,
      offline: true,
      pageSize: 2,
      maxPages: 2,
    });
    const outcome = await catalog.search({
      title: "zzqxqwnonexistentphrasebooknotfound",
    });
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.failures[0]?.code, "unavailable");
    }
  } finally {
    await removeTestDir(scratch);
  }
});
