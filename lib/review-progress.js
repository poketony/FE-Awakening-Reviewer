export const PROGRESS_VERSION = 1;

export function emptyProgress() {
  return {
    version: PROGRESS_VERSION,
    knownIds: { main: [], dlc: [] },
    files: {},
  };
}

export function parseProgress(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return emptyProgress();
    return {
      version: PROGRESS_VERSION,
      knownIds: {
        main: uniqueStrings(parsed.knownIds?.main),
        dlc: uniqueStrings(parsed.knownIds?.dlc),
      },
      files: normalizeFiles(parsed.files),
    };
  } catch {
    return emptyProgress();
  }
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function normalizeFiles(files) {
  if (!files || typeof files !== "object") return {};
  const output = {};
  for (const [id, file] of Object.entries(files)) {
    if (!id || !file || typeof file !== "object") continue;
    const expected = uniqueStrings(file.expected);
    const done = {};
    if (file.done && typeof file.done === "object") {
      for (const [key, value] of Object.entries(file.done)) {
        if (!key || !value) continue;
        done[key] = typeof value === "string" ? value : new Date(0).toISOString();
      }
    }
    output[id] = {
      mode: file.mode === "dlc" ? "dlc" : "main",
      expected,
      done,
    };
  }
  return output;
}

export function rememberCatalog(progress, mode, ids) {
  const target = mode === "dlc" ? "dlc" : "main";
  const known = new Set(progress.knownIds[target] || []);
  for (const id of ids || []) if (id) known.add(String(id));
  progress.knownIds[target] = [...known];
  return progress;
}

export function rememberExpected(progress, { mode, fileId, labels }) {
  if (!fileId) return progress;
  const file = ensureFile(progress, mode, fileId);
  const unique = uniqueStrings(labels);
  if (unique.length) file.expected = unique;
  return progress;
}

export function setEntryDone(progress, { mode, fileId, entryKey, done, at = new Date().toISOString() }) {
  if (!fileId || !entryKey) return progress;
  const file = ensureFile(progress, mode, fileId);
  if (done) file.done[entryKey] = at;
  else delete file.done[entryKey];
  return progress;
}

function ensureFile(progress, mode, fileId) {
  if (!progress.files[fileId]) {
    progress.files[fileId] = {
      mode: mode === "dlc" ? "dlc" : "main",
      expected: [],
      done: {},
    };
  }
  return progress.files[fileId];
}

export function isEntryDone(progress, fileId, entryKey) {
  return Boolean(progress.files?.[fileId]?.done?.[entryKey]);
}

export function fileProgress(progress, fileId) {
  const file = progress.files?.[fileId];
  if (!file) return { expected: 0, done: 0, fraction: 0, state: "incomplete" };
  const expected = uniqueStrings(file.expected);
  const done = expected.length
    ? expected.filter((key) => file.done?.[key]).length
    : Object.keys(file.done || {}).length;
  const fraction = expected.length ? Math.min(1, done / expected.length) : 0;
  const state = expected.length && done >= expected.length
    ? "complete"
    : done > 0
      ? "progress"
      : "incomplete";
  return { expected: expected.length, done, fraction, state };
}

export function modeProgress(progress, mode) {
  const target = mode === "dlc" ? "dlc" : "main";
  const ids = uniqueStrings(progress.knownIds?.[target]);
  let weighted = 0;
  let complete = 0;
  let inProgress = 0;
  for (const id of ids) {
    const file = fileProgress(progress, id);
    weighted += file.fraction;
    if (file.state === "complete") complete += 1;
    else if (file.state === "progress") inProgress += 1;
  }
  const total = ids.length;
  const percent = total ? Math.round((weighted / total) * 100) : 0;
  return { total, complete, inProgress, percent };
}

export function completedToday(progress, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  let count = 0;
  for (const file of Object.values(progress.files || {})) {
    for (const timestamp of Object.values(file.done || {})) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) count += 1;
    }
  }
  return count;
}

export function progressMessage(percent) {
  if (percent >= 100) return "전부 끝냈다. 검수 완료.";
  if (percent >= 75) return "75% 돌파. 이제 끝이 꽤 가깝다.";
  if (percent >= 50) return "절반 넘겼다. 숫자가 확실히 줄고 있다.";
  if (percent >= 25) return "25% 돌파. 진행도가 눈에 보인다.";
  if (percent >= 10) return "시동은 걸렸다. 이 페이스 그대로.";
  if (percent > 0) return "좋다. 숫자가 오르기 시작했다.";
  return "첫 완료 체크 하나부터 찍자.";
}
