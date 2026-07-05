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

import { writeFile, mkdir, readFile, stat, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_BASE = process.env.PIGEON_BASE || "https://pigeon-ten-ochre.vercel.app";
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

// ── schema helpers ─────────────────────────────────────────────────────────
// Pull the JSON-LD <script> blocks out of a fix body.
function schemaBlocks(body) {
  return [
    ...body.matchAll(
      /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi,
    ),
  ].map((m) => m[0]);
}
function scriptInner(block) {
  return block
    .replace(/^[\s\S]*?<script[^>]*>/i, "")
    .replace(/<\/script>[\s\S]*$/i, "")
    .trim();
}
function isOrg(block) {
  return /"@type"\s*:\s*"?(Organization|LocalBusiness|Person)/i.test(block);
}
function isFaq(block) {
  return /"@type"\s*:\s*"?FAQPage/i.test(block);
}
// Turn a raw <script ld+json> block into a React element (JSON goes via
// dangerouslySetInnerHTML so JSX never parses the braces).
function scriptToJsx(block) {
  return `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(scriptInner(block))} }} />`;
}
// Astro leaves is:inline scripts untouched (no bundling of our JSON-LD).
function scriptToAstro(block) {
  return `<script type="application/ld+json" is:inline set:html={${JSON.stringify(scriptInner(block))}} />`;
}
function htmlEsc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
// Extract visible Q&As from a FAQPage JSON-LD block.
function faqQAs(block) {
  try {
    const node = JSON.parse(scriptInner(block));
    const findFaq = (n) => {
      if (Array.isArray(n)) return n.map(findFaq).find(Boolean);
      if (n && typeof n === "object") {
        if (/faqpage/i.test(String(n["@type"]))) return n;
        if (Array.isArray(n["@graph"])) return findFaq(n["@graph"]);
      }
      return null;
    };
    const faq = findFaq(node);
    const list = Array.isArray(faq?.mainEntity) ? faq.mainEntity : [];
    return list
      .map((q) => ({
        q: String(q?.name ?? "").trim(),
        a: String(q?.acceptedAnswer?.text ?? "").trim(),
      }))
      .filter((x) => x.q && x.a);
  } catch {
    return [];
  }
}

// ── framework detection ────────────────────────────────────────────────────
async function detectFramework() {
  const pkg = (await readJson("package.json")) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (f) => exists(join(process.cwd(), f));

  if (deps.next) {
    for (const l of [
      "app/layout.tsx",
      "app/layout.jsx",
      "src/app/layout.tsx",
      "src/app/layout.jsx",
    ]) {
      if (await has(l))
        return { kind: "next-app", layout: l, appDir: l.replace(/layout\.[jt]sx$/, "") };
    }
    return { kind: "next-pages" };
  }
  if (deps.astro) {
    for (const base of ["src/layouts", "src/components", "src"]) {
      const d = join(process.cwd(), base);
      let entries = [];
      try {
        entries = await readdir(d);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.endsWith(".astro")) continue;
        const p = `${base}/${e}`;
        if (/<\/head>/i.test(await readFile(join(process.cwd(), p), "utf8")))
          return { kind: "astro", layout: p };
      }
    }
    return { kind: "astro" };
  }
  if (deps.nuxt) return { kind: "nuxt" };
  if (deps["@sveltejs/kit"]) return { kind: "sveltekit" };
  if ((await has("index.html")) || (await has("public/index.html")))
    return { kind: "static" };
  return { kind: "unknown" };
}

