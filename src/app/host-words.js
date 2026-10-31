// What the page says when a change it asked the Workbench's host for did not happen because the request itself failed:
// the host could not be reached, or it answered in a way the page could not use. The failure's own text (a transport
// error, a status code) goes to the browser console, and the Workbench server logs its side; the page says only these
// sentences.

// Owner-approved 2026-10-31.
export const SETS_NOT_ADDED = "The chosen sets weren't added because the Workbench couldn't reach its host. Your choices are unchanged; use Add chosen sets again.";

/** Whether a thrown request failure means the host could not be reached (no answer, or the Workbench's 502/503/504). */
export const unreachable = error => error?.unreachable === true;

/**
 * The sentence for a change that did not happen: `what` says what was not done ("The chosen sets weren't added"),
 * `unchanged` what stays as it was, `again` what to do next. The error is logged, never shown.
 */
export function notDoneWords(error, { what, unchanged = 'Your setup is unchanged', again = 'try again' }) {
  console.error('The Workbench host did not complete the request:', error);
  return `${what} because the Workbench ${unreachable(error) ? "couldn't reach its host" : "host couldn't handle the request"}. ${unchanged}; ${again}.`;
}

/** Add chosen sets: the owner's sentence when the host could not be reached. */
export const setsNotAddedWords = error => notDoneWords(error, { what: "The chosen sets weren't added", unchanged: 'Your choices are unchanged', again: 'use Add chosen sets again' });
