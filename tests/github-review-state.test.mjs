import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "../lib/github.js";

const logicalPath = "Awakening/review-progress.json";
const pcPath = "Awakening/review-progress-pc.json";
const mobilePath = "Awakening/review-progress-mobile.json";

function progress(status, updatedAt) {
  return `${JSON.stringify({
    version: 2,
    files: {},
    entries: {
      sample: {
        path: "Awakening/Messages (K)/sample.txt",
        entryKey: "MID_SAMPLE",
        status,
        updatedAt,
      },
    },
  })}\n`;
}

test("PC와 모바일 진행도를 합쳐 최신 MID 상태를 읽는다", async () => {
  const client = new GitHubClient();
  const blobs = new Map([
    ["legacy-sha", progress("unreviewed", "2026-09-07T00:00:00.000Z")],
    ["pc-sha", progress("approved", "2026-09-07T01:00:00.000Z")],
    ["mobile-sha", progress("needs_fix", "2026-09-07T02:00:00.000Z")],
  ]);

  client.getTreeRaw = async (ref) => {
    if (ref === "main") return [{ path: "Awakening/Messages (K)/sample.txt", type: "blob", sha: "source-sha" }];
    if (ref === "review-state") return [
      { path: logicalPath, type: "blob", sha: "legacy-sha" },
      { path: pcPath, type: "blob", sha: "pc-sha" },
      { path: mobilePath, type: "blob", sha: "mobile-sha" },
    ];
    throw new Error(`unexpected ref: ${ref}`);
  };
  client.getBlobTextRaw = async (sha) => blobs.get(sha) || "";

  const tree = await client.getTree("main");
  const descriptor = tree.find((entry) => entry.path === logicalPath);
  assert.ok(descriptor);
  assert.match(descriptor.sha, /^__fe_review_progress_union__:/u);

  const merged = JSON.parse(await client.getBlobText(descriptor.sha));
  assert.equal(merged.entries.sample.status, "needs_fix");
});

test("모바일 publish는 검수 기록을 main이 아니라 모바일 전용 파일 경로로 라우팅한다", async () => {
  const client = new GitHubClient({ token: "test-token" });
  const calls = [];
  client.commitReviewProgress = async (file) => {
    calls.push({ kind: "review", path: file.path });
    return { commitSha: "review-commit", branch: "review-state", htmlUrl: "review" };
  };
  client.commitFilesRaw = async ({ files, branch }) => {
    calls.push({ kind: "source", paths: files.map((file) => file.path), branch });
    return { commitSha: "main-commit", branch, htmlUrl: "main" };
  };

  await client.commitFilesToBranch({
    branch: "main",
    message: "test",
    files: [
      { path: logicalPath, text: progress("approved", "2026-09-07T03:00:00.000Z") },
      { path: "Awakening/Messages (K)/sample.txt", text: "MID_SAMPLE: test" },
    ],
  });

  assert.deepEqual(calls, [
    { kind: "review", path: logicalPath },
    { kind: "source", paths: ["Awakening/Messages (K)/sample.txt"], branch: "main" },
  ]);
});
