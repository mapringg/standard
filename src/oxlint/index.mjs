import redis from "./rules/redis.mjs";
import ai from "./rules/ai.mjs";
import ui from "./rules/ui.mjs";
import timer from "./rules/timer.mjs";
import swr from "./rules/swr.mjs";
import env from "./rules/env.mjs";
import json from "./rules/json.mjs";
import log from "./rules/log.mjs";
import format from "./rules/format.mjs";

export default { meta: { name: "standard", version: "0.15.0" }, rules: { timer, redis, ai, ui, swr, env, json, log, format } };