// ── per-framework appliers (each returns {applied[], touched[]}) ────────────
async function applyNextApp(fw, orgBlocks, faqBlocks, cwd) {
  const applied = [];
  const touched = [];
  if (orgBlocks.length) {
    const compRel = `${fw.appDir}pigeon-schema.tsx`;
    const comp = `// Generated by Pigeon — Organization identity for AI search. Reviewed via PR.
export default function PigeonSchema() {
  return (
    <>
      ${orgBlocks.map(scriptToJsx).join("\n      ")}
    </>
  );
}
`;
    await writeFile(join(cwd, compRel), comp, "utf8");
    touched.push(compRel);

    // inject <PigeonSchema/> + import into the real root layout
    const layoutPath = join(cwd, fw.layout);
    let layout = await readFile(layoutPath, "utf8");
    if (!layout.includes("pigeon-schema")) {
      if (/<body[^>]*>/i.test(layout)) {
        layout = `import PigeonSchema from "./pigeon-schema";\n${layout}`.replace(
          /(<body[^>]*>)/i,
          `$1\n        <PigeonSchema />`,
        );
        await writeFile(layoutPath, layout, "utf8");
        touched.push(fw.layout);
        applied.push(`Organization schema → ${fw.layout} (via ${compRel})`);
      } else {
        applied.push(`Organization schema component ${compRel} — add <PigeonSchema/> to your layout`);
      }
    } else {
      applied.push(`Organization schema already wired in ${fw.layout}`);
    }
  }
  if (faqBlocks.length) {
    const qas = faqBlocks.flatMap(faqQAs);
    const faqRel = `${fw.appDir}faq/page.tsx`;
    const sections = qas
      .map(
        (x) =>
          `      <section>\n        <h2>{${JSON.stringify(x.q)}}</h2>\n        <p>{${JSON.stringify(x.a)}}</p>\n      </section>`,
      )
      .join("\n");
    const page = `// Generated by Pigeon — FAQ page (visible Q&A + FAQPage schema).
export const metadata = { title: "FAQ" };
export default function FaqPage() {
  return (
    <main>
      <h1>Frequently asked questions</h1>
${sections}
      ${faqBlocks.map(scriptToJsx).join("\n      ")}
    </main>
  );
}
`;
    await mkdir(dirname(join(cwd, faqRel)), { recursive: true });
    await writeFile(join(cwd, faqRel), page, "utf8");
    touched.push(faqRel);
    applied.push(`FAQ page → ${faqRel} (${qas.length} Q&As)`);
  }
  return { applied, touched };
}

async function applyAstro(fw, orgBlocks, faqBlocks, cwd) {
  const applied = [];
  const touched = [];
  if (orgBlocks.length && fw.layout) {
    const p = join(cwd, fw.layout);
    let html = await readFile(p, "utf8");
    if (!html.includes("pigeon:schema") && /<\/head>/i.test(html)) {
      html = html.replace(
        /<\/head>/i,
        `  <!-- pigeon:schema -->\n  ${orgBlocks.map(scriptToAstro).join("\n  ")}\n</head>`,
      );
      await writeFile(p, html, "utf8");
      touched.push(fw.layout);
      applied.push(`Organization schema → ${fw.layout}`);
    }
  }
  if (faqBlocks.length) {
    const qas = faqBlocks.flatMap(faqQAs);
    const rel = "src/pages/faq.astro";
    const sections = qas
      .map((x) => `      <section>\n        <h2>${htmlEsc(x.q)}</h2>\n        <p>${htmlEsc(x.a)}</p>\n      </section>`)
      .join("\n");
    const page = `---
// Generated by Pigeon — FAQ page (visible Q&A + FAQPage schema).
---
<html lang="en">
  <head>
    <title>FAQ</title>
    ${faqBlocks.map(scriptToAstro).join("\n    ")}
  </head>
  <body>
    <main>
      <h1>Frequently asked questions</h1>
${sections}
    </main>
  </body>
</html>
`;
    await mkdir(dirname(join(cwd, rel)), { recursive: true });
    await writeFile(join(cwd, rel), page, "utf8");
    touched.push(rel);
    applied.push(`FAQ page → ${rel} (${qas.length} Q&As)`);
  }
  return { applied, touched };
}

