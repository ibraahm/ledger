import fs from "node:fs/promises";
import path from "node:path";
import * as store from "./store.js";

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface VaultSyncResult {
  root: string;
  files: number;
  created: number;
  updated: number;
  skipped: number;
  syncedAt: string;
}

async function markdownFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const items = await fs.readdir(directory, { withFileTypes: true });
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith(".") || found.length >= MAX_FILES) continue;
      const full = path.join(directory, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) await visit(full);
      else if (item.isFile() && item.name.toLowerCase().endsWith(".md")) found.push(full);
    }
  };
  await visit(root);
  return found;
}

export async function syncVault(input: string): Promise<VaultSyncResult> {
  const root = path.resolve(input);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Markdown vault folder not found.");

  const files = await markdownFiles(root);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const file of files) {
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const body = await fs.readFile(file, "utf8");
    if (!body.trim()) {
      skipped += 1;
      continue;
    }
    const relative = path.relative(root, file).split(path.sep).join("/");
    const outcome = await store.upsertExternalEntry(body, `vault:${relative}`, stat.mtime.toISOString());
    if (outcome === "created") created += 1;
    else updated += 1;
  }

  return { root, files: files.length, created, updated, skipped, syncedAt: new Date().toISOString() };
}
