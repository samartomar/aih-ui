import { createApi } from './api.mjs';
import { createAuthoringAdapter, journalFrictionEvidence } from './authoring.mjs';
import { createBatchAdapter } from './batch.mjs';
import { createReadinessAdapter } from './readiness.mjs';
import { createReportAdapter } from './report.mjs';
import { createStaticServer } from './static.mjs';

// The ordinary preview and its regression share this composition boundary.
export async function createWorkbench({ consumerDir, runDir, summary, settingsPath }) {
  // The readiness journal is the friction input for what the person ran here. The readiness adapter is created first because the authoring host's journal provider closes over it
  // and reads it afresh on each improvements check; its child is forked lazily, on the first readiness request.
  const readiness = createReadinessAdapter(consumerDir);
  const authoring = await createAuthoringAdapter(consumerDir, { frictionEvidence: await journalFrictionEvidence(consumerDir, () => readiness.records()) });
  const batch = createBatchAdapter(consumerDir);
  const report = createReportAdapter(consumerDir);
  const existingApi = createApi({ summary, settingsPath });
  const server = createStaticServer(runDir, async (request, response, pathname) => {
    try { return await batch.handle(request, response, pathname) || await readiness.handle(request, response, pathname) || await report.handle(request, response, pathname) || await authoring.handle(request, response, pathname) || await existingApi(request, response, pathname); }
    catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `Authoring host unavailable: ${error.message}` })); return true;
    }
  });
  server.on('close', () => { authoring.close(); readiness.close(); batch.close(); });
  return { server, catalog: await authoring.catalog() };
}
