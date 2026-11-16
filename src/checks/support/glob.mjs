/**
 * @param {string} glob
 * @returns {RegExp}
 */
function pattern(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * @param {string} path
 * @param {string} glob
 * @returns {boolean}
 */
export function matchesGlob(path, glob) {
  return pattern(glob).test(path);
}
