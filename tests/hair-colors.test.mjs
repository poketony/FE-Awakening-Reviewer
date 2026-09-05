import test from "node:test";
import assert from "node:assert/strict";
import { hairColorForCharacter, DEFAULT_HAIR_COLOR } from "../lib/hair-colors.js";

function hex(rgb) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

test("Awakening reviewer hair colors match the archive canonical table", () => {
  const expected = new Map([
    ["プレイヤー", "#F6F4EF"],
    ["マイユニ_青年_顔立ちA", "#F6F4EF"],
    ["マイユニ_少女_顔立ちA", "#F6F4EF"],
    ["マーク", "#5B5855"],
    ["マーク男", "#5B5855"],
    ["マーク女", "#5B5855"],
    ["ルキナ", "#505C81"],
    ["マルス", "#505C81"],
    ["ウード", "#DAD3BD"],
    ["ウード正体不明", "#DAD3BD"],
    ["アズール", "#999191"],
    ["ブレディ", "#F2E7C4"],
    ["デジェル", "#595655"],
    ["シンシア", "#A19791"],
    ["セレナ", "#AF5454"],
    ["ジェローム", "#D48085"],
    ["シャンブレー", "#463E36"],
    ["ロラン", "#532426"],
    ["ノワール", "#484848"],
    ["ンン", "#C2D6AE"],
  ]);

  for (const [id, color] of expected) assert.equal(hex(hairColorForCharacter(id)), color, id);
  assert.deepEqual(hairColorForCharacter("unknown"), DEFAULT_HAIR_COLOR);
});
