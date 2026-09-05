import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProgress, parseProgress, rememberCatalog, rememberExpected, setEntryDone,
  isEntryDone, fileProgress, modeProgress, completedToday, progressMessage,
} from "../lib/review-progress.js";

test("progress survives malformed storage and remembers the current catalog ids", () => {
  const progress = parseProgress("not json");
  rememberCatalog(progress, "main", ["a", "b", "a"]);
  assert.deepEqual(progress.knownIds.main, ["a", "b"]);
  rememberCatalog(progress, "main", ["b", "c"]);
  assert.deepEqual(progress.knownIds.main, ["b", "c"]);
});

test("big percent is completed files while weighted percent still rewards partial stages", () => {
  const progress = emptyProgress();
  rememberCatalog(progress, "main", ["a", "b"]);
  rememberExpected(progress, { mode: "main", fileId: "a", labels: ["C", "B", "A", "S"] });
  setEntryDone(progress, { mode: "main", fileId: "a", entryKey: "C", done: true, at: "2026-09-05T10:00:00Z" });
  assert.equal(isEntryDone(progress, "a", "C"), true);
  assert.equal(fileProgress(progress, "a").state, "progress");
  assert.equal(modeProgress(progress, "main").percent, 0);
  assert.equal(modeProgress(progress, "main").weightedPercent, 12.5);
  for (const key of ["B", "A", "S"]) setEntryDone(progress, { mode: "main", fileId: "a", entryKey: key, done: true });
  assert.equal(fileProgress(progress, "a").state, "complete");
  assert.equal(modeProgress(progress, "main").percent, 50);
  assert.equal(modeProgress(progress, "main").complete, 1);
  assert.equal(modeProgress(progress, "main").total, 2);
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
  assert.match(progressMessage({ percent: 50, complete: 50, total: 100, remaining: 50 }), /절반/);
  assert.match(progressMessage({ percent: 100, complete: 100, total: 100, remaining: 0 }), /완료/);
  assert.match(progressMessage({ percent: 1, complete: 1, total: 100, remaining: 99 }), /0%/);
});
