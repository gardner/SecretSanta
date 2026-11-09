import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

void test(
  "server loads .env and persisted invitations before accepting requests",
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "santa-startup-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      socket.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
    await writeFile(
      path.join(directory, ".env"),
      `PORT=${port}\nBASE_URL=https://santa.example\nDATA_DIR=${directory}\n`,
    );
    await writeFile(
      path.join(directory, "state.json"),
      JSON.stringify({
        version: 1,
        parties: [
          {
            id: "p",
            name: "Saved",
            budget: "",
            criteria: "",
            createdAt: "date",
            guests: [
              { id: "a", name: "Alice", assignment: "Bob" },
              { id: "b", name: "Bob", assignment: "Alice" },
            ],
          },
        ],
      }),
    );
    const env = { ...process.env };
    delete env.PORT;
    delete env.BASE_URL;
    delete env.DATA_DIR;
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../src/server.ts", import.meta.url)),
      ],
      { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    t.after(async () => {
      child.kill();
      await exited;
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        reject(new Error(`Server exited: ${String(code)}`));
      });
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) resolve();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        reject(new Error(chunk.toString()));
      });
    });
    const guest = await fetch(
      `http://127.0.0.1:${port}/api/guest/a/assignment`,
    );
    assert.equal(guest.status, 200);
    assert.equal(
      ((await guest.json()) as { assignment: string }).assignment,
      "Bob",
    );
    const created = await fetch(`http://127.0.0.1:${port}/api/parties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", guests: ["C", "D"] }),
    });
    const result = (await created.json()) as {
      guestUrls: Record<string, string>;
    };
    assert.equal(created.status, 201);
    assert.ok(
      Object.values(result.guestUrls).every((url) =>
        url.startsWith("https://santa.example/guest/"),
      ),
    );
  },
);
