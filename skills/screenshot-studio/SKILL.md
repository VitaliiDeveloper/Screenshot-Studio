---
name: screenshot-studio
description: Bootstrap and enter Screenshot Studio projects for App Store, Google Play, and Microsoft Store marketing screenshots. Use when a user wants to initialize a Screenshot Studio project, start a code-first store-screenshot workflow, or continue work in a folder containing app-store-screenshots.json.
---

# Screenshot Studio

Use the packaged `screenshots` CLI to create the project, then treat the generated project-local
`AGENTS.md` as the complete and authoritative workflow contract.

## Enter a project

1. Check the target folder for `app-store-screenshots.json`.
2. If it exists, do not initialize again. Read that folder's `AGENTS.md` completely and follow it.
3. If it does not exist, run the bundled bootstrap script with an explicit target:

   ```bash
   node <skill-directory>/scripts/init-project.mjs --dir <target-folder> --name "<project name>"
   ```

4. Read the newly generated `<target-folder>/AGENTS.md` completely before editing project files or
   running another command.

The script resolves the CLI from `--cli <executable>`, then `SCREENSHOT_STUDIO_CLI`, then
`screenshots` on `PATH`. If none is available, stop and ask the user to make the built
`@screenshot-studio/cli` artifact available. Do not fetch packages, invent project JSON, or replace
the CLI initialization path.

## Choose a style

For a ready-made look, follow the generated guide's "Recipe: choose a style".

## Boundaries

- Delegate schema, layout, copy, translation, asset processing, editor, and export behavior to the
  generated `AGENTS.md` and the CLI it documents. Prefer its `template`, `element`, `locale`,
  `theme`, `screen`, `import`, and `export` commands over hand-editing project JSON; they lock and
  validate the project. `element get|set|add|rm` and `screen show|set` cover element geometry, style,
  and screen backgrounds.
- Keep AI optional: require no provider SDK, API key, or persisted agent state.
- Keep all created files inside the explicit target folder.
- Never overwrite an existing project file or project-local agent guide.
