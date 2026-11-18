import { fixedPathRule } from "../fixed-path.mjs";

export default fixedPathRule({ owner: "src/lib/timer.ts", modules: [], globals: ["setTimeout", "setInterval", "requestAnimationFrame"], properties: [] });
