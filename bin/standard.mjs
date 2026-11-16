#!/usr/bin/env node

import { HOOKS } from "../src/hook.mjs";
import { install } from "../src/install.mjs";
import { registry } from "../src/registry.mjs";
import { loadRepo } from "../src/repo.mjs";
import { failed, report, run } from "../src/run.mjs";
import { subjectsFromEvent, subjectsFromGh } from "../src/subjects.mjs";

const USAGE = `Usage:
  standard check [<name>...] [--pr <number>] [--init | --write | --prune]
  standard hook <${Object.keys(HOOKS).join(" | ")}> [<git args>...]
  standard install`;

const MODES = ["--init", "--write", "--prune"];

/**
 * @typedef {import("../src/hook.mjs").ExitCode} ExitCode
 * @type {Record<string, (args: string[]) => ExitCode | Promise<ExitCode>>}
 */
const COMMANDS = {
  async check(argv) {
    const at = argv.indexOf("--pr");
    const number = at === -1 ? null : argv[at + 1];
    if (number !== null && !/^[1-9]\d*$/.test(number ?? "")) {
      throw new Error("--pr needs a pull request number, such as --pr 12.");
    }
    const args = at === -1 ? argv : argv.toSpliced(at, 2);
    const flags = args.filter((arg) => arg.startsWith("--"));
    const stray = flags.find((flag) => !MODES.includes(flag)) ?? flags[1];
    if (stray) throw new Error(`Unexpected argument ${stray}. Use --pr <number> or one of ${MODES.join(", ")}.`);
    const repo = loadRepo(process.cwd());
    const event = process.env.GITHUB_EVENT_PATH;
    const results = await run({
      checks: registry,
      repo,
      scope: number
        ? subjectsFromGh(repo.root, Number(number))
        : event
          ? subjectsFromEvent(repo.root, event)
          : { commits: null, pr: null },
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
