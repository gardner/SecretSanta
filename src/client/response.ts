import { z } from "zod";
import { parseInvitations } from "./invitations.js";

export async function readCreationResponse(
  response: Response,
): Promise<Record<string, string>> {
  const fallback = response.ok
    ? "The party may have been created, but its invitation links could not be read. Contact the organizer before creating another party."
    : "Unable to create the party right now. Please try again shortly.";
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = z.object({ error: z.string().min(1) }).safeParse(data);
    throw new Error(error.success ? error.data.error : fallback);
  }
  try {
    return parseInvitations(data);
  } catch {
    throw new Error(fallback);
  }
}
