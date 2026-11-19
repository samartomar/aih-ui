// Resolve the declared client through Core's public registry, including IDEs.
export function selectedClientTarget(harnessPublic, id) {
  const selected = harnessPublic.selectTool(id);
  return selected.status === 'ok' ? {id:selected.tool.id,surface:selected.tool.surface} : null;
}
