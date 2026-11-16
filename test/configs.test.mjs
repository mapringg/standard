import assert from "node:assert/strict";
import test from "node:test";

test("an adopter imports the oxlint config by its export name", async () => {
  const { default: config } = await import("@mapringg/standard/oxlint", { with: { type: "json" } });
  assert.deepEqual(config.categories, { correctness: "error" });
  assert.ok(config.plugins.includes("typescript"));
});

test("an adopter spreads the oxfmt config and appends to its ignores", async () => {
  const { default: config } = await import("@mapringg/standard/oxfmt", { with: { type: "json" } });
  assert.deepEqual([...config.ignorePatterns, "dist/**"], [".claude/**", "dist/**"]);
  assert.equal(config.sortPackageJson.sortScripts, true);
});
