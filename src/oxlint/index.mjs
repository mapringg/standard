import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep, matchesGlob } from "node:path";
import plugin from "./rules.mjs";

export default { ...plugin, rules: Object.fromEntries(Object.entries(plugin.rules).map(([name, rule]) => [name, {
  ...rule,
  /** @param {Parameters<NonNullable<typeof rule.create>>[0]} context */
  create(context) {
    for (let root = dirname(context.filename); ; root = dirname(root)) {
      const path = join(root, ".standard/config.json");
      if (existsSync(path)) {
        const config = JSON.parse(readFileSync(path, "utf8"));
        if ((config.allow?.[`standard/${name}`] ?? []).some((/** @type {string} */ glob) => matchesGlob(relative(root, context.filename).split(sep).join("/"), glob))) return {};
        break;
      }
      if (dirname(root) === root) break;
    }
    return rule.create?.(context) ?? {};
  },
}])) };
