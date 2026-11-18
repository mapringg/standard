import { matchesGlob } from "node:path";
import schema from "../schema.json" with { type: "json" };

/** @typedef {{ skip: readonly string[], ticket?: string, allow: Readonly<Record<string, readonly string[]>> }} Settings */

/** @param {unknown} value @param {unknown} definition @param {string} [at] */
function validate(value, definition, at = ".standard/config.json") {
  const spec = /** @type {{ type?: string, enum?: unknown[], properties?: Record<string, unknown>, required?: string[], minItems?: number, minLength?: number, items?: unknown, uniqueItems?: boolean, pattern?: string }} */ (definition);
  if (spec.enum) {
    if (!spec.enum.includes(value)) throw new Error(`${at} must be one of ${spec.enum.join(", ")}.`);
  } else if (spec.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${at} must be an object.`);
    const fields = /** @type {Record<string, unknown>} */ (value);
    for (const key of spec.required ?? []) if (!(key in fields)) throw new Error(`${at}.${key} is required.`);
    for (const [key, item] of Object.entries(fields)) {
      const child = spec.properties?.[key];
      if (!Object.hasOwn(spec.properties ?? {}, key)) throw new Error(`${at} has an unknown key "${key}". Settings were replaced in 0.16.0; use standard migrate and allow.`);
      validate(item, child, `${at}.${key}`);
    }
  } else if (spec.type === "array") {
    if (!Array.isArray(value) || value.length < (spec.minItems ?? 0)) throw new Error(`${at} must be a non-empty list.`);
    if (spec.uniqueItems && new Set(value).size !== value.length) throw new Error(`${at} must contain unique items.`);
    value.forEach((item, index) => validate(item, spec.items, `${at}[${index}]`));
  } else if (typeof value !== "string" || value.length < (spec.minLength ?? 0) || spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) throw new Error(`${at} must be a string.`);
}

/** @param {unknown} raw @returns {Settings} */
export function parseSettings(raw) {
  validate(raw, schema);
  const parsed = /** @type {Partial<Settings>} */ (raw);
  for (const globs of Object.values(parsed.allow ?? {})) for (const glob of globs) {
    if (glob.startsWith("/") || glob.split("/").includes("..") || glob.startsWith("!")) throw new Error(`Exception glob "${glob}" must be relative and positive.`);
  }
  return Object.freeze({ skip: parsed.skip ?? [], ...(parsed.ticket === undefined ? {} : { ticket: parsed.ticket }), allow: parsed.allow ?? {} });
}

/** @param {Pick<import("./config.mjs").Config, "allow">} config @param {string} rule @param {string} path */
export function excepted(config, rule, path) {
  return (config.allow?.[rule] ?? []).some((glob) => matchesGlob(path, glob));
}

/** @param {import("./registry.mjs").Finding} finding @param {readonly string[]} files */
export function findingPath(finding, files) {
  return files.find((file) => finding.key === file || finding.key.startsWith(`${file} `) || finding.key.startsWith(`${file}:`)) ?? "";
}
