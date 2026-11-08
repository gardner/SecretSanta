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
const inputText = (maximum: number) => z.string().trim().min(1).max(maximum);
export const inputSchema = z.object({
  name: inputText(100),
  budget: z.string().trim().max(50).default(""),
  criteria: z.string().trim().max(500).default(""),
  guests: z
    .array(inputText(50))
    .min(2)
    .max(50)
    .refine(
      (names) => new Set(names).size === names.length,
      "Guest names must be unique",
    ),
});

export function assign(names: string[]): Map<string, string> {
  const shuffled = [...names];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined)
      throw new Error("Invalid shuffle index");
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return new Map(
    shuffled.map((name, i) => [
      name,
      shuffled[(i + 1) % shuffled.length] ?? "",
    ]),
  );
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
    if (ids.has(party.id)) throw new Error("Duplicate party ID");
    ids.add(party.id);
    validateGuests(party, ids);
  }
  return state;
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
