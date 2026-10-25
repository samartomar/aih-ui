/* Palette values belong only to src/styles/tokens.css. */
const colorRole = (name) => ({ opacityValue }) => {
  const color = `var(--color-${name})`;
  const opacity = Number(opacityValue);
  return opacityValue === undefined || !Number.isFinite(opacity)
    ? color
    : `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
};

const roles = [
  "background", "on-background", "surface", "surface-dim", "surface-bright",
  "surface-container-lowest", "surface-container-low", "surface-container",
  "surface-container-high", "surface-container-highest", "surface-card",
  "surface-variant", "on-surface", "on-surface-variant", "outline", "outline-variant",
  "primary", "primary-bright", "primary-container", "on-primary",
  "secondary", "secondary-container", "tertiary", "tertiary-container",
  "error", "error-container", "info", "info-bg",
  "kind-skill", "kind-command", "kind-agent", "kind-mcp", "kind-hook", "kind-rule", "kind-document", "kind-token",
  "ledger-command", "ledger-agent", "ledger-mcp", "ledger-hook",
  "metadata-emphasis", "metadata-revision", "metric-selected",
];

module.exports = {
  // The V9 report shell carries its own inline styles and is never styled by these utilities.
  content: { relative: true, files: ["./src/**/*.{html,js}", "!./src/report/template.js", "!./src/report/templates/**"] },
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(roles.map((name) => [name, colorRole(name)])),
        "on-error-container": colorRole("error"),
        "wb-chrome": colorRole("chrome"),
        "wb-nav": colorRole("chrome"),
        "wb-center": colorRole("canvas"),
        "wb-cards": colorRole("canvas"),
        "wb-card": colorRole("card"),
        "wb-input": colorRole("field"),
        "wb-matrix": colorRole("panel"),
        "wb-inspector": colorRole("panel"),
        "wb-subhead": colorRole("panel"),
        "wb-title": colorRole("text"),
        "wb-meta": colorRole("meta"),
        "wb-meta-bg": colorRole("subtle"),
        "wb-border": colorRole("border"),
        "wb-control-border": colorRole("control-border"),
        "wb-scrim": colorRole("scrim"),
      },
      borderColor: { DEFAULT: "var(--color-border)" },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        panel: "var(--panel-shadow)",
      },
      borderRadius: { DEFAULT: "0.125rem", lg: "0.25rem", xl: "0.375rem", full: "0.5rem" },
      fontSize: {
        "wb-body": "var(--type-body)",
        "wb-card-description": "var(--type-card-description)",
        "wb-heading": "var(--type-heading)",
        "wb-metric": "var(--type-metric)",
      },
      fontWeight: {
        light: "var(--fw-light)",
        normal: "var(--fw-regular)",
        medium: "var(--fw-medium)",
        semibold: "var(--fw-strong)",
      },
      fontFamily: {
        "code-block": ["Geist Mono", "monospace"],
        mono: ["Geist Mono", "monospace"],
        body: ["Geist", "sans-serif"],
      },
    },
  },
};
