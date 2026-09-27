import fs from "node:fs";
const N=[],E=[];
const F=(p,summary,tags,complexity,extra={})=>N.push({id:`file:${p}`,type:"file",name:p.split("/").pop(),filePath:p,summary,tags,complexity,...extra});
const fn=(p,name,lr,summary,tags,complexity,exported)=>{const id=`function:${p}:${name}`;N.push({id,type:"function",name,filePath:p,lineRange:lr,summary,tags,complexity});E.push({source:`file:${p}`,target:id,type:"contains",direction:"forward",weight:1.0});if(exported)E.push({source:`file:${p}`,target:id,type:"exports",direction:"forward",weight:0.8});};
const ed=(s,t,type,w)=>E.push({source:s,target:t,type,direction:"forward",weight:w});

F("tools/catalog-index-contract.mjs","Defines the published catalog-index contract (format name and version) that the preview enforces before serving a resolved catalog index.",["validation","contract","catalog","utility"],"simple");
fn("tools/catalog-index-contract.mjs","contractViolations",[16,31],"Checks a parsed catalog-index.json for the expected format, version and entries array, returning a list of violation messages (empty means servable).",["validation","contract","catalog"],"simple",true);

F("tools/check-page-contract.mjs","Offline regression script verifying that every element id the page modules collect exists exactly once in src/index.html, that the relative module graph and page assets resolve to copied files, and that request paths classify correctly (200/400/403).",["test","validation","contract","script","regression"],"moderate",{languageNotes:"Imports the page's own SORT_KEYS from src/catalog/selectors.js instead of restating it, so the check cannot drift from the page."});

F("tools/check-scan-attribution.mjs","Integration check that installs the three local package tarballs into a throwaway consumer, copies the backend service in, and asserts signer attribution rules (declaration follows the actual signer, ordering independence, unattributed and ambiguous trust cases).",["test","integration","security","attribution","script"],"moderate");

F("tools/packages.mjs","Resolves @aihq/core, @aihq/scan and @aihq/catalog into tarballs, either from supplied *_TGZ files or by git-archiving a committed checkpoint into an external workspace, building, packing and caching by commit, then installs them into a throwaway consumer.",["service","build-system","packaging","utility"],"moderate");
fn("tools/packages.mjs","npm",[66,86],"Runs an npm command synchronously in a given directory and turns any non-zero exit into a reported hard error.",["utility","process","build-system"],"simple",false);
fn("tools/packages.mjs","resolvePackage",[104,184],"Produces a tarball for one package: uses a supplied tarball as delivered, or snapshots the checkout's committed HEAD via git archive, installs, builds and packs it, caching the result by commit.",["packaging","build-system","git","caching"],"complex",true);
fn("tools/packages.mjs","installConsumer",[187,212],"Creates a throwaway consumer project and installs the resolved tarballs into it with --ignore-scripts, copying in the service assets.",["packaging","installation","factory"],"moderate",true);

F("tools/preview-request.mjs","Classifies a raw preview request URL into a served file path or a 400/403 refusal, kept separate from the server so malformed-URL and traversal behavior can be tested without starting a preview.",["security","validation","http","utility"],"simple");
fn("tools/preview-request.mjs","classifyRequestPath",[16,38],"Parses and decodes the request path, maps the root to index.html, refuses malformed URLs (400) and NUL, backslash, dot-dot or out-of-root paths (403), and otherwise returns the resolved file.",["security","http","path-traversal","validation"],"simple",true);

F("tools/preview.mjs","Entry point that builds a throwaway Policy Workbench preview: resolves and installs the three packages into a consumer, copies page, service and presentation assets into an external run directory, validates the catalog index contract, and serves the static page plus API on 127.0.0.1.",["entry-point","dev-server","build-system","orchestration","cli"],"complex");
fn("tools/preview.mjs","readInstalledPackages",[83,106],"Reads the installed package manifests from the consumer to report provenance (name, version, source) of what is actually installed.",["provenance","packaging","utility"],"simple",false);
fn("tools/preview.mjs","main",[138,392],"Orchestrates the whole preview run: parses flags, gathers assets, resolves and installs packages, queries the service for the catalog document, checks the index contract, writes the run directory, and starts the static server with the API handler.",["entry-point","orchestration","dev-server"],"complex",false);

