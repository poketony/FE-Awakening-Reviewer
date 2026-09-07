import { GitHubClient } from "./lib/github.js";
import { emptyProgress, parseProgress, mergeProgress, serializeProgress } from "./lib/review-progress.js";

const OWNER = "poketony";
const REPO = "FE-Awakening";
const DATA_BRANCH = "main";
const STATE_BRANCH = "review-state";
const PROGRESS_PATH = "Awakening/review-progress.json";
const STORAGE_KEY = "fe-awakening-reviewer:review-progress:v2";
const DRAFT_KEY = "fe-awakening-reviewer:drafts:v1";
const client = new GitHubClient({ owner: OWNER, repo: REPO });
let baseline = emptyProgress();
let busy = false;
let lastPull = 0;

function readLocalProgress() {
  return parseProgress(localStorage.getItem(STORAGE_KEY));
}

function writeLocalProgress(value) {
  localStorage.setItem(STORAGE_KEY, serializeProgress(value));
}

function readDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; }
}

function entrySignature(value) {
  const parsed = parseProgress(value);
  return JSON.stringify(Object.keys(parsed.entries).sort().map((key) => [key, parsed.entries[key]]));
}

function encodedPath() {
  return PROGRESS_PATH.split("/").map(encodeURIComponent).join("/");
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function readRemoteState() {
  try {
    const result = await client.request(client.repoPath(`/contents/${encodedPath()}?ref=${encodeURIComponent(STATE_BRANCH)}&t=${Date.now()}`));
    const text = result?.sha ? await client.getBlobText(result.sha) : "";
    return { progress: parseProgress(text), sha: result?.sha || null };
  } catch (error) {
    if (/GitHub API 404:/u.test(error.message)) return { progress: emptyProgress(), sha: null };
    throw error;
  }
}

function toast(message, type = "ok") {
  const element = document.querySelector("#toast");
  if (!element) return;
  element.textContent = message;
  element.dataset.type = type;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2600);
}

function topStatus(message, tone = "muted") {
  const element = document.querySelector("#status");
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
}

async function pullState({ reloadOnIncoming = false, quiet = true } = {}) {
  if (busy) return false;
  busy = true;
  try {
    const local = readLocalProgress();
    const remote = await readRemoteState();
    baseline = remote.progress;
    const incomingMerged = mergeProgress(local, remote.progress);
    const incomingChanged = entrySignature(incomingMerged) !== entrySignature(local);
    const merged = mergeProgress(remote.progress, local);
    writeLocalProgress(merged);
    lastPull = Date.now();
    if (incomingChanged && reloadOnIncoming) {
      const save = document.querySelector("#save");
      if (save && !save.disabled) {
        if (!quiet) toast("PC의 새 검수 기록을 받았습니다. 현재 편집 저장 후 새로고침됩니다.");
        return true;
      }
      location.reload();
      return true;
    }
    if (incomingChanged && !quiet) toast("PC의 새 검수 기록을 반영했습니다.");
    return incomingChanged;
  } catch (error) {
    if (!quiet) toast(`검수 기록 동기화 실패: ${error.message}`, "error");
    return false;
  } finally {
    busy = false;
  }
}

