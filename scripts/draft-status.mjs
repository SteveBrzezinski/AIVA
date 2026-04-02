import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const argv = process.argv.slice(2);
const args = new Set(argv);
const wantJson = args.has("--json");
const worktreeRoots = [
  path.join(repoRoot, "codex-worktrees"),
  path.join(repoRoot, ".codex-worktrees"),
];

let requestedIssueNumber = null;
let nextPhase = null;

for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--issue" && argv[index + 1]) {
    const parsed = Number(argv[index + 1]);
    if (Number.isFinite(parsed)) {
      requestedIssueNumber = parsed;
    }
  }

  if (argv[index] === "--phase" && argv[index + 1]) {
    nextPhase = argv[index + 1];
  }
}

function loadDraftFiles() {
  return worktreeRoots
    .filter((candidate) => existsSync(candidate))
    .flatMap((root) =>
      readdirSync(root)
        .filter((entry) => entry.endsWith(".meta.json"))
        .map((entry) => path.join(root, entry))
    );
}

function loadDrafts() {
  return loadDraftFiles()
    .flatMap((filePath) => {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        return [
          {
            ...data,
            phase: data.phase || "drafting",
            _filePath: filePath,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((left, right) => (left.issueNumber ?? 0) - (right.issueNumber ?? 0));
}

function main() {
  const drafts = loadDrafts();

  if (requestedIssueNumber !== null && nextPhase) {
    const target = drafts.find((entry) => entry.issueNumber === requestedIssueNumber);
    if (!target) {
      const message = `No draft metadata found for issue #${requestedIssueNumber}.`;
      if (wantJson) {
        console.log(JSON.stringify({ updated: false, message }, null, 2));
      } else {
        console.log(message);
      }
      process.exitCode = 1;
      return;
    }

    target.phase = nextPhase;
    target.updatedAtMs = Date.now();
    writeFileSync(
      target._filePath,
      JSON.stringify(
        {
          issueNumber: target.issueNumber,
          issueTitle: target.issueTitle,
          issueUrl: target.issueUrl,
          branch: target.branch,
          worktreePath: target.worktreePath,
          baseRef: target.baseRef,
          phase: target.phase,
          updatedAtMs: target.updatedAtMs,
        },
        null,
        2
      )
    );

    const result = {
      updated: true,
      issueNumber: target.issueNumber,
      phase: target.phase,
      worktreePath: target.worktreePath,
    };

    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Updated issue #${target.issueNumber} to phase ${target.phase}.`);
    console.log(target.worktreePath);
    return;
  }

  const result = drafts.map((entry) => ({
    issueNumber: entry.issueNumber,
    issueTitle: entry.issueTitle,
    branch: entry.branch,
    worktreePath: entry.worktreePath,
    phase: entry.phase,
    updatedAtMs: entry.updatedAtMs ?? null,
  }));

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.length === 0) {
    console.log("No draft metadata found.");
    return;
  }

  for (const entry of result) {
    console.log(`#${entry.issueNumber} ${entry.issueTitle}`);
    console.log(`  ${entry.branch}`);
    console.log(`  ${entry.worktreePath}`);
    console.log(`  phase: ${entry.phase}`);
  }
}

main();
