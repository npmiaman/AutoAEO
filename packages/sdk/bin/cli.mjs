#!/usr/bin/env node
// pigeon — install Pigeon in your codebase.
//
//   pigeon login     log into your Pigeon account (paste a CLI token)
//   pigeon link      pick which workspace this repo belongs to
//   pigeon apply     write the fixes Pigeon generated into your codebase
//   pigeon status    show who you're logged in as + the linked workspace
//   pigeon build     [legacy] build-time artifact fetch by --key
//
// Account creds live in ~/.pigeon/config.json; the repo link lives in
// ./.pigeon.json. Override the server with --base or PIGEON_BASE.

import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const DEFAULT_BASE = process.env.PIGEON_BASE || "https://app.pigeon.com";
const CONFIG_DIR = join(homedir(), ".pigeon");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const LINK_FILE = join(process.cwd(), ".pigeon.json");

// ── tiny helpers ─────────────────────────────────────────────────────────
function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}
async function readConfig() {
  return (await readJson(CONFIG_FILE)) ?? {};
}
async function writeConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(question, (a) => {
      rl.close();
      res(a.trim());
    }),
  );
}
function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* user can open it manually */
  }
}
async function api(base, token, path) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
  }
  return res.json();
}
function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact"
  );
}
function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── commands ───────────────────────────────────────────────────────────────
async function login() {
  const base = flag("base", DEFAULT_BASE).replace(/\/$/, "");
  console.log(`\nLog in to Pigeon (${base}).`);
  console.log(`Opening ${base}/profile — generate a CLI token there.\n`);
  openBrowser(`${base}/profile`);
  const token = await ask("Paste your CLI token: ");
  if (!token) die("No token entered.");

  let me;
  try {
    me = await api(base, token, "/api/cli/me");
  } catch (e) {
    die(`Token rejected: ${e.message}`);
  }
  await writeConfig({ base, token });
  console.log(`\n✓ Logged in as ${me.user?.email ?? "your account"}.`);
  console.log("Next: run `pigeon link` inside your project.");
}

