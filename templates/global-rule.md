<!-- MOCHI:BEGIN (managed by Mochi - do not edit inside; use Mochi Settings to update or remove) -->
## Ops Memory

A global knowledge base about my servers and deployments lives at: <OPS_MEMORY_PATH>

After any task that deploys, configures, installs, migrates or changes a server, service, port, version, cron job, nginx/proxy config, or environment variable NAMES (in any project):
1. Update the matching file in `vms/` and `projects/` (create it from `templates/` style if missing): frontmatter `last_updated` (YYYY-MM-DD) and `updated_by: claude-code`, plus the Deployed / Config Notes / Recent Changes sections.
2. Add a dated one-line entry at the top of `changelog/YYYY-MM.md` (newest first).
3. NEVER write secret values (passwords, tokens, keys, connection strings with passwords). Write the variable NAME and where it is stored instead.
4. Keep entries short, factual and in the past tense.
5. If you are unsure which VM or project applies, append a line to `inbox.md` instead of guessing.

Also keep these facts current in the same files when you learn or change them:
6. Storage: a `## Storage` section listing buckets, volumes, disks and databases a VM or project uses (type, name, location, purpose). Names only, never keys.
7. Live site: project frontmatter `vm: <vm-name>`, `domain: <domain>`, `live_url: <url>` and `live: true|false` (true only if it is publicly reachable). A VM file may carry `provider`, `zone`, `machine`, `os`, `ip`.
8. Dev logins: a `## Dev Logins` table with columns `Label | URL | Username | Role | Password | Notes`. The Password cell is ALWAYS the word `keychain` (or `—`), never a real password. When a login is new, tell me to set its password in Mochi (Add → Dev login). Passwords live in the OS keychain.
9. Run `/mochi-sync` inside a project to refresh all of the above for that project.
<!-- MOCHI:END -->
