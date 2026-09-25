import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const ROOT = pathToFileURL(resolvePath(import.meta.dirname, "..") + "/").href;
const TRIES = ["", ".ts", ".tsx", ".js", "/index.ts"];

export async function resolve(specifier, context, next) {
  const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
  let firstError;
  for (const suffix of TRIES) {
    try {
      return await next(target + suffix, context);
    } catch (error) {
      firstError ??= error;
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
    }
  }
  throw firstError;
}
