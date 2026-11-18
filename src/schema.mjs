import plugin from "./oxlint/rules.mjs";

/** @param {readonly { name: string }[]} checks */
export function buildSchema(checks) {
  const ids = [...checks.filter(({ name }) => name !== "config").map(({ name }) => name), ...Object.keys(plugin.rules).map((name) => `standard/${name}`)];
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", title: "Standard configuration", type: "object", additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      ticket: { type: "string", pattern: "^[A-Z][A-Z0-9]*$" },
      skip: { type: "array", uniqueItems: true, items: { enum: checks.filter(({ name }) => !["config", "baseline-growth"].includes(name)).map(({ name }) => name) } },
      allow: { type: "object", additionalProperties: false, properties: Object.fromEntries(ids.map((id) => [id, { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } }])) },
    },
  };
}
