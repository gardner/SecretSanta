import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputSchema, makeParty } from "./model.js";
import type { Store } from "./store.js";

const root = fileURLToPath(new URL("../", import.meta.url));
function creationLimit(): RequestHandler {
  const clients = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of clients)
      if (value.expires <= now) clients.delete(key);
    const key = req.ip ?? "unknown";
    const entry = clients.get(key) ?? { count: 0, expires: now + 60000 };
    if (entry.count >= 10) {
      res
        .set("Retry-After", String(Math.ceil((entry.expires - now) / 1000)))
        .status(429)
        .json({
          error: "Too many parties created. Please try again in a minute.",
        });
      return;
    }
    entry.count++;
    clients.set(key, entry);
    next();
  };
}

export function createApp(store: Store, baseUrl: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.post("/api/parties", creationLimit(), async (req, res) => {
    const input = inputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: input.error.issues.map((issue) => issue.message).join("; "),
      });
      return;
    }
    const party = makeParty(input.data);
    try {
      await store.add(party);
    } catch (error) {
      console.error("Unable to persist party:", error);
      res
        .status(503)
        .json({ error: "Unable to save the party. Please try again." });
      return;
    }
    const guestUrls = Object.fromEntries(
      party.guests.map((guest) => [guest.name, `${baseUrl}/guest/${guest.id}`]),
    );
    res.status(201).json({ partyId: party.id, guestUrls });
  });
  app.get("/api/guest/:id/assignment", (req, res) => {
    const record = store.guest(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    const { party, guest } = record;
    res.json({
      party: {
        name: party.name,
        budget: party.budget,
        criteria: party.criteria,
      },
      guestName: guest.name,
      assignment: guest.assignment,
    });
  });
  app.use(express.static(path.join(root, "public")));
  app.use("/assets", express.static(path.join(root, "dist/client")));
  app.get("/guest/:id", (_req, res) => {
    res.sendFile(path.join(root, "public/guest.html"));
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    res.status(status).json({
      error: status < 500 ? "Invalid request body" : "Internal server error",
    });
  };
  app.use(errors);
  return app;
}
