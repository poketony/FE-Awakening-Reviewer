import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProgress, parseProgress, rememberCatalog, rememberExpected, setEntryDone,
  isEntryDone, fileProgress, modeProgress, completedToday, progressMessage,
} from "../lib/review-progress.js";

test("progress survives malformed storage and remembers catalog ids", () => {
  const progress = parseProgress("not json");
  rememberCatalog(progress, "main", ["a", "b", "a"]);
  assert.deepEqual(progress.knownIds.main, ["a", "b"]);
});

test("entry completion drives file state and weighted mode percent", () => {
  const progress = emptyProgress();
  rememberCatalog(progress, "main", ["a", "b"]);
  rememberExpected(progress, { mode: "main", fileId: "a", labels: ["C", "B", "A", "S"] });
  setEntryDone(progress, { mode: "main", fileId: "a", entryKey: "C", done: true, at: "2026-09-05T10:00:00Z" });
  assert.equal(isEntryDone(progress, "a", "C"), true);
  assert.equal(fileProgress(progress, "a").state, "progress");
  assert.equal(modeProgress(progress, "main").percent, 13); // 25% of one of two files
  for (const key of ["B", "A", "S"]) setEntryDone(progress, { mode: "main", fileId: "a", entryKey: key, done: true });
  assert.equal(fileProgress(progress, "a").state, "complete");
  assert.equal(modeProgress(progress, "main").percent, 50);
});

test("unmarking an entry rolls completion back", () => {
  const progress = emptyProgress();
  rememberExpected(progress, { mode: "dlc", fileId: "x", labels: ["1", "2"] });
  setEntryDone(progress, { mode: "dlc", fileId: "x", entryKey: "1", done: true });
  setEntryDone(progress, { mode: "dlc", fileId: "x", entryKey: "1", done: false });
  assert.equal(fileProgress(progress, "x").done, 0);
});

test("today count and motivation text are deterministic", () => {
  const progress = emptyProgress();
  rememberExpected(progress, { mode: "main", fileId: "a", labels: ["C"] });
  setEntryDone(progress, { mode: "main", fileId: "a", entryKey: "C", done: true, at: "2026-09-05T03:00:00Z" });
  assert.equal(completedToday(progress, new Date("2026-09-05T12:00:00Z")), 1);
  assert.match(progressMessage(50), /절반/);
  assert.match(progressMessage(100), /완료/);
});
