const ENTRY_RE = /^([^:\r\n]+):([ \t]?)([^\r\n]*)/gm;

export function decodeUtf8Bytes(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hasBom = array.length >= 3 && array[0] === 0xef && array[1] === 0xbb && array[2] === 0xbf;
  const body = hasBom ? array.subarray(3) : array;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(body);
  return { text: hasBom ? `\uFEFF${text}` : text, hasBom };
}

export function parseMessageDocument(text, metadata = {}) {
  const entries = [];
  const byKey = new Map();
  ENTRY_RE.lastIndex = 0;
  let match;
  while ((match = ENTRY_RE.exec(text)) !== null) {
    const key = match[1].replace(/^\uFEFF/u, "");
    const valueStart = match.index + match[1].length + 1 + match[2].length;
    const entry = {
      key,
      value: match[3],
      lineStart: match.index,
      valueStart,
      valueEnd: valueStart + match[3].length,
    };
    entries.push(entry);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return { ...metadata, text, entries, byKey };
}

export function replaceEntryValue(document, key, nextValue) {
  const entry = document.byKey.get(key);
  if (!entry) throw new Error(`항목을 찾을 수 없습니다: ${key}`);
  const nextText = document.text.slice(0, entry.valueStart) + nextValue + document.text.slice(entry.valueEnd);
  return parseMessageDocument(nextText, {
    path: document.path,
    sha: document.sha,
    hasBom: document.hasBom,
  });
}

export function formatEntryForEditing(value) {
  return String(value || "")
    .replace(/\$k(?=\\n|\$p)/g, "$k\n")
    .replace(/\$p(?=\$|[^\r\n])/g, "$p\n");
}

export function unformatEntryFromEditing(value) {
  return String(value || "").replace(/[\r\n]/g, "");
}

export function parseNameMap(text) {
  const names = new Map();
  const document = parseMessageDocument(text);
  for (const entry of document.entries) {
    if (!entry.key.startsWith("MPID_") || !entry.value.trim()) continue;
    names.set(entry.key.slice(5), stripCommands(entry.value).trim());
  }
  names.set("マルス", "루키나");
  names.set("プレイヤー", "러플레");
  return names;
}

export function stripCommands(script, playerName = "러플레") {
  let text = String(script || "");
  text = text.replace(/\\n/g, "\n");
  text = text.replace(/\$KrP[1-6]\|/g, "");
  text = text.replace(/\$G[^|$]*\|/g, "");
  text = text.replace(/\$Wm[^|$]*\|.?/g, "");
  text = text.replace(/\$(?:Sbv|Sbp|Sls|Slp)[^|$]*\|[^|$]*\|/g, "");
  text = text.replace(/\$(?:VNMPID|Sbs|Sve|Svj|Svp|Sre|Ssp|Fw|Ws|VF|Fo|Fi|E|b|w|l)[^|$]*\|/g, "");
  text = text.replace(/\$c[^|$]*\|/g, "");
  text = text.replace(/\$(?:Wa|Wc|Nu|N0|N1|t0|t1|Wv|Wd|k|p|a)/g, (match) => {
    if (match === "$k" || match === "$p") return "\n\n";
    if (match === "$Nu") return playerName;
    return "";
  });
  text = text.replace(/\$[A-Za-z][A-Za-z0-9]*(?:[^|$]*\|)?/g, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function isMainSupportEntry(key, includeVariants = false) {
  const match = key.match(/^MID_支援_(.+)_([ＣＢＡＳ])(?:_00)?(?:_(PC[MF]\d+))?$/u);
  if (!match) return false;
  if (key.includes("_ルキナ_")) return false;
  if (includeVariants) return true;
  const variant = match[3];
  return !variant || variant === "PCM1" || variant === "PCF1";
}

export function canonicalCharacterId(value, names = new Map()) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed === "username" || trimmed.startsWith("プレイヤー")) return "プレイヤー";
  if (names.has(trimmed)) return trimmed;
  const routeNeutral = trimmed.replace(/[白黒透]$/u, "");
  return names.has(routeNeutral) ? routeNeutral : trimmed;
}

export function extractDlcCharacters(key, names = new Map(), includeVariants = false) {
  if (!includeVariants) {
    const variant = key.match(/_(PC[MF]\d+)(?:_|$)/u)?.[1];
    if (variant && variant !== "PCM1" && variant !== "PCF1") return null;
  }
  const marker = key.match(/^MID_E\d+_(?:TK|EV)_(.+)$/u);
  if (!marker) return null;
  const characters = [];
  for (const token of marker[1].split("_")) {
    if (/^(?:\d+|PCM\d+|PCF\d+)$/u.test(token)) continue;
    const canonical = canonicalCharacterId(token, names);
    const known = names.has(canonical) || token === "username" || token.startsWith("プレイヤー");
    if (!known || characters.includes(canonical)) continue;
    characters.push(canonical);
    if (characters.length === 2) break;
  }
  return characters.length === 2 ? characters : null;
}

export function entryLabel(key) {
  const main = key.match(/_([ＣＢＡＳ])(?:_00)?(?:_PC[MF]\d+)?$/u);
  if (main) return main[1];
  const gender = key.match(/_(PCM|PCF)(\d+)$/u);
  const part = key.replace(/_PC[MF]\d+$/u, "").match(/_0?(\d+)$/u);
  const bits = [];
  if (gender) bits.push(gender[1] === "PCM" ? "남성" : "여성");
  if (part) bits.push(`${Number(part[1])}편`);
  return bits.join(" · ") || "회화";
}
