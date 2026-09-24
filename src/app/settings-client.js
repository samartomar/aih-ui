async function request(path, body) {
  const response = await fetch(path, {
    cache: "no-store",
    ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(result.error ?? `Local setup request failed (${response.status}).`);
  return result;
}

export const loadSetup = () => request("/api/workbench-settings");
export const saveSetup = (settings) => request("/api/workbench-settings", settings);
export const updateSetup = (settings) => request("/api/workbench-settings/update", settings);
export const saveClients = (clients) => request("/api/workbench-settings/clients", { clients });
