import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const port = Number(process.env.PORT ?? 8003);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535");
const baseUrl = new URL(process.env.BASE_URL || `http://localhost:${port}`);
if (
  !["http:", "https:"].includes(baseUrl.protocol) ||
  baseUrl.pathname !== "/" ||
  baseUrl.search ||
  baseUrl.hash ||
  baseUrl.username ||
  baseUrl.password
)
  throw new Error("BASE_URL must be an HTTP(S) origin");
const directory =
  process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const store = await Store.open(directory);
createApp(store, baseUrl.origin).listen(port, "0.0.0.0", () => {
  console.log(`Secret Santa listening on port ${port}`);
});
