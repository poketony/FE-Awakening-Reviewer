# Security notes

- Never commit a GitHub token into this repository.
- The app intentionally does not persist PATs in Web Storage or IndexedDB.
- Prefer a fine-grained PAT restricted to `poketony/FE-Awakening` with only Contents (read/write) and Pull requests (read/write).
- The app writes through a new review branch and Pull Request, never directly to `main`.
- Before creating a commit, every edited file's original blob SHA is compared with current `main`; concurrent edits cause the publish operation to stop.
- Keep the Content-Security-Policy in `index.html` narrow if new dependencies are added.
