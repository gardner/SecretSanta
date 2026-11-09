import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputSchema, makeParty } from "./model.js";
import type { Store } from "./store.js";
import { CreationQuota, requestLimit } from "./limits.js";

const root = fileURLToPath(new URL("../", import.meta.url));
export function createApp(store: Store, baseUrl: string) {
  const app = express();
  const quota = new CreationQuota();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.post("/api/parties", requestLimit(), async (req, res) => {
    const input = inputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: input.error.issues.map((issue) => issue.message).join("; "),
      });
      return;
    }
    const party = makeParty(input.data);
    const complete = quota.reserve(req.ip ?? "unknown");
    if (!complete) {
      res.set("Retry-After", "60").status(429).json({
        error:
          "Too many parties created or being saved. Please try again in a minute.",
      });
      return;
    }
    try {
      await store.add(party);
      complete(true);
    } catch (error) {
      complete(false);
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
    res.json(record);
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
