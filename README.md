# CoffeCord

CoffeCord is a community-maintained fork of **Equicord** (GPL-3.0-or-later), built to keep the project alive and experiment with new ideas. The code remains heavily based on Equicord and Vencord—huge thanks to their teams and contributors.

## Quick start
- Prereqs: Node 18+, pnpm (see `packageManager` in `package.json`).
- Install deps: `pnpm install`
- Build desktop: `pnpm build`
- Build web: `pnpm buildWeb`
- Inject/repair into Discord: `pnpm inject` (or `pnpm repair` / `pnpm uninject`)
- Dev loop: `pnpm dev` (watches + rebuilds)

## Notes
- This repository lives at `https://github.com/CoffeCord/CoffeCord`.
- Licensed under GPL-3.0-or-later. Because this is a fork of Equicord (also GPL), downstream forks must keep the same license.
- If you open issues, please include platform, build type, and steps to reproduce.

## Credits
- Equicord team and contributors for the original codebase and features.
- Vencord/Vesktop authors for the upstream client mod ecosystem.
