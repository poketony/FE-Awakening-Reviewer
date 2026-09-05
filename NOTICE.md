# Upstream notice

The in-game preview implementation in `lib/game-renderer.js` is adapted from the rendering approach used by:

- `poketony/FE-Support-Archive` (`assets/game-renderer.js`)
- `poketony/FE-Awakening` Awakening Live Renderer
- the FEITS lineage credited by those projects

The adapted renderer is kept under GPL-3.0-or-later. See `LICENSE`.

The reviewer does **not** bundle Fire Emblem image/font assets. At runtime it reads the assets already stored in `poketony/FE-Awakening` so that the reviewer remains small and follows the repository's current renderer resources.
