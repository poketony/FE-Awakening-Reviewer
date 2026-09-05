export function readControlToken(source, offset) {
  const rest = source.slice(offset);
  const noParam = ["$Wa", "$Wc", "$Nu", "$N0", "$N1", "$t0", "$t1", "$Wv", "$Wd", "$k", "$p", "$a"];
  for (const code of noParam.sort((a, b) => b.length - a.length)) {
    if (rest.startsWith(code)) return code;
  }
  const particle = rest.match(/^\$KrP[1-6]\|/u)?.[0];
  if (particle) return particle;
  if (rest.startsWith("$Wm")) {
    const end = rest.indexOf("|");
    if (end >= 0 && end + 1 < rest.length) return rest.slice(0, end + 2);
  }
  for (const code of ["$Sbv", "$Sbp", "$Sls", "$Slp"]) {
    if (!rest.startsWith(code)) continue;
    const first = rest.indexOf("|");
    const second = first >= 0 ? rest.indexOf("|", first + 1) : -1;
    if (second >= 0) return rest.slice(0, second + 1);
  }
  for (const code of ["$VNMPID", "$Sbs", "$Sve", "$Svj", "$Svp", "$Sre", "$Ssp", "$Fw", "$Ws", "$VF", "$Fo", "$Fi", "$E", "$b", "$w", "$l"]) {
    if (!rest.startsWith(code)) continue;
    const end = rest.indexOf("|");
    if (end >= 0) return rest.slice(0, end + 1);
  }
  if (rest.startsWith("$G") || rest.startsWith("$c")) {
    const end = rest.indexOf("|");
    if (end >= 0) return rest.slice(0, end + 1);
  }
  const generic = rest.match(/^\$[A-Za-z][A-Za-z0-9]*/u)?.[0];
  if (!generic) return null;
  const end = rest.indexOf("|");
  const nextDollar = rest.indexOf("$", 1);
  return end >= 0 && (nextDollar < 0 || end < nextDollar) ? rest.slice(0, end + 1) : generic;
}

export function controlTokens(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    if (source.startsWith("\\n", index)) { tokens.push("\\n"); index += 2; continue; }
    if (source[index] !== "$") { index += 1; continue; }
    const command = readControlToken(source, index);
    if (!command) { index += 1; continue; }
    tokens.push(command);
    index += command.length;
  }
  return tokens;
}

export function compareControlCodes(before, after) {
  const original = controlTokens(before);
  const edited = controlTokens(after);
  const same = original.length === edited.length && original.every((token, index) => token === edited[index]);
  return { same, original, edited };
}

export function changedText(before, after) {
  return String(before) !== String(after);
}

export function summarizeChange(before, after) {
  const control = compareControlCodes(before, after);
  return {
    changed: changedText(before, after),
    controlCodesPreserved: control.same,
    control,
  };
}
