import { assertEquals } from "@std/assert";
import { denoOsToNodePlatform } from "./compile.ts";

Deno.test("compile maps the Deno Windows OS token to the npm target token", () => {
  assertEquals(denoOsToNodePlatform("windows"), "win32");
  assertEquals(denoOsToNodePlatform("linux"), "linux");
  assertEquals(denoOsToNodePlatform("darwin"), "darwin");
});
