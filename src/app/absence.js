/*
 * Three different absences, kept apart on purpose. Collapsing them into one
 * word is how a page starts implying that an organization failed to supply
 * something the catalog was never going to carry.
 *
 * - NOT_PUBLISHED: a package field the installed index genuinely does not carry.
 * - NOT_SUPPLIED:  operator input. Organizations supply it; no package will.
 * - NOT_CONNECTED: an action or telemetry feed with no Core contract wired yet.
 */

export const NOT_PUBLISHED = "Not published";
export const NOT_SUPPLIED = "Not supplied";
export const NOT_CONNECTED = "Not connected";
