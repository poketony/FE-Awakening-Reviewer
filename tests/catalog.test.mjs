import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog } from "../lib/catalog.js";

const blob = (path, sha = path) => ({ path, sha, type: "blob" });

test("catalog pairs main J/K and excludes retained Lucina duplicate", () => {
  const tree = [
    blob("Awakening/Messages (K)/カラム_ミリエル.txt", "k1"),
    blob("Awakening/Messages (J)/カラム_ミリエル.txt", "j1"),
    blob("Awakening/Messages (K)/ルキナ_セレナ.txt", "k2"),
    blob("Awakening/Messages (J)/ルキナ_セレナ.txt", "j2"),
    blob("Awakening/Messages (K)/GameData.txt", "gd"),
  ];
  const result = buildCatalog(tree);
  assert.equal(result.main.length, 1);
  assert.equal(result.main[0].fileName, "カラム_ミリエル.txt");
});

test("catalog pairs DLC by numeric prefix even if J/K titles differ", () => {
  const tree = [
    blob("Awakening/DLC Message (K)/22. 인연의 여름.txt", "k22"),
    blob("Awakening/DLC Message (J)/22. 絆の夏.txt", "j22"),
    blob("Awakening/DLC Message (K)/21. 다른 DLC.txt", "k21"),
    blob("Awakening/DLC Message (J)/21. 別DLC.txt", "j21"),
  ];
  const result = buildCatalog(tree);
  assert.equal(result.dlc.length, 1);
  assert.equal(result.dlc[0].japaneseSha, "j22");
});
