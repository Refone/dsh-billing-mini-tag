#!/usr/bin/env node
/**
 * Publishing preflight for dsh-billing-mini-tag.
 *
 * Checks the four things the DSH ecosystem scans for, plus the metadata a
 * public repo/package needs:
 *
 *   1. the `dsh-plugin` keyword,
 *   2. a copyable `dsh plugin --profile web add <package>` command in README,
 *   3. an exported `apply(ctx)` host module,
 *   4. a resolvable `dsh.bundle.patch` declaration (cordis.patch.yml).
 *
 * No dependencies: run with `node scripts/check-release.mjs`.
 */

import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const passes = [];

async function exists(relativePath) {
  try {
    await access(join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function check(label, run) {
  try {
    const detail = await run();
    passes.push(label);
    console.log(`  \u2713 ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failures.push(label);
    console.error(`  \u2717 ${label}\n      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainFile(entry) {
  return !entry.includes("*") && !entry.endsWith("/");
}

console.log(`\ndsh-billing-mini-tag release check (${root})\n`);

let manifest;
await check("package.json parses", async () => {
  manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  return `${manifest.name}@${manifest.version}`;
});

await check("name, version, description and license are present", () => {
  assert(manifest.name === "dsh-billing-mini-tag", "package name is not dsh-billing-mini-tag");
  assert(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version), "version is not semver");
  assert(typeof manifest.description === "string" && manifest.description.length > 20, "description is missing or too short");
  assert(manifest.license === "MIT", "license should be MIT");
});

await check("keywords include dsh-plugin", () => {
  assert(Array.isArray(manifest.keywords) && manifest.keywords.includes("dsh-plugin"), "keywords[] does not include dsh-plugin");
  return manifest.keywords.join(", ");
});

await check("dsh-plugin is not marked private", () => {
  assert(manifest.private !== true, "package.json still has private: true");
});

await check("repository / homepage / bugs point at GitHub", () => {
  const repository = manifest.repository?.url ?? "";
  assert(repository.includes("github.com/Refone/dsh-billing-mini-tag"), "repository.url does not point at the GitHub repo");
  assert(String(manifest.homepage ?? "").includes("github.com/Refone/dsh-billing-mini-tag"), "homepage is missing");
  assert(String(manifest.bugs?.url ?? "").includes("github.com/Refone/dsh-billing-mini-tag"), "bugs.url is missing");
});

await check("host and client exports resolve to real files", async () => {
  const dot = manifest.exports?.["."];
  const client = manifest.exports?.["./client"];
  assert(typeof dot === "string", "exports['.'] is missing");
  assert(typeof client === "string", "exports['./client'] is missing");
  assert(await exists(dot), `exports['.'] target ${dot} does not exist`);
  assert(await exists(client), `exports['./client'] target ${client} does not exist`);
  assert(typeof manifest.main === "string" && await exists(manifest.main), "main entry does not exist");
  return `${dot}, ${client}`;
});

await check("dsh.bundle.patch declares an installable bundle", async () => {
  const patch = manifest.dsh?.bundle?.patch;
  assert(typeof patch === "string", "dsh.bundle.patch is missing");
  assert(await exists(patch), `${patch} does not exist`);
  const text = await readFile(join(root, patch), "utf8");
  assert(/^\s*-\s*insert:/m.test(text), `${patch} has no '- insert:' layer`);
  assert(new RegExp(`id:\\s*${manifest.name}(\\s|$)`).test(text), `${patch} does not insert id ${manifest.name}`);
  return patch;
});

await check("dsh.client targets the web profile", () => {
  assert(manifest.dsh?.client?.platform === "web", "dsh.client.platform is not web");
  assert(Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length > 0, "dsh.client.inject is empty");
  return manifest.dsh.client.inject.join(", ");
});

await check("source exports apply(ctx) with the plugin name", async () => {
  const module = await import(pathToFileURL(join(root, manifest.exports["."])).href);
  assert(typeof module.apply === "function", "host module does not export apply()");
  assert(module.name === manifest.name, `exported name is ${module.name}, expected ${manifest.name}`);
  assert(Array.isArray(module.inject), "host module does not export an inject array");
  return `inject: ${module.inject.join(", ")}`;
});

await check("browser module is syntactically valid", () => {
  const result = spawnSync(process.execPath, ["--check", join(root, manifest.exports["./client"])], {
    encoding: "utf8",
  });
  assert(result.status === 0, result.stderr.trim() || "node --check failed");
});

await check("READMEs carry a copyable install command", async () => {
  for (const readme of ["README.md", "README.zh.md"]) {
    assert(await exists(readme), `${readme} does not exist`);
    const text = await readFile(join(root, readme), "utf8");
    assert(text.includes("dsh plugin --profile web add"), `${readme} has no 'dsh plugin --profile web add' command`);
    assert(text.includes(manifest.name), `${readme} does not name ${manifest.name}`);
  }
  return "README.md, README.zh.md";
});

await check("package files[] ships every required artifact", async () => {
  const files = manifest.files;
  assert(Array.isArray(files) && files.length > 0, "files[] is missing");
  const normalize = (entry) => entry.replace(/^\.\//, "");
  const included = new Set(files.map(normalize));
  for (const required of [manifest.exports["."], manifest.exports["./client"], "cordis.patch.yml", "README.md", "LICENSE"]) {
    assert(included.has(normalize(required)), `files[] does not include ${required}`);
  }
  for (const entry of files.filter(isPlainFile)) {
    assert(await exists(entry), `files[] includes missing file ${entry}`);
  }
  return `${files.length} entries`;
});

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed, ${passes.length} passed.\n`);
  process.exitCode = 1;
} else {
  console.log(`All ${passes.length} checks passed.\n`);
}
