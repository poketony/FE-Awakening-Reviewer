import test from "node:test";
import assert from "node:assert/strict";
import { parseNameMap } from "../lib/message-format.js";

test("reviewer fallback names translate male and female Morgan", () => {
  const names = parseNameMap("");
  assert.equal(names.get("マーク男"), "마크(남)");
  assert.equal(names.get("マーク女"), "마크(여)");
});
