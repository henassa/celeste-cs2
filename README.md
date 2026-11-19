# Celeste CS2

*(formerly scrimview)*

Free, local-first **demo review and scrim tool for Counter-Strike 2**, built to become a scrim and tracking tool for players, coaches and amateur teams.

Drop a `.dem` (or a FACEIT `.dem.zst` / `.dem.gz`) and watch the round on the radar: positions, view direction, health, weapons, utility (smokes, molotovs, flashes, HE with trajectories), bomb, kill feed and a round timeline.

**Your demos never leave your computer.** Parsing runs in your browser (WebAssembly, in a Web Worker). No account, no upload, no analytics, no external fonts or CDNs.

## Install

- **Desktop app (Windows)**: download `Celeste-CS2-…-x64-nsis.exe` (installer) or `…-portable.exe` from the [Releases](../../releases) page. On first launch an assistant offers to build the **3D maps and real player models from your own CS2 install** (competitive pool, the other maps of the game and your workshop maps; pick the ones you want), and to declare your team. Everything can be changed later in **Settings**. Generated files live in `%APPDATA%/Celeste` (the data of an older scrimview install is picked up automatically) (the large game exports can be moved to another disk or deleted once the maps are built).
- **Browser**: the same app runs as a static site on GitHub Pages (or any static host, `npm run build`). It can be **installed** like an app from Chrome / Edge (desktop and Android: menu → *Install app* / *Add to Home screen*) and then works **offline**. The 3D maps are prepared with the command line (see *3D map models*).
- **Android**: download `Celeste-CS2-….apk` from the Releases page and open it on your phone (allow installing apps from your browser or file manager when Android asks). The phone layout keeps what works well on a small screen: replay on the radar with the drawing tools folded away, library, analysis, match prep, playbook and calendar; the side team panels, the overlay view and keyboard shortcuts stay on desktop. Large demos (200 MB+) need a recent phone with plenty of memory.

## Features

### Dashboard, team and settings

- **Language**: English and French (Settings → Display, or *Language* in the command palette). Automatic by default, from the system language. Texts are written in English in the code and go through `t()` (`src/i18n/`); the French dictionary is keyed by the English text, so a missing translation simply shows the English one
- **Team profiles**: one profile per team you play or coach, switched from the top of the sidebar (or Settings → My team). Each profile has its own name, logo, roster, playbook, calendar, reviews, VODs, boards and match-prep notes; the demo library, 3D maps and settings are shared. An existing install becomes the first profile, nothing is moved
- **Dashboard**: open a demo, your team's last matches (W/L, score), form per map, the players of your roster (rating, ADR, KAST), shortcuts to the training plan, the nade finder, the anti-strat brief and the boards
- **My team** (Settings): name, logo and players (by SteamID, picked from your library or from a team detected automatically); the dashboard and the sidebar follow it
- **3D maps & models** (Settings, desktop app): choose the maps to build in 3D with an estimated size for each one (3D file kept, temporary exports, free space), the detail level (standard, full scenery, every polygon), install the player models, follow the progress, see and free the disk space
- Sidebar in sections: Analysis, Strategies, Team, Scout, Settings
- **Playbook**: your strats per map and side (default, execute, retake, setup, pistol, anti-eco): the call, the role of each player, the utility with its setpos, linked boards, and the demo rounds where you played it (from a replay: Ctrl K → “Add this moment to the playbook”); export / import a playbook file to share it with the team
- **Reviews**: every review session across your demos (round notes, markers, drawings, playlists, linked VOD), searchable, one click to reopen the demo at the right round, export the `.scrim` file
- **VOD sync** (VOD panel of the replay): link the YouTube or Twitch video of the match, tell once which VOD time matches the current moment, then the video follows the replay (jumps, pause, play, speed). In the desktop app the video opens in its own window
- **Calendar**: scrims, officials, practices and reviews per day, with the demos of your library on their day; the next events show on the dashboard

