import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface Handle {
  writeFile(content: string): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface AtomicIO {
  open(file: string, flags: string, mode?: number): Promise<Handle>;
  rename(from: string, to: string): Promise<void>;
  rm(file: string, options: { force: boolean }): Promise<void>;
}
export class CommitUncertainError extends Error {}
export type AtomicWriter = (target: string, content: string) => Promise<void>;

export async function atomicWrite(
  target: string,
  content: string,
  io: AtomicIO = fs,
): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    const file = await io.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await io.rename(temporary, target);
    renamed = true;
    const directory = await io.open(path.dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (renamed)
      throw new CommitUncertainError(
        "Rename completed but durability is uncertain; restart before writing again",
        { cause: error },
      );
    throw error;
  } finally {
    await io.rm(temporary, { force: true }).catch(() => undefined);
  }
}
