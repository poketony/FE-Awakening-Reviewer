const MAIN_K = "Awakening/Messages (K)/";
const MAIN_J = "Awakening/Messages (J)/";
const DLC_K = "Awakening/DLC Message (K)/";
const DLC_J = "Awakening/DLC Message (J)/";
const SUPPORT_DLC_NUMBERS = new Set(["22", "23", "24"]);

function basename(path) {
  return path.split("/").pop() || path;
}

function withoutExt(name) {
  return name.replace(/\.txt$/iu, "");
}

export function buildCatalog(tree) {
  const blobs = tree.filter((entry) => entry.type === "blob" && entry.path.endsWith(".txt"));
  const byPath = new Map(blobs.map((entry) => [entry.path, entry]));
  const main = [];
  for (const item of blobs.filter((entry) => entry.path.startsWith(MAIN_K))) {
    const fileName = basename(item.path);
    if (fileName === "GameData.txt") continue;
    const stem = withoutExt(fileName);
    if (!stem.includes("_")) continue;
    const characters = stem.split("_");
    if (characters.includes("父親") || characters.includes("ルキナ")) continue;
    const japanesePath = MAIN_J + fileName;
    const japanese = byPath.get(japanesePath);
    if (!japanese) continue;
    main.push({
      mode: "main",
      id: item.path,
      fileName,
      koreanPath: item.path,
      koreanSha: item.sha,
      japanesePath,
      japaneseSha: japanese.sha,
    });
  }

  const japaneseDlcByNumber = new Map();
  for (const item of blobs.filter((entry) => entry.path.startsWith(DLC_J))) {
    const number = basename(item.path).match(/^(\d+)\./u)?.[1];
    if (number) japaneseDlcByNumber.set(number, item);
  }
  const dlc = [];
  for (const item of blobs.filter((entry) => entry.path.startsWith(DLC_K))) {
    const fileName = basename(item.path);
    const number = fileName.match(/^(\d+)\./u)?.[1];
    if (!number || !SUPPORT_DLC_NUMBERS.has(number)) continue;
    const japanese = japaneseDlcByNumber.get(number);
    if (!japanese) continue;
    dlc.push({
      mode: "dlc",
      id: item.path,
      fileName,
      koreanPath: item.path,
      koreanSha: item.sha,
      japanesePath: japanese.path,
      japaneseSha: japanese.sha,
    });
  }

  const natural = (a, b) => a.fileName.localeCompare(b.fileName, "ja", { numeric: true });
  return { main: main.sort(natural), dlc: dlc.sort(natural) };
}

export function fileDisplayName(item, names = new Map()) {
  const stem = withoutExt(item.fileName);
  if (item.mode === "dlc") return stem;
  const relation = new Map([
    ["親子", "부모·자녀"], ["兄弟", "형제·자매"], ["姉妹", "형제·자매"],
    ["夫婦", "부부"], ["恋人", "연인"], ["家族", "가족"],
  ]);
  return stem.split("_").map((token) => {
    if (token.startsWith("プレイヤー")) return "러플레";
    return names.get(token) || relation.get(token) || token;
  }).join(" × ").replace(/ × (부모·자녀|형제·자매|부부|연인|가족)$/u, " · $1");
}

export const paths = { MAIN_K, MAIN_J, DLC_K, DLC_J };
