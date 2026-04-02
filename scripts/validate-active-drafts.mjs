import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const worktreeRoots = [
  path.join(repoRoot, "codex-worktrees"),
  path.join(repoRoot, ".codex-worktrees"),
];

function loadDraftMetadata() {
  return worktreeRoots
    .filter((candidate) => existsSync(candidate))
    .flatMap((root) =>
      readdirSync(root)
        .filter((entry) => entry.endsWith(".meta.json"))
        .map((entry) => path.join(root, entry))
    )
    .flatMap((filePath) => {
      try {
        return [JSON.parse(readFileSync(filePath, "utf8"))];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.worktreePath && existsSync(entry.worktreePath))
    .sort((left, right) => (left.issueNumber ?? 0) - (right.issueNumber ?? 0));
}

function validateDraft(metadata) {
  const hardcodedResult = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "check-hardcoded-paths.mjs"), "--cwd", metadata.worktreePath, "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  const hardcodedRaw = hardcodedResult.stdout?.trim() ?? "";
  if (!hardcodedRaw) {
    throw new Error(hardcodedResult.stderr?.trim() || "Hardcoded scan returned no JSON output.");
  }
  const hardcoded = JSON.parse(hardcodedRaw);

  const validationResult = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "validate-branch.mjs"), "--cwd", metadata.worktreePath, "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );

  const raw = validationResult.stdout?.trim() ?? "";
  if (!raw) {
    throw new Error(validationResult.stderr?.trim() || "Validation returned no JSON output.");
  }

  return {
    hardcoded,
    validation: JSON.parse(raw),
  };
}

function main() {
  const drafts = loadDraftMetadata();
  if (drafts.length === 0) {
    console.log("No active draft worktrees found.");
    return;
  }

  console.log(`Validating ${drafts.length} active draft worktree(s)...`);
  const failures = [];

  for (const draft of drafts) {
    console.log(`\n=== #${draft.issueNumber} ${draft.issueTitle} ===`);
    console.log(draft.branch);
    console.log(draft.worktreePath);

    try {
      const result = validateDraft(draft);
      if (result.hardcoded.ok && result.validation.ok) {
        console.log("QA: passed");
      } else {
        const failureParts = [];
        if (!result.hardcoded.ok) {
          failureParts.push(`hardcoded paths: ${result.hardcoded.findings.length}`);
        }
        if (!result.validation.ok) {
          failureParts.push(result.validation.failures.join(", "));
        }
        console.log(`QA: failed (${failureParts.join(" | ")})`);
        failures.push({
          issueNumber: draft.issueNumber,
          branch: draft.branch,
          failures: failureParts,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`QA: failed (${message})`);
      failures.push({
        issueNumber: draft.issueNumber,
        branch: draft.branch,
        failures: [message],
      });
    }
  }

  if (failures.length > 0) {
    console.error(
      `\nDraft QA found failures in: ${failures.map((entry) => entry.branch).join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAll active draft worktrees passed QA.");
}

main();
