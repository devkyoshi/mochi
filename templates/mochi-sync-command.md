---
description: Update this project's Ops Memory records (VM, storage, live site, dev logins)
argument-hint: [project-name]
---
<!-- MOCHI:COMMAND (managed by Mochi - update or remove it from Mochi Settings) -->
Refresh the Ops Memory records for the project in the current directory. Ops Memory lives at: <OPS_MEMORY_PATH>

Project name: `$ARGUMENTS` if given, otherwise the name of the current repository folder.

Steps:
1. Inspect the project read-only: README, `docker-compose*.yml`, Dockerfiles, `.github/workflows/*`, nginx/proxy config, deploy scripts, `.env.example` (variable NAMES only), seed or fixture scripts (usernames and roles only). Do not run anything that changes a server.
2. Read the current `projects/<name>.md` and the matching `vms/<vm>.md` in Ops Memory (create them in the same style if missing). If you cannot tell which VM or project this is, append one line to `inbox.md` and stop.
3. Update `projects/<name>.md`:
   - frontmatter: `vm`, `domain`, `live_url`, `live: true|false` (true only if the site is publicly reachable), `last_updated` (today, YYYY-MM-DD), `updated_by: claude-code`;
   - `## Deployed`: one bullet per service as `name (how, path): what it does, :port`;
   - `## Storage`: buckets, volumes, disks and databases (type, name, location, purpose; never keys or connection strings);
   - `## Config Notes`: non-secret facts, env var NAMES and where they are stored;
   - `## Dev Logins`: a table `| Label | URL | Username | Role | Password | Notes |`. The Password cell is always the word `keychain` (or `—`). Only list logins you found in the repo (seed data, README); do not invent any.
4. Update the VM file the same way (`provider`, `zone`, `machine`, `os`, `ip`, Deployed, Storage) and bump its `last_updated`.
5. Add one dated line at the top of `changelog/YYYY-MM.md` (newest first) and keep the existing "Recent Changes" bullets.
6. NEVER write secret values: no passwords, tokens, keys or connection strings with passwords. If you see one, mention the variable NAME and where it is stored instead.
7. Finish with a short summary of what changed, and list every dev login that still needs its password set in Mochi (Add → Dev login).
