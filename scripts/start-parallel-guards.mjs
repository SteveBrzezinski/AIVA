import { spawn } from "node:child_process";

const repoRoot = process.cwd();

const tasks = [
  {
    name: "hardcoded-path-scan",
    args: ["scripts/check-hardcoded-paths.mjs"],
  },
  {
    name: "branch-validation",
    args: ["scripts/validate-branch.mjs"],
  },
  {
    name: "draft-qa",
    args: ["scripts/validate-active-drafts.mjs"],
  },
  {
    name: "github-issue-scan",
    args: ["scripts/github-issues.mjs"],
  },
  {
    name: "issue-draft-prepare",
    args: ["scripts/start-next-issue-draft.mjs"],
  },
];

function runTask(task) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, task.args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[${task.name}] ${chunk}`);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[${task.name}] ${chunk}`);
    });

    child.on("close", (code) => {
      resolve({
        name: task.name,
        code: code ?? 1,
      });
    });
  });
}

async function main() {
  console.log(`Starting ${tasks.length} local guard tasks in parallel...`);
  const results = await Promise.all(tasks.map((task) => runTask(task)));
  const failures = results.filter((result) => result.code !== 0);

  if (failures.length > 0) {
    console.error(
      `Parallel guard round finished with failures: ${failures
        .map((failure) => failure.name)
        .join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  console.log("Parallel guard round finished successfully.");
}

main();
