import { z } from "zod";

// Validate without rebuilding a dictionary: schema record transforms omit __proto__.
const linksSchema = z.custom<Record<string, string>>(
  (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((url: unknown) => typeof url === "string"),
);
const responseSchema = z.object({ guestUrls: linksSchema });
export function parseInvitations(input: unknown): Record<string, string> {
  return responseSchema.parse(input).guestUrls;
}
