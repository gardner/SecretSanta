import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import request from "supertest";
import { Store } from "../src/store.js";
import { createApp } from "../src/app.js";
import { assign, makeParty } from "../src/model.js";

async function directory(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "santa-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function legacy(
  dir: string,
  assignments: Record<string, string>,
): Promise<void> {
  await writeFile(
    path.join(dir, "parties.json"),
    JSON.stringify({
      p: {
        id: "p",
        name: "Legacy",
        budget: "",
        criteria: "",
        createdAt: "old",
        guests: ["__proto__", "Alice", "Bob"],
      },
    }),
  );
  await writeFile(
    path.join(dir, "assignments.json"),
    JSON.stringify({ p: assignments }),
  );
  await writeFile(
    path.join(dir, "guest_links.json"),
    JSON.stringify({
      proto: { partyId: "p", guestName: "__proto__" },
      alice: { partyId: "p", guestName: "Alice" },
      bob: { partyId: "p", guestName: "Bob" },
    }),
  );
}
const input = { name: "Party", budget: "", criteria: "", guests: ["A", "B"] };

void test("recover only the uniquely inferable legacy prototype assignment", async (t) => {
  const dir = await directory(t);
  await legacy(dir, { Alice: "Bob", Bob: "__proto__" });
  const store = await Store.open(dir);
  assert.deepEqual(
    store.snapshot.parties[0]?.guests.map((g) => [g.id, g.assignment]),
    [
      ["proto", "Alice"],
      ["alice", "Bob"],
      ["bob", "__proto__"],
    ],
  );
  assert.deepEqual((await Store.open(dir)).snapshot, store.snapshot);
});
void test("preserve explicitly stored prototype assignments and reject ambiguous corruption", async (t) => {
  const dir = await directory(t);
  await legacy(
    dir,
    Object.fromEntries([
      ["__proto__", "Bob"],
      ["Alice", "__proto__"],
      ["Bob", "Alice"],
    ]),
  );
  const store = await Store.open(dir);
  assert.equal(store.snapshot.parties[0]?.guests[0]?.assignment, "Bob");
  const bad = await directory(t);
  await legacy(bad, { Alice: "Bob" });
  await assert.rejects(Store.open(bad));
});
void test("missing current snapshot never falls back to stale legacy data", async (t) => {
  const dir = await directory(t);
  await legacy(
    dir,
    Object.fromEntries([
      ["__proto__", "Bob"],
      ["Alice", "__proto__"],
      ["Bob", "Alice"],
    ]),
  );
  const store = await Store.open(dir);
  await store.add(makeParty(input));
  const backup = await readFile(path.join(dir, "state.json.backup"), "utf8");
  await rm(path.join(dir, "state.json"));
  await rm(path.join(dir, "state.initialized")); // Upgrade from an older marker-free store.
  await assert.rejects(Store.open(dir), /missing.*snapshot|snapshot.*missing/i);
  assert.equal(
    await readFile(path.join(dir, "state.json.backup"), "utf8"),
    backup,
  );
});
void test("missing first snapshot is detected even before a backup exists", async (t) => {
  const dir = await directory(t);
  const store = await Store.open(dir);
  await store.add(makeParty(input));
  await rm(path.join(dir, "state.json"));
  await assert.rejects(Store.open(dir), /missing.*snapshot|snapshot.*missing/i);
});
void test("invalid submissions do not consume successful-creation quota", async (t) => {
  const app = createApp(
    await Store.open(await directory(t)),
    "https://example.test",
  );
  for (let i = 0; i < 12; i++)
    await request(app)
      .post("/api/parties")
      .send({ name: "", guests: ["A"] })
      .expect(400);
  await request(app).post("/api/parties").send(input).expect(201);
});
void test("validation identifies the field and required guest count", async (t) => {
  const app = createApp(
    await Store.open(await directory(t)),
    "https://example.test",
  );
  const result = await request(app)
    .post("/api/parties")
    .send({ name: "", guests: ["A"] })
    .expect(400);
  const { error } = result.body as { error: string };
  assert.match(error, /party name/i);
  assert.match(error, /at least 2 guests/i);
});
void test("concurrent creations cannot exceed ten quota reservations", async (t) => {
  const store = await Store.open(await directory(t));
  const app = createApp(store, "https://example.test");
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(app).post("/api/parties").send(input),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 201).length, 10);
  assert.equal(responses.filter((r) => r.status === 429).length, 10);
  assert.equal(store.snapshot.parties.length, 10);
});
void test("guest lookup returns only its own assignment and detached public details", async (t) => {
  const store = await Store.open(await directory(t));
  const party = makeParty(input);
  await store.add(party);
  const id = party.guests[0]?.id;
  assert.ok(id);
  const result = store.guest(id);
  assert.ok(result);
  assert.deepEqual(Object.keys(result).sort(), [
    "assignment",
    "guestName",
    "party",
  ]);
  assert.deepEqual(Object.keys(result.party).sort(), [
    "budget",
    "criteria",
    "name",
  ]);
  result.party.name = "mutated";
  assert.equal(store.guest(id)?.party.name, "Party");
  await assert.rejects(store.add(party), /duplicate/i);
});
void test("random draws allow mutual pairs and retry self-assignments", () => {
  // First shuffle is identity; second swaps A/B and C/D.
  const choices = [3, 2, 1, 2, 2, 0];
  const draw = assign(["A", "B", "C", "D"], () => {
    const value = choices.shift();
    assert.notEqual(value, undefined);
    return value ?? 0;
  });
  assert.deepEqual(
    [...draw],
    [
      ["A", "B"],
      ["B", "A"],
      ["C", "D"],
      ["D", "C"],
    ],
  );
  assert.equal(choices.length, 0);
});

void test("failed saves refund quota while successful saves still exhaust it", async (t) => {
  const store = await Store.open(await directory(t));
  const app = createApp(store, "https://example.test");
  t.mock.method(console, "error", () => {});
  const failure = t.mock.method(store, "add", () =>
    Promise.reject(new Error("disk unavailable")),
  );
  for (let i = 0; i < 12; i++)
    await request(app).post("/api/parties").send(input).expect(503);
  failure.mock.restore();
  for (let i = 0; i < 10; i++)
    await request(app).post("/api/parties").send(input).expect(201);
  await request(app).post("/api/parties").send(input).expect(429);
});

void test("invalid request abuse still has a separate higher limit", async (t) => {
  const app = createApp(
    await Store.open(await directory(t)),
    "https://example.test",
  );
  for (let i = 0; i < 60; i++)
    await request(app).post("/api/parties").send({}).expect(400);
  const response = await request(app).post("/api/parties").send({}).expect(429);
  assert.match((response.body as { error: string }).error, /Too many requests/);
});
