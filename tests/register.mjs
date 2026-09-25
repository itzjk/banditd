// Lets `node --test` load the app's TypeScript the way Next resolves it:
// the "@/..." alias from tsconfig, extensionless imports, and packages such as
// next/server that ship CommonJS without an exports map.
import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);
