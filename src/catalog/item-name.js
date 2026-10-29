export function itemDisplayName(item, fallback) {
  const base = item?.name ?? item?.label ?? fallback ?? item?.id ?? '';
  const namespace = item?.payload?.namespace;
  return namespace && !base.endsWith(` (${namespace})`) ? `${base} (${namespace})` : base;
}
