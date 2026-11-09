import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assign, validateSnapshot, type Snapshot } from "./model.js";

export async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
const legacyParty = z.object({
  id: z.string(),
  name: z.string(),
  budget: z.string(),
  criteria: z.string(),
  createdAt: z.string(),
  guests: z.array(z.string()).min(2),
});
// Map entries explicitly so __proto__ survives validation as an ordinary key.
const record = <T extends z.ZodType>(schema: T) =>
  z
    .custom<Record<string, unknown>>(
      (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .transform((value) =>
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, schema.parse(item)]),
      ),
    );

export async function migrate(directory: string): Promise<Snapshot> {
  const raw = await Promise.all(
    ["parties.json", "assignments.json", "guest_links.json"].map((file) =>
      readOptional(path.join(directory, file)),
    ),
  );
  if (raw.every((value) => value === undefined))
    return { version: 1, parties: [] };
  if (raw.some((value) => value === undefined))
    throw new Error(
      "Incomplete legacy storage; restore all three files from backup",
    );
  const parties = record(legacyParty).parse(JSON.parse(raw[0] ?? "{}"));
  const assignments = record(record(z.string())).parse(
    JSON.parse(raw[1] ?? "{}"),
  );
  const links = record(
    z.object({ partyId: z.string(), guestName: z.string() }),
  ).parse(JSON.parse(raw[2] ?? "{}"));
  return validateSnapshot({
    version: 1,
    parties: Object.values(parties).map((party) => {
      const previous = Object.hasOwn(assignments, party.id)
        ? assignments[party.id]
        : undefined;
      const recipients = previous
        ? recoverAssignments(party.guests, previous)
        : assign(party.guests);
      return {
        ...party,
        guests: party.guests.map((name) => ({
          name,
          id: findGuestLink(links, party.id, name),
          assignment: recipients.get(name),
        })),
      };
    }),
  });
}

function findGuestLink(
  links: Record<string, { partyId: string; guestName: string }>,
  partyId: string,
  name: string,
): string {
  const matches = Object.entries(links).filter(
    ([, link]) => link.partyId === partyId && link.guestName === name,
  );
  const id = matches[0]?.[0];
  if (matches.length !== 1 || id === undefined)
    throw new Error(
      "Missing or duplicate legacy guest link; restore storage from backup",
    );
  return id;
}

function recoverAssignments(
  names: string[],
  previous: Record<string, string>,
): Map<string, string> {
  const recipients = new Map(Object.entries(previous));
  const missing = names.filter((name) => !recipients.has(name));
  if (missing.length === 0) return recipients;
  const used = new Set(recipients.values());
  const remaining = names.filter((name) => !used.has(name));
  // Only repair the known legacy setter bug, never guess or redraw a party.
  if (
    missing.length !== 1 ||
    missing[0] !== "__proto__" ||
    remaining.length !== 1
  ) {
    throw new Error(
      "Incomplete legacy assignments; restore storage from backup",
    );
  }
  const recipient = remaining[0];
  if (recipient === undefined || recipient === "__proto__")
    throw new Error("Invalid legacy assignment");
  recipients.set("__proto__", recipient);
  return recipients;
}
