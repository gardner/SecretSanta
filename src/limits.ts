import type { RequestHandler } from "express";

interface Entry {
  pending: number;
  completed: number;
  expires: number;
}
export class CreationQuota {
  private readonly clients = new Map<string, Entry>();
  reserve(key: string): ((success: boolean) => void) | undefined {
    const now = Date.now();
    for (const [id, entry] of this.clients) {
      if (entry.expires > now) continue;
      if (entry.pending === 0) this.clients.delete(id);
      else {
        entry.completed = 0;
        entry.expires = now + 60000;
      }
    }
    const entry = this.clients.get(key) ?? {
      pending: 0,
      completed: 0,
      expires: now + 60000,
    };
    if (entry.completed + entry.pending >= 10) return undefined;
    entry.pending++;
    this.clients.set(key, entry);
    return (success) => {
      entry.pending--;
      if (success) entry.completed++;
    };
  }
}

// A separate, higher request ceiling limits abuse without charging invalid
// submissions or failed saves against the successful-creation quota.
export function requestLimit(): RequestHandler {
  const clients = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of clients)
      if (value.expires <= now) clients.delete(key);
    const key = req.ip ?? "unknown";
    const entry = clients.get(key) ?? { count: 0, expires: now + 60000 };
    if (entry.count >= 60) {
      res
        .set("Retry-After", "60")
        .status(429)
        .json({ error: "Too many requests. Please try again in a minute." });
      return;
    }
    entry.count++;
    clients.set(key, entry);
    next();
  };
}
