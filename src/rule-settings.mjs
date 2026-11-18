import { matchesGlob } from "node:path";
import schema from "../schema.json" with { type: "json" };

/** @typedef {"off" | "warn" | "error" | 0 | 1 | 2} Severity */
/** @typedef {{ rules: Readonly<Record<string, Severity>>, overrides: readonly { files: readonly string[], rules: Readonly<Record<string, Severity>> }[] }} Settings */

/** @param {unknown} value @param {unknown} definition @param {string} [at] */
function validate(value, definition, at = ".standard/config.json") {
  const spec = /** @type {{ type?: string, enum?: unknown[], properties?: Record<string, unknown>, required?: string[], minItems?: number, minLength?: number, items?: unknown }} */ (definition);
  if (spec.enum) {
    if (!spec.enum.includes(value)) throw new Error(`${at} must be one of ${spec.enum.join(", ")}.`);
  } else if (spec.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${at} must be an object.`);
    const fields = /** @type {Record<string, unknown>} */ (value);
    for (const key of spec.required ?? []) if (!(key in fields)) throw new Error(`${at}.${key} is required.`);
    for (const [key, item] of Object.entries(fields)) {
      const child = spec.properties?.[key];
      if (!Object.hasOwn(spec.properties ?? {}, key)) throw new Error(`${at} has an unknown key "${key}". Legacy settings were replaced in 0.16.0; use rules and overrides.`);
      validate(item, child, `${at}.${key}`);
    }
  } else if (spec.type === "array") {
    if (!Array.isArray(value) || value.length < (spec.minItems ?? 0)) throw new Error(`${at} must be a non-empty list.`);
    value.forEach((item, index) => validate(item, spec.items, `${at}[${index}]`));
  } else if (typeof value !== "string" || value.length < (spec.minLength ?? 0)) throw new Error(`${at} must be a string.`);
}

/** @param {unknown} raw @returns {Settings} */
export function parseSettings(raw) {
  validate(raw, schema);
  const parsed = /** @type {Partial<Settings>} */ (raw);
  for (const { files } of parsed.overrides ?? []) for (const glob of files) {
    if (glob.startsWith("/") || glob.split("/").includes("..") || glob.startsWith("!")) throw new Error(`Override glob "${glob}" must be relative and positive.`);
  }
  return Object.freeze({ rules: parsed.rules ?? {}, overrides: parsed.overrides ?? [] });
}

/** @param {import("./config.mjs").Config} config @param {string} rule @param {string} [path] @returns {0 | 1 | 2} */
export function severity(config, rule, path) {
  let level = config.rules?.[rule] ?? "error";
  for (const override of config.overrides ?? []) {
    if (path && override.files.some((glob) => matchesGlob(path, glob))) level = override.rules[rule] ?? level;
  }
  return level === "off" || level === 0 ? 0 : level === "warn" || level === 1 ? 1 : 2;
}

/** @param {import("./registry.mjs").Finding} finding @param {readonly string[]} files */
function findingPath(finding, files) {
  const path = [...files].sort((a, b) => b.length - a.length).find((file) => finding.key === file || finding.key.startsWith(`${file} `) || finding.key.startsWith(`${file}:`));
  return path;
}

/** @param {import("./config.mjs").Config} config @param {string} rule @param {import("./registry.mjs").Finding} finding @param {readonly string[]} files */
export function findingSeverity(config, rule, finding, files) {
  return severity(config, rule, findingPath(finding, files));
}

/** @param {import("./config.mjs").Config} config @param {string} rule @param {import("./registry.mjs").Finding} finding @param {readonly string[]} files */
export function configuredSeverity(config, rule, finding, files) {
  const path = findingPath(finding, files);
  return config.rules?.[rule] !== undefined || (config.overrides ?? []).some((entry) => path && entry.rules[rule] !== undefined && entry.files.some((glob) => matchesGlob(path, glob)));
}
