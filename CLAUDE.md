# misc

Fabian's catch-all repo for ideas and small apps started away from the
office — things that don't have a "real" home yet. It is **not** one
project. It's a set of unrelated projects living side by side.

## Structure

Every idea/app gets its own top-level folder, named after the app. Each
folder is self-contained:

- It may use a completely different language, stack, or toolchain than its
  neighbors — don't assume conventions carry over between folders.
- It owns a `CLAUDE.md` — project-specific context and working instructions
  for that app only.
- It owns a `MEMORY.md` — a running log of decisions made, current state,
  what's done, what's open, and anything a future session (with no memory
  of this conversation) needs to know before touching the code.
- It may add other AI-context files as useful (`TODO.md`, `DECISIONS.md`,
  etc.) — there's no fixed template, use what the project actually needs.

## Working in this repo

- **Read the folder's own `CLAUDE.md` and `MEMORY.md` before doing anything**
  inside it. This root file is intentionally thin — it only describes the
  repo layout, not any individual app.
- **Starting something new?** Create a new top-level folder, and give it its
  own `CLAUDE.md` + `MEMORY.md` from the start, even if the app is tiny.
  Don't bolt new, unrelated work onto an existing folder.
- **Finishing a session inside a folder?** Update that folder's `MEMORY.md`
  with what changed and what's still open, so the next session (yours or
  a fresh one) doesn't have to reconstruct context from git log.
- Keep the folder list below up to date when you add or retire a project.

## Folders

- `TheftAlert/` — macOS menu-bar app that arms before you walk away from
  your locked Mac and sounds a siren if it's tampered with, unless a
  paired iPhone is nearby. Swift Package, AppKit-based, unbuilt/untested
  (built without macOS access). See `TheftAlert/CLAUDE.md`.
