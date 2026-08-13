import fs from "node:fs/promises";
import path from "node:path";
import { config, ENTITY_KINDS } from "./config.js";
import * as store from "./store.js";
import { getDb } from "./db.js";

/**
 * Writes a plaintext Obsidian mirror of the network. This is an export, not a
 * backup. It is decrypted by definition, so put it somewhere you control.
 * The database remains the source of truth.
 */
async function main() {
  await getDb();
  const root = config.exportDir;
  await fs.rm(root, { recursive: true, force: true });

  let written = 0;
  const activeGoals = await store.listGoals("active", 5000);

  for (const kind of ENTITY_KINDS) {
    const list = await store.listEntities(kind, undefined, 5000);
    if (!list.length) continue;
    const dir = path.join(root, kind.charAt(0).toUpperCase() + kind.slice(1) + "s");
    await fs.mkdir(dir, { recursive: true });

    for (const entity of list) {
      const facts = await store.factsFor(entity.id, 500);
      const open = (await store.openCommitments(2000)).filter((c) => c.entityId === entity.id);
      const goals = activeGoals.filter((goal) => goal.entityId === entity.id);

      const frontmatter = [
        "---",
        `title: ${JSON.stringify(entity.name)}`,
        `kind: ${entity.kind}`,
        `status: ${entity.status}`,
        entity.country ? `country: ${JSON.stringify(entity.country)}` : null,
        ...Object.entries(entity.meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
        "---",
      ]
        .filter(Boolean)
        .join("\n");

      const body = [
        `# ${entity.name}`,
        open.length
          ? `## Open\n${open
              .map((c) => `- [ ] ${c.title}${c.dueOn ? ` (due ${c.dueOn}${c.dueTime ? ` ${c.dueTime}` : ""})` : ""}${c.waitingOn ? ` (waiting on ${c.waitingOn})` : c.direction === "theirs" ? " (they owe)" : ""}`)
              .join("\n")}`
          : "",
        goals.length
          ? `## Goals\n${goals
              .map((goal) => `- ${goal.title}${goal.targetOn ? ` (target ${goal.targetOn})` : ""}`)
              .join("\n")}`
          : "",
        facts.length
          ? `## History\n${facts
              .map((f) => `### ${f.label}: ${String(f.createdAt).slice(0, 10)}\n${f.body}`)
              .join("\n\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      await fs.writeFile(path.join(dir, `${entity.slug}.md`), `${frontmatter}\n\n${body}\n`, "utf8");
      written += 1;
    }
  }

  if (activeGoals.length) {
    await fs.mkdir(root, { recursive: true });
    const body = [
      "# Active goals",
      ...activeGoals.map(
        (goal) =>
          `- ${goal.title}${goal.targetOn ? ` (target ${goal.targetOn})` : ""}${goal.entityName ? ` - ${goal.entityName}` : ""}`,
      ),
    ].join("\n");
    await fs.writeFile(path.join(root, "Goals.md"), `${body}\n`, "utf8");
    written += 1;
  }

  console.log(`Exported ${written} entity files to ${root}`);
  console.log("This is plaintext. Store it accordingly.");
  process.exit(0);
}

main();