- CS2 demos from Valve matchmaking / Premier, FACEIT (`.dem.zst` decompressed in the browser), HLTV
- Players with view cones, HP, armor, money, main weapon, utility and bomb/kit, shown with weapon and equipment icons (team panels, kill feed, weapon stats)
- Grenade trajectories, smoke and fire areas with remaining time, flash and HE bursts
- Bomb carried / dropped / planted / defused / exploded
- Kill feed (headshot, wallbang, through smoke, no-scope, blind, flash assist) with the callout of each kill; click a kill (feed or timeline) to replay from 3 s before
- Copy a player's `setpos` / `setang` to stand at the same spot in game (follow a player, then the crosshair button)
- Win probability curve for the round under the timeline (win model trained on your library when calibrated, default model otherwise)
- Moments: clutches, 4Ks and aces, the most decisive kills, rounds lost while players up, eco wins, team kills, defuses under pressure, detected automatically; click one to replay it
- Grenades view: every grenade of the match with its trajectory, thrower spot, landing callout and how it was thrown (standing, walking, running, jump, crouched); filter by type, team, side, round and landing spot; copy the exact `setpos` / `setang` of the throw, or watch it in the replay
- Voice comms: when the demo recorded team voice (usually FACEIT, never Valve matchmaking), **Voice** extracts it and plays it in sync with the replay (pause, seek, speeds up to 2×), with a speaking indicator (panel, team panels and sound waves on the radar), mute, solo and volume per player. Opus is decoded by the browser (WebCodecs: Chrome, Edge, recent Firefox), one round at a time to keep memory low; nothing is uploaded
- Round overlay: all CT or T rounds of a team play at once on the radar, synced on the end of the freeze time, with trails, deaths, plants and smokes; double-click a round to open it
- Round strip (winner, reason), round scrubber with kills and plant markers
- Speeds 0.25× to 8×, follow a player (camera follows when zoomed), zoom and pan, two-level maps (Nuke, Vertigo, Train…)
- **Replay in 3D**: same layout as the 2D replay (team panels, kill feed, side panel, timeline), players as articulated silhouettes holding their current weapon (extruded from the weapon icons), animated from the demo: stride from the real speed, aim follows the view angle, crouching, planting and defusing, grenades (visible in hand and in flight, trajectories; smokes fill the real map volume like CS2's volumetric smokes — voxels spreading from the landing point, blocked by walls, stretching along corridors — and molotov fire spreads over the floors, climbing steps and flowing down slopes; flash and HE bursts), your drawings (draw directly on the 3D map with the same tools: they are the same annotations as in 2D) and the coach's zones; the real map model (the game's collision geometry: floors, walls, stairs, crates, buildings), shaded by height with crisp edges, the radar on the floors; players move in sync with the replay, the camera tracks the followed player and roofs above them are cut away automatically; a height slider cuts the map anywhere (Ancient, Anubis, Cache, Dust2, Inferno, Mirage, Nuke, Overpass, Train, Vertigo)
- shadcn/ui neutral dark design, monochrome

### Navigation and layout

- Sidebar with every page one click away; the open replay stays loaded while you browse the analysis, and comes back at the same moment
- Every page has an address (`#/analysis/heatmaps`, `#/replay/stats`…): browser back / forward, bookmarks and reload work
- Command palette (**Ctrl K**): pages, rounds (type `12`), follow a player, panels, layouts, export, coach
- **3D image quality** (Settings → Display): Auto (measured once when the map loads), High or Performance; it never changes while you play or draw
- **Player colors** (Layout menu): by side (CT / T, monochrome by default) or **by team**, each team keeping its color after half-time; applied to the radar, the 3D replay, the panels and the kill feed
- Replay layout: resize the team panels and the side panel by dragging their edges, hide any panel, move the side panel left or right; presets (Analyst, Caster, Review, Focus) and your own saved layouts; **F** for radar only
- **Presentation mode (P)** for streaming a review: full screen, broadcast scorebar, team panels (H to hide), kill feed, round progress, a caption lower third (K to type it, otherwise the team note of the round), green background option for chroma key; no editing buttons, everything stays on the keyboard (Space, Q/E, 1–0, B to draw), P or Esc to exit

### Scrim tools

- Draw on the radar and in the 3D replay: pen (B), arrow (A), straight line (S), circle (O), rectangle (R), text (I), eraser (X); every color and width one click away, **Shift** for straight lines, 45° steps and squares, right-click or Esc cancels a stroke, a reminder of the gestures while drawing, undo / redo
- Drawings are tied to the moment and the level (visible until round end, or 5 s)
- Timeline markers and notes per round, with indicators on the round strip
- Everything is saved automatically in your browser (IndexedDB), per demo
- Playlist: queue moments to review in order (current moment to round end), reorder, rename, play all; saved with the notes
- Export / import a `.scrim` file to share notes and playlist with your team (they open the same demo and import it: merge or replace)
- Export the current moment as a PNG or a short MP4 / WebM clip, with score, round, clock and kills drawn on it

### Coach (optional AI)

- Shows positions on the map: ask for strong or weak spots and the coach draws zones (strong / weak / note, from its `position_strength` analysis of kills and deaths per callout) on the replay radar, the 3D view and the heatmaps (2D and 3D)
- Available everywhere (**C**): in the replay it works on the open match, on the other pages on your whole library (player history, opponent brief, strategies, veto, training plan)
- The coach looks the data up by itself with local tools (match overview, round detail with kills, callouts and win-probability swings, player and team reports, utility, moments, library, brief, veto) before answering; the tools it used are shown, and rounds it cites (R12) are clickable
- It starts from pre-computed findings (opening duels, trades, retakes, post-plants, AWPer, lurkers, recurring smokes) and CS reference points, and must back every claim with rounds and sample sizes
- Ollama: the context window is raised to 16k tokens (Ollama's default 4k silently cut the match summary, which made answers shallow); recommended models that support tools: `qwen3:8b` (default), `qwen3:14b`, `gpt-oss:20b`. Models without tool support get the full summary instead
- Choose where it runs: **Ollama** on your computer (free, nothing leaves it), **in the browser** with WebLLM (free, local, WebGPU, model downloaded once), or **your own key** for any OpenAI-compatible API (Google Gemini and Groq have free tiers). Settings and keys stay in your browser; the demo file is never sent
- Answers in French, English or the language of your question

### FACEIT (optional, your own key)

- Save a free client-side key from the FACEIT Developer Portal: profile, level and Elo, your recent CS2 matches with FACEIT stats, “In library” when the demo is already imported, and a link to the match room to download the demo in one click
- FACEIT demos are private: automatic download only works if your key has FACEIT Downloads API access (granted on request by FACEIT); otherwise download from the match room and drop the file

### Tactical board

- Plans in steps on any map: CT and T players (numbered, renamable), smokes, molotovs, flashes, HE, bomb, arrows, lines and freehand, 5 colors, a note per step
- A new step copies the players of the current one: play the steps and they slide from one position to the next
- From the replay, **Board** opens the current moment on a new board (alive players, active smokes and fires, planted bomb), then go back to the replay where you left it
- Saved in your browser; export a step as PNG, export / import a `.board` file to share it
- Shortcuts: V move, C / T players, S smoke, M molotov, F flash, H HE, B bomb, A arrow, L line, P pen, X eraser, ← → steps, Space play, Del remove, Ctrl+Z / Ctrl+Y

### Match stats

- **Details**: economy chart (equipment value of both teams per round, bank, winner; click a round to watch it) and win rate by buy type, also against full buys; weapons (kills, headshots, damage, accuracy) and where each player's hits land (head, chest, stomach, arms, legs); utility effectiveness (enemies blinded per flash, blind time, blinded enemies then killed by the team, teammates flashed, damage per HE and per molotov); duel matrix (kills–deaths and damage difference for every pair of opponents). The coach can read all of it
- Aim and duels: accuracy, shots fired while stopped (counter-strafe), time to kill, one-hit kills, duels won when hitting first or hit first; reaction time and crosshair placement measured on demand from the server's “spotted” flag with exact angles around each duel (a few seconds), saved to the library for training plans

- K, D, A, +/−, ADR, KAST, HS%, opening kills/deaths, trades, clutches (1v1…1v5), multi-kill rounds, utility damage, enemies flashed, flash assists, grenades thrown
- Summary cards: momentum (longest streak, comeback), impact player (round swing), economy upsets (rounds won on a weaker buy), site pressure on T side
- Filter by side (CT / T), sort by any column
- Kills, deaths and headshots match the in-game scoreboard stored in the demo; damage within 2 % (checked in the tests)
- Ratings:
  - **HLTV 1.0**: public formula
  - **HLTV 2.0≈**: community approximation (HLTV never published the formula)
  - **Swing**: average change in round win probability per round, from an open, documented model (`src/stats/win-probability.ts`)
  - **HLTV 3.0≈**: HLTV's model is private; scrimview fits an estimate on real HLTV values you add in the library, and shows the measured error

### Library and rating calibration

- Add many demos at once (files or a whole folder): each one is parsed locally, one after the other, and only a summary is kept (stats, rounds, kills and positions with callouts, about 100 KB per match) in your browser
- Opening a demo also adds it to the library
- Back up the whole library (matches, stats, reference ratings) to a JSON file and restore it on any browser or computer
- For any match, paste the scoreboard copied from its HLTV page: players are matched by name, ratings are read automatically and can be corrected
- Calibrate: a ridge regression on your stats approximates HLTV 3.0; the error is measured by leaving one match out at a time and shown next to the 2.0≈ baseline
- Calibration inputs include eco-adjusted kills and damage (a kill against a better-equipped opponent is worth more), as HLTV 3.0 does
- Win model: with 150+ rounds of demos from this version, calibration also trains a round win-probability model on your own rounds (logistic regression on players alive, bomb, time and equipment) and derives each player's win probability added (WPA) by kills and deaths. It is used only if it lowers the cross-validated error by a measurable margin; the calibration card says whether it was kept
- A default HLTV 3.0 calibration ships with the app (22 pro maps, 217 players, average error ±0.09, 84 % of players within ±0.15); your own calibration replaces it
- Export / import the calibration (`scrimview-calibration.json`, a few KB) to share it, or export the raw calibration data for offline analysis

### Multi-demo analysis

Everything below is computed in your browser from the library (each match keeps a compact spatial summary: kills, deaths, grenades, player positions 10/20/30/45/60 s after freeze time, economy and bomb site per round).

- **Players**: stats across all your demos (by SteamID, weighted by rounds), filter by map and side; profile with progression over time (3.0≈, 2.0≈, ADR, KAST), per-map results, head-to-head comparison
- **Teams**: detected automatically from rosters (3+ shared players); map record, round win rate on CT / T, pistol rounds, win rate by buy type (full / force / eco), after the opening kill or death, plant rate and A/B split, post-plant and retake win rates, utility per round
- **Training**: a training plan per player from their demos: weak points with their evidence (crosshair placement, first-shot speed, shooting while moving, accuracy, opening duels, utility, KAST; minimum sample sizes enforced), drills for each, a 30–45 min plan for today, the player's own recurring lineups with setpos, and their opening deaths to rewatch in a row; copy as Markdown
- **Nade finder** (in Lineups): click the map where you want a grenade to land, or where you stand; every throw of your demos that lands (or starts) within the search radius is listed closest first, with its trajectory, technique, setpos and a link to the round
- **Series**: BO3 / BO5 found automatically (same two rosters within a few hours, or files named “…-m1”, “…-m2”): score per map, CT / T halves, cumulative player stats and the series MVP
- **Strategies**: rounds that look alike grouped automatically (T executes, CT setups) from positions at 20–30 s, smokes and mollies of the first 40 s, plant site and timing; each group gets a readable name, its frequency, win rate and habit level, the density of positions, and its rounds one click away (the most typical first)
- **Rounds**: filter every round of the library by side, result, opening duel won or lost, bomb site, own and opponent buy, situation (second round after pistol, anti-eco, player advantage or disadvantage, 1vX) and the callout of the opening duel; summary (win rate, opening duels, conversion, plants), tendencies marked as habit, recurring or one-off (with a small-sample warning), and the list of rounds. Click a round to open it in the replay (you pick the demo file again: demos are never stored); the other filtered rounds of that map then play in a row
- **Lineups**: grenades grouped by throw spot and landing spot across all your demos (same filters as Rounds), with how often and on how many maps they were thrown (habit, recurring, one-off), the most typical throw's `setpos`, and each occurrence one click away
- **Match prep** (Scout → Match prep, or “Prepare” on a calendar event): pick the team you play next and get a full prep from your demos. *Overview*: recent form, map pool against yours (declare your roster in Settings → My team), suggested BO1 / BO3 veto and key players. *Per map*: findings ranked by how far they are from the reference (the average of the other teams in your library, or typical values when the library is too small) and how often they happen, each with its sample size, a **NEW** badge when the tendency comes from their last maps, a counter idea, the matching rounds across demos to watch back to back, and a “Counter-strat” button that creates a Playbook strat tagged with the opponent (with the rounds as clips); their T and CT sides by economy (pistol / eco / force / full: win rate, A/B plants, plant time, where they stand at 20 s); first-contact and plant timings against the reference; detected executes and setups; player cards (role, rating, openings, clutches, favourite spots on each side, AWP spots). *Game plan*: your notes per map and the linked counter-strats. Copy everything as Markdown, or download a prep file your teammates import in Celeste (notes included). The AI coach can read the prep too (`match_prep`)
- **Brief**: an anti-strat brief for a team on a map, built from your demos: key points written from simple, readable rules (site preference, plant timing, opening-duel dependence, entry and AWP players, buys after a lost pistol, CT setups, retakes, recurring grenades), each with its sample size; results, T and CT tendencies, recurring grenades and players with roles backed by evidence (AWP share, opening duels, lurking distance at 30 s, CT anchor spot, flashes, trades). Copy it as Markdown (Discord, Notion), download a `.md`, or print / save as PDF
- **Veto**: map pool of your team against an opponent on the Active Duty maps (editable pool): maps won, rounds won on CT / T, last played, an estimated edge per map (small samples pulled toward 50 %, maps never played count as 45 %), and a simulated BO1 / BO3 veto where each side bans its worst map and picks its best. Demos don't record real picks and bans, so this works from the maps actually played
- **Heatmaps**: smooth density (gaussian kernel, robust normalization so one hotspot does not hide the rest) with contour lines and a legend; sliders for radius, intensity, cut-off and opacity, linear / √ / log scale, saved in your browser; mono, blue or orange single-hue scales; a real 3D view on the modelled map (density laid on the floors, events at their height), and a simpler 3D view for other maps; a timing heatmap (callouts × round clock: when each zone sees fights); kills, deaths, positions at a given time (default setups) and grenade landings, for everyone, a team or a player, by side and level, by time window (0–20 s, 20–45 s, 45 s+, post-plant), restricted to the filtered rounds; density or dots; save as PNG

### Shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | −5 s / +5 s (Shift: 1 s) |
| Q / E | Previous / next round |
| ↑ / ↓ | Speed up / down |
| 1–5, 6–0 | Follow a player (left team, right team) |
| Esc | Stop following |
| N / T / L | Names / grenade trails / switch level |
| V / B / A / X | Select, pen, arrow, eraser |
| M | Add a marker |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Mouse wheel, drag, double-click | Zoom, pan, reset view |
| F | Focus: radar only |
| P | Presentation mode (H team panels, K caption) |
| G / C | Moments / coach panel |
| Ctrl K | Command palette |
| ? | All shortcuts |
| [ | Collapse the sidebar |

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests + real-demo tests (see below)
npm run build      # static site in dist/
npm run desktop    # build, then open the desktop app (Electron)
npm run desktop:dev   # desktop app on the Vite dev server (hot reload)
npm run dist:win   # Windows installer + portable .exe in release/
```

The desktop app (`electron/`) loads the same build through an `app://` protocol that also serves the files generated on the machine (`geo/`, `anim/`, `maps/` from the user data folder), and runs the extraction scripts (`scripts/`) with Electron's own Node: no separate Node install for users. Pushing a tag `vX.Y.Z` builds the Windows installer and a Linux AppImage on GitHub Actions and attaches them to a draft release (`.github/workflows/release.yml`). Set the repository address in `src/app/project.ts` for the About links.

The extraction scripts read these environment variables (the desktop app sets them): `SCRIMVIEW_ASSETS` (where `geo/`, `anim/`, `maps/` are written, `public/` by default), `SCRIMVIEW_WORK` (game exports, `map-sources/`), `SCRIMVIEW_TOOLS` (Source2Viewer-CLI, `tools/`), `SCRIMVIEW_CS2` (CS2 folder). `npm run maps:extract -- --list` prints the installed maps (game and workshop) as JSON; `-- --all` builds all of them; `-- "name=<path to .vpk>"` builds one workshop map, with its calibration read from the map's own overview file.

### Building a big library (HLTV packs, folders of demos)

`npm run library:build -- "<folder>"` analyses every demo of a folder and its sub-folders (`.dem`, `.dem.gz`, `.dem.zst` and `.rar` archives such as HLTV's, extracted one demo at a time) on several cores, and writes `scrimview-library.json`: import it in the app with Library → Restore. Only the summary of each match is kept (about 150 KB per match). Run it again on the same output to add new demos: those already analysed are skipped, and progress is saved every 30 s. Options: `--out=pro.json`, `--workers=N` (4 at most by default: one analysis can use 1–2 GB of memory).

### Testing with real demos

Demos are not stored in the repository. Put `.dem` files in `tests/demos/` (or point `SCRIMVIEW_DEMOS` to a folder) and run `npm test`.
Optional `<name>.expect.json` files next to a demo pin hand-verified values (map, number of rounds, final score).

`npm run dump -- path/to/demo.dem [roundIndex]` prints a debug summary of a parsed demo.

`PREP_AUDIT=<folder of .dem, or a library backup .json> npx vitest run tests/prep-audit.test.ts` writes every match-prep finding of every team and map to `/tmp/prep-audit.txt` (or `PREP_AUDIT_OUT`), to review thresholds on a real library.

### 3D map models

Two sources, per map, both turned into `public/geo/<map>.bin.gz` by `scripts/build-geometry.mjs`:

- **From your CS2 install (faithful)**: `npm run maps:extract` finds CS2 through Steam, downloads Source2Viewer-CLI into `tools/` once, exports each map of the pool (`maps/<map>.vmap_c`: world geometry and props, with materials) and its radar to `map-sources/`, then builds the models: real visible geometry and props, in the app's monochrome look (`--colors` keeps the average color of each material), tool brushes / sky / decals / alpha cards removed, simplified to at most 650k triangles within about 1.5 units with open edges locked (no spikes or holes). Fences, railings, grates, foliage and glass are kept and drawn see-through (without textures an opaque surface would hide the view). Options: `-- --full` (complete maps: the scenery around the playable areas, foliage and fences, up to 1.5M triangles), `-- --complete` (every single polygon of the map: no simplification and no trimming, only the 3D skybox far away is removed; files of 50 to 150 MB per map and a heavier 3D view, meant for a good graphics card), `-- de_mirage de_nuke` (some maps), `--cs2="<folder with game/csgo>"`, `--tris=600000`, `--error=0.0002`, `--force` (export again after a map update). Everything stays on your machine; `map-sources/` and `tools/` are ignored by git. Expect a few minutes and several hundred MB of export per map.
- **Without CS2 (fallback, shipped)**: collision meshes and radars from [awpy-data](https://github.com/pnxenopoulos/awpy-data) releases: `node scripts/build-geometry.mjs <geometry dir> <radars dir>`. Coarser (already decimated by awpy, no colors).

### Player animations (from your CS2 install)

`npm run anims:extract` exports the player skeleton (`animation/skeletons/characters/worldmodel`) and the world-model animation clips (idle, walk, run and crouch in four directions for rifle, pistol and knife, grenade hold and throw, planting, defusing, death) with Source2Viewer-CLI, and tries to find an agent body mesh. `scripts/build-anims.mjs` turns them into `public/anim/players.json.gz` (three.js clips, forward motion removed since positions come from the demo). The 3D replay then plays the real animations, picked from the demo (speed, movement direction relative to the view, crouching, planting, defusing, weapon class), on the agent body if one was found, otherwise on a monochrome mannequin built on the real skeleton. Without the pack, the articulated silhouettes are used and the 3D view says so. The pack is generated on your machine and is not part of the source zip: after unzipping a new version in another folder, run `npm run assets:import -- "<old folder>"` to copy the player models, the 3D maps, the game exports and the tools from the old version instead of extracting everything again.

### WebAssembly parser

`src/parser/wasm/` contains [demoparser2](https://github.com/LaihoE/demoparser) compiled to WebAssembly with a small local patch (`wasm/patches/`). To rebuild it: `wasm/build.sh` (needs Rust with the `wasm32-unknown-unknown` target and `wasm-pack`).

### Architecture

```
src/parser/   demoparser2 (WASM) calls, worker, MatchData builder (pure, tested in Node)
src/data/     compact match format (typed arrays, transferable without copy)
src/viewer/   playback state, interpolation, canvas renderer
src/components/  React UI (shadcn/ui + Tailwind)
src/stats/    match stats, ratings, win probability model
src/library/  local match library (stats + spatial summaries)
src/analysis/ multi-demo aggregates: players, teams, heatmaps
src/calib/    reference ratings paste parser, rating calibration
src/scrim/    scrim notes: drawings, markers, notes, local storage, exports
src/maps/     radar calibration
```

Positions are sampled at 16 Hz (every 4 ticks) and interpolated at render time. A 30-round demo stays well under 100 MB in memory.

## Deployment

- **GitHub Pages**: the site is fully static. `.github/workflows/deploy.yml` type-checks, tests, builds and publishes to GitHub Pages on every push to `main` (in the repository: Settings → Pages → Source: *GitHub Actions*). The site works under any sub-path (`https://<user>.github.io/<repo>/`), registers a service worker for offline use and a web manifest so it can be installed.
- **Desktop**: pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml` (Windows installer + portable, Linux AppImage) into a draft release.
- **Android**: the same tag runs `.github/workflows/android.yml` (Capacitor, `android/`): a debug-signed `.apk` you can install directly. To sign with your own key (so updates install over the previous version), add the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Locally: `npm run android:sync` then `npm run android:open` (Android Studio), or `npm run android:apk` with the Android SDK and JDK 21.

## License


MIT, see [LICENSE](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Counter-Strike is a trademark of Valve Corporation. This project is not affiliated with Valve.
