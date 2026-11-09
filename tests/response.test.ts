import assert from "node:assert/strict";
import { test } from "node:test";
import { readCreationResponse } from "../src/client/response.js";

void test("HTML and malformed JSON errors get a friendly fallback", async () => {
  for (const body of ["<html>Bad Gateway</html>", "{broken"]) {
    await assert.rejects(
      readCreationResponse(new Response(body, { status: 502 })),
      /try again/i,
    );
  }
});
void test("API validation errors retain their useful message", async () => {
  await assert.rejects(
    readCreationResponse(
      new Response(
        JSON.stringify({ error: "At least 2 guests are required" }),
        { status: 400 },
      ),
    ),
    /At least 2 guests/,
  );
});
void test("successful malformed responses avoid parser details and duplicate-creation advice", async () => {
  await assert.rejects(
    readCreationResponse(new Response("<html>unexpected</html>")),
    /may have been created/i,
  );
});
