import { mkdir } from "node:fs/promises";
import path from "node:path";
import { migrate, readOptional } from "./migrate.js";
import {
  partySchema,
  validateParty,
  validateSnapshot,
  type Party,
  type Snapshot,
} from "./model.js";
import {
  atomicWrite,
  CommitUncertainError,
  type AtomicWriter,
} from "./atomic.js";

export interface GuestAssignment {
  party: Pick<Party, "name" | "budget" | "criteria">;
  guestName: string;
  assignment: string;
}

// One process owns the directory. Indexes and cached bytes advance only on commit.
export class Store {
  private tail: Promise<void> = Promise.resolve();
  private readonly ids = new Set<string>();
  private readonly guests = new Map<string, GuestAssignment>();
  private uncertain = false;
  private constructor(
    private directory: string,
    private state: Snapshot,
    private serialized: string | undefined,
    private write: AtomicWriter,
  ) {
    for (const party of state.parties) this.index(party);
  }
  get snapshot(): Snapshot {
    return structuredClone(this.state);
  }

  static async open(
    directory: string,
    write: AtomicWriter = atomicWrite,
  ): Promise<Store> {
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, "state.json");
    const raw = await readOptional(target);
    const marker = await readOptional(
      path.join(directory, "state.initialized"),
    );
    if (
      raw === undefined &&
      (marker !== undefined ||
        (await readOptional(`${target}.backup`)) !== undefined)
    ) {
      throw new Error(
        "Current snapshot is missing; restore state.json from a known-good backup",
      );
    }
    const state =
      raw === undefined
        ? await migrate(directory)
        : validateSnapshot(JSON.parse(raw));
    const store = new Store(directory, state, raw, write);
    if (raw === undefined && state.parties.length > 0)
      await store.persist(state);
    else if (raw !== undefined && marker === undefined)
      await write(path.join(directory, "state.initialized"), "1\n");
    return store;
  }

  guest(id: string): GuestAssignment | undefined {
    const result = this.guests.get(id);
    return result ? { ...result, party: { ...result.party } } : undefined;
  }

  add(input: Party): Promise<void> {
    // Parse/detach only the incoming party; historical records were validated at startup.
    const party = partySchema.parse(input);
    const operation = this.tail.then(async () => {
      if (this.uncertain)
        throw new Error(
          "Storage commit is uncertain; restart before writing again",
        );
      validateParty(party, this.ids);
      const next: Snapshot = {
        version: 1,
        parties: [...this.state.parties, party],
      };
      await this.persist(next);
      this.state = next;
      this.index(party);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private index(party: Party): void {
    this.ids.add(party.id);
    for (const guest of party.guests) {
      this.ids.add(guest.id);
      this.guests.set(guest.id, {
        party: {
          name: party.name,
          budget: party.budget,
          criteria: party.criteria,
        },
        guestName: guest.name,
        assignment: guest.assignment,
      });
    }
  }

  private async persist(next: Snapshot): Promise<void> {
    const target = path.join(this.directory, "state.json");
    const serialized = JSON.stringify(next, null, 2);
    try {
      if (this.serialized === undefined)
        await this.write(path.join(this.directory, "state.initialized"), "1\n");
      else await this.write(`${target}.backup`, this.serialized);
      await this.write(target, serialized);
      this.serialized = serialized;
    } catch (error) {
      if (error instanceof CommitUncertainError) this.uncertain = true;
      throw error;
    }
  }
}