async function applyStatic(orgBlocks, faqBlocks, cwd) {
  const applied = [];
  const touched = [];
  for (const file of ["index.html", "public/index.html", "src/index.html"]) {
    const p = join(cwd, file);
    if (!(await exists(p))) continue;
    let html = await readFile(p, "utf8");
    if (orgBlocks.length && !html.includes("pigeon:schema") && /<\/head>/i.test(html)) {
      html = html.replace(
        /<\/head>/i,
        `  <!-- pigeon:schema -->\n  ${orgBlocks.join("\n  ")}\n</head>`,
      );
      await writeFile(p, html, "utf8");
      touched.push(file);
      applied.push(`Organization schema → ${file}`);
    }
    break;
  }
  if (faqBlocks.length) {
    const qas = faqBlocks.flatMap(faqQAs);
    const rel = "faq.html";
    const sections = qas
      .map((x) => `    <section><h2>${htmlEsc(x.q)}</h2><p>${htmlEsc(x.a)}</p></section>`)
      .join("\n");
    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FAQ</title>
${faqBlocks.join("\n")}
</head><body>
  <main><h1>Frequently asked questions</h1>
${sections}
  </main>
</body></html>
`;
    await writeFile(join(cwd, rel), page, "utf8");
    touched.push(rel);
    applied.push(`FAQ page → ${rel} (${qas.length} Q&As)`);
  }
  return { applied, touched };
}

// ── git: branch, commit, (optional) PR ──────────────────────────────────────
function sh(cmd, args) {
  return spawnSync(cmd, args, { cwd: process.cwd(), encoding: "utf8" });
}
function gitBranchAndPr(touched) {
  if (sh("git", ["rev-parse", "--is-inside-work-tree"]).status !== 0)
    return { skipped: "not a git repository" };
  const branch = "pigeon/aeo-fixes";
  if (sh("git", ["checkout", "-B", branch]).status !== 0)
    return { skipped: "couldn't create branch" };
  sh("git", ["add", ...touched, "pigeon"]);
  const commit = sh("git", [
    "commit",
    "-m",
    "Pigeon: AEO/GEO fixes — Organization schema + FAQ page",
  ]);
  if (commit.status !== 0)
    return { branch, committed: false, note: "nothing new to commit" };

  const hasGh = sh("gh", ["--version"]).status === 0;
  const hasRemote = sh("git", ["remote", "get-url", "origin"]).status === 0;
  if (hasGh && hasRemote) {
    if (sh("git", ["push", "-u", "origin", branch]).status === 0) {
      const pr = sh("gh", ["pr", "create", "--fill", "--head", branch]);
      const url = (pr.stdout || "").trim();
      if (pr.status === 0 && url) return { branch, committed: true, prUrl: url };
    }
  }
  return { branch, committed: true };
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

  const cwd = process.cwd();

  // 1. Always drop every artifact into ./pigeon/ for reference.
  const dir = join(cwd, "pigeon");
  await mkdir(dir, { recursive: true });
  const index = [`# Pigeon fixes — ${data.site?.name ?? linked.workspaceName}`, ""];
  const ext = { schema: "html", content: "md", steps: "md" };
  for (const f of fixes) {
    const name = `${slug(f.title)}.${ext[f.kind] ?? "md"}`;
    await writeFile(join(dir, name), f.body, "utf8");
    index.push(`- **${f.title}** (phase ${f.phase}) → \`pigeon/${name}\``);
  }

  // 2. Framework-aware application of the schema + FAQ.
  const allSchema = fixes
    .filter((f) => f.kind === "schema")
    .flatMap((f) => schemaBlocks(f.body));
  const orgBlocks = allSchema.filter(isOrg);
  const faqBlocks = allSchema.filter(isFaq);

  const fw = await detectFramework();
  console.log(`Detected: ${fw.kind}`);
  let res = { applied: [], touched: [] };
  if (fw.kind === "next-app") res = await applyNextApp(fw, orgBlocks, faqBlocks, cwd);
  else if (fw.kind === "astro") res = await applyAstro(fw, orgBlocks, faqBlocks, cwd);
  else if (fw.kind === "static") res = await applyStatic(orgBlocks, faqBlocks, cwd);

  index.push(
    "",
    "## Applied automatically",
    res.applied.length ? res.applied.map((a) => `- ${a}`).join("\n") : "- (none — see manual steps below)",
    "",
    "## Do by hand",
    "- Paste content pieces into the matching pages (answer-first, keep them visible).",
    "- Follow the steps files (e.g. Entity Home) as a checklist.",
  );
  await writeFile(join(dir, "README.md"), index.join("\n"), "utf8");

  console.log(`\n✓ Wrote all ${fixes.length} artifact(s) to ./pigeon/`);
  if (res.applied.length) {
    console.log("✓ Applied into your codebase:");
    res.applied.forEach((a) => console.log(`   • ${a}`));
  } else if (fw.kind === "next-pages" || fw.kind === "nuxt" || fw.kind === "sveltekit" || fw.kind === "unknown") {
    console.log(
      `(No auto-apply adapter for ${fw.kind} yet — artifacts are in ./pigeon/ with a guide.)`,
    );
  }

  // 3. Open the changes as a branch/PR to review.
  const touched = [...res.touched];
  const git = gitBranchAndPr(touched);
  if (git.skipped) {
    console.log(`\n(git: ${git.skipped} — changes left in your working tree.)`);
  } else if (git.prUrl) {
    console.log(`\n✓ Opened a PR for review: ${git.prUrl}`);
  } else if (git.committed) {
    console.log(
      `\n✓ Committed to branch "${git.branch}". Push and open a PR to review:\n    git push -u origin ${git.branch}`,
    );
  } else {
    console.log(`\n(git: ${git.note ?? "no changes"} on branch "${git.branch}".)`);
  }
  console.log("\nSee ./pigeon/README.md for the rest.");
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
