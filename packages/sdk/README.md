# @pigeon/sdk — install Pigeon in your codebase

Pigeon measures where your site shows up in AI search (ChatGPT / Perplexity /
Gemini), figures out what to fix, and **generates the concrete fixes**. This
package lets Pigeon apply those fixes _inside your codebase_.

## Quick start

```bash
npm i -g @pigeon/sdk

pigeon login     # log into your Pigeon account (paste a CLI token)
pigeon link      # pick which workspace this repo belongs to
pigeon apply     # write the generated fixes into your code
```

- **`pigeon login`** opens your account, where you generate a one-time CLI token
  (Profile → “Connect your codebase”), and pastes it in. Creds are stored in
  `~/.pigeon/config.json`.
- **`pigeon link`** lists your workspaces and links this repo to one
  (`.pigeon.json`). If you only have one, it links automatically.
- **`pigeon apply`** pulls the latest fix pack for the linked workspace and
  writes each artifact into `./pigeon/` (schema `.html`, content/steps `.md`),
  with a `README.md` explaining where each goes. It also **auto-injects** the
  Organization JSON-LD into a static `index.html` `<head>` when it finds one.
- **`pigeon status`** shows who you’re logged in as and the linked workspace.

Point the CLI at a self-hosted / local server with `--base http://localhost:3000`
(or `PIGEON_BASE`).

## Runtime SDK (optional)

Serve the artifacts Pigeon generated at runtime, framework-agnostic:

```ts
import { createPigeon, renderJsonLd } from "@pigeon/sdk";

const pigeon = createPigeon({ apiKey: process.env.PIGEON_KEY! });
const route = await pigeon.getRoute("/pricing");
// inject renderJsonLd(route) into your <head>
```

## Legacy build step

```bash
pigeon build --key $PIGEON_KEY --out public
# writes public/llms.txt + public/pigeon-artifacts.json
```

MIT
