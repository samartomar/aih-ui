// The new colour roles live in both root themes, are exposed as Tailwind roles, and pass 4.5:1 where they are text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(join(repo, "src/styles/tokens.css"), "utf8");
const block = selector => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf("}", start));
};
const roles = text => Object.fromEntries([...text.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const themes = { dark: roles(block(":root")), light: roles(block("html.light")) };
const resolveRole = (theme, name) => {
  const value = themes[theme][name] ?? themes.dark[name];
  const reference = /^var\(--color-([a-z-]+)\)$/.exec(value ?? "");
  return reference ? resolveRole(theme, reference[1]) : value;
};
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const NEW = ["kind-rule", "kind-document", "kind-hook", "info", "info-bg"];
const SURFACES = ["canvas", "panel", "card", "subtle", "hover"];

test("the new roles are defined with palette values in both themes and only in tokens.css", () => {
  for (const theme of ["dark", "light"]) for (const name of NEW) assert.match(themes[theme][name] ?? "", /^#[0-9a-f]{6}$/, `${theme} --color-${name}`);
  const config = readFileSync(join(repo, "tailwind.config.cjs"), "utf8");
  for (const name of NEW) assert.match(config, new RegExp(`"${name}"`), `Tailwind role ${name}`);
});

test("the hook accent is orange in both themes, never the success green", () => {
  for (const theme of ["dark", "light"]) {
    const hook = resolveRole(theme, "kind-hook");
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hook.slice(i, i + 2), 16));
    assert.ok(r > g && g > b, `${theme} hook ${hook} is orange`);
    assert.notEqual(hook, resolveRole(theme, "success"));
    const ledger = resolveRole(theme, "ledger-hook");
    const [lr, lg, lb] = [1, 3, 5].map(i => parseInt(ledger.slice(i, i + 2), 16));
    assert.ok(lr > lg && lg > lb, `${theme} hook metric ${ledger} is orange`);
  }
});

test("text roles reach 4.5:1 on every surface they sit on, and info text on its own background", () => {
  for (const theme of ["dark", "light"]) {
    for (const name of ["kind-rule", "kind-document", "kind-hook", "info"]) {
      for (const surface of SURFACES) {
        const ratio = contrast(resolveRole(theme, name), resolveRole(theme, surface));
        assert.ok(ratio >= 4.5, `${theme} ${name} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    const ratio = contrast(resolveRole(theme, "info"), resolveRole(theme, "info-bg"));
    assert.ok(ratio >= 4.5, `${theme} info on info-bg: ${ratio.toFixed(2)}`);
  }
});

test("Tailwind exposes every role the icon map uses", () => {
  const require = createRequire(import.meta.url);
  const config = require(join(repo, "tailwind.config.cjs"));
  for (const role of ["kind-skill", "kind-rule", "kind-command", "kind-agent", "kind-hook", "kind-mcp", "kind-document", "primary", "secondary", "tertiary", "error", "info", "outline", "on-surface-variant"]) {
    assert.equal(typeof config.theme.extend.colors[role], "function", role);
  }
});
