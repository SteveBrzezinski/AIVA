import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const wantJson = args.has("--json");
const wantNextOnly = args.has("--next-unclaimed");
const WORKTREE_ROOT_CANDIDATES = [
  path.join(repoRoot, "codex-worktrees"),
  path.join(repoRoot, ".codex-worktrees"),
];
const OVERRIDES_FILE_CANDIDATES = [
  path.join(repoRoot, "codex-worktrees", "issue-worker.overrides.json"),
  path.join(repoRoot, ".codex-worktrees", "issue-worker.overrides.json"),
];

const COMPLETE_LABELS = new Set(["complete", "completed", "done", "shipped"]);

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseGithubRemote(url) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (!match) {
    throw new Error(`Cannot derive GitHub repo from remote: ${url}`);
  }

  return {
    owner: match[1],
    repo: match[2],
    slug: `${match[1]}/${match[2]}`,
  };
}

function loadRepoInfo() {
  const remoteUrl = runGit(["remote", "get-url", "origin"]);
  return parseGithubRemote(remoteUrl);
}

function loadBranchesAndWorktrees() {
  const branches = runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const worktreesRaw = runGit(["worktree", "list", "--porcelain"]);
  const worktrees = [];
  let current = {};

  for (const line of worktreesRaw.split(/\r?\n/)) {
    if (!line) {
      if (Object.keys(current).length > 0) {
        worktrees.push(current);
        current = {};
      }
      continue;
    }

    const [key, ...rest] = line.split(" ");
    current[key] = rest.join(" ");
  }

  if (Object.keys(current).length > 0) {
    worktrees.push(current);
  }

  return {
    branches,
    worktrees: worktrees.map((entry) => ({
      path: entry.worktree,
      branch: entry.branch ? entry.branch.replace("refs/heads/", "") : null,
    })),
  };
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

function compactSlug(text) {
  return slugify(text).replace(/-/g, "");
}

function getBranchLeaf(branchName) {
  const normalized = branchName.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function issueBranchMatches(branchName, issueNumber, issueTitle) {
  const numberMatch = new RegExp(
    `(^|[/-])(issue-|issues-|ticket-|tickets-)?${issueNumber}([/-]|$)`
  ).test(branchName);
  const titleSlug = slugify(issueTitle);
  const slugMatch = branchName === `v1/${titleSlug}` || branchName.startsWith(`v1/${titleSlug}-`);
  if (numberMatch || slugMatch) {
    return true;
  }

  const branchLeafSlug = slugify(getBranchLeaf(branchName));
  const branchLeafCompact = compactSlug(getBranchLeaf(branchName));
  const titleCompact = compactSlug(issueTitle);

  if (
    branchLeafCompact.length >= 4 &&
    (titleCompact.includes(branchLeafCompact) || branchLeafCompact.includes(titleCompact))
  ) {
    return true;
  }

  const branchTokens = branchLeafSlug.split("-").filter((token) => token.length >= 4);
  const titleTokens = new Set(titleSlug.split("-").filter((token) => token.length >= 4));
  return branchTokens.length >= 2 && branchTokens.every((token) => titleTokens.has(token));
}

function loadDraftMetadata() {
  return WORKTREE_ROOT_CANDIDATES
    .filter((candidate) => existsSync(candidate))
    .flatMap((metaDir) =>
      readdirSync(metaDir)
        .filter((entry) => entry.endsWith(".meta.json"))
        .map((entry) => path.join(metaDir, entry))
    )
    .flatMap((filePath) => {
      try {
        return [JSON.parse(readFileSync(filePath, "utf8"))];
      } catch {
        return [];
      }
    });
}

function loadOverrides() {
  for (const filePath of OVERRIDES_FILE_CANDIDATES) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      return {
        ignoreIssueNumbers: Array.isArray(raw.ignoreIssueNumbers)
          ? raw.ignoreIssueNumbers.map((value) => Number(value)).filter(Number.isFinite)
          : [],
        ignoreTitleSlugs: Array.isArray(raw.ignoreTitleSlugs)
          ? raw.ignoreTitleSlugs.map((value) => compactSlug(String(value))).filter(Boolean)
          : [],
        priorityIssueNumbers: Array.isArray(raw.priorityIssueNumbers)
          ? raw.priorityIssueNumbers.map((value) => Number(value)).filter(Number.isFinite)
          : [],
        maxConcurrentDrafts:
          Number.isFinite(Number(raw.maxConcurrentDrafts)) && Number(raw.maxConcurrentDrafts) > 0
            ? Number(raw.maxConcurrentDrafts)
            : 2,
      };
    } catch {
      return {
        ignoreIssueNumbers: [],
        ignoreTitleSlugs: [],
        priorityIssueNumbers: [],
        maxConcurrentDrafts: 2,
      };
    }
  }

  return {
    ignoreIssueNumbers: [],
    ignoreTitleSlugs: [],
    priorityIssueNumbers: [],
    maxConcurrentDrafts: 2,
  };
}

