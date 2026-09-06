const TOKEN_KEY = "fe-awakening-reviewer:github-token:v1";

const tokenInput = document.querySelector("#token");

if (tokenInput) {
  const savedToken = localStorage.getItem(TOKEN_KEY) || "";
  if (savedToken && !tokenInput.value) tokenInput.value = savedToken;

  const persistToken = () => {
    const token = tokenInput.value.trim();
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  };

  tokenInput.addEventListener("input", persistToken);
  tokenInput.addEventListener("change", persistToken);
}