async function link() {
  const cfg = await readConfig();
  if (!cfg.token) die("Not logged in. Run `pigeon login` first.");

  const { workspaces } = await api(cfg.base, cfg.token, "/api/cli/workspaces");
  if (!workspaces?.length)
    die(`No workspaces on this account. Create one at ${cfg.base}.`);

  let chosen;
  if (workspaces.length === 1) {
    chosen = workspaces[0];
    console.log(`One workspace — linking "${chosen.name}".`);
  } else {
    console.log("\nYour workspaces:");
    workspaces.forEach((w, i) =>
      console.log(`  ${i + 1}. ${w.name}  (${w.primaryDomain})`),
    );
    const pick = await ask(`\nWhich one? [1-${workspaces.length}]: `);
    chosen = workspaces[Number(pick) - 1];
    if (!chosen) die("Invalid selection.");
  }

  await writeFile(
    LINK_FILE,
    JSON.stringify(
      { workspaceId: chosen.id, workspaceName: chosen.name, base: cfg.base },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n✓ Linked this repo to "${chosen.name}" (.pigeon.json).`);
  console.log("Next: run `pigeon apply`.");
}

// Pull the schema <script> blocks out of a fix body.
function schemaBlocks(body) {
  return [
    ...body.matchAll(
      /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi,
    ),
  ].map((m) => m[0]);
}

// Best-effort: inject Organization JSON-LD into a static index.html <head>.
async function injectSchema(blocks) {
  for (const file of ["index.html", "public/index.html", "src/index.html"]) {
    const p = join(process.cwd(), file);
    if (!(await exists(p))) continue;
    let html = await readFile(p, "utf8");
    if (!/<\/head>/i.test(html)) return null;
    if (html.includes("pigeon:schema")) return file; // already applied
    const injected = blocks.filter((b) => !html.includes(b));
    if (!injected.length) return file;
    html = html.replace(
      /<\/head>/i,
      `  <!-- pigeon:schema -->\n  ${injected.join("\n  ")}\n</head>`,
    );
    await writeFile(p, html, "utf8");
    return file;
  }
  return null;
}

async function apply() {
  const cfg = await readConfig();
  if (!cfg.token) die("Not logged in. Run `pigeon login` first.");
  const linked = await readJson(LINK_FILE);
  if (!linked?.workspaceId)
    die("This repo isn't linked. Run `pigeon link` first.");

  console.log(`Fetching fixes for "${linked.workspaceName}"…`);
  const data = await api(
    cfg.base,
    cfg.token,
    `/api/cli/workspaces/${linked.workspaceId}/fixes`,
  );
  const fixes = data.fixPack ?? [];
  if (!fixes.length)
    die("No fixes yet — run a scan for this workspace in the Pigeon app first.");

  const dir = join(process.cwd(), "pigeon");
  await mkdir(dir, { recursive: true });

  const index = [`# Pigeon fixes — ${data.site?.name ?? linked.workspaceName}`, ""];
  const ext = { schema: "html", content: "md", steps: "md" };
  const written = [];
  for (const f of fixes) {
    const name = `${slug(f.title)}.${ext[f.kind] ?? "md"}`;
    await writeFile(join(dir, name), f.body, "utf8");
    written.push(name);
    index.push(`- **${f.title}** (phase ${f.phase}) → \`pigeon/${name}\``);
  }

  // Auto-apply the schema where it's safe (a static index.html).
  const allSchema = fixes
    .filter((f) => f.kind === "schema")
    .flatMap((f) => schemaBlocks(f.body));
  let injectedInto = null;
  if (allSchema.length) injectedInto = await injectSchema(allSchema);

  index.push(
    "",
    "## How to apply",
    injectedInto
      ? `- Schema JSON-LD was auto-injected into \`${injectedInto}\` (marked \`pigeon:schema\`).`
      : "- Add the schema `.html` blocks to your site's <head> (site-wide for Organization, per-page for FAQ).",
    "- Paste the content pieces into the matching pages (answer-first, keep them visible).",
    "- Follow the steps files (e.g. Entity Home) as a checklist.",
  );
  await writeFile(join(dir, "README.md"), index.join("\n"), "utf8");

  console.log(`\n✓ Wrote ${written.length} fix file(s) to ./pigeon/`);
  written.forEach((n) => console.log(`   • ${n}`));
  if (injectedInto) console.log(`✓ Auto-injected schema into ${injectedInto}`);
  console.log("\nSee ./pigeon/README.md for what to paste where.");
}

async function status() {
  const cfg = await readConfig();
  if (!cfg.token) {
    console.log("Not logged in. Run `pigeon login`.");
    return;
  }
  try {
    const me = await api(cfg.base, cfg.token, "/api/cli/me");
    console.log(`Logged in as ${me.user?.email ?? "?"}  (${cfg.base})`);
  } catch {
    console.log(
      "Logged in, but the token is no longer valid — run `pigeon login`.",
    );
  }
  const linked = await readJson(LINK_FILE);
  console.log(
    linked?.workspaceId
      ? `This repo → workspace "${linked.workspaceName}"`
      : "This repo isn't linked. Run `pigeon link`.",
  );
}

// ── legacy build-time fetch by site API key ────────────────────────────────
async function build() {
  const key = flag("key", process.env.PIGEON_KEY);
  const out = flag("out", "public");
  const base = flag("base", DEFAULT_BASE).replace(/\/$/, "");
  if (!key) die("Missing --key (or PIGEON_KEY env).");
  const res = await fetch(`${base}/api/sdk/artifacts`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) die(`Pigeon API ${res.status}: ${await res.text()}`);
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
}

const HELP = `pigeon — install Pigeon in your codebase

  pigeon login     log into your Pigeon account (paste a CLI token)
  pigeon link      pick which workspace this repo belongs to
  pigeon apply     write the fixes Pigeon generated into your codebase
  pigeon status    show login + linked workspace
  pigeon build     [legacy] build-time artifact fetch by --key

Options: --base <url> (self-host/local, or PIGEON_BASE)
Get started: sign up at ${DEFAULT_BASE}, then \`pigeon login\`.`;

const cmd = process.argv[2];
const run = { login, link, apply, status, build }[cmd];
if (run) {
  run().catch((e) => die(e.message));
} else {
  console.log(HELP);
}
