#!/usr/bin/env node

import { HOOKS } from "../src/hook.mjs";
import { install } from "../src/install.mjs";
import { registry } from "../src/registry.mjs";
import { loadRepo } from "../src/repo.mjs";
import { failed, report, run } from "../src/run.mjs";
import { commitsFromEvent } from "../src/subjects.mjs";

const USAGE = `Usage:
  standard check [<name>...] [--init | --write | --prune]
  standard hook <${Object.keys(HOOKS).join(" | ")}> [<git args>...]
  standard install`;

const MODES = ["--init", "--write", "--prune"];

/**
 * @typedef {import("../src/hook.mjs").ExitCode} ExitCode
 * @type {Record<string, (args: string[]) => ExitCode | Promise<ExitCode>>}
 */
const COMMANDS = {
  async check(args) {
    const flags = args.filter((arg) => arg.startsWith("--"));
    const stray = flags.find((flag) => !MODES.includes(flag)) ?? flags[1];
    if (stray) throw new Error(`Unexpected argument ${stray}. Use one of ${MODES.join(", ")}.`);
    const repo = loadRepo(process.cwd());
    const event = process.env.GITHUB_EVENT_PATH;
    const results = await run({
      checks: registry,
      repo,
      scope: { commits: event ? commitsFromEvent(repo.root, event) : null },
      names: args.filter((arg) => !arg.startsWith("--")),
      mode: /** @type {import("../src/ratchet.mjs").Mode} */ (flags[0]?.slice(2) ?? "check"),
    });
    for (const line of report(results, process.env.GITHUB_ACTIONS === "true")) console.log(line);
    return failed(results) ? 1 : 0;
  },
  hook([name, ...args]) {
    if (!Object.hasOwn(HOOKS, name)) throw new Error(`Unknown hook ${name}.\n${USAGE}`);
    return HOOKS[name](loadRepo(process.cwd()), args);
  },
  install() {
    const changes = install(loadRepo(process.cwd()).root);
    for (const change of changes) console.log(`standard install: ${change}`);
    if (changes.length === 0) console.log("standard install: hooks already up to date");
    return 0;
  },
};

const [command, ...args] = process.argv.slice(2);
try {
  if (!Object.hasOwn(COMMANDS, command)) throw new Error(`Unknown command ${command ?? ""}.\n${USAGE}`);
  process.exitCode = await COMMANDS[command](args);
} catch (error) {
  console.error(`standard: ${/** @type {Error} */ (error).message}`);
  process.exitCode = 1;
}
