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
const record = <T extends z.ZodType>(schema: T) => z.record(z.string(), schema);

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
        ? new Map(Object.entries(previous))
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
