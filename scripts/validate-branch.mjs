import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
let repoRoot = process.cwd();
let wantJson = false;

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--cwd" && argv[index + 1]) {
    repoRoot = path.resolve(argv[index + 1]);
    index += 1;
    continue;
  }

  if (arg === "--json") {
    wantJson = true;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function npmCommand(scriptName) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `npm.cmd run ${scriptName}`],
      displayCommand: `npm.cmd run ${scriptName}`,
    };
  }

  return {
    command: "npm",
    args: ["run", scriptName],
    displayCommand: `npm run ${scriptName}`,
  };
}

function getBranchName() {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return "unknown";
  }

  return result.stdout.trim() || "unknown";
}

function buildChecks() {
  const checks = [];
  const packageJsonPath = path.join(repoRoot, "package.json");

  if (existsSync(packageJsonPath)) {
    const packageJson = readJson(packageJsonPath);
    const scripts = packageJson.scripts ?? {};

    if (scripts["tts:check"]) {
      checks.push({
        label: "TypeScript TTS check",
        ...npmCommand("tts:check"),
      });
    }

    if (scripts.build) {
      checks.push({
        label: "Frontend build",
        ...npmCommand("build"),
      });
    }

    if (scripts.test) {
      checks.push({
        label: "Project tests",
        ...npmCommand("test"),
      });
    }
  }

  const cargoManifest = path.join(repoRoot, "src-tauri", "Cargo.toml");
  if (existsSync(cargoManifest)) {
    checks.push({
      label: "Tauri cargo check",
      command: process.platform === "win32" ? "cargo.exe" : "cargo",
      args: ["check", "--manifest-path", cargoManifest],
    });
  }

  return checks;
}

function runCheck(check) {
  if (!wantJson) {
    console.log(`\n=== ${check.label} ===`);
    console.log(check.displayCommand ?? `${check.command} ${check.args.join(" ")}`);
  }

  const result = spawnSync(check.command, check.args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (!wantJson) {
    if (result.stdout?.trim()) {
      console.log(result.stdout.trim());
    }

    if (result.stderr?.trim()) {
      console.error(result.stderr.trim());
    }

    if (result.error) {
      console.error(result.error.message);
    }
  }

  return {
    status: result.error ? 1 : result.status ?? 1,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message ?? null,
  };
}

function main() {
  const branch = getBranchName();
  const checks = buildChecks();
  const result = {
    cwd: repoRoot,
    branch,
    ok: true,
    failures: [],
    checks: [],
  };

  if (checks.length === 0) {
    if (!wantJson) {
      console.log("No validation commands discovered for this repository.");
    }
    return result;
  }

  if (!wantJson) {
    console.log(`Running ${checks.length} validation checks for branch ${branch}.`);
  }

  for (const check of checks) {
    const execution = runCheck(check);
    result.checks.push({
      label: check.label,
      status: execution.status,
      stdout: execution.stdout,
      stderr: execution.stderr,
      error: execution.error,
    });
    if (execution.status !== 0) {
      result.failures.push(check.label);
    }
  }

  if (result.failures.length > 0) {
    result.ok = false;
    if (!wantJson) {
      console.error(`\nValidation failed on branch ${branch}: ${result.failures.join(", ")}`);
    }
    return result;
  }

  if (!wantJson) {
    console.log(`\nAll validation checks passed on branch ${branch}.`);
  }
  return result;
}

const result = main();

if (wantJson) {
  console.log(JSON.stringify(result, null, 2));
}

if (!result.ok) {
  process.exitCode = 1;
}