F("tools/server/api.mjs","HTTP API routing for the preview: maps GET/POST /api/* routes (packages, subject, catalog-integrity, evidence, validation-fixture, operator-file, observation, reopen, prepare, consume, saved) to service calls and session storage, keeping filesystem paths server-side.",["api-handler","router","http","service"],"complex");
fn("tools/server/api.mjs","readBody",[24,46],"Reads a request body into a buffer, rejecting it once it exceeds the per-route byte limit.",["http","utility","validation"],"simple",false);
fn("tools/server/api.mjs","createApi",[53,248],"Builds the API request handler with a route table that dispatches JSON requests to the service worker and session store, hiding operator-side paths behind opaque session ids.",["api-handler","factory","router","session"],"complex",true);

F("tools/server/assets.mjs","Determines which files the preview copies where: discovers served page assets by walking src/, lists service modules and flat presentation assets, and asserts required entry points are readable.",["utility","build-system","assets","configuration"],"moderate");
fn("tools/server/assets.mjs","walk",[42,53],"Recursively lists files under a directory as relative POSIX paths.",["utility","filesystem","recursion"],"simple",false);
fn("tools/server/assets.mjs","pageAssets",[60,66],"Returns the page asset copy list discovered under src/, preserving the module tree so relative imports keep working.",["assets","build-system","discovery"],"simple",true);
fn("tools/server/assets.mjs","serviceAssets",[69,78],"Returns the .mjs backend service modules from tools/service to copy into the consumer's service/ directory.",["assets","service","build-system"],"simple",true);
fn("tools/server/assets.mjs","presentationAssets",[80,85],"Returns the presentation-only files carried over unmodified from the design prototype, served flat by name.",["assets","prototype","presentation"],"simple",true);
fn("tools/server/assets.mjs","assertReadable",[88,96],"Asserts every asset source exists and required page entry points are present, failing fast instead of producing a blank page.",["validation","assets","fail-fast"],"simple",true);

F("tools/server/service-client.mjs","Seam between the preview server and the installed packages: runs the service worker as a child process inside the consumer and exchanges one JSON request for one JSON response.",["service","ipc","adapter","child-process"],"simple");
fn("tools/server/service-client.mjs","callService",[16,36],"Spawns the consumer's core-service.mjs with a JSON request on stdin and returns the parsed JSON response, or an error object on spawn failure, non-zero exit or unparseable output.",["service","child-process","ipc","error-handling"],"simple",true);

F("tools/server/sessions.mjs","Server-owned session store deriving every filesystem location from an opaque uuid, holding operator-supplied files (authority bundle, trust, attestation material) and revision-guarded observation uploads outside the consume root.",["session","security","storage","service","validation"],"complex");
fn("tools/server/sessions.mjs","isBoundedRelativePath",[69,80],"Accepts only bounded relative POSIX paths with no absolute, backslash, empty or dot-dot segments, guarding observation file placement.",["security","validation","path-traversal"],"simple",false);
fn("tools/server/sessions.mjs","createSessions",[105,368],"Creates the session store API (open, create, record, get, dirOf, storeOperatorFile, storeObservation, observationOf, openFromBytes) that writes files only under server-derived session directories and refuses superseded revisions.",["factory","session","storage","security"],"complex",true);

F("tools/server/static.mjs","Static half of the preview server: lets the API handler claim /api paths first, then serves run-directory files via classifyRequestPath with MIME types and 400/403/404 answers.",["http","dev-server","static-files","security"],"moderate");
fn("tools/server/static.mjs","createStaticServer",[23,63],"Creates the node:http server that delegates to the API handler and otherwise serves classified, in-root files with the proper content type.",["http","factory","static-files"],"moderate",true);
fn("tools/server/static.mjs","listen",[65,70],"Starts the server on 127.0.0.1 at the given port and resolves with the bound address.",["http","utility","network"],"simple",true);

