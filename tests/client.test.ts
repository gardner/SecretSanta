import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInvitations } from "../src/client/invitations.js";

void test("client preserves prototype-like guest names and rejects malformed responses", () => {
  const data: unknown = JSON.parse(
    '{"guestUrls":{"__proto__":"https://santa.example/guest/a","Alice":"https://santa.example/guest/b"}}',
  );
  assert.equal(Object.entries(parseInvitations(data)).length, 2);
  assert.throws(() => parseInvitations({ guestUrls: { Alice: 42 } }));
});
