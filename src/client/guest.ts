import { z } from "zod";
import { element, snow } from "./shared.js";

snow();
const assignmentSchema = z.object({
  guestName: z.string(),
  assignment: z.string(),
  party: z.object({
    name: z.string(),
    budget: z.string(),
    criteria: z.string(),
  }),
});
function showError(invalid: boolean): void {
  element("error", HTMLDivElement).classList.remove("hidden");
  element("errorTitle", HTMLHeadingElement).textContent = invalid
    ? "Link Not Valid"
    : "Please Try Again";
  element("errorMessage", HTMLParagraphElement).textContent = invalid
    ? "This invitation was not found. Please check the link with your organizer."
    : "Your assignment could not be loaded. Please wait a moment and reload this page.";
}
async function load(): Promise<void> {
  try {
    const guestId =
      window.location.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const response = await fetch(
      `/api/guest/${encodeURIComponent(guestId)}/assignment`,
    );
    if (!response.ok) {
      showError(response.status === 404 || response.status === 400);
      return;
    }
    const data = assignmentSchema.parse(await response.json());
    element("guestName", HTMLSpanElement).textContent = data.guestName;
    element("partyName", HTMLSpanElement).textContent = data.party.name;
    element("assignedPerson", HTMLDivElement).textContent = data.assignment;
    for (const field of ["budget", "criteria"] as const) {
      if (!data.party[field]) continue;
      element(field, HTMLSpanElement).textContent = data.party[field];
      element(`${field}Info`, HTMLDivElement).classList.remove("hidden");
    }
    element("assignmentResult", HTMLDivElement).classList.remove("hidden");
  } catch {
    showError(false);
  } finally {
    element("loading", HTMLDivElement).classList.add("hidden");
  }
}
void load();
