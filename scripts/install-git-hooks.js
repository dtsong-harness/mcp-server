#!/usr/bin/env node

/**
 * Point this repo's git at .githooks so the committed hooks (pre-commit docs
 * sync, prepare-commit-msg shim) take effect.
 *
 * Runs from the `prepare` lifecycle script on `pnpm install`. Guards against
 * contexts where there is no work tree (e.g. when the package is installed as
 * a dependency) so it never breaks an install.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function isGitWorkTree() {
  try {
    const out = execSync("git rev-parse --is-inside-work-tree", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out === "true";
  } catch {
    return false;
  }
}

// No .git (e.g. installed as a dependency, or a tarball) — nothing to wire up.
if (!isGitWorkTree() || !existsSync(join(ROOT, ".githooks"))) {
  process.exit(0);
}

try {
  execSync("git config core.hooksPath .githooks", { cwd: ROOT, stdio: "ignore" });
  console.log("git hooks installed (core.hooksPath -> .githooks)");
} catch (err) {
  // Non-fatal: a developer can run `pnpm hooks:install` manually.
  console.warn(`could not set core.hooksPath: ${err.message}`);
}
