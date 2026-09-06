import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProgress, parseProgress, registerFile, setReviewStatus, getReviewStatus,
  fileProgress, summarizeMode, mergeProgress, completedToday, serializeProgress,
} from "../lib/review-progress.js";

test("공용 v2 검수 상태와 파일 완료율", () => {
  const progress = emptyProgress();
  registerFile(progress, { path: "Awakening/Messages (K)/A.txt", mode: "main", expected: ["C", "B"] });
  setReviewStatus(progress, { path: "Awakening/Messages (K)/A.txt", entryKey: "C", status: "approved", at: "2026-09-06T01:00:00.000Z" });
  assert.equal(getReviewStatus(progress, "awakening/messages (k)/A.txt", "C"), "approved");
  assert.equal(fileProgress(progress, "Awakening/Messages (K)/A.txt").state, "progress");
  setReviewStatus(progress, { path: "Awakening/Messages (K)/A.txt", entryKey: "B", status: "approved", at: "2026-09-06T01:01:00.000Z" });
  assert.equal(fileProgress(progress, "Awakening/Messages (K)/A.txt").state, "complete");
  const summary = summarizeMode(progress, "main", ["Awakening/Messages (K)/A.txt", "Awakening/Messages (K)/B.txt"]);
  assert.equal(summary.percent, 50);
  assert.equal(summary.entryPercent, 100);
});

test("수정 필요와 보류는 파일 완료로 치지 않는다", () => {
  const progress = emptyProgress();
  registerFile(progress, { path: "Awakening/Messages (K)/A.txt", expected: ["C", "B"] });
  setReviewStatus(progress, { path: "Awakening/Messages (K)/A.txt", entryKey: "C", status: "needs_fix" });
  setReviewStatus(progress, { path: "Awakening/Messages (K)/A.txt", entryKey: "B", status: "deferred" });
  const file = fileProgress(progress, "Awakening/Messages (K)/A.txt");
  assert.equal(file.state, "progress");
  assert.equal(file.needsFix, 1);
  assert.equal(file.deferred, 1);
});

test("병합은 MID별 최신 updatedAt을 보존하고 미검수 tombstone도 유지한다", () => {
  const left = emptyProgress();
  const right = emptyProgress();
  setReviewStatus(left, { path: "Awakening/Messages (K)/A.txt", entryKey: "C", status: "approved", at: "2026-09-06T01:00:00.000Z" });
  setReviewStatus(right, { path: "Awakening/Messages (K)/A.txt", entryKey: "C", status: "unreviewed", at: "2026-09-06T02:00:00.000Z" });
  const merged = mergeProgress(left, right);
  assert.equal(getReviewStatus(merged, "Awakening/Messages (K)/A.txt", "C"), "unreviewed");
});

test("오늘 완료 수와 직렬화가 안정적이다", () => {
  const progress = emptyProgress();
  setReviewStatus(progress, { path: "Awakening/Messages (K)/B.txt", entryKey: "B", status: "approved", at: "2026-09-06T02:00:00.000Z" });
  setReviewStatus(progress, { path: "Awakening/Messages (K)/A.txt", entryKey: "A", status: "approved", at: "2026-09-05T02:00:00.000Z" });
  assert.equal(completedToday(progress, new Date("2026-09-06T12:00:00.000Z")), 1);
  const text = serializeProgress(progress);
  assert.deepEqual(parseProgress(text), parseProgress(progress));
  assert.ok(text.indexOf("a.txt") < text.indexOf("b.txt"));
});
