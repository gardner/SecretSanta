# Secret Santa

A Secret Santa organizer built with TypeScript, Express, and a browser frontend.

![Secret Santa app](public/screenshot.png)

## Run locally

Requires Node.js 24 or newer and pnpm 10.18.3 (`corepack enable`).

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm build
pnpm start
```

Open <http://localhost:8003>. The server loads `.env` automatically. Set `BASE_URL`
to the public HTTP(S) origin before sharing invitations; it must not include a path.
If omitted, it defaults to `http://localhost:${PORT}`. `PORT` defaults to 8003.
`DATA_DIR` optionally overrides the default `data/` directory.

`pnpm dev` builds the browser code and watches the server. After changing browser
TypeScript, run `pnpm build:client` and reload the page.

## Use

Create a party with 2–50 unique guest names, an optional budget, and optional gift
criteria. Share each personal invitation only with its intended guest. Possession
of a guest URL grants access to that assignment; organizers receive every URL.
There is no party-ID/name endpoint for reading assignments.

All assignments are drawn uniformly from permutations with no self-assignments
and persisted when a party is created. Mutual pairs and smaller cycles are allowed;
existing assignments are never redrawn. Names and
gift criteria are displayed as text, including punctuation and Unicode.

## Storage and migration

The app stores parties, invitation tokens, and assignments together in
`data/state.json`. Writes are serialized, flushed to a temporary file, and renamed
atomically, then the parent directory is synced before reporting success. If a
rename completes but durability cannot be confirmed, further writes are blocked
until restart so stale in-memory state cannot overwrite that commit. The previous
snapshot is kept in `state.json.backup`; only one backup is retained.

Run **one server process per data directory**, on a local filesystem supporting
atomic rename and directory syncing (the Linux Docker deployment supports both).
This file store does not support multiple replicas. Keep a separate
backup for disaster recovery; atomic replacement does not guarantee survival of
all hardware or filesystem failures.

On first startup, existing `parties.json`, `assignments.json`, and
`guest_links.json` are migrated together. Existing invitations and assignments are
preserved, and previously unassigned parties receive assignments during migration.
The known legacy `__proto__` assignment omission is repaired only when the missing
recipient can be uniquely inferred without changing any saved assignment.
Legacy files are left intact. Stop the old server before migrating and back up its
data directory. Missing, corrupt, or inconsistent storage prevents startup rather
than silently discarding records. A `state.initialized` marker and the backup
prevent a missing current snapshot from triggering a stale legacy migration.
An interrupted first write may leave only this marker: inspect and recover the
data before restarting, rather than deleting the marker to bypass this check.
To restore a snapshot, stop the server, preserve
the damaged files for investigation, and replace `state.json` with a known-good
backup before restarting.

Guest lookups use a token index and return only the requested assignment. New
parties are validated against committed IDs; backup bytes are cached rather than
read back on every save. Snapshot serialization and writes still scale with total
stored history; use a transactional database if that becomes a bottleneck.

## Docker

```sh
docker compose up --build -d
```

Compose reads `.env` and retains the existing `./data:/app/data` bind mount so
existing installations migrate in place. Back up `./data` before upgrading.
Set `BASE_URL` to the public origin, including the published port when applicable.
Creation is limited to ten successful or in-flight parties per minute per
connection IP. Invalid inputs and failed saves do not consume that quota. A
separate ceiling of 60 creation requests per minute limits repeated failures and
abuse. Behind a reverse
proxy this limit is shared; guest reads are not subject to that creation limit.

## Quality checks

```sh
pnpm check
```

This runs strict TypeScript checking, type-aware ESLint, Prettier verification,
regression tests, and production builds. ESLint enforces cyclomatic complexity of
at most 10 and at most 500 nonblank, noncomment lines per TypeScript file.
TypeScript enables unchecked-index detection, exact optional properties, unused
code checks, and implicit-return checks. TypeScript 6.0 is used to stay within the
supported range of the installed typescript-eslint release.

The analysis requirements in `AGENTS.md` link to Python tooling; this repository
uses the corresponding TypeScript tools. CI enforces all checks. Optional local
pre-commit hooks use the same tools:

```sh
uv tool install pre-commit
pre-commit install
pre-commit run --all-files
```

Use `pnpm format` to format changes. Tests use temporary directories and never
modify production data. They cover concurrency, persistence failures, restart
stability, migration, invitation privacy, and unusual names.
