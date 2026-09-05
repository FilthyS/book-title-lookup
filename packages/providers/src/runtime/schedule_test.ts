/**
 * Deterministic scheduler tests: concurrency never exceeds the policy and
 * spacing honors the injected virtual clock.
 */

import { assertEquals } from "@std/assert";
import { SourceScheduler } from "./schedule.ts";
import { FakeEffects } from "./test-util.ts";

Deno.test("scheduler admits at most maxConcurrent requests", async () => {
  const effects = new FakeEffects();
  const scheduler = new SourceScheduler(effects, 2, 0);
  assertEquals(await scheduler.acquire(), "acquired");
  assertEquals(await scheduler.acquire(), "acquired");
  assertEquals(scheduler.active, 2);
  let third: string | undefined;
  const pending = scheduler.acquire().then((result) => {
    third = result;
  });
  await Promise.resolve();
  assertEquals(scheduler.active, 2, "third waits for a slot");
  scheduler.release();
  await pending;
  assertEquals(third, "acquired");
  assertEquals(scheduler.active, 2);
});

Deno.test("scheduler cancellation removes a queued waiter", async () => {
  const effects = new FakeEffects();
  const scheduler = new SourceScheduler(effects, 1, 0);
  await scheduler.acquire();
  const controller = new AbortController();
  let result: string | undefined;
  const pending = scheduler.acquire(controller.signal).then((value) => {
    result = value;
  });
  controller.abort();
  await pending;
  assertEquals(result, "cancelled");
  scheduler.release();
  assertEquals(scheduler.active, 0);
});

Deno.test("scheduler spacing delays until the min gap elapses", async () => {
  const effects = new FakeEffects();
  const scheduler = new SourceScheduler(effects, 1, 350);
  assertEquals(await scheduler.waitSpacing(), "waited");
  assertEquals(effects.delays.length, 0, "no wait before the first request");
  scheduler.markRequested();
  effects.advance(100);
  await scheduler.waitSpacing();
  // 350ms gap minus the 100ms already elapsed.
  assertEquals(effects.delays.at(-1), 250);
  effects.advance(400);
  await scheduler.waitSpacing();
  assertEquals(
    effects.delays.at(-1),
    250,
    "no additional wait when the gap is satisfied",
  );
});

Deno.test("scheduler spaces concurrent request starts", async () => {
  const effects = new FakeEffects();
  const scheduler = new SourceScheduler(effects, 2, 350);

  const first = scheduler.waitSpacing().then((result) => {
    scheduler.markRequested();
    return result;
  });
  const second = scheduler.waitSpacing().then((result) => {
    scheduler.markRequested();
    return result;
  });
  assertEquals(await Promise.all([first, second]), ["waited", "waited"]);

  assertEquals(effects.delays, [350]);
});
