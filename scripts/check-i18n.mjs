// Fails when the English and Dutch translations do not have the same keys.
import { readFileSync } from "node:fs";

const load = (lang) => JSON.parse(readFileSync(new URL(`../web/src/locales/${lang}.json`, import.meta.url), "utf8"));
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const en = new Set(flatten(load("en")));
const nl = new Set(flatten(load("nl")));
const missingNl = [...en].filter((k) => !nl.has(k));
const missingEn = [...nl].filter((k) => !en.has(k));
if (missingNl.length || missingEn.length) {
  if (missingNl.length) console.error("Missing in nl.json:\n  " + missingNl.join("\n  "));
  if (missingEn.length) console.error("Missing in en.json:\n  " + missingEn.join("\n  "));
  process.exit(1);
}
console.log(`i18n: ${en.size} keys, English and Dutch match`);
