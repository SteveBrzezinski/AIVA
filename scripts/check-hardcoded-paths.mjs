import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
let repoRoot = process.cwd();
const scanStaged = args.has("--staged");
const wantJson = args.has("--json");

for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--cwd" && argv[index + 1]) {
    repoRoot = path.resolve(argv[index + 1]);
  }
}

const SCAN_EXTENSIONS = new Set([
  ".bat",
  ".cjs",
  ".cmd",
  ".conf",
  ".config",
  ".css",
  ".env",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".less",
  ".mdx",
  ".mjs",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SCAN_FILENAMES = new Set([
  ".env.example",
  ".gitignore",
  ".npmrc",
  "Dockerfile",
]);

const IGNORE_PREFIXES = [
  ".codex-worktrees/",
  "codex-worktrees/",
  ".git/",
  "dist/",
  "node_modules/",
  "src-tauri/target/",
];

const PATTERNS = [
  {
    type: "Windows user profile path",
    regex: /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'`]+/g,
  },
  {
    type: "Unix home path",
    regex: /(^|[^A-Za-z0-9_])\/(?:Users|home)\/[A-Za-z0-9._-]+/g,
  },
];

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getCandidateFiles() {
  const gitArgs = scanStaged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["ls-files", "-co", "--exclude-standard"];
  const output = runGit(gitArgs);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => shouldScan(file));
}

function shouldScan(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (IGNORE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }

  const baseName = path.basename(normalized);
  if (SCAN_FILENAMES.has(baseName)) {
    return true;
  }

  const extension = path.extname(baseName).toLowerCase();
  return SCAN_EXTENSIONS.has(extension);
}

function readText(filePath) {
  if (scanStaged) {
    return execFileSync("git", ["show", `:${filePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

function isSuppressed(line) {
  return line.includes("codex-ignore-hardcoded-path");
}

function collectFindings(filePath, sourceText) {
  const findings = [];
  const lines = sourceText.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line || isSuppressed(line)) {
      return;
    }

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const rawMatch = pattern.type === "Unix home path" ? match[0].trim() : match[0];
        const value = rawMatch.replace(/^[^/]*?(\/(?:Users|home)\/)/, "$1");
        findings.push({
          filePath,
          lineNumber: index + 1,
          type: pattern.type,
          value,
          line: line.trim(),
        });
      }
    }
  });

  return findings;
}

function main() {
  const files = getCandidateFiles();
  const findings = [];

  for (const filePath of files) {
    try {
      const text = readText(filePath);
      findings.push(...collectFindings(filePath, text));
    } catch (error) {
      console.warn(`[hardcoded-scan] skipped ${filePath}: ${error.message}`);
    }
  }

  const result = {
    cwd: repoRoot,
    staged: scanStaged,
    ok: findings.length === 0,
    findings,
  };

  if (findings.length === 0) {
    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(
      scanStaged
        ? "No staged hardcoded user-specific paths found."
        : "No hardcoded user-specific paths found."
    );
    return;
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  console.error("Found hardcoded user-specific paths:");
  for (const finding of findings) {
    console.error(
      `- ${finding.filePath}:${finding.lineNumber} [${finding.type}] ${finding.value}`
    );
    console.error(`  ${finding.line}`);
  }

  console.error(
    'Replace hardcoded paths with config/env-driven values. Add "codex-ignore-hardcoded-path" only for intentional examples.'
  );
  process.exitCode = 1;
}

main();
