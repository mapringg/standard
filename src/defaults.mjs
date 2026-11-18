import { readBudgets } from "./doc-budgets.mjs";
import { posix } from "node:path";

/** @param {import("./repo.mjs").Repo} repo */
export function defaults(repo) {
  if (repo.config.allow === undefined) return repo.config;
  const files = repo.files();
  const manifests = files.filter((path) => posix.basename(path) === "package.json").map((path) => ({ path, value: JSON.parse(repo.read(path)) }));
  const nextApps = manifests.filter(({ value }) => value.dependencies?.next || value.devDependencies?.next).map(({ path }) => posix.dirname(path));
  const reactApps = manifests.filter(({ value }) => (value.dependencies?.react || value.devDependencies?.react) && (value.dependencies?.next || value.devDependencies?.next || value.dependencies?.vite || value.devDependencies?.vite));
  const root = manifests.find(({ path }) => path === "package.json")?.value;
  return Object.freeze({
    ...repo.config,
    hooks: { "pre-commit": root ? ["pnpm exec lint-staged"] : [], "pre-push": [
      ...["typecheck", "test"].filter((name) => root?.scripts?.[name]).map((name) => `pnpm ${name}`),
      ...(files.includes("scripts/pre-push.sh") ? ["sh scripts/pre-push.sh"] : []),
    ] },
    pr: reactApps.length ? { ...repo.config.pr, screenshots: { when: [...manifests.filter(({ value }) => value.dependencies?.react || value.devDependencies?.react || value.peerDependencies?.react).flatMap(({ path }) => ["ts", "tsx", "js", "jsx", "css"].map((ext) => posix.join(posix.dirname(path), `**/*.${ext}`))), ...["test", "spec", "stories"].map((kind) => `!**/*.${kind}.*`), ...["__tests__", "test", "tests", "__fixtures__", "fixture", "fixtures", "scripts", "evals"].map((folder) => `!**/${folder}/**`), "!**/*.config.*"], uploader: "scripts/upload-evidence.mjs" } } : repo.config.pr,
    clientData: reactApps.filter(({ value }) => (value.dependencies?.vite || value.devDependencies?.vite) && !value.dependencies?.next && !value.devDependencies?.next).map(({ path }) => ({ app: posix.dirname(path), reason: /** @type {const} */ ("unreachable") })),
    budgets: readBudgets(repo),
    apiModules: ["**/src/lib/api/**"], cachedModules: ["**/*.cache.ts"],
    boundaries: {
      modules: [{ folders: ["**/src/*", "**/src/features/*"], entries: ["index", "routes"], open: ["**/src/lib", "**/src/components/ui"], except: [] }],
      forbid: nextApps.flatMap((app) => [
        { files: [posix.join(app, "src/features/**")], except: [], imports: [posix.join(app, "src/app/**")], fix: "Let the route compose the feature." },
        { files: [posix.join(app, "src/{components,lib,hooks}/**")], except: [], imports: [posix.join(app, "src/features/**")], fix: "Move feature behavior into the feature." },
        { files: [posix.join(app, "src/app/**")], except: [], imports: [posix.join(app, "src/features/**/*.server.*")], fix: "Import the feature entry instead." },
      ]),
    },
  });
}
