import fs from "node:fs";
import crypto from "node:crypto";
import { dedupePath, feedbackDir } from "./paths.mjs";

function normalizeClaim(claim) {
  return String(claim || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint({ lessonId, claim } = {}) {
  const key = `${lessonId || "unknown"}|${normalizeClaim(claim)}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function load(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(dedupePath(repoRoot), "utf8"));
  } catch {
    return { fingerprints: {}, max: 200 };
  }
}

function save(repoRoot, data) {
  fs.mkdirSync(feedbackDir(repoRoot), { recursive: true });
  fs.writeFileSync(dedupePath(repoRoot), JSON.stringify(data, null, 2) + "\n");
}

export function isDuplicate(repoRoot, fp) {
  const data = load(repoRoot);
  return !!(data.fingerprints && data.fingerprints[fp]);
}

export function rememberFingerprint(repoRoot, fp) {
  const data = load(repoRoot);
  data.fingerprints = data.fingerprints || {};
  data.fingerprints[fp] = new Date().toISOString();
  const keys = Object.keys(data.fingerprints);
  const max = data.max || 200;
  if (keys.length > max) {
    const overflow = keys
      .sort((a, b) =>
        String(data.fingerprints[a]).localeCompare(String(data.fingerprints[b])),
      )
      .slice(0, keys.length - max);
    for (const k of overflow) delete data.fingerprints[k];
  }
  save(repoRoot, data);
}
