const API = "https://api.github.com";
const REVIEW_PROGRESS_PATH = "Awakening/review-progress.json";
const REVIEW_LEGACY_PATH = "Awakening/review-progress.json";
const REVIEW_PC_PATH = "Awakening/review-progress-pc.json";
const REVIEW_MOBILE_PATH = "Awakening/review-progress-mobile.json";
const REVIEW_STATE_BRANCH = "review-state";
const VIRTUAL_REVIEW_SHA_PREFIX = "__fe_review_progress_union__";

function bytesFromBase64(value) {
  const normalized = String(value || "").replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function emptyProgress() {
  return { version: 2, files: {}, entries: {} };
}

function parseProgressText(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return emptyProgress();
    return {
      version: 2,
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch {
    return emptyProgress();
  }
}

function newerRecord(left, right) {
  if (!left) return right;
  if (!right) return left;
  const lt = Date.parse(left.updatedAt || 0) || 0;
  const rt = Date.parse(right.updatedAt || 0) || 0;
  return rt >= lt ? right : left;
}

function mergeProgressText(baseText, incomingText) {
  const base = parseProgressText(baseText);
  const incoming = parseProgressText(incomingText);
  const merged = emptyProgress();
  for (const key of new Set([...Object.keys(base.files), ...Object.keys(incoming.files)])) {
    const value = newerRecord(base.files[key], incoming.files[key]);
    if (value) merged.files[key] = value;
  }
  for (const key of new Set([...Object.keys(base.entries), ...Object.keys(incoming.entries)])) {
    const value = newerRecord(base.entries[key], incoming.entries[key]);
    if (value) merged.entries[key] = value;
  }
  const files = {};
  const entries = {};
  for (const key of Object.keys(merged.files).sort()) files[key] = merged.files[key];
  for (const key of Object.keys(merged.entries).sort()) entries[key] = merged.entries[key];
  return `${JSON.stringify({ version: 2, files, entries }, null, 2)}\n`;
}

export class GitHubClient {
  constructor({ owner = "poketony", repo = "FE-Awakening", token = "" } = {}) {
    this.owner = owner;
    this.repo = repo;
    this.token = token.trim();
    this.virtualReviewText = null;
    this.virtualReviewSha = null;
  }

  setToken(token) {
    this.token = String(token || "").trim();
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, { ...options, headers });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.message || ""; } catch { detail = await response.text(); }
      throw new Error(`GitHub API ${response.status}: ${detail || response.statusText}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  repoPath(suffix) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  async verifyToken() {
    if (!this.token) throw new Error("토큰이 입력되지 않았습니다.");
    const user = await this.request("/user");
    const repo = await this.request(this.repoPath(""));
    return { login: user.login, repo: repo.full_name, defaultBranch: repo.default_branch };
  }

  async getTreeRaw(ref = "main") {
    const result = await this.request(this.repoPath(`/git/trees/${encodeURIComponent(ref)}?recursive=1`));
    if (result.truncated) throw new Error("저장소 트리가 너무 커서 GitHub 응답이 잘렸습니다.");
    return result.tree || [];
  }

  async getBlob(sha) {
    return this.request(this.repoPath(`/git/blobs/${encodeURIComponent(sha)}`));
  }

  async getBlobTextRaw(sha) {
    const blob = await this.getBlob(sha);
    const bytes = blob.encoding === "base64" ? bytesFromBase64(blob.content) : new TextEncoder().encode(blob.content || "");
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  async buildReviewUnion(stateTree = null) {
    const tree = stateTree || await this.getTreeRaw(REVIEW_STATE_BRANCH);
    const byPath = new Map(tree.map((entry) => [entry.path, entry]));
    const legacyDescriptor = byPath.get(REVIEW_LEGACY_PATH);
    const pcDescriptor = byPath.get(REVIEW_PC_PATH);
    const mobileDescriptor = byPath.get(REVIEW_MOBILE_PATH);
    const read = async (descriptor) => descriptor?.type === "blob"
      ? this.getBlobTextRaw(descriptor.sha)
      : `${JSON.stringify(emptyProgress(), null, 2)}\n`;
    const [legacy, pc, mobile] = await Promise.all([
      read(legacyDescriptor),
      read(pcDescriptor),
      read(mobileDescriptor),
    ]);
    this.virtualReviewText = mergeProgressText(mergeProgressText(legacy, pc), mobile);
    this.virtualReviewSha = [
      VIRTUAL_REVIEW_SHA_PREFIX,
      legacyDescriptor?.sha || "none",
      pcDescriptor?.sha || "none",
      mobileDescriptor?.sha || "none",
    ].join(":");
    return this.virtualReviewText;
  }

  async getTree(ref = "main") {
    const tree = await this.getTreeRaw(ref);
    if (ref !== "main") return tree;
    try {
      const stateTree = await this.getTreeRaw(REVIEW_STATE_BRANCH);
      await this.buildReviewUnion(stateTree);
      return [
        ...tree.filter((entry) => entry.path !== REVIEW_PROGRESS_PATH),
        { path: REVIEW_PROGRESS_PATH, mode: "100644", type: "blob", sha: this.virtualReviewSha },
      ];
    } catch {
      return tree;
    }
  }

  async getBlobText(sha) {
    if (String(sha || "").startsWith(`${VIRTUAL_REVIEW_SHA_PREFIX}:`)) {
      if (!this.virtualReviewText || sha !== this.virtualReviewSha) await this.buildReviewUnion();
      return this.virtualReviewText;
    }
    return this.getBlobTextRaw(sha);
  }

  async getHead(branch = "main") {
    const ref = await this.request(this.repoPath(`/git/ref/heads/${encodeURIComponent(branch)}`));
    const commitSha = ref.object.sha;
    const commit = await this.request(this.repoPath(`/git/commits/${commitSha}`));
    return { commitSha, treeSha: commit.tree.sha };
  }

  async createBlob(text) {
    return this.request(this.repoPath("/git/blobs"), {
      method: "POST",
      body: JSON.stringify({ content: text, encoding: "utf-8" }),
    });
  }

  async commitFilesRaw({ files, branch, message }) {
    const head = await this.getHead(branch);
    const currentTree = await this.getTreeRaw(head.commitSha);
    const treeByPath = new Map(currentTree.map((entry) => [entry.path, entry]));
    const stale = files.filter((file) => Object.hasOwn(file, "baseSha") && (treeByPath.get(file.path)?.sha || null) !== (file.baseSha || null));
    if (stale.length) {
      throw new Error(`원격 ${branch}에서 이미 변경된 파일이 있습니다. 새로 불러온 뒤 다시 적용하세요:\n${stale.map((item) => item.path).join("\n")}`);
    }

    const treeElements = [];
    for (const file of files) {
      const blob = await this.createBlob(file.text);
      treeElements.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await this.request(this.repoPath("/git/trees"), {
      method: "POST",
      body: JSON.stringify({ base_tree: head.treeSha, tree: treeElements }),
    });
    const commit = await this.request(this.repoPath("/git/commits"), {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [head.commitSha] }),
    });
    await this.request(this.repoPath(`/git/refs/heads/${encodeURIComponent(branch)}`), {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    return {
      commitSha: commit.sha,
      branch,
      htmlUrl: `https://github.com/${this.owner}/${this.repo}/commit/${commit.sha}`,
    };
  }

  async commitReviewProgress(file, message) {
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const head = await this.getHead(REVIEW_STATE_BRANCH);
        const currentTree = await this.getTreeRaw(head.commitSha);
        const descriptor = currentTree.find((entry) => entry.path === REVIEW_MOBILE_PATH && entry.type === "blob");
        const remoteText = descriptor ? await this.getBlobTextRaw(descriptor.sha) : `${JSON.stringify(emptyProgress(), null, 2)}\n`;
        const mergedText = mergeProgressText(remoteText, file.text);
        if (mergeProgressText(remoteText, remoteText) === mergedText) {
          this.virtualReviewText = null;
          this.virtualReviewSha = null;
          return {
            commitSha: head.commitSha,
            branch: REVIEW_STATE_BRANCH,
            htmlUrl: `https://github.com/${this.owner}/${this.repo}/commit/${head.commitSha}`,
            noChange: true,
          };
        }
        const blob = await this.createBlob(mergedText);
        const tree = await this.request(this.repoPath("/git/trees"), {
          method: "POST",
          body: JSON.stringify({
            base_tree: head.treeSha,
            tree: [{ path: REVIEW_MOBILE_PATH, mode: "100644", type: "blob", sha: blob.sha }],
          }),
        });
        const commit = await this.request(this.repoPath("/git/commits"), {
          method: "POST",
          body: JSON.stringify({ message, tree: tree.sha, parents: [head.commitSha] }),
        });
        await this.request(this.repoPath(`/git/refs/heads/${encodeURIComponent(REVIEW_STATE_BRANCH)}`), {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: false }),
        });
        this.virtualReviewText = null;
        this.virtualReviewSha = null;
        return {
          commitSha: commit.sha,
          branch: REVIEW_STATE_BRANCH,
          htmlUrl: `https://github.com/${this.owner}/${this.repo}/commit/${commit.sha}`,
        };
      } catch (error) {
        lastError = error;
        if (attempt >= 3 || !/GitHub API (409|422):/u.test(String(error?.message || error))) throw error;
      }
    }
    throw lastError || new Error("모바일 검수 기록 동기화에 실패했습니다.");
  }

  async commitFilesToBranch({ files, branch = "main", message }) {
    if (!this.token) throw new Error("GitHub에 쓰려면 토큰이 필요합니다.");
    if (!files.length) throw new Error("반영할 변경사항이 없습니다.");

    if (branch !== "main") return this.commitFilesRaw({ files, branch, message });

    const reviewFiles = files.filter((file) => file.path === REVIEW_PROGRESS_PATH);
    const sourceFiles = files.filter((file) => file.path !== REVIEW_PROGRESS_PATH);
    let reviewResult = null;
    let sourceResult = null;

    if (reviewFiles.length) reviewResult = await this.commitReviewProgress(reviewFiles.at(-1), `모바일 검수 기록 동기화 · ${message}`);
    if (sourceFiles.length) sourceResult = await this.commitFilesRaw({ files: sourceFiles, branch: "main", message });

    const result = sourceResult || reviewResult;
    return {
      ...result,
      reviewStateCommitSha: reviewResult?.commitSha || null,
      reviewStateHtmlUrl: reviewResult?.htmlUrl || null,
    };
  }

  async commitDrafts({ drafts, baseBranch = "main", message, branchName }) {
    if (!this.token) throw new Error("GitHub에 쓰려면 토큰이 필요합니다.");
    if (!drafts.length) throw new Error("반영할 수정사항이 없습니다.");
    const head = await this.getHead(baseBranch);
    const currentTree = await this.getTreeRaw(head.commitSha);
    const treeByPath = new Map(currentTree.map((entry) => [entry.path, entry]));
    const stale = drafts.filter((draft) => treeByPath.get(draft.path)?.sha !== draft.baseSha);
    if (stale.length) {
      throw new Error(`원격 main에서 이미 변경된 파일이 있습니다. 새로 불러온 뒤 다시 적용하세요:\n${stale.map((item) => item.path).join("\n")}`);
    }
    const treeElements = [];
    for (const draft of drafts) {
      const blob = await this.createBlob(draft.text);
      treeElements.push({ path: draft.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await this.request(this.repoPath("/git/trees"), {
      method: "POST",
      body: JSON.stringify({ base_tree: head.treeSha, tree: treeElements }),
    });
    const commit = await this.request(this.repoPath("/git/commits"), {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [head.commitSha] }),
    });
    await this.request(this.repoPath("/git/refs"), {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
    });
    return { commitSha: commit.sha, branchName };
  }

  async createPullRequest({ branchName, baseBranch = "main", title, body }) {
    return this.request(this.repoPath("/pulls"), {
      method: "POST",
      body: JSON.stringify({ title, body, head: branchName, base: baseBranch }),
    });
  }
}

export function makeReviewBranchName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const random = Math.random().toString(36).slice(2, 6);
  return `mobile-review/${stamp}-${random}`;
}
