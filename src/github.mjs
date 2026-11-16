import { execFileSync } from "node:child_process";
import { constants } from "node:http2";

const NEXT_PAGE = /<([^>]+)>;\s*rel="next"/;
const ATTEMPTS = 3;

/**
 * @typedef {object} GitHub
 * @property {string} api
 * @property {string} repository owner/name
 * @property {string} token
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {GitHub | null} Null when the run has no token or repository to write to.
 */
export function githubFromEnv(env) {
  if (!env.GH_TOKEN || !env.GITHUB_REPOSITORY) return null;
  return {
    api: env.GITHUB_API_URL ?? "https://api.github.com",
    repository: env.GITHUB_REPOSITORY,
    token: env.GH_TOKEN,
  };
}

/**
 * A refused stream never reached the server, so even a write is safe to send again.
 * @param {unknown} error
 */
function refusedUnprocessed(error) {
  const cause = /** @type {{ cause?: { http2ErrorCode?: number } }} */ (error).cause;
  return cause?.http2ErrorCode === constants.NGHTTP2_REFUSED_STREAM;
}

/**
 * @param {GitHub} github
 * @param {string} method
 * @param {string} path Relative to the repository, or a full URL from a Link header.
 * @param {unknown} [body]
 * @returns {Promise<Response>}
 */
export async function githubRequest(github, method, path, body) {
  const url = path.startsWith("http") ? path : `${github.api}/repos/${github.repository}/${path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, {
        method,
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${github.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (attempt === ATTEMPTS || !(method === "GET" || refusedUnprocessed(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

/**
 * @param {GitHub} github
 * @param {string} path
 * @returns {Promise<any[]>}
 */
export async function githubPages(github, path) {
  const items = [];
  /** @type {string | undefined} */
  let next = `${path}?per_page=100`;
  while (next) {
    const response = await githubRequest(github, "GET", next);
    if (!response.ok) throw new Error(`GET ${next}: ${response.status} ${await response.text()}`);
    items.push(...(await response.json()));
    next = response.headers.get("link")?.match(NEXT_PAGE)?.[1];
  }
  return items;
}

/**
 * @param {Promise<Response>} request
 * @param {number[]} [tolerated]
 */
export async function expectOk(request, tolerated = []) {
  const response = await request;
  if (!response.ok && !tolerated.includes(response.status)) {
    throw new Error(`${response.url}: ${response.status} ${await response.text()}`);
  }
}

export class GhError extends Error {
  /**
   * @param {string} message
   * @param {string} detail What gh printed to stderr, such as "gh: Branch not protected (HTTP 404)".
   * @param {number | null} status The HTTP status gh reports, or null when it reports none.
   */
  constructor(message, detail, status) {
    super(message);
    this.detail = detail;
    this.status = status;
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
export function gh(cwd, args) {
  try {
    return execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stderr = "", message } = /** @type {Error & { stderr?: string }} */ (error);
    const detail = stderr.trim() || message;
    const status = /\(HTTP (\d{3})\)/.exec(detail)?.[1];
    throw new GhError(`gh ${args.join(" ")} failed in ${cwd}. ${detail}`, detail, status === undefined ? null : Number(status));
  }
}
