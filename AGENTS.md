# AGENTS.md

## Project

**FocusGuard** — a Manifest V3 Chrome extension that intercepts navigation to user-listed domains and redirects the tab to a full-screen Pomodoro timer page.

Vanilla JS/HTML/CSS with **no build step** — files are loaded by Chrome exactly as they sit on disk. npm exists for tests and lint only (Vitest + ESLint); nothing in `node_modules/` is required to load the extension.

The extension makes **no network requests**. Fonts are self-hosted in `fonts/` and site avatars are generated locally — both were previously third-party fetches. Keep it that way: any new `<link>`, `fetch`, or remote asset breaks the offline guarantee and the privacy claim in `README.md`.

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at repo root + `docs/adr/` for decisions. See `docs/agents/domain.md`.
