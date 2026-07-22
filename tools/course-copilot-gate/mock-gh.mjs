#!/usr/bin/env node
// tools/course-copilot-gate/mock-gh.mjs
// Mock: node mock-gh.mjs issue create --repo X --title T --body B
const args = process.argv.slice(2);
if (args[0] === "issue" && args[1] === "create") {
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "owner/repo";
  const url = `https://github.com/${repo}/issues/99`;
  process.stdout.write(url + "\n");
  process.exit(0);
}
process.stderr.write("mock-gh: unsupported args " + args.join(" ") + "\n");
process.exit(1);
