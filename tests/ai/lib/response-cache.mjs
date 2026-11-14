// Disk cache for model responses, keyed on everything that changes the output:
// endpoint host, model, the full message list, output limit and repeat index.
// CI restores tests/ai/.cache between runs, so an unchanged scenario costs
// nothing to re-run. Disable with RESTPILOT_EVAL_CACHE=off or `--no-cache`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir =
  process.env.RESTPILOT_EVAL_CACHE_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.cache/responses");

export function cacheEnabled(context) {
  if (context?.bustCache) return false;
  return !/^(0|off|false|no)$/i.test(process.env.RESTPILOT_EVAL_CACHE || "");
}

export function cacheKey(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function readCache(key) {
  const file = path.join(dir, key.slice(0, 2), `${key}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeCache(key, value) {
  const sub = path.join(dir, key.slice(0, 2));
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, `${key}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
