# Colorado Map App (co-map-app)

## Overview
Internal mapping platform for The Colorado Sun. React + Leaflet frontend, Cloudflare Workers + D1 backend. Supports multiple maps per account, per-map design customization, embeddable iframes, auto-rotate category tours, and focus/category embed URLs.

Deployed automatically to Cloudflare Workers on push to `main`.

## Tech Stack
- React 19 + TypeScript + Vite
- Leaflet / react-leaflet, react-leaflet-cluster
- Tailwind CSS v4, Font Awesome
- Hono (Cloudflare Worker routes), Cloudflare D1 (SQLite)

## Commands
- `npm run dev` — local dev
- `npm run build` — build
- `npm run lint` — lint
- `npm run preview` — preview build

## Conventions
- `main` is protected; work on `feature/<name>` branches, squash-merge PRs.
- Conventional commits.

## Key directories
- `src/` — frontend React app
- `worker/` — Cloudflare Worker / D1 backend
- `public/` — static assets

## Note
Config/credentials for Cloudflare and D1 are via environment variables, not committed.