async function pushState(localProgress) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remote = await readRemoteState();
    const merged = mergeProgress(remote.progress, localProgress);
    const text = serializeProgress(merged);
    if (entrySignature(remote.progress) === entrySignature(merged)) {
      baseline = merged;
      writeLocalProgress(merged);
      return { changed: false, commitSha: null };
    }
    try {
      const body = {
        message: `모바일 검수 기록 동기화 ${new Date().toISOString().slice(0, 10)}`,
        content: utf8Base64(text),
        branch: STATE_BRANCH,
      };
      if (remote.sha) body.sha = remote.sha;
      const result = await client.request(client.repoPath(`/contents/${encodedPath()}`), {
        method: "PUT",
        body: JSON.stringify(body),
      });
      baseline = merged;
      writeLocalProgress(merged);
      return { changed: true, commitSha: result?.commit?.sha || null };
    } catch (error) {
      if (/GitHub API (409|422):/u.test(error.message) && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("다른 기기에서 검수 기록을 갱신 중입니다. 잠시 뒤 다시 시도하세요.");
}

async function publish() {
  if (busy) return;
  busy = true;
  let mainCommitted = false;
  try {
    const control = document.querySelector("#control-state");
    if (control?.dataset.state === "error") throw new Error("현재 장면의 입력 오류를 먼저 고쳐주세요.");
    const save = document.querySelector("#save");
    if (save && !save.disabled) {
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const token = document.querySelector("#token")?.value?.trim() || "";
    if (!token) throw new Error("GitHub에 반영하려면 Fine-grained PAT를 입력하세요.");
    client.setToken(token);
    topStatus("최신 main과 review-state를 확인하는 중…");
    await client.verifyToken();

    const drafts = Object.values(readDrafts()).filter((draft) => draft?.path && typeof draft.text === "string");
    const remote = await readRemoteState();
    const local = readLocalProgress();
    const merged = mergeProgress(remote.progress, local);
    writeLocalProgress(merged);
    const stateChanged = entrySignature(remote.progress) !== entrySignature(merged);

    if (!drafts.length && !stateChanged) {
      baseline = remote.progress;
      toast("GitHub에 반영할 변경사항이 없습니다.", "info");
      topStatus("최신 상태", "ok");
      return;
    }

    const summary = [
      "GitHub에 반영합니다.",
      `번역 수정: ${drafts.length}개 파일 → main`,
      `검수 기록: ${stateChanged ? "상태 변경 있음" : "변경 없음"} → review-state`,
      "",
      "번역과 검수 기록은 서로 다른 브랜치에 저장됩니다.",
    ].join("\n");
    if (!window.confirm(summary)) return;

    let mainResult = null;
    if (drafts.length) {
      topStatus("번역 수정분을 main에 커밋하는 중…");
      mainResult = await client.commitFilesToBranch({
        files: drafts.map((draft) => ({ path: draft.path, text: draft.text, baseSha: draft.baseSha })),
        branch: DATA_BRANCH,
        message: `모바일 각성 검수 반영 ${new Date().toISOString().slice(0, 10)}`,
      });
      mainCommitted = true;
      localStorage.setItem(DRAFT_KEY, "{}");
    }

    let stateResult = { changed: false, commitSha: null };
    if (stateChanged) {
      topStatus("검수 기록을 review-state에 동기화하는 중…");
      stateResult = await pushState(readLocalProgress());
    }

    const parts = [];
    if (drafts.length) parts.push(`번역 ${drafts.length}개`);
    if (stateChanged) parts.push("검수 기록");
    const resultBox = document.querySelector("#pr-result");
    const commitSha = mainResult?.commitSha || stateResult.commitSha;
    if (resultBox && commitSha) {
      const branch = mainResult ? DATA_BRANCH : STATE_BRANCH;
      resultBox.innerHTML = `<a href="https://github.com/${OWNER}/${REPO}/commit/${commitSha}" target="_blank" rel="noreferrer">커밋 확인 · ${branch}</a>`;
    }
    topStatus(`GitHub 반영 완료 · ${parts.join(" + ")}`, "ok");
    toast(`반영 완료 · ${parts.join(" + ")}`, "ok");
    if (mainCommitted) setTimeout(() => location.reload(), 1000);
  } catch (error) {
    if (mainCommitted) {
      topStatus(`번역은 main에 저장됨 · 검수 기록 동기화 실패`, "error");
      toast("번역은 보존됐습니다. 검수 기록만 다시 반영하세요.", "error");
    } else {
      topStatus(error.message, "error");
      toast(error.message, "error");
    }
  } finally {
    busy = false;
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.("#publish");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void publish();
}, true);

window.addEventListener("focus", () => {
  if (Date.now() - lastPull > 1500) void pullState({ reloadOnIncoming: true, quiet: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastPull > 1500) {
    void pullState({ reloadOnIncoming: true, quiet: true });
  }
});

await pullState({ reloadOnIncoming: false, quiet: true });
window.__reviewStateBridge = { pull: pullState, getBaseline: () => baseline };
