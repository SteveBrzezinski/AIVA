import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const argv = process.argv.slice(2);
const args = new Set(argv);
const wantJson = args.has("--json");
const WORKTREE_ROOT = path.join(repoRoot, "codex-worktrees");
const LEGACY_WORKTREE_ROOT = path.join(repoRoot, ".codex-worktrees");
let requestedIssueNumber = null;

for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--issue" && argv[index + 1]) {
    const parsed = Number(argv[index + 1]);
    if (Number.isFinite(parsed)) {
      requestedIssueNumber = parsed;
    }
  }
}

function runGit(gitArgs) {
  return execFileSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function loadIssueData() {
  const raw = execFileSync(process.execPath, ["scripts/github-issues.mjs", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw);
}

function slugify(text) {
  const slug = text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  return slug || "draft";
}

function branchToFolder(branch) {
  return branch.replace(/[\\/]+/g, "-");
}

function refExists(ref) {
  try {
    runGit(["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

function loadExistingDraft() {
  const drafts = [];
  for (const metaDir of [WORKTREE_ROOT, LEGACY_WORKTREE_ROOT]) {
    if (!existsSync(metaDir)) {
      continue;
    }

    for (const entry of readdirSync(metaDir).filter((item) => item.endsWith(".meta.json"))) {
      const filePath = path.join(metaDir, entry);
      try {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        if (data.worktreePath && existsSync(data.worktreePath)) {
          drafts.push(data);
        }
      } catch {
        // Ignore invalid metadata files and continue.
      }
    }
  }

  return drafts;
}

function loadOverrides() {
  for (const candidate of [
    path.join(WORKTREE_ROOT, "issue-worker.overrides.json"),
    path.join(LEGACY_WORKTREE_ROOT, "issue-worker.overrides.json"),
  ]) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8"));
      return {
        maxConcurrentDrafts:
          Number.isFinite(Number(raw.maxConcurrentDrafts)) && Number(raw.maxConcurrentDrafts) > 0
            ? Number(raw.maxConcurrentDrafts)
            : 2,
      };
    } catch {
      return {
        maxConcurrentDrafts: 2,
      };
    }
  }

  return {
    maxConcurrentDrafts: 2,
  };
}

function getBaseRef() {
  try {
    return runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  } catch {}

  for (const candidate of ["origin/main", "origin/master", "main", "master", "HEAD"]) {
    if (candidate === "HEAD" || refExists(candidate)) {
      return candidate;
    }
  }

  return "HEAD";
}

function main() {
  const issueData = loadIssueData();
  const overrides = loadOverrides();
  const existingDrafts = loadExistingDraft();

  if (requestedIssueNumber !== null) {
    const matchingDraft = existingDrafts.find((entry) => entry.issueNumber === requestedIssueNumber);
    if (matchingDraft) {
      const result = {
        created: false,
        reused: true,
        issue: {
          number: matchingDraft.issueNumber,
          title: matchingDraft.issueTitle,
          url: matchingDraft.issueUrl,
        },
        branch: matchingDraft.branch,
        worktreePath: matchingDraft.worktreePath,
        baseRef: matchingDraft.baseRef,
      };

      if (wantJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        `Reusing existing draft for issue #${matchingDraft.issueNumber}: ${matchingDraft.issueTitle}`
      );
      console.log(`Branch: ${matchingDraft.branch}`);
      console.log(`Worktree: ${matchingDraft.worktreePath}`);
      console.log(`Base ref: ${matchingDraft.baseRef}`);
      console.log(matchingDraft.issueUrl);
      return;
    }
  }

  if (existingDrafts.length >= overrides.maxConcurrentDrafts) {
    const message = `Max concurrent drafts reached (${overrides.maxConcurrentDrafts}).`;
    if (wantJson) {
      console.log(
        JSON.stringify(
          {
            created: false,
            message,
            activeDrafts: existingDrafts.map((entry) => ({
              issueNumber: entry.issueNumber,
              branch: entry.branch,
              worktreePath: entry.worktreePath,
            })),
          },
          null,
          2
        )
      );
      return;
    }

    console.log(message);
    for (const entry of existingDrafts) {
      console.log(`- #${entry.issueNumber} ${entry.branch} @ ${entry.worktreePath}`);
    }
    return;
  }

  const nextIssue = requestedIssueNumber !== null
    ? issueData.actionableIssues.find(
        (issue) => issue.number === requestedIssueNumber && !issue.claimed && !issue.completed
      ) ?? null
    : issueData.nextUnclaimed;

  if (!nextIssue && requestedIssueNumber !== null) {
    const message = `Issue #${requestedIssueNumber} is not available for a new draft.`;
    if (wantJson) {
      console.log(JSON.stringify({ created: false, message }, null, 2));
    } else {
      console.log(message);
    }
    return;
  }

  if (!nextIssue) {
    const message = "No unclaimed actionable issue is available for drafting.";
    if (wantJson) {
      console.log(JSON.stringify({ created: false, message }, null, 2));
    } else {
      console.log(message);
    }
    return;
  }

  const matchingDraft = existingDrafts.find((entry) => entry.issueNumber === nextIssue.number);
  if (matchingDraft) {
    const result = {
      created: false,
      reused: true,
      issue: {
        number: matchingDraft.issueNumber,
        title: matchingDraft.issueTitle,
        url: matchingDraft.issueUrl,
      },
      branch: matchingDraft.branch,
      worktreePath: matchingDraft.worktreePath,
      baseRef: matchingDraft.baseRef,
    };

    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Reusing existing draft for issue #${matchingDraft.issueNumber}: ${matchingDraft.issueTitle}`);
    console.log(`Branch: ${matchingDraft.branch}`);
    console.log(`Worktree: ${matchingDraft.worktreePath}`);
    console.log(`Base ref: ${matchingDraft.baseRef}`);
    console.log(matchingDraft.issueUrl);
    return;
  }

  const slug = slugify(nextIssue.title);
  const branch = `v1/${slug}`;
  const worktreePath = path.join(WORKTREE_ROOT, branchToFolder(branch));
  const metadataPath = path.join(WORKTREE_ROOT, `issue-${nextIssue.number}.meta.json`);
  const baseRef = getBaseRef();
  mkdirSync(path.dirname(worktreePath), { recursive: true });

  if (!existsSync(worktreePath)) {
    if (refExists(`refs/heads/${branch}`)) {
      runGit(["worktree", "add", worktreePath, branch]);
    } else {
      runGit(["worktree", "add", "-b", branch, worktreePath, baseRef]);
    }
  }

  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        issueNumber: nextIssue.number,
        issueTitle: nextIssue.title,
        issueUrl: nextIssue.url,
        branch,
        worktreePath,
        baseRef,
        phase: "drafting",
      },
      null,
      2
    )
  );

  const result = {
    created: true,
    issue: {
      number: nextIssue.number,
      title: nextIssue.title,
      url: nextIssue.url,
    },
    branch,
    worktreePath,
    baseRef,
  };

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Prepared draft for issue #${nextIssue.number}: ${nextIssue.title}`);
  console.log(`Branch: ${branch}`);
  console.log(`Worktree: ${worktreePath}`);
  console.log(`Base ref: ${baseRef}`);
  console.log(nextIssue.url);
}

try {
  main();
} catch (error) {
  console.error(`Issue draft setup failed: ${error.message}`);
  process.exitCode = 1;
}
