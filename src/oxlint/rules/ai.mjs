import { fixedPathRule } from "../fixed-path.mjs";

export default fixedPathRule({"owner": "src/lib/ai.ts", "modules": ["@ai-sdk/**", "ai", "ai/**", "openai", "openai/**"], "globals": [], "properties": [], "note": "Browser code such as DefaultChatTransport or useChat goes behind src/lib/ai.browser.ts."});