async function fetchIssues(slug) {
  const response = await fetch(`https://api.github.com/repos/${slug}/issues?state=open&per_page=30`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-overlay-assistant-codex-issues",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.filter((item) => !item.pull_request);
}

function normalizeIssue(issue, workspaceState, draftMetadata, overrides) {
  const labels = (issue.labels ?? []).map((label) => label.name.toLowerCase());
  const completed = labels.some((label) => COMPLETE_LABELS.has(label));
  const ignoredByOverride =
    overrides.ignoreIssueNumbers.includes(issue.number) ||
    overrides.ignoreTitleSlugs.includes(compactSlug(issue.title));

  const matchingBranches = workspaceState.branches.filter((branch) =>
    issueBranchMatches(branch, issue.number, issue.title)
  );
  const matchingWorktrees = workspaceState.worktrees.filter(
    (worktree) =>
      (worktree.branch && issueBranchMatches(worktree.branch, issue.number, issue.title)) ||
      worktree.path.replace(/\\/g, "/").includes(`/issue-${issue.number}`)
  );
  const metadataMatch = draftMetadata.find((entry) => entry.issueNumber === issue.number) ?? null;

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    labels,
    claimed:
      ignoredByOverride ||
      matchingBranches.length > 0 ||
      matchingWorktrees.length > 0 ||
      metadataMatch !== null,
    completed,
    matchingBranches,
    matchingWorktrees,
    metadataBranch: metadataMatch?.branch ?? null,
    metadataWorktreePath: metadataMatch?.worktreePath ?? null,
    ignoredByOverride,
  };
}

function printHuman(data) {
  console.log(`Repository: ${data.repo}`);
  console.log(`Open actionable issues: ${data.actionableIssues.length}`);

  if (data.actionableIssues.length === 0) {
    console.log("No open actionable issues found.");
    return;
  }

  for (const issue of data.actionableIssues.slice(0, 5)) {
    const claimState = issue.claimed ? "claimed" : "unclaimed";
    console.log(`- #${issue.number} ${issue.title} [${claimState}]`);
    if (issue.matchingBranches.length > 0) {
      console.log(`  branches: ${issue.matchingBranches.join(", ")}`);
    }
    if (issue.matchingWorktrees.length > 0) {
      const paths = issue.matchingWorktrees.map((entry) => `${entry.branch} @ ${entry.path}`);
      console.log(`  worktrees: ${paths.join(", ")}`);
    }
    if (issue.metadataBranch && issue.matchingBranches.length === 0) {
      console.log(`  draft-branch: ${issue.metadataBranch}`);
    }
    if (issue.metadataWorktreePath && issue.matchingWorktrees.length === 0) {
      console.log(`  draft-worktree: ${issue.metadataWorktreePath}`);
    }
    if (issue.ignoredByOverride) {
      console.log("  override: manually blocked from automatic picking");
    }
    console.log(`  ${issue.url}`);
  }

  if (data.nextUnclaimed) {
    console.log(`Next unclaimed issue: #${data.nextUnclaimed.number} ${data.nextUnclaimed.title}`);
  } else {
    console.log("No unclaimed issues are currently available.");
  }
}

async function main() {
  const repo = loadRepoInfo();
  const workspaceState = loadBranchesAndWorktrees();
  const draftMetadata = loadDraftMetadata();
  const overrides = loadOverrides();
  const issues = await fetchIssues(repo.slug);
  const normalized = issues.map((issue) =>
    normalizeIssue(issue, workspaceState, draftMetadata, overrides)
  );
  const priorityOrder = new Map(
    overrides.priorityIssueNumbers.map((issueNumber, index) => [issueNumber, index])
  );
  const actionableIssues = normalized
    .filter((issue) => !issue.completed)
    .map((issue, originalIndex) => ({ issue, originalIndex }))
    .sort((left, right) => {
      const leftPriority = priorityOrder.get(left.issue.number);
      const rightPriority = priorityOrder.get(right.issue.number);

      if (leftPriority !== undefined || rightPriority !== undefined) {
        if (leftPriority === undefined) {
          return 1;
        }
        if (rightPriority === undefined) {
          return -1;
        }
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
      }

      if (left.issue.claimed !== right.issue.claimed) {
        return left.issue.claimed ? 1 : -1;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ issue }) => issue);
  const nextUnclaimed = actionableIssues.find((issue) => !issue.claimed) ?? null;

  const result = {
    repo: repo.slug,
    actionableIssues,
    nextUnclaimed,
  };

  if (wantJson) {
    if (wantNextOnly) {
      console.log(JSON.stringify(nextUnclaimed, null, 2));
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (wantNextOnly) {
    if (!nextUnclaimed) {
      console.log("No unclaimed actionable issue found.");
      return;
    }

    console.log(`#${nextUnclaimed.number} ${nextUnclaimed.title}`);
    console.log(nextUnclaimed.url);
    return;
  }

  printHuman(result);
}

main().catch((error) => {
  console.error(`Issue scan failed: ${error.message}`);
  process.exitCode = 1;
});
