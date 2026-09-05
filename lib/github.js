const API = "https://api.github.com";

function bytesFromBase64(value) {
  const normalized = String(value || "").replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class GitHubClient {
  constructor({ owner = "poketony", repo = "FE-Awakening", token = "" } = {}) {
    this.owner = owner;
    this.repo = repo;
    this.token = token.trim();
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

  async getTree(ref = "main") {
    const result = await this.request(this.repoPath(`/git/trees/${encodeURIComponent(ref)}?recursive=1`));
    if (result.truncated) throw new Error("저장소 트리가 너무 커서 GitHub 응답이 잘렸습니다.");
    return result.tree || [];
  }

  async getBlob(sha) {
    return this.request(this.repoPath(`/git/blobs/${encodeURIComponent(sha)}`));
  }

  async getBlobText(sha) {
    const blob = await this.getBlob(sha);
    const bytes = blob.encoding === "base64" ? bytesFromBase64(blob.content) : new TextEncoder().encode(blob.content || "");
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  async getHead(branch = "main") {
    const ref = await this.request(this.repoPath(`/git/ref/heads/${encodeURIComponent(branch)}`));
    const commitSha = ref.object.sha;
    const commit = await this.request(this.repoPath(`/git/commits/${commitSha}`));
    return { commitSha, treeSha: commit.tree.sha };
  }

  async commitDrafts({ drafts, baseBranch = "main", message, branchName }) {
    if (!this.token) throw new Error("GitHub에 쓰려면 토큰이 필요합니다.");
    if (!drafts.length) throw new Error("반영할 수정사항이 없습니다.");

    const currentTree = await this.getTree(baseBranch);
    const treeByPath = new Map(currentTree.map((entry) => [entry.path, entry]));
    const stale = drafts.filter((draft) => treeByPath.get(draft.path)?.sha !== draft.baseSha);
    if (stale.length) {
      throw new Error(`원격 main에서 이미 변경된 파일이 있습니다. 새로 불러온 뒤 다시 적용하세요:\n${stale.map((item) => item.path).join("\n")}`);
    }

    const head = await this.getHead(baseBranch);
    const treeElements = [];
    for (const draft of drafts) {
      const blob = await this.request(this.repoPath("/git/blobs"), {
        method: "POST",
        body: JSON.stringify({ content: draft.text, encoding: "utf-8" }),
      });
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
