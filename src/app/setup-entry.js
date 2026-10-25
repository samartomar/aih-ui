// The header's "Your setup" entry: how many chosen items the current setup holds, in the Workbench words.
// The current setup is the open draft, otherwise the accepted policy; a proposal is not counted until accepted.

const OPENS = 'Open the Project folder, Install and installed items';

/** The entry's visible label, hover title and accessible name for the client's current setup (pure). */
export function setupEntry(client) {
  const count = (client?.draft?.roots ?? client?.intent?.roots ?? []).length;
  const chosen = count ? `${count} chosen ${count === 1 ? 'item' : 'items'}` : 'nothing chosen yet';
  return {
    label: count ? `Your setup (${count})` : 'Your setup',
    title: `${OPENS} for your setup.`,
    accessibleName: `Your setup: ${chosen}. ${OPENS}`,
  };
}
