import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  atomicWrite,
  CommitUncertainError,
  type AtomicIO,
} from "../src/atomic.js";
import { Store } from "../src/store.js";
import { makeParty } from "../src/model.js";

function fakeIO(calls: string[], failDirectorySync = false): AtomicIO {
  return {
    open: (file) =>
      Promise.resolve({
        writeFile: () => {
          calls.push("write");
          return Promise.resolve();
        },
        sync: () => {
          calls.push(file === "/data" ? "directory sync" : "file sync");
          return file === "/data" && failDirectorySync
            ? Promise.reject(new Error("sync failed"))
            : Promise.resolve();
        },
        close: () => {
          calls.push("close");
          return Promise.resolve();
        },
      }),
    rename: () => {
      calls.push("rename");
      return Promise.resolve();
    },
    rm: () => Promise.resolve(),
  };
}
void test("atomic writes sync the file before rename and directory after rename", async () => {
  const calls: string[] = [];
  await atomicWrite("/data/state.json", "data", fakeIO(calls));
  assert.deepEqual(calls, [
    "write",
    "file sync",
    "close",
    "rename",
    "directory sync",
    "close",
  ]);
});
void test("post-rename directory sync failure is distinguished from a failed write", async () => {
  await assert.rejects(
    atomicWrite("/data/state.json", "data", fakeIO([], true)),
    CommitUncertainError,
  );
});
void test("an uncertain commit blocks later writes from overwriting unseen data", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "santa-atomic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let fail = false;
  const store = await Store.open(dir, async (target, content) => {
    await atomicWrite(target, content);
    if (fail && target.endsWith("/state.json"))
      throw new CommitUncertainError("simulated directory sync failure");
  });
  const input = { name: "Party", budget: "", criteria: "", guests: ["A", "B"] };
  await store.add(makeParty(input));
  fail = true;
  await assert.rejects(store.add(makeParty(input)), CommitUncertainError);
  const disk = await readFile(path.join(dir, "state.json"), "utf8");
  await assert.rejects(store.add(makeParty(input)), /restart/i);
  assert.equal(await readFile(path.join(dir, "state.json"), "utf8"), disk);
  assert.equal((await Store.open(dir)).snapshot.parties.length, 2);
});

void test("failed pre-rename writes do not publish guest indexes or reserve IDs", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "santa-retry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let fail = false;
  const store = await Store.open(dir, async (target, content) => {
    if (fail && target.endsWith("/state.json")) throw new Error("write failed");
    await atomicWrite(target, content);
  });
  const input = { name: "Party", budget: "", criteria: "", guests: ["A", "B"] };
  await store.add(makeParty(input));
  const previous = await readFile(path.join(dir, "state.json"), "utf8");
  const party = makeParty(input);
  const guest = party.guests[0];
  assert.ok(guest);
  fail = true;
  await assert.rejects(store.add(party), /write failed/);
  assert.equal(store.guest(guest.id), undefined);
  assert.equal(await readFile(path.join(dir, "state.json"), "utf8"), previous);
  fail = false;
  await store.add(party);
  assert.equal(store.guest(guest.id)?.assignment, guest.assignment);
  assert.equal(
    await readFile(path.join(dir, "state.json.backup"), "utf8"),
    previous,
  );
});
