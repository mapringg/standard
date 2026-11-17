import { existsSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

import { classicApi, majorOf, nativeApi, typescriptFor } from "./typescript.mjs";

/**
 * A useReducer call, by repo-relative path and the UTF-16 offset where the call expression ends.
 * @typedef {{ file: string, end: number }} Site
 *
 * What TypeScript makes of a site's state. `exact` is false when the type could not be read, and the caller then fails
 * the site with "<the call> <reason>, so the check cannot read its state. <fix>".
 * @typedef {{ exact: true, members: readonly Member[] } | { exact: false, reason: string, fix: string }} StateShape
 *
 * One member of the state type after splitting a union. A state that is not a union is one member.
 * @typedef {object} Member
 * @property {string} text The member as TypeScript prints it.
 * @property {string | null} status The string literal its status property has, or null when it has none or it is not one literal.
 *
 * One TypeScript install, open on the files of its sites. Both compilers share the checker calls and differ in the rest.
 * @typedef {object} Engine
 * @property {(file: string) => { checker: any, source: any } | null} project The project that holds an absolute file, or null when it is in none.
 * @property {(node: any, visit: (child: any) => void) => void} children
 * @property {number} call The syntax kind of a call expression.
 * @property {Record<string, number>} flags The compiler's own TypeFlags.
 * @property {() => void} close
 */

/**
 * @param {string} reason
 * @param {string} fix
 * @returns {StateShape}
 */
const unread = (reason, fix) => ({ exact: false, reason, fix });

/**
 * @param {string} root
 * @param {string} file Repo-relative.
 * @returns {string | null} The repo-relative tsconfig.json nearest above the file.
 */
function nearestTsconfig(root, file) {
  for (let folder = posix.dirname(file); ; folder = posix.dirname(folder)) {
    const tsconfig = posix.join(folder, "tsconfig.json");
    if (existsSync(posix.join(root, tsconfig))) return tsconfig;
    if (folder === ".") return null;
  }
}

/**
 * @param {string} install The folder of a typescript 7 package.
 * @param {readonly string[]} files Absolute paths.
 * @returns {Promise<Engine>}
 */
async function nativeEngine(install, files) {
  const API = await nativeApi(install);
  const [{ TypeFlags }, { SyntaxKind }] = await Promise.all(["typeFlags", "syntaxKind"].map((name) => import(pathToFileURL(posix.join(install, `dist/enums/${name}.enum.js`)).href)));
  const api = new API({});
  try {
    // Opening the files makes TypeScript pick each one's project as an editor does, references included.
    const snapshot = api.updateSnapshot({ openFiles: [...files] });
    return {
      project(file) {
        const found = snapshot.getDefaultProjectForFile(file);
        // A file that no tsconfig covers lands in an inferred project, whose config name is not a file.
        const source = found && existsSync(found.configFileName) ? found.program.getSourceFile(file) : undefined;
        return source ? { checker: found.checker, source } : null;
      },
      children: (node, visit) => node.forEachChild(visit),
      call: SyntaxKind.CallExpression,
      flags: TypeFlags,
      close() {
        try {
          snapshot.dispose();
        } finally {
          api.close();
        }
      },
    };
  } catch (error) {
    api.close();
    throw error;
  }
}

/**
 * @param {string} install The folder of a typescript package before 7.
 * @param {string} root
 * @returns {Engine}
 */
function classicEngine(install, root) {
  const ts = classicApi(install);
  /** @type {Map<string, any>} */
  const programs = new Map();
  return {
    project(file) {
      const tsconfig = nearestTsconfig(root, posix.relative(root, file));
      if (tsconfig === null) return null;
      if (!programs.has(tsconfig)) {
        const parsed = ts.getParsedCommandLineOfConfigFile(posix.join(root, tsconfig), undefined, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
        programs.set(tsconfig, parsed ? ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences }) : null);
      }
      const source = programs.get(tsconfig)?.getSourceFile(file);
      return source ? { checker: programs.get(tsconfig).getTypeChecker(), source } : null;
    },
    children: (node, visit) => ts.forEachChild(node, visit),
    call: ts.SyntaxKind.CallExpression,
    flags: ts.TypeFlags,
    close() {},
  };
}

/**
 * @param {any} checker
 * @param {Record<string, number>} flags
 * @param {any} call A useReducer call expression.
 * @returns {StateShape}
 */
