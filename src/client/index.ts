import { z } from "zod";
import { parseInvitations } from "./invitations.js";
import { element, message, snow } from "./shared.js";

snow();
const form = element("partyForm", HTMLFormElement);
const submit = element("createParty", HTMLButtonElement);

function renderLink(guest: string, url: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "p-3 bg-white border border-gray-300 rounded";
  const name = document.createElement("strong");
  name.textContent = `${guest}: `;
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = url;
  input.className = "w-full bg-transparent text-sm text-gray-600 mt-1";
  input.setAttribute("aria-label", `Invitation for ${guest}`);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "📋 Copy";
  button.className = "px-3 py-1 bg-blue-500 text-white rounded text-sm";
  button.addEventListener("click", () => {
    void copy(url, input, button);
  });
  row.append(name, button, input);
  return row;
}
async function copy(
  url: string,
  input: HTMLInputElement,
  button: HTMLButtonElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "✅ Copied!";
  } catch {
    input.focus();
    input.select();
    button.textContent = "Select and copy the link";
  }
}
async function createParty(): Promise<void> {
  submit.disabled = true;
  try {
    const response = await fetch("/api/parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: element("partyName", HTMLInputElement).value,
        budget: element("budget", HTMLInputElement).value,
        criteria: element("criteria", HTMLTextAreaElement).value,
        guests: element("guests", HTMLTextAreaElement)
          .value.split("\n")
          .map((name) => name.trim())
          .filter(Boolean),
      }),
    });
    const data: unknown = await response.json();
    if (!response.ok)
      throw new Error(z.object({ error: z.string() }).parse(data).error);
    const guestUrls = parseInvitations(data);
    element("guestLinks", HTMLDivElement).replaceChildren(
      ...Object.entries(guestUrls).map(([guest, url]) =>
        renderLink(guest, url),
      ),
    );
    const result = element("result", HTMLDivElement);
    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    alert(`Error creating party: ${message(error)}`);
  } finally {
    submit.disabled = false;
  }
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void createParty();
});
