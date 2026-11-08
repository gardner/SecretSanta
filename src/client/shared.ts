export function element<T extends HTMLElement>(
  id: string,
  type: new (...args: never[]) => T,
): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing element: ${id}`);
  return node;
}
export function snow(): void {
  const container = element("snow", HTMLDivElement);
  for (let i = 0; i < 50; i++) {
    const flake = document.createElement("div");
    flake.className = "snowflake";
    flake.textContent = "❄";
    Object.assign(flake.style, {
      left: `${Math.random() * 100}%`,
      animationDuration: `${Math.random() * 3 + 2}s`,
      opacity: String(Math.random()),
      fontSize: `${Math.random() * 10 + 10}px`,
      animationDelay: `${Math.random() * 2}s`,
    });
    container.append(flake);
  }
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
