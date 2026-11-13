# TinyOffice

Web portal for TinyClaw. TinyOffice provides a browser UI for monitoring and operating your agent system.

## Features

- Real-time dashboard (agents, teams, queue, event feed)
- Web chat console with `@agent` / `@team` routing
- Agent management (create, edit, delete)
- Team management (members + leader)
- Task board (kanban + drag/drop + assign to agents/teams)
- Logs and live events view
- Settings editor for `.tinyclaw/settings.json`
- Office simulation view of agent/team interactions

## Requirements

- Node.js 18+
- Running TinyClaw backend/API (default: `http://localhost:3777`)

## Setup

```bash
cd tinyoffice
npm install
```

## Configuration

TinyOffice reads the backend base URL from `NEXT_PUBLIC_API_URL`.

Default:

- `http://localhost:3777`

If needed, create `tinyoffice/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3777
```

## Run

Development:

```bash
npm run dev
```

Open `http://localhost:3000`.

Production:

```bash
npm run build
npm run start
```

## Scripts

- `npm run dev` - Start Next.js dev server
- `npm run build` - Build production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Backend API network boundary

The TinyClaw backend has **no built-in user authentication**. It binds to `127.0.0.1:3777` by default. Keep the API local unless you have separately configured a trusted reverse proxy with authentication and transport security.

- `TINYCLAW_API_HOST` may explicitly change the bind address. Setting `0.0.0.0` exposes an unauthenticated control plane to reachable network clients; avoid this without an independent access boundary.
- Browser requests are accepted from `http://localhost:3000` and `http://127.0.0.1:3000` by default, to support TinyOffice.
- `TINYCLAW_ALLOWED_ORIGINS` permits explicitly listing additional browser origins as a comma-separated value, e.g. `https://office.example`. This is a browser-origin restriction, **not authentication**.
- Local CLI and channel clients without an `Origin` header remain supported; process-level and local-machine protections are still necessary.

## API Endpoints Used

TinyOffice calls TinyClaw API endpoints such as:

- `POST /api/message`
- `GET /api/agents`
- `PUT /api/agents/:id`
- `DELETE /api/agents/:id`
- `GET /api/teams`
- `PUT /api/teams/:id`
- `DELETE /api/teams/:id`
- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `PUT /api/tasks/reorder`
- `DELETE /api/tasks/:id`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/queue/status`
- `GET /api/responses`
- `GET /api/logs`
- `GET /api/events/stream` (SSE)

## Notes

- TinyOffice is UI-only; it does not replace TinyClaw daemon processes.
- Start TinyClaw first so queue processor, channels, and API are available.
