// Reads a headless-rendered DOM dump of the preview page and reports the acceptance facts.
// Usage: node tools/inspect-dom.mjs <dom-dump.html>
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node tools/inspect-dom.mjs <dom-dump.html>");
  process.exit(1);
}
const dom = readFileSync(path, "utf8");

const idMatch = (id) => {
  const pattern = new RegExp(`<([a-z0-9]+)[^>]*\\sid="${id}"[^>]*>`, "i");
  return dom.match(pattern)?.[0] ?? null;
};
const text64 = (id) => {
  const pattern = new RegExp(`<([a-z0-9]+)[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</\\1>`, "i");
  const body = dom.match(pattern)?.[2] ?? "";
  return body.replace(/<[^>]+>/g, "\u00b7").replace(/\s+/g, " ").trim();
};

console.log("--- error element ---");
console.log(idMatch("catalog-error") ?? "(no #catalog-error element)");
console.log("--- masthead ---");
console.log("masthead-version:", text64("masthead-version"));
console.log("masthead-facts:", text64("masthead-facts"));
console.log("--- provenance ---");
console.log(text64("provenance-strip").slice(0, 400));
console.log("--- counts ---");
console.log("nav-sources-count:", text64("nav-sources-count"), "| rail-package-count:", text64("rail-package-count"), "| visible-count:", text64("visible-count"), text64("visible-caption"));
console.log("--- source rails ---");
const railStart = dom.indexOf('id="rail-source-list"');
const railEnd = dom.indexOf('id="framework-matrix-tabs"');
const rail = dom.slice(railStart, railEnd);
const railText = rail
  .replace(/<button[^>]*>/g, "\n  row: ")
  .replace(/<div[^>]*class="pl-2[^"]*"[^>]*>/g, "\n  group: ")
  .replace(/<[^>]+>/g, " ")
  .replace(/[ \t]+/g, " ")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
console.log(railText.slice(0, 60).join("\n"));
