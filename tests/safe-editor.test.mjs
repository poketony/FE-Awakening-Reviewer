import test from "node:test";
import assert from "node:assert/strict";
import { buildSafeEditTemplate, rebuildSafeEditTemplate, validateSafeText, summarizeLockedContext } from "../lib/safe-editor.js";
import { compareControlCodes } from "../lib/validation.js";

test("safe template roundtrip preserves the complete script exactly", () => {
  const raw = "$t1$Wmクロム|7$Wsクロム|$E笑,|안녕\\n반가워$k$Wsusername|어이, $Nu.$k";
  const template = buildSafeEditTemplate(raw);
  const values = template.textParts.map((part) => part.value);
  assert.equal(template.textParts[0].value, "안녕\n반가워");
  assert.equal(rebuildSafeEditTemplate(template, values), raw);
});

test("safe text replacement edits a two-line message in one field while keeping controls", () => {
  const raw = "$t1$WsA|안녕\\n반가워$k$WsB|잘 가$k";
  const template = buildSafeEditTemplate(raw);
  const values = template.textParts.map((part) => part.value);
  values[0] = "안녕하세요\n반갑습니다";
  const next = rebuildSafeEditTemplate(template, values);
  assert.equal(next.includes("안녕하세요\\n반갑습니다"), true);
  assert.equal(compareControlCodes(raw, next).same, true);
});

test("safe editor rejects script syntax but allows displayed textarea line breaks", () => {
  assert.equal(validateSafeText("평범한 대사").valid, true);
  assert.equal(validateSafeText("첫째 줄\n둘째 줄").valid, true);
  assert.equal(validateSafeText("$WsA|").valid, false);
  assert.equal(validateSafeText("강제\\n줄바꿈").valid, false);
});

test("adding or removing a displayed line break is rejected by control comparison", () => {
  const raw = "$WsA|안녕\\n반가워$k";
  const template = buildSafeEditTemplate(raw);
  const values = template.textParts.map((part) => part.value);
  values[0] = "안녕\n정말\n반가워";
  const next = rebuildSafeEditTemplate(template, values);
  assert.equal(compareControlCodes(raw, next).same, false);
});

test("speaker and protected context are tracked around editable pieces", () => {
  const raw = "$Wsクロム|안녕$k\\n$Wsusername|나는 $Nu야.$k";
  const template = buildSafeEditTemplate(raw);
  assert.equal(template.textParts[0].speaker, "クロム");
  assert.equal(template.textParts[1].speaker, "username");
  const labels = summarizeLockedContext(template.textParts[1].leadingLocked);
  assert.equal(labels.includes("대사 넘김"), true);
  assert.equal(labels.includes("줄바꿈"), true);
});
