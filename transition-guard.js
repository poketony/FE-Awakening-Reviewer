(() => {
  const originalFetch = window.fetch.bind(window);
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const immutableResponses = new Map();
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
      const signal = mergeSignals(init.signal || input?.signal || null, transitionController.signal);
      try {
        const response = await originalFetch(input, { ...init, signal });
        if (response.ok) putImmutable(url, response);
        return response;
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
      const context = originalGetContext.call(canvas, "2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
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
    const observer = new MutationObserver(() => {
      if (!toast.textContent.includes("__review_switch_aborted__")) return;
      toast.textContent = "";
      toast.classList.remove("show");
    });
    observer.observe(toast, { childList: true, characterData: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", suppressExpectedAbortToast, { once: true });
  else suppressExpectedAbortToast();
})();