F("tools/tests/sessions-observation.test.mjs","node:test suite for the session store's observation revision guard: older or equal revisions are refused without touching bytes, missing revisions are refused, inputs and sessions are counted independently, and unknown sessions are rejected first.",["test","session","revision-guard","concurrency"],"moderate");

const imp={"tools/check-page-contract.mjs":["src/catalog/selectors.js","tools/preview-request.mjs","tools/server/assets.mjs"],"tools/check-scan-attribution.mjs":["tools/packages.mjs","tools/server/assets.mjs"],"tools/preview.mjs":["tools/catalog-index-contract.mjs","tools/packages.mjs","tools/server/api.mjs","tools/server/assets.mjs","tools/server/service-client.mjs","tools/server/static.mjs"],"tools/server/api.mjs":["tools/server/service-client.mjs","tools/server/sessions.mjs"],"tools/server/static.mjs":["tools/preview-request.mjs"],"tools/tests/sessions-observation.test.mjs":["tools/server/sessions.mjs"]};
for(const [s,ts] of Object.entries(imp)) for(const t of ts) ed(`file:${s}`,`file:${t}`,"imports",0.7);

const M="function:tools/preview.mjs:main";
for(const t of ["function:tools/catalog-index-contract.mjs:contractViolations","function:tools/packages.mjs:resolvePackage","function:tools/packages.mjs:installConsumer","function:tools/server/api.mjs:createApi","function:tools/server/assets.mjs:pageAssets","function:tools/server/assets.mjs:serviceAssets","function:tools/server/assets.mjs:presentationAssets","function:tools/server/assets.mjs:assertReadable","function:tools/server/static.mjs:createStaticServer","function:tools/server/static.mjs:listen"]) ed(M,t,"calls",0.8);
ed("file:tools/preview.mjs","function:tools/server/service-client.mjs:callService","calls",0.8);
ed("function:tools/server/api.mjs:createApi","function:tools/server/service-client.mjs:callService","calls",0.8);
ed("function:tools/server/api.mjs:createApi","function:tools/server/sessions.mjs:createSessions","calls",0.8);
ed("function:tools/server/static.mjs:createStaticServer","function:tools/preview-request.mjs:classifyRequestPath","calls",0.8);
ed("function:tools/packages.mjs:resolvePackage","function:tools/packages.mjs:npm","calls",0.8);
ed("function:tools/server/assets.mjs:pageAssets","function:tools/server/assets.mjs:walk","calls",0.8);
ed("file:tools/check-page-contract.mjs","function:tools/preview-request.mjs:classifyRequestPath","calls",0.8);
ed("file:tools/check-page-contract.mjs","function:tools/server/assets.mjs:pageAssets","calls",0.8);
ed("file:tools/check-scan-attribution.mjs","function:tools/packages.mjs:resolvePackage","calls",0.8);
ed("file:tools/check-scan-attribution.mjs","function:tools/packages.mjs:installConsumer","calls",0.8);
ed("file:tools/check-scan-attribution.mjs","function:tools/server/assets.mjs:serviceAssets","calls",0.8);
ed("file:tools/tests/sessions-observation.test.mjs","function:tools/server/sessions.mjs:createSessions","calls",0.8);
ed("file:tools/server/sessions.mjs","file:tools/tests/sessions-observation.test.mjs","tested_by",0.5);
ed("file:tools/preview-request.mjs","file:tools/check-page-contract.mjs","tested_by",0.5);

const ids=new Set(N.map(n=>n.id));
const bad=E.filter(e=>!ids.has(e.source)||!(ids.has(e.target)||e.target==="file:src/catalog/selectors.js"));
console.log(N.length,E.length,E.filter(e=>e.type==="imports").length,"bad",bad, "dupIds", N.length-ids.size);
fs.writeFileSync("D:/dev/aih-ui/.ua/intermediate/batch-4.json",JSON.stringify({nodes:N,edges:E},null,1));
