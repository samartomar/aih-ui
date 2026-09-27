const fs=require("fs");
const b=require("../intermediate/batches.json").batches.find(x=>x.batchIndex===2);
const r=require("./ua-file-extract-results-2.json");
const F={
"src/app/absence.js":["Defines the shared absence vocabulary (Not published, Not declared, Not supplied, Not connected) and related reason strings so the UI never conflates missing package data with missing operator input.",["constants","vocabulary","ui-copy","shared"],"simple"],
"src/governance/bytes.js":["Moves exact artifact bytes between files, the backend and browser downloads via Base64 without re-serializing, preserving the canonical bytes Core's parsers require.",["utility","serialization","base64","download"],"simple"],
"src/governance/controller.js":["Governance workflow controller that wires all pane components and transport calls into one vertical slice (select, inspect, import evidence, prepare, save, reopen, consume) while guarding every async answer with revision tokens so verdicts only reflect current inputs.",["controller","state-management","workflow","entry-point","async"],"complex"],
"src/governance/detector.js":["Renders scanner attestation, scanner result facts and detector provenance as three distinct statements in the Governance pane.",["component","rendering","scanner","attestation"],"moderate"],
"src/governance/elements.js":["Collects the Governance pane's DOM elements by id and groups them by the component that owns each one.",["dom","configuration","component-wiring","utility"],"moderate"],
"src/governance/inputs.js":["Component owning the subject readout, catalog details, evidence file input and decision/target/effect/route fields; exposes operator-supplied values without ever inventing missing ones.",["component","form","validation","operator-input"],"complex"],
"src/governance/observation.js":["Component collecting the operator's observation inputs (artifact manifest, install root and folder) and handing the bytes to the backend by path without parsing or hashing them.",["component","file-input","observation","operator-input"],"moderate"],
"src/governance/operator-files.js":["Component for the operator's own authority, verifier trust and attestation material files, stored separately and never derived from imported evidence.",["component","file-input","security","trust"],"moderate"],
"src/governance/prepared.js":["Component owning the Prepare button, the prepared-artifact readout and exact-byte downloads, showing binding only as a claim until independent consumption.",["component","rendering","download","prepare-step"],"moderate"],
"src/governance/reopen.js":["Component that reopens the two downloaded files in a fresh session so consumption re-derives the verdict independently from the exact bytes.",["component","file-input","reopen","verification"],"moderate"],
"src/governance/revisions.js":["Revision tracker that assigns a revision per verification input slot and session so asynchronous answers minted under stale inputs are discarded.",["state-management","concurrency","utility","revision-tracking"],"moderate"],
"src/governance/rows.js":["Provides the single label/value row renderer used across Governance displays, rendering null values as an explicit absence word.",["utility","rendering","dom","component"],"simple"],
"src/governance/statuses.js":["Renders the six verification status axes as six separate cells in contract order, never collapsing them into one badge.",["component","rendering","status","verification"],"simple"],
"src/governance/transport.js":["HTTP transport layer for every Governance call to the preview backend's /api endpoints, passing operator input through unchanged and returning Core's answers.",["api-client","transport","http","service"],"moderate"],
"src/governance/verdict.js":["Component owning the Consume button and verdict readout, including assessment binding, observation results and the mandatory execution sentence.",["component","rendering","verdict","verification"],"moderate"],
"src/governance/vocabulary.js":["Defines the words the Governance pane may use: the six status axes, tone mappings and refusal wording, with rules forbidding Applied/Installed/Executed language.",["constants","vocabulary","ui-copy","type-definition"],"moderate"],
"tools/tests/revisions.test.mjs":["Unit tests for the revision tracker covering slot tokens, session changes, selection changes and undefined-slot errors.",["test","unit-test","revision-tracking","concurrency"],"moderate"],
};
const S={
"src/governance/bytes.js":{bytesToBase64:"Encodes a byte array to a Base64 string without re-serialization.",base64ToBytes:"Decodes a Base64 string back into the exact original bytes.",downloadBase64:"Triggers a browser download of Base64-encoded bytes under a given filename."},
"src/governance/controller.js":{createGovernance:"Builds the Governance pane: instantiates all components, holds workflow state, and orchestrates prepare, store, reopen and consume calls with revision-guarded async handling."},
"src/governance/detector.js":{renderScanResult:"Renders the scanner attestation, scan result facts and detector provenance sections for a scan result.",createDetector:"Creates the detector component that displays scanner attestation and provenance state."},
"src/governance/elements.js":{governanceElements:"Looks up all Governance pane element ids and returns them grouped per owning component."},
"src/governance/inputs.js":{renderCatalog:"Renders published catalog information about the selected subject.",setTargetOptions:"Populates the target select options from the subject's available targets.",createInputs:"Creates the inputs component managing subject readout, evidence file and decision fields, exposing values()."},
"src/governance/observation.js":{createObservation:"Creates the observation component collecting manifest, install root and folder inputs."},
"src/governance/operator-files.js":{createOperatorFiles:"Creates the component handling authority, verifier trust and attestation file inputs."},
"src/governance/prepared.js":{createPrepared:"Creates the prepared-artifact component with Prepare button, readout and download buttons."},
"src/governance/reopen.js":{createReopen:"Creates the reopen component that accepts the downloaded files for a fresh independent session."},
"src/governance/revisions.js":{createRevisionTracker:"Creates a per-slot revision tracker issuing tokens and checking whether an answer's token is still current."},
"src/governance/rows.js":{row:"Appends a label/value row to a parent element, showing the given absence word when the value is null."},
"src/governance/statuses.js":{createStatuses:"Creates the statuses component rendering all six verification axes as separate cells."},
"src/governance/transport.js":{api:"Posts a JSON body to a backend /api path and normalizes network and error responses.",fetchSubject:"Requests the published subject information for a catalog selection.",fetchCatalogIntegrity:"Requests catalog integrity information from the backend.",parseEvidence:"Sends evidence bytes to the backend for parsing by Core.",prepare:"Asks the backend to prepare an artifact through Core from operator inputs.",storeOperatorFile:"Stores one operator file (authority, trust or attestation) in the session.",storeObservation:"Stores the operator's observation manifest and files in the session.",reopenFromFiles:"Opens a fresh session from the downloaded files.",consume:"Requests independent consumption of the saved artifact and returns the verdict.",loadValidationFixture:"Loads the explicitly labelled validation fixture.",fetchSaved:"Fetches the exact saved bytes for download."},
"src/governance/verdict.js":{createVerdict:"Creates the verdict component with the Consume button and verdict readout.",executionSentence:"Chooses the execution sentence for not-attempted, observed or refused execution values.",renderAssessmentBinding:"Renders the assessment binding details of a verdict.",renderObservation:"Renders the observation result details of a verdict."},
"src/governance/vocabulary.js":{refusalWording:"Maps a refusal code to the permitted user-facing wording."},
};
const nodes=[],edges=[];const E=(s,t,type,w)=>edges.push({source:s,target:t,type,direction:"forward",weight:w});
for(const f of r.results){const p=f.path;const [sum,tags,cx]=F[p];
nodes.push({id:"file:"+p,type:"file",name:p.split("/").pop(),filePath:p,summary:sum,tags,complexity:cx});
const exp=new Set((f.exports||[]).map(e=>e.name));
for(const fn of f.functions||[]){const len=fn.endLine-fn.startLine+1;if(!(exp.has(fn.name)||len>=10))continue;
const id=`function:${p}:${fn.name}`;const s=S[p]&&S[p][fn.name];if(!s)throw new Error("no sum "+id);
nodes.push({id,type:"function",name:fn.name,filePath:p,lineRange:[fn.startLine,fn.endLine],summary:s,tags:tags.slice(0,3),complexity:len>150?"complex":len>40?"moderate":"simple"});
E("file:"+p,id,"contains",1.0);if(exp.has(fn.name))E("file:"+p,id,"exports",0.8);}
for(const t of b.batchImportData[p]||[])E("file:"+p,"file:"+t,"imports",0.7);}
const cg="function:src/governance/controller.js:createGovernance";
for(const [f,n] of [["elements","governanceElements"],["detector","createDetector"],["inputs","createInputs"],["observation","createObservation"],["operator-files","createOperatorFiles"],["prepared","createPrepared"],["reopen","createReopen"],["revisions","createRevisionTracker"],["statuses","createStatuses"],["verdict","createVerdict"]])E(cg,`function:src/governance/${f}.js:${n}`,"calls",0.8);
E("file:src/governance/revisions.js","file:tools/tests/revisions.test.mjs","tested_by",0.5);
const ids=new Set(nodes.map(n=>n.id));const ok=new Set([...Object.values(b.batchImportData).flat()].map(x=>"file:"+x));
for(const e of edges)for(const x of [e.source,e.target])if(!ids.has(x)&&!ok.has(x))throw new Error("bad "+x);
fs.writeFileSync(__dirname+"/../intermediate/batch-2.json",JSON.stringify({nodes,edges},null,1));
console.log(nodes.length,edges.length,edges.filter(e=>e.type==="imports").length);
