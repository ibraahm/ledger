import { config } from "./config.js";
import { chat } from "./ollama.js";
import * as store from "./store.js";

export type RankedMemoryHit = store.MemoryHit & { match: "exact" | "related" };

export function parseSemanticIds(input: string): string[] {
  const match = input.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const value = JSON.parse(match[0]);
    return Array.isArray(value)
      ? value.map(String).filter((id) => /^(entry|fact|entity|task|goal|event):\d+$/.test(id)).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

export async function hybridMemorySearch(query: string, limit = 60): Promise<RankedMemoryHit[]> {
  const exact = await store.searchMemory(query, limit);
  const rankedExact = exact.map((hit) => ({ ...hit, match: "exact" as const }));
  if (!query.trim() || exact.length >= Math.min(10, limit)) return rankedExact;

  const seen = new Set(exact.map((hit) => `${hit.kind}:${hit.id}`));
  const recent = (await store.searchMemory("", 90)).filter((hit) => !seen.has(`${hit.kind}:${hit.id}`));
  if (!recent.length) return rankedExact;
  const catalog = recent.map((hit) => ({
    id: `${hit.kind}:${hit.id}`,
    text: `${hit.title}. ${hit.body} ${hit.context}`.replace(/\s+/g, " ").slice(0, 360),
  }));

  try {
    const response = await chat([
      {
        role: "system",
        content: "Rank private Ledger records by conceptual relevance. Return only a JSON array of record ids, most relevant first. Do not add prose. Include a record only when its meaning genuinely relates to the query, even if it uses different words.",
      },
      { role: "user", content: `Query: ${query}\n\nRecords:\n${catalog.map((item) => `${item.id}\t${item.text}`).join("\n")}` },
    ], [], { model: config.fastModel });
    const order = parseSemanticIds(response.content);
    const byId = new Map(recent.map((hit) => [`${hit.kind}:${hit.id}`, hit]));
    const related = order.map((id) => byId.get(id)).filter((hit): hit is store.MemoryHit => Boolean(hit))
      .map((hit) => ({ ...hit, match: "related" as const }));
    return [...rankedExact, ...related].slice(0, limit);
  } catch {
    return rankedExact;
  }
}
