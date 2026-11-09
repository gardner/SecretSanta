import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";

const guestSchema = z.object({
  id: z.string(),
  name: z.string(),
  assignment: z.string(),
});
export const partySchema = z.object({
  id: z.string(),
  name: z.string(),
  budget: z.string(),
  criteria: z.string(),
  createdAt: z.string(),
  guests: z.array(guestSchema).min(2).max(50),
});
export const snapshotSchema = z.object({
  version: z.literal(1),
  parties: z.array(partySchema),
});
export type Party = z.infer<typeof partySchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
const inputText = (label: string, maximum: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(maximum, `${label} must be at most ${maximum} characters`);
const optionalText = (label: string, maximum: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .max(maximum, `${label} must be at most ${maximum} characters`)
    .default("");
export const inputSchema = z.object({
  name: inputText("Party name", 100),
  budget: optionalText("Budget", 50),
  criteria: optionalText("Gift criteria", 500),
  guests: z
    .array(inputText("Guest name", 50), { error: "Guest names must be a list" })
    .min(2, "At least 2 guests are required")
    .max(50, "Maximum 50 guests allowed")
    .refine(
      (names) => new Set(names).size === names.length,
      "Guest names must be unique",
    ),
});

// Fisher-Yates is uniform; rejecting self-assignments preserves uniformity
// across all derangements, including mutual pairs and smaller cycles.
export function assign(
  names: string[],
  random: (maximum: number) => number = randomInt,
): Map<string, string> {
  if (names.length < 2 || new Set(names).size !== names.length)
    throw new Error("At least two unique guests are required");
  let shuffled: string[];
  do {
    shuffled = shuffle(names, random);
  } while (shuffled.some((name, i) => name === names[i]));
  return new Map(names.map((name, i) => [name, shuffled[i] ?? ""]));
}
function shuffle(
  names: string[],
  random: (maximum: number) => number,
): string[] {
  const result = [...names];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined)
      throw new Error("Invalid shuffle index");
    result[i] = b;
    result[j] = a;
  }
  return result;
}

export function makeParty(input: z.infer<typeof inputSchema>): Party {
  const assignments = assign(input.guests);
  return {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    guests: input.guests.map((name) => ({
      id: randomUUID(),
      name,
      assignment: assignments.get(name) ?? "",
    })),
  };
}

export function validateSnapshot(input: unknown): Snapshot {
  const state = snapshotSchema.parse(input);
  const ids = new Set<string>();
  for (const party of state.parties) {
    for (const id of validateParty(party, ids)) ids.add(id);
  }
  return state;
}

// Validate only the candidate against committed IDs; never mutate the ID index
// until its snapshot has been committed successfully.
export function validateParty(
  party: Party,
  existing: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  ids.add(party.id);
  validateGuests(party, ids);
  for (const id of ids)
    if (existing.has(id)) throw new Error("Duplicate record ID");
  return ids;
}

function validateGuests(party: Party, ids: Set<string>): void {
  const names = new Set(party.guests.map((guest) => guest.name));
  const recipients = new Set(party.guests.map((guest) => guest.assignment));
  if (names.size !== party.guests.length || recipients.size !== names.size)
    throw new Error("Invalid guest assignments");
  for (const guest of party.guests) {
    if (
      ids.has(guest.id) ||
      !names.has(guest.assignment) ||
      guest.name === guest.assignment
    )
      throw new Error("Invalid guest record");
    ids.add(guest.id);
  }
}
