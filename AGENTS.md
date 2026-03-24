# AGENTS.md

## Cursor Cloud specific instructions

**NEUMA** is a React + Vite SPA for 3D foot scanning and custom shoe fitting. Single `package.json`, no monorepo, no database.

### Key commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server (HTTP) | `npm run dev` (port 5173, `--host`) |
| Dev server (HTTPS) | `npm run dev:https` (needed for camera on mobile) |
| Lint | `npm run lint` |
| Build | `npm run build` |

### Notes

- The Vite dev server includes mock API middleware for all `/api/*` endpoints, so **no external services or env vars** are required for local development.
- `strictPort: true` is set in `vite.config.js`; if port 5173 is occupied the server will fail instead of auto-incrementing. Kill any stale process on 5173 before starting.
- ESLint has 3 pre-existing errors (2 unused vars in `App.jsx`, 1 `process` undef in `vite.config.js`) and 2 warnings. These are in the existing codebase and not regressions.
- For real Google Drive uploads, configure `.env.local` per `docs/GOOGLE_DRIVE.md` and use `npx vercel dev` instead of `npm run dev`.
- The `@ar-js-org/aruco-rs` WASM package is excluded from Vite's `optimizeDeps` to prevent pre-bundle issues.
- No automated test suite exists in this project; verification is done via lint and build.
