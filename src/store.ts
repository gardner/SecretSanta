import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { migrate, readOptional } from "./migrate.js";
import { validateSnapshot, type Party, type Snapshot } from "./model.js";

// One process owns this directory. Publish memory only after the full snapshot is committed.
export class Store {
  private tail: Promise<void> = Promise.resolve();
  private constructor(
    private directory: string,
    private state: Snapshot,
  ) {}
  get snapshot(): Snapshot {
    return structuredClone(this.state);
  }

  static async open(directory: string): Promise<Store> {
    await mkdir(directory, { recursive: true });
    const raw = await readOptional(path.join(directory, "state.json"));
    const state =
      raw === undefined
        ? await migrate(directory)
        : validateSnapshot(JSON.parse(raw));
    const store = new Store(directory, state);
    if (raw === undefined && state.parties.length > 0)
      await store.persist(state);
    return store;
  }

  guest(
    id: string,
  ): { party: Party; guest: Party["guests"][number] } | undefined {
    for (const party of this.state.parties) {
      const guest = party.guests.find((item) => item.id === id);
      if (guest) return structuredClone({ party, guest });
    }
    return undefined;
  }

  add(party: Party): Promise<void> {
    const operation = this.tail.then(async () => {
      const next = validateSnapshot({
        version: 1,
        parties: [...this.state.parties, party],
      });
      await this.persist(next);
      this.state = next;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private async persist(next: Snapshot): Promise<void> {
    const target = path.join(this.directory, "state.json");
    const existing = await readOptional(target);
    if (existing !== undefined)
      await this.atomicWrite(`${target}.backup`, existing);
    await this.atomicWrite(target, JSON.stringify(next, null, 2));
  }

  private async atomicWrite(target: string, content: string): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