function shapeOf(checker, flags, call) {
  // useReducer returns [state, dispatch], so element 0 of the resolved return type is the state however the caller binds it.
  const signature = checker.getResolvedSignature(call);
  const tuple = signature && checker.getReturnTypeOfSignature(signature);
  const first = tuple && checker.getPropertyOfType(tuple, "0");
  const state = first && checker.getTypeOfSymbol(first);
  if (!state) return unread("has no return type that TypeScript can resolve", "Run the typecheck and fix what it reports at this call, such as missing types for react.");
  const text = checker.typeToString(state);
  if (state.flags & (flags.Any | flags.Unknown)) return unread(`has a state of type ${text}`, "Give the reducer's state parameter a concrete union type.");
  if (state.flags & flags.TypeParameter) return unread(`has a state of type parameter ${text}`, "Call useReducer where the state type is concrete, or give the hook a concrete state union.");
  /** @type {readonly any[]} */
  const members = state.flags & flags.Union ? (state.types ?? state.getTypes()) : [state];
  return {
    exact: true,
    members: members.map((member) => {
      const property = checker.getPropertyOfType(member, "status");
      const status = property && checker.getTypeOfSymbol(property);
      return { text: checker.typeToString(member), status: status && status.flags & flags.StringLiteral ? String(status.value) : null };
    }),
  };
}

/**
 * @param {Engine} engine
 * @param {string} root
 * @param {string} file Repo-relative.
 * @param {readonly Site[]} sites The sites in that file.
 * @returns {StateShape[]} One per site, in order.
 */
function readFile(engine, root, file, sites) {
  const project = engine.project(posix.join(root, file));
  if (project === null) {
    const tsconfig = nearestTsconfig(root, file);
    const shape = unread("is in no TypeScript project", tsconfig === null ? `Add a tsconfig.json whose include covers ${file}.` : `Add ${file} to the include of ${tsconfig}.`);
    return sites.map(() => shape);
  }
  const ends = new Set(sites.map(({ end }) => end));
  /** @type {Map<number, any>} */
  const calls = new Map();
  /** @param {any} node */
  const visit = (node) => {
    if (node.kind === engine.call && ends.has(node.end)) calls.set(node.end, node);
    engine.children(node, visit);
  };
  engine.children(project.source, visit);
  return sites.map(({ end }) => {
    const call = calls.get(end);
    if (call === undefined) return unread("is not a call where TypeScript parses the file", `Fix the syntax errors in ${file} and run the check again.`);
    try {
      return shapeOf(project.checker, engine.flags, call);
    } catch (error) {
      return threw(error);
    }
  });
}

/**
 * @param {unknown} error
 * @returns {StateShape}
 */
function threw(error) {
  return unread(`made TypeScript fail with "${error instanceof Error ? error.message : String(error)}"`, "Run the typecheck and fix what it reports, then run the check again.");
}

/**
 * Reads the state type of each useReducer call with the TypeScript its file resolves.
 * @param {string} root Absolute path of the repository.
 * @param {readonly Site[]} sites
 * @returns {Promise<Map<Site, StateShape>>} One entry per site.
 */
export async function reducerStates(root, sites) {
  /** @type {Map<Site, StateShape>} */
  const shapes = new Map();
  /** @type {Map<string, Map<string, Site[]>>} */
  const byInstall = new Map();
  for (const site of sites) {
    const install = typescriptFor(posix.join(root, site.file));
    if (install === null) {
      shapes.set(site, unread("is in a package that resolves no typescript", `Add typescript to the devDependencies of the package that holds ${site.file} and run pnpm install, so the check reads it with the repository's own compiler.`));
      continue;
    }
    const byFile = byInstall.get(install) ?? new Map();
    byInstall.set(install, byFile.set(site.file, [...(byFile.get(site.file) ?? []), site]));
  }
  for (const [install, byFile] of byInstall) {
    try {
      const engine = majorOf(install) >= 7 ? await nativeEngine(install, [...byFile.keys()].map((file) => posix.join(root, file))) : classicEngine(install, root);
      try {
        for (const [file, group] of byFile) {
          readFile(engine, root, file, group).forEach((shape, index) => shapes.set(/** @type {Site} */ (group[index]), shape));
        }
      } finally {
        engine.close();
      }
    } catch (error) {
      for (const site of [...byFile.values()].flat()) {
        if (!shapes.has(site)) shapes.set(site, threw(error));
      }
    }
  }
  return shapes;
}
