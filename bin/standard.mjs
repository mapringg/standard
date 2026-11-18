#!/usr/bin/env node
import { writeBudgets } from "../src/doc-budgets.mjs";

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { explainAll, explainMarkdown, explainOne } from "../src/explain.mjs";
import { HOOKS } from "../src/hook.mjs";
import { install } from "../src/install.mjs";
import { merge } from "../src/merge.mjs";
import { migrateNames } from "../src/migrate-names.mjs";
import { registry } from "../src/registry.mjs";
import { loadRepo } from "../src/repo.mjs";
import { failed, report, run } from "../src/run.mjs";
import { anyFails, formatScore, score } from "../src/score.mjs";
import { subjectsFromEvent, subjectsFromGh } from "../src/subjects.mjs";

const USAGE = `Usage:
  standard check [<name>...] [--pr <number>] [--init | --write | --prune]
  standard explain [<check> | --markdown]
  standard hook <${Object.keys(HOOKS).join(" | ")}> [<git args>...]
  standard install
  standard merge <number> [--admin]
  standard migrate names [--write] [--effect <file>=<sync|route|subscribe>...]
  standard score [<path>...] [--remote] [--json]`;

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
    const budgetMode = repo.config.allow !== undefined && args.filter((arg) => !arg.startsWith("--")).join() === "docs" && flags.length === 1;
    if (budgetMode) repo.config = { ...repo.config, budgets: writeBudgets(repo, flags[0].slice(2)) };
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
      mode: /** @type {import("../src/ratchet.mjs").Mode} */ (budgetMode ? "check" : flags[0]?.slice(2) ?? "check"),
    });
    for (const line of report(results, process.env.GITHUB_ACTIONS === "true")) console.log(line);
    return failed(results) ? 1 : 0;
  },
  explain(args) {
    if (args.length > 1 || args[0]?.startsWith("--") && args[0] !== "--markdown") throw new Error(`explain takes one check name or --markdown.\n${USAGE}`);
    const lines = args[0] === "--markdown" ? explainMarkdown(registry) : args[0] ? explainOne(registry, args[0]) : explainAll(registry);
    for (const line of lines) console.log(line);
    return 0;
  },
  hook([name, ...args]) {
    if (!Object.hasOwn(HOOKS, name)) throw new Error(`Unknown hook ${name}.\n${USAGE}`);
    return HOOKS[name](loadRepo(process.cwd()), args);
  },
  install() {
    if (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" }).status !== 0) {
      console.log("standard install: not inside a git work tree, so there are no hooks to install");
      return 0;
    }
    const changes = install(loadRepo(process.cwd()).root);
    for (const change of changes) console.log(`standard install: ${change}`);
    if (changes.length === 0) console.log("standard install: hooks already up to date");
    return 0;
  },
  merge([number, ...flags]) {
    if (!/^[1-9]\d*$/.test(number ?? "") || flags.some((flag) => flag !== "--admin")) {
      throw new Error(`merge needs a pull request number and takes only --admin.\n${USAGE}`);
    }
    return merge(process.cwd(), Number(number), flags.includes("--admin"), registry);
  },
  migrate([what, ...argv]) {
    if (what !== "names") throw new Error(`migrate takes names.\n${USAGE}`);
    const picks = new Map();
    let write = false;
    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === "--write") write = true;
      else if (argv[index] === "--effect") {
        const [file, reason] = (argv[++index] ?? "").split("=");
        if (!file || !["sync", "route", "subscribe"].includes(reason)) throw new Error("--effect needs <file>=<sync|route|subscribe>.");
        picks.set(file, reason);
      } else throw new Error(`Unexpected argument ${argv[index]}.\n${USAGE}`);
    }
    const { ok, lines } = migrateNames(loadRepo(process.cwd()).root, { write, picks });
    for (const line of lines) console.log(line);
    return ok ? 0 : 1;
  },
  score(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { remote: { type: "boolean" }, json: { type: "boolean" } },
      allowPositionals: true,
    });
    const scores = score(positionals.length > 0 ? positionals : [process.cwd()], values.remote ?? false);
    console.log(values.json ? JSON.stringify({ repos: scores }, null, 2) : formatScore(scores).join("\n"));
    return anyFails(scores) ? 1 : 0;
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
