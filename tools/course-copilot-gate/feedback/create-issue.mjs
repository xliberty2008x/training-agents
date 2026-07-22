import { spawn } from "node:child_process";

/**
 * Create a GitHub issue via gh CLI.
 * Spawn: spawn(ghBin, [...ghExtraArgs, "issue", "create", ...])
 *
 * @returns {Promise<{ ok: boolean, url: string|null, number: number|null, error: string|null, durationMs: number }>}
 */
export function createGithubIssue({
  ghBin = "gh",
  ghExtraArgs = [],
  repo = "xliberty2008x/training-agents",
  title,
  body,
  labels = [],
  timeoutMs = 30000,
  env,
} = {}) {
  const prefix = Array.isArray(ghExtraArgs) ? ghExtraArgs : [];
  const args = [
    ...prefix,
    "issue",
    "create",
    "--repo",
    String(repo),
    "--title",
    String(title || ""),
    "--body",
    String(body || ""),
  ];
  // Best-effort labels (mock ignores; real gh may fail if label missing — caller can retry without)
  for (const lab of labels || []) {
    if (lab) args.push("--label", String(lab));
  }

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer = null;
    const start = Date.now();

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - start });
    }

    function fail(error) {
      finish({ ok: false, url: null, number: null, error });
    }

    const child = spawn(ghBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env || process.env,
    });

    timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      fail("gh_timeout");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (err) => {
      fail(err.message || String(err));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        fail(stderr.trim() || `gh_exit_${code}`);
        return;
      }
      const url =
        stdout
          .trim()
          .split(/\s+/)
          .find((t) => /^https?:\/\//.test(t)) || stdout.trim();
      const m = String(url).match(/\/issues\/(\d+)/);
      finish({
        ok: true,
        url: url || null,
        number: m ? Number(m[1]) : null,
        error: null,
      });
    });
  });
}
