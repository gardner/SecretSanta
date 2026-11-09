import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "santa-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await Store.open(directory);
  const app = createApp(store, "https://santa.example");
  return { directory, store, app };
}
const party = { name: "Christmas", guests: ["Alice", "Bob", "Carol"] };

void test("concurrent creations survive restart with stable assignments", async (t) => {
  const { app, directory } = await fixture(t);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(app).post("/api/parties").send(party).expect(201),
    ),
  );
  const reopened = createApp(
    await Store.open(directory),
    "https://santa.example",
  );
  for (const response of responses) {
    const body = response.body as { guestUrls: Record<string, string> };
    const recipients = new Set<string>();
    for (const [guest, url] of Object.entries(body.guestUrls)) {
      const endpoint = `/api/guest/${url.split("/").at(-1) ?? ""}/assignment`;
      const before = await request(app).get(endpoint).expect(200);
      const after = await request(reopened).get(endpoint).expect(200);
      assert.deepEqual(before.body, after.body);
      const data = after.body as { assignment: string };
      assert.notEqual(data.assignment, guest);
      recipients.add(data.assignment);
    }
    assert.equal(recipients.size, 3);
  }
});

void test("party IDs and names cannot be used to read assignments", async (t) => {
  const { app } = await fixture(t);
  const response = await request(app)
    .post("/api/parties")
    .send(party)
    .expect(201);
  const { partyId } = response.body as { partyId: string };
  await request(app).get(`/api/parties/${partyId}`).expect(404);
  await request(app)
    .post(`/api/parties/${partyId}/assign`)
    .send({ guestName: "Alice" })
    .expect(404);
});

void test("prototype property names receive usable links and assignments", async (t) => {
  const { app } = await fixture(t);
  const response = await request(app)
    .post("/api/parties")
    .send({ name: "Names", guests: ["__proto__", "constructor", "toString"] })
    .expect(201);
  const { guestUrls } = response.body as { guestUrls: Record<string, string> };
  assert.equal(Object.keys(guestUrls).length, 3);
  for (const url of Object.values(guestUrls)) {
    const result = await request(app)
      .get(`/api/guest/${url.split("/").at(-1) ?? ""}/assignment`)
      .expect(200);
    assert.equal(
      typeof (result.body as { assignment: unknown }).assignment,
      "string",
    );
  }
});

void test("guest reads do not exhaust a shared-IP creation limit", async (t) => {
  const { app } = await fixture(t);
  const response = await request(app)
    .post("/api/parties")
    .send(party)
    .expect(201);
  const { guestUrls } = response.body as { guestUrls: Record<string, string> };
  const id = guestUrls.Alice?.split("/").at(-1);
  assert.ok(id);
  for (let i = 0; i < 20; i++)
    await request(app).get(`/api/guest/${id}/assignment`).expect(200);
});

void test("failed persistence rejects creation and leaves memory unchanged", async (t) => {
  const { app, directory, store } = await fixture(t);
  await rename(directory, `${directory}-moved`);
  t.after(() => rm(`${directory}-moved`, { recursive: true, force: true }));
  await writeFile(directory, "not a directory");
  await request(app).post("/api/parties").send(party).expect(503);
  assert.equal(store.snapshot.parties.length, 0);
});

void test("invalid storage prevents startup instead of silently deleting data", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(path.join(directory, "state.json"), "{broken");
  await assert.rejects(Store.open(directory));
  assert.equal(
    await readFile(path.join(directory, "state.json"), "utf8"),
    "{broken",
  );
});

void test("legacy files migrate preserving guest links and existing assignments", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(
    path.join(directory, "parties.json"),
    JSON.stringify({
      p: {
        id: "p",
        ...party,
        budget: "",
        criteria: "",
        createdAt: "legacy date",
      },
    }),
  );
  await writeFile(
    path.join(directory, "assignments.json"),
    JSON.stringify({ p: { Alice: "Bob", Bob: "Carol", Carol: "Alice" } }),
  );
  await writeFile(
    path.join(directory, "guest_links.json"),
    JSON.stringify({
      token: { partyId: "p", guestName: "Alice" },
      bob: { partyId: "p", guestName: "Bob" },
      carol: { partyId: "p", guestName: "Carol" },
    }),
  );
  const app = createApp(await Store.open(directory), "https://santa.example");
  const result = await request(app)
    .get("/api/guest/token/assignment")
    .expect(200);
  assert.equal((result.body as { assignment: string }).assignment, "Bob");
});

void test("migration refuses missing guest links rather than replacing invitations", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(
    path.join(directory, "parties.json"),
    JSON.stringify({
      p: { id: "p", ...party, budget: "", criteria: "", createdAt: "date" },
    }),
  );
  await writeFile(path.join(directory, "assignments.json"), "{}");
  await writeFile(path.join(directory, "guest_links.json"), "{}");
  await assert.rejects(Store.open(directory), /guest link/i);
});

void test("backup retains the previous complete snapshot and failed saves can be retried", async (t) => {
  const { app, directory, store } = await fixture(t);
  await request(app).post("/api/parties").send(party).expect(201);
  const first = await readFile(path.join(directory, "state.json"), "utf8");
  await rename(directory, `${directory}-moved`);
  t.after(() => rm(`${directory}-moved`, { recursive: true, force: true }));
  await writeFile(directory, "blocked");
  await request(app).post("/api/parties").send(party).expect(503);
  assert.equal(store.snapshot.parties.length, 1);
  await rm(directory);
  await rename(`${directory}-moved`, directory);
  await request(app).post("/api/parties").send(party).expect(201);
  assert.equal(
    await readFile(path.join(directory, "state.json.backup"), "utf8"),
    first,
  );
  assert.equal((await Store.open(directory)).snapshot.parties.length, 2);
});

void test("rejects invalid guest lists while preserving punctuation in valid names", async (t) => {
  const { app } = await fixture(t);
  for (const guests of [
    ["Alice"],
    ["Alice", " Alice "],
    ["", "Bob"],
    [42, "Bob"],
    Array.from({ length: 51 }, (_, i) => String(i)),
  ]) {
    await request(app)
      .post("/api/parties")
      .send({ name: "Test", guests })
      .expect(400);
  }
  const result = await request(app)
    .post("/api/parties")
    .send({ name: "Test", guests: ["O'Neil", "<Alice>"] })
    .expect(201);
  assert.deepEqual(
    Object.keys(
      (result.body as { guestUrls: Record<string, string> }).guestUrls,
    ),
    ["O'Neil", "<Alice>"],
  );
});
