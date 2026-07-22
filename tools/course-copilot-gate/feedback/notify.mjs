import fs from "node:fs";
import crypto from "node:crypto";
import { notificationsPath, feedbackDir } from "./paths.mjs";

function load(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(notificationsPath(repoRoot), "utf8"));
  } catch {
    return { items: [] };
  }
}

function save(repoRoot, data) {
  fs.mkdirSync(feedbackDir(repoRoot), { recursive: true });
  fs.writeFileSync(
    notificationsPath(repoRoot),
    JSON.stringify(data, null, 2) + "\n",
  );
}

export function appendNotification(repoRoot, { number, url, title } = {}) {
  const data = load(repoRoot);
  const item = {
    id: crypto.randomUUID(),
    number: number != null ? Number(number) : null,
    url: url != null ? String(url) : null,
    title: title != null ? String(title) : "",
    createdAt: new Date().toISOString(),
    seen: false,
  };
  data.items = Array.isArray(data.items) ? data.items : [];
  data.items.push(item);
  if (data.items.length > 50) data.items = data.items.slice(-50);
  save(repoRoot, data);
  return item;
}

export function listUnseen(repoRoot) {
  const data = load(repoRoot);
  return (data.items || []).filter((i) => i && !i.seen);
}

export function ackNotifications(repoRoot, ids) {
  const set = new Set((ids || []).map(String));
  const data = load(repoRoot);
  for (const item of data.items || []) {
    if (item && set.has(String(item.id))) item.seen = true;
  }
  save(repoRoot, data);
}
