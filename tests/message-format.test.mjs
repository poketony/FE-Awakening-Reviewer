import test from "node:test";
import assert from "node:assert/strict";
import { parseMessageDocument, replaceEntryValue, formatEntryForEditing, unformatEntryFromEditing, isMainSupportEntry, extractDlcCharacters } from "../lib/message-format.js";
import { compareControlCodes } from "../lib/validation.js";

test("MID value replacement changes only the target value", () => {
  const source = "ARCHIVE\r\n\r\nMID_A: $t1$WsA|hello$k\\n\r\nMID_B: world\r\n";
  const doc = parseMessageDocument(source);
  const next = replaceEntryValue(doc, "MID_A", "$t1$WsA|안녕$k\\n");
  assert.equal(next.byKey.get("MID_B").value, "world");
  assert.equal(next.text.includes("MID_A: $t1$WsA|안녕$k\\n"), true);
  assert.equal(next.text.endsWith("MID_B: world\r\n"), true);
});

test("pretty editing roundtrip preserves script", () => {
  const raw = "$t1$WsA|안녕$k\\n$WsB|반가워$k$p끝";
  assert.equal(unformatEntryFromEditing(formatEntryForEditing(raw)), raw);
});

test("control code changes are blocked but text changes pass", () => {
  const before = "$t1$WsA|안녕$k\\n$WsB|반가워$k";
  const textOnly = "$t1$WsA|안녕하세요$k\\n$WsB|반가워요$k";
  const broken = "$t1$WsA|안녕하세요$k\\n$WsC|반가워요$k";
  assert.equal(compareControlCodes(before, textOnly).same, true);
  assert.equal(compareControlCodes(before, broken).same, false);
});

test("escaped game linebreak changes are treated as structural changes", () => {
  const before = "$t1$WsA|첫 줄\\n둘째 줄$k";
  const broken = "$t1$WsA|첫 줄 둘째 줄$k";
  assert.equal(compareControlCodes(before, broken).same, false);
});

test("main support filter keeps canonical player variants", () => {
  assert.equal(isMainSupportEntry("MID_支援_A_B_Ｃ"), true);
  assert.equal(isMainSupportEntry("MID_支援_A_B_Ｃ_PCM1"), true);
  assert.equal(isMainSupportEntry("MID_支援_A_B_Ｃ_PCM2"), false);
  assert.equal(isMainSupportEntry("MID_支援_ルキナ_A_Ｃ"), false);
});

test("DLC key extracts two known characters", () => {
  const names = new Map([["セレナ", "세레나"], ["ルキナ", "루키나"]]);
  assert.deepEqual(extractDlcCharacters("MID_E000_EV_ルキナ_セレナ_01", names), ["ルキナ", "セレナ"]);
});
