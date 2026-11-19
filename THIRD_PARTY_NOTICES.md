# Third-party notices

scrimview bundles or derives from the following projects. Their licenses apply to the corresponding files.

| Component | Use | License |
|---|---|---|
| [demoparser2](https://github.com/LaihoE/demoparser) by LaihoE | CS2 demo parsing, compiled to WebAssembly (`src/parser/wasm/`, local patch in `wasm/patches/`) | MIT (`src/parser/wasm/LICENSE-demoparser2`) |
| [CS Demo Manager](https://github.com/akiver/cs-demo-manager) by AkiVer | Radar calibration values (`src/maps/maps.json`), radar images (`public/maps/`, converted to WebP) and weapon / equipment icons (`src/assets/icons/`) | MIT (`public/maps/LICENSE-cs-demo-manager`) |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | UI components (`src/components/ui/`) | MIT |
| [Radix UI](https://github.com/radix-ui/primitives) | Accessible UI primitives | MIT |
| [lucide](https://github.com/lucide-icons/lucide) | Icons | ISC |
| [fzstd](https://github.com/101arrowz/fzstd) | Zstandard decompression of `.dem.zst` files | MIT |
| [WebLLM](https://github.com/mlc-ai/web-llm) by MLC AI | Optional in-browser language model for the coach, loaded only when chosen | Apache-2.0 |
| [three.js](https://github.com/mrdoob/three.js) | 3D maps (heatmaps, replay), loaded only when a 3D view opens | MIT |
| [awpy-data](https://github.com/pnxenopoulos/awpy-data) by Peter Xenopoulos | Collision meshes of the maps, converted to the 3D models (`public/geo/`, built by `scripts/build-geometry.mjs`) | Build scripts MIT; the meshes are Valve game assets |
| [Source 2 Viewer (ValveResourceFormat)](https://github.com/ValveResourceFormat/ValveResourceFormat) | Map export from the user's own CS2 install (`npm run maps:extract`, downloaded on demand, not shipped) | MIT |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) by Arseny Kapoulkine | Simplification of the map models at build time (not shipped) | MIT |
| [Geist, Geist Mono](https://github.com/vercel/geist-font) | Fonts, bundled locally (no font CDN) | SIL Open Font License 1.1 |

Radar images and map collision meshes originate from Counter-Strike 2 game files and remain Valve's property. Counter-Strike is a trademark of Valve Corporation.
scrimview is not affiliated with or endorsed by Valve. FACEIT is a trademark of FACEIT Ltd; scrimview uses its public Data API with the user's own key and is not affiliated with FACEIT.
