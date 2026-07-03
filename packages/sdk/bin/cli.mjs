#!/usr/bin/env node
// pigeon — build-time CLI for JAMstack / static sites.
//
//   npx pigeon build --key <apiKey> [--out public] [--base https://app.pigeon.com]
//
// Fetches your site's Pigeon artifacts and writes them into your build output:
//   <out>/llms.txt              — the AI-readable index
//   <out>/pigeon-artifacts.json — per-route meta + JSON-LD, for your framework
//                                  to inline at build time
//
// Run it in your build step (e.g. "prebuild": "pigeon build --key $PIGEON_KEY").

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function build() {
  const key = arg("key", process.env.PIGEON_KEY);
  const out = arg("out", "public");
  const base = (arg("base", "https://app.pigeon.com")).replace(/\/$/, "");
  if (!key) {
    console.error("Missing --key (or PIGEON_KEY env).");
    process.exit(1);
  }

  const res = await fetch(`${base}/api/sdk/artifacts`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`Pigeon API ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const artifacts = await res.json();

  await mkdir(out, { recursive: true });
  if (artifacts.llmsTxt) {
    await writeFile(join(out, "llms.txt"), artifacts.llmsTxt, "utf8");
    console.log(`✓ wrote ${join(out, "llms.txt")}`);
  }
  await writeFile(
    join(out, "pigeon-artifacts.json"),
    JSON.stringify(artifacts, null, 2),
    "utf8",
  );
  console.log(`✓ wrote ${join(out, "pigeon-artifacts.json")}`);
  const routes = Object.keys(artifacts.byPath ?? {}).length;
  console.log(
    `Done — ${routes} route(s) with meta/JSON-LD, llms.txt ${
      artifacts.llmsTxt ? "included" : "not yet generated"
    }.`,
  );
}

const cmd = process.argv[2];
if (cmd === "build") {
  build().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.log(`pigeon — AI-search optimization

Usage:
  pigeon build --key <apiKey> [--out public] [--base <url>]

Get your API key by connecting your site at https://app.pigeon.com.`);
}
