// Builds the `mochi-hook` helper and copies it to src-tauri/binaries/mochi-hook-<target-triple>[.exe],
// where Tauri's `bundle.externalBin` expects it. Usage: node scripts/prepare-hook.mjs [--release] [--target <triple>]
// (the target defaults to $TAURI_ENV_TARGET_TRIPLE, then the host).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "Cargo.toml");
const args = process.argv.slice(2);
const release = args.includes("--release");
const targetIdx = args.indexOf("--target");
// `tauri build --target X` exports TAURI_ENV_TARGET_TRIPLE to beforeBuildCommand.
const explicitTarget = targetIdx >= 0 ? args[targetIdx + 1] : process.env.TAURI_ENV_TARGET_TRIPLE || undefined;

const hostTriple = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
const triple = explicitTarget ?? hostTriple;
if (!triple) throw new Error("Could not determine the Rust target triple.");
const ext = triple.includes("windows") ? ".exe" : "";

const cargoArgs = ["build", "--manifest-path", manifest, "--bin", "mochi-hook"];
if (release) cargoArgs.push("--release");
if (explicitTarget) cargoArgs.push("--target", explicitTarget);
execFileSync("cargo", cargoArgs, { stdio: "inherit" });

const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const profileDir = release ? "release" : "debug";
const built = join(meta.target_directory, ...(explicitTarget ? [explicitTarget] : []), profileDir, `mochi-hook${ext}`);
if (!existsSync(built)) throw new Error(`Expected ${built} after building mochi-hook.`);

const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `mochi-hook-${triple}${ext}`);
copyFileSync(built, out);
console.log(`mochi-hook -> ${out}`);
