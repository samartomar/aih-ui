#!/usr/bin/env node
/** Compile the Workbench's pinned Tailwind v3 utilities from src/ usage. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export async function buildCss(root = REPO_ROOT) {
  let postcss;
  let tailwindcss;
  let autoprefixer;
  try {
    postcss = require("postcss");
    tailwindcss = require("tailwindcss");
    autoprefixer = require("autoprefixer");
  } catch (error) {
    throw new Error(`Install this workspace's frontend dependencies with npm ci: ${error.message}`);
  }

  const input = join(root, "src", "styles", "tailwind.input.css");
  const output = join(root, "src", "styles", "tailwind.css");
  const result = await postcss([tailwindcss({ config: join(root, "tailwind.config.cjs") }), autoprefixer()]).process(
    readFileSync(input, "utf8"),
    { from: input, to: output },
  );
  writeFileSync(output, result.css);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCss().then((output) => process.stdout.write(`Tailwind CSS: ${output}\n`)).catch((error) => {
    process.stderr.write(`build-css: ${error.message}\n`);
    process.exitCode = 1;
  });
}
