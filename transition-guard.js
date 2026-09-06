(() => {
  const originalFetch = window.fetch.bind(window);
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const NativeMutationObserver = window.MutationObserver;
  const immutableResponses = new Map();
  const immutablePending = new Map();
  const shortResponses = new Map();
  const guardedCanvasIds = new Set(["ja-canvas", "ko-canvas"]);
  const passiveMethods = new Set([
    "measureText", "createLinearGradient", "createRadialGradient", "createConicGradient",
    "createPattern", "isPointInPath", "isPointInStroke", "getImageData", "getTransform",
  ]);
  const MAX_IMMUTABLE_CACHE = 96;
  const SHORT_CACHE_MS = 1500;
  let transitionController = new AbortController();

  function inputUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  function requestMethod(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function isImmutableGitHubBlob(url) {
    return /^https:\/\/api\.github\.com\/repos\/poketony\/FE-Awakening\/git\/blobs\/[0-9a-f]+(?:\?.*)?$/iu.test(url);
  }

  function isShortLivedTree(url) {
    return /^https:\/\/api\.github\.com\/repos\/poketony\/FE-Awakening\/git\/trees\/main\?recursive=1$/iu.test(url);
  }

  function mergeSignals(first, second) {
    if (!first) return second;
    if (!second) return first;
    if (typeof AbortSignal?.any === "function") return AbortSignal.any([first, second]);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (first.aborted || second.aborted) controller.abort();
    else {
      first.addEventListener("abort", abort, { once: true });
      second.addEventListener("abort", abort, { once: true });
    }
    return controller.signal;
  }

  function putImmutable(url, response) {
    if (immutableResponses.size >= MAX_IMMUTABLE_CACHE) {
      const oldest = immutableResponses.keys().next().value;
      if (oldest) immutableResponses.delete(oldest);
    }
    immutableResponses.set(url, response.clone());
  }

  window.fetch = async function guardedFetch(input, init = {}) {
    const url = inputUrl(input);
    const method = requestMethod(input, init);
    if (method !== "GET") return originalFetch(input, init);

    if (isImmutableGitHubBlob(url)) {
      const cached = immutableResponses.get(url);
      if (cached) return cached.clone();

      const pending = immutablePending.get(url);
      if (pending) {
        try { return (await pending).clone(); }
        catch (error) {
          if (transitionController.signal.aborted) throw new Error("__review_switch_aborted__");
          throw error;
        }
      }

      const signal = mergeSignals(init.signal || input?.signal || null, transitionController.signal);
      const request = originalFetch(input, { ...init, signal })
        .then((response) => {
          if (response.ok) putImmutable(url, response);
          return response;
        })
        .finally(() => immutablePending.delete(url));
      immutablePending.set(url, request);
      try {
        return (await request).clone();
      } catch (error) {
        if (signal?.aborted) throw new Error("__review_switch_aborted__");
        throw error;
      }
    }

    if (isShortLivedTree(url)) {
      const cached = shortResponses.get(url);
      const now = Date.now();
      if (cached && cached.expires > now) return cached.response.clone();
      const response = await originalFetch(input, init);
      if (response.ok) shortResponses.set(url, { response: response.clone(), expires: now + SHORT_CACHE_MS });
      return response;
    }

    return originalFetch(input, init);
  };

  function currentGeneration(canvas) {
    return Number(canvas.dataset.renderGeneration || 0);
  }

  function bumpCanvasGeneration() {
    for (const id of guardedCanvasIds) {
      const canvas = document.getElementById(id);
      if (!canvas) continue;
      canvas.dataset.renderGeneration = String(currentGeneration(canvas) + 1);
      // 기존 화면은 새 렌더가 완성될 때까지 유지한다. 즉시 clear하면 모바일에서
      // 매 동작마다 빈 화면이 먼저 보여 체감 지연이 크게 느껴진다.
    }
  }

  HTMLCanvasElement.prototype.getContext = function guardedGetContext(type, ...args) {
    const context = originalGetContext.call(this, type, ...args);
    if (type !== "2d" || !context || !guardedCanvasIds.has(this.id)) return context;
    const canvas = this;
    const generation = currentGeneration(canvas);
    return new Proxy(context, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...callArgs) => {
          if (currentGeneration(canvas) !== generation && !passiveMethods.has(String(property))) return undefined;
          return value.apply(target, callArgs);
        };
      },
      set(target, property, value) {
        if (currentGeneration(canvas) !== generation) return true;
        return Reflect.set(target, property, value, target);
      },
    });
  };

  // progress.js는 entry-buttons의 직접 자식 교체만 보면 충분하다. subtree까지 보면
  // 상태 배지를 꾸미며 바뀐 textContent를 다시 감지해 같은 매핑을 반복하게 된다.
  window.MutationObserver = class ReviewerMutationObserver extends NativeMutationObserver {
    observe(target, options = {}) {
      if (target?.id === "entry-buttons" && options.childList) {
        return super.observe(target, { ...options, subtree: false });
      }
      return super.observe(target, options);
    }
  };

  function startFileTransition() {
    transitionController.abort();
    transitionController = new AbortController();
    bumpCanvasGeneration();
  }

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.("#file-select")) startFileTransition();
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target?.closest?.("#entry-buttons .entry-button, #ja-frame-prev, #ja-frame-next, #ko-frame-prev, #ko-frame-next");
    if (target) bumpCanvasGeneration();
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target?.matches?.(".safe-text")) bumpCanvasGeneration();
  }, true);

  const suppressExpectedAbortToast = () => {
    const toast = document.querySelector("#toast");
    if (!toast || toast.dataset.transitionGuardObserved) return;
    toast.dataset.transitionGuardObserved = "true";
    const observer = new NativeMutationObserver(() => {
      if (!toast.textContent.includes("__review_switch_aborted__")) return;
      toast.textContent = "";
      toast.classList.remove("show");
    });
    observer.observe(toast, { childList: true, characterData: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", suppressExpectedAbortToast, { once: true });
  else suppressExpectedAbortToast();
})();
