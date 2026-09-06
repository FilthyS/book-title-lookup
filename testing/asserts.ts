import strictAssert from "node:assert/strict";

export function assert(
  condition: unknown,
  message?: string,
): asserts condition {
  strictAssert.ok(condition, message);
}

export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  strictAssert.deepStrictEqual(actual, expected, message);
}

export function assertMatch(
  actual: string,
  expected: RegExp,
  message?: string,
): void {
  strictAssert.match(actual, expected, message);
}

export function assertStringIncludes(
  actual: string,
  expected: string,
  message?: string,
): void {
  strictAssert.ok(
    actual.includes(expected),
    message ??
      `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`,
  );
}
