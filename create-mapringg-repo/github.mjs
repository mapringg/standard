import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export function command(cwd, bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: options.stream ? "inherit" : ["pipe", "pipe", "pipe"],
    input: options.input,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${bin} ${args[0]} failed${result.stderr?.trim() ? `: ${result.stderr.trim()}` : "."}`);
  }
  return { ok: result.status === 0, output: result.stdout?.trim() ?? "", error: result.stderr?.trim() ?? "" };
}

export function github(cwd, repo) {
  const endpoint = `repos/${repo}`;
  const api = (path, method = "GET", body) => {
    const args = ["api", "--method", method, path];
    if (body !== undefined) args.push("--input", "-");
    const result = command(cwd, "gh", args, { input: JSON.stringify(body), allowFailure: true });
    if (result.ok) return result.output ? JSON.parse(result.output) : null;
    const status = /HTTP (\d{3})/.exec(result.error)?.[1];
    const message = result.error.split("\n")[0];
    throw Object.assign(new Error(message || "GitHub API request failed."), { status });
  };

  return {
    lookup() {
      try {
        return api(endpoint);
      } catch (error) {
        if (error.status === "404") return null;
        throw error;
      }
    },
    configureMerge(current) {
      const desired = {
        allow_merge_commit: false,
        allow_rebase_merge: false,
        allow_squash_merge: true,
        squash_merge_commit_title: "PR_TITLE",
        squash_merge_commit_message: "BLANK",
      };
      if (Object.entries(desired).some(([key, value]) => current[key] !== value)) api(endpoint, "PATCH", desired);
    },
    requireCheck(base, check) {
      const path = `${endpoint}/branches/${encodeURIComponent(base)}/protection`;
      const required = { strict: false, contexts: [check] };
      try {
        let protection = null;
        try {
          protection = api(path);
        } catch (error) {
          if (error.status !== "404") throw error;
        }
        if (!protection) {
          api(path, "PUT", {
            required_status_checks: required,
            enforce_admins: false,
            required_pull_request_reviews: null,
            restrictions: null,
          });
        } else if (!protection.required_status_checks) {
          api(`${path}/required_status_checks`, "PATCH", required);
        } else if (!protection.required_status_checks.contexts.includes(check)) {
          api(`${path}/required_status_checks/contexts`, "POST", { contexts: [check] });
        }
        return true;
      } catch (error) {
        if (/upgrade to github pro|make this repository public/i.test(error.message)) return false;
        throw error;
      }
    },
    pulls(base) {
      const args = [
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--base",
        base,
        "--limit",
        "100",
        "--json",
        "number,url,headRefName,headRefOid,isCrossRepository",
      ];
      return JSON.parse(command(cwd, "gh", args).output);
    },
    createPull(base, branch, title, body) {
      return command(
        cwd,
        "gh",
        ["pr", "create", "--repo", repo, "--base", base, "--head", branch, "--title", title, "--body-file", "-"],
        { input: body },
      ).output;
    },
    async waitForCheck(sha, check) {
      const deadline = Date.now() + 15 * 60_000;
      while (Date.now() < deadline) {
        const name = new URLSearchParams({ check_name: check, filter: "latest", per_page: "30" });
        const entries = api(`${endpoint}/commits/${sha}/check-runs?${name}`).check_runs;
        if (entries.length && entries.every((entry) => entry.status === "completed")) {
          const failed = entries.find((entry) => entry.conclusion !== "success");
          if (failed) throw new Error(`${check} finished with ${failed.conclusion}. ${failed.html_url}`);
          console.log(`${check} passed.`);
          return;
        }
        await setTimeout(5000);
      }
      throw new Error(`Timed out waiting for ${check}. Rerun setup to resume checking.`);
    },
  };
}

export function githubRepo(url) {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      url,
    );
  if (!match) throw new Error("Use a github.com origin.");
  return `${match[1]}/${match[2]}`;
}
