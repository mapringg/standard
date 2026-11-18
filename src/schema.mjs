/** @param {readonly { name: string }[]} checks */
export function buildSchema(checks) {
  const severity = { enum: ["off", "warn", "error", 0, 1, 2] };
  const rules = { type: "object", additionalProperties: false, properties: Object.fromEntries(checks.map(({ name }) => [name, name === "config" ? { enum: ["error", 2] } : severity])) };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Standard configuration",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: { type: "string" }, rules,
      overrides: { type: "array", items: { type: "object", additionalProperties: false, required: ["files", "rules"], properties: {
        files: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }, rules,
      } } },
    },
  };
}
