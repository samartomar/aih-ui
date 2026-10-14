import { createApi } from './api.mjs';
import { createAuthoringAdapter } from './authoring.mjs';
import { createStaticServer } from './static.mjs';

// The ordinary preview and its regression share this composition boundary.
export async function createWorkbench({ consumerDir, runDir, summary, settingsPath }) {
  const authoring = await createAuthoringAdapter(consumerDir);
  const existingApi = createApi({ consumerDir, runDir, summary, settingsPath });
  const server = createStaticServer(runDir, async (request, response, pathname) => {
    try { return await authoring.handle(request, response, pathname) || await existingApi(request, response, pathname); }
    catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `Authoring host unavailable: ${error.message}` })); return true;
    }
  });
  server.on('close', () => authoring.close());
  return { server, catalog: await authoring.catalog() };
}
