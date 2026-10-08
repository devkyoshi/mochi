<!-- MOCHI:BEGIN (managed by Mochi - do not edit inside; use Mochi Settings to update or remove) -->
## Ops Memory

A global knowledge base about my servers and deployments lives at: <OPS_MEMORY_PATH>

After any task that deploys, configures, installs, migrates or changes a server, service, port, version, cron job, nginx/proxy config, or environment variable NAMES (in any project):
1. Update the matching file in `vms/` and `projects/` (create it from `templates/` style if missing): frontmatter `last_updated` (YYYY-MM-DD) and `updated_by: claude-code`, plus the Deployed / Config Notes / Recent Changes sections.
2. Add a dated one-line entry at the top of `changelog/YYYY-MM.md` (newest first).
3. NEVER write secret values (passwords, tokens, keys, connection strings with passwords). Write the variable NAME and where it is stored instead.
4. Keep entries short, factual and in the past tense.
5. If you are unsure which VM or project applies, append a line to `inbox.md` instead of guessing.
<!-- MOCHI:END -->
