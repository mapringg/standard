import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";

import { sizeOf } from "../src/checks/pr-size.mjs";
import { githubRequest } from "../src/github.mjs";
import { CLI, ENV, checkEvent, eventFile, pullRequestEvent, pullRequestRepo, WIRED } from "./helpers.mjs";

/** @param {[string, number, number][]} files */
function size(files) {
  const { label, color, lines } = sizeOf(files.map(([path, additions, deletions]) => ({ path, additions, deletions })));
  return `${label} ${color} ${lines}`;
}

test("labels by added plus deleted lines", () => {
  assert.equal(size([["apps/api/src/app.ts", 60, 20]]), "size:M fbca04 80");
});

test("leaves test lines out when the pull request also changes other code", () => {
  assert.equal(
    size([
      ["apps/web/src/chart.tsx", 5, 2],
      ["apps/web/src/chart.test.tsx", 400, 0],
    ]),
    "size:XS 0e8a16 7",
  );
});

test("counts test lines in a test-only pull request", () => {
  assert.equal(size([["apps/api/src/__tests__/store.ts", 150, 0]]), "size:L fe7d37 150");
});

test("never counts the lockfile", () => {
  assert.equal(
    size([
      ["package.json", 1, 1],
      ["pnpm-lock.yaml", 3000, 2000],
    ]),
    "size:XS 0e8a16 2",
  );
});

test("labels an empty diff extra small", () => {
  assert.equal(size([]), "size:XS 0e8a16 0");
});

test("labels each threshold's first line with the next size", () => {
  const labels = [9, 10, 30, 100, 500, 1000].map((lines) => sizeOf([{ path: "a.mjs", additions: lines, deletions: 0 }]).label);
  assert.deepEqual(labels, ["size:XS", "size:S", "size:M", "size:L", "size:XL", "size:XXL"]);
});

const lines = (count, word) => Array.from({ length: count }, (_, at) => `${word} ${at}`).join("\n") + "\n";

function fixture(t) {
  return pullRequestRepo(t, {
    base: { ...WIRED, ".standard/config.json": { ...WIRED[".standard/config.json"], pending: ["dead-code", "boundaries"] }, "src/app.mjs": lines(5, "old"), "src/old-name.mjs": lines(20, "same") },
    head: {
      "src/app.mjs": lines(5, "new"),
      "src/app.test.mjs": lines(300, "test"),
      "pnpm-lock.yaml": lines(4000, "lock"),
      "src/old-name.mjs": null,
      "src/new-name.mjs": lines(20, "same"),
      "logo.png": Buffer.from([0, 1, 2, 0, 255]),
    },
  });
}

test("pr-size reports the size of a fixture diff, without lockfile, tests, renames or binaries", (t) => {
  const repo = fixture(t);
  const { stdout, status } = checkEvent(t, repo.cwd, pullRequestEvent({ base: repo.base, head: repo.head }), ["pr-size"]);
  assert.equal(stdout.trim(), "pr-size: size:S, 10 changed line(s) (#123)");
  assert.equal(status, 0);
});

function fakeGitHub(t, respond) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(`${request.method} ${request.url}${body ? ` ${body}` : ""}`);
    const [status, json] = respond(request);
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
  });
  t.after(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const env = {
        GH_TOKEN: "token",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_API_URL: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`,
      };
      resolve({ requests, env });
    });
  });
}

function checkPullRequestAsync(t, repo, env) {
  const child = spawn(process.execPath, [CLI, "check"], {
    cwd: repo.cwd,
    env: {
      ...ENV,
      ...env,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: eventFile(t, pullRequestEvent({ base: repo.base, head: repo.head })),
    },
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  return new Promise((resolve) => child.on("close", (status) => resolve({ stdout, status })));
}

test("pr-size creates the label, swaps out another size label and sets its own", async (t) => {
  const repo = fixture(t);
  const github = await fakeGitHub(t, (request) => {
    if (request.method === "POST" && request.url === "/repos/owner/repo/labels") return [422, {}];
    if (request.method === "GET") return [200, [{ name: "size:XL" }, { name: "bug" }]];
    return [200, {}];
  });
  const { stdout, status } = await checkPullRequestAsync(t, repo, github.env);
  assert.match(stdout, /^pr-size: size:S, 10 changed line\(s\) \(#123\)$/m);
  assert.equal(status, 0);
  assert.deepEqual(github.requests, [
    'POST /repos/owner/repo/labels {"name":"size:S","color":"5ebd3e","description":"Changed lines, without the lockfile and, unless only tests changed, tests"}',
    "GET /repos/owner/repo/issues/123/labels?per_page=100",
    "DELETE /repos/owner/repo/issues/123/labels/size%3AXL",
    'POST /repos/owner/repo/issues/123/labels {"labels":["size:S"]}',
  ]);
});

test("a label pr-size cannot set is a warning, and standard check still passes", async (t) => {
  const repo = fixture(t);
  const github = await fakeGitHub(t, () => [403, { message: "Resource not accessible by integration" }]);
  const { stdout, status } = await checkPullRequestAsync(t, repo, github.env);
  assert.match(
    stdout,
    /^::warning title=pr-size::size:S: Could not set the label\. http:\/\/127\.0\.0\.1:\d+\/repos\/owner\/repo\/labels: 403 .*Resource not accessible/m,
  );
  assert.equal(status, 0);
});

async function droppingServer(t, failures) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (requests.length <= failures) return request.socket.destroy();
    response.end("{}");
  });
  t.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const github = {
    api: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`,
    repository: "owner/repo",
    token: "token",
  };
  return { requests, github };
}

test("retries a GET that got no response", async (t) => {
  const { requests, github } = await droppingServer(t, 1);
  assert.equal((await githubRequest(github, "GET", "pulls/7/files")).status, 200);
  assert.deepEqual(requests, ["GET /repos/owner/repo/pulls/7/files", "GET /repos/owner/repo/pulls/7/files"]);
});

test("does not retry a write that may have landed", async (t) => {
  const { requests, github } = await droppingServer(t, 1);
  await assert.rejects(githubRequest(github, "POST", "issues/7/labels", { labels: ["size:M"] }));
  assert.deepEqual(requests, ["POST /repos/owner/repo/issues/7/labels"]);
});
