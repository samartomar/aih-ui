import fs from "node:fs";
const R = JSON.parse(fs.readFileSync("D:/dev/aih-ui/.ua/tmp/ua-file-extract-results-3.json","utf8"));
const inp = JSON.parse(fs.readFileSync("D:/dev/aih-ui/.ua/tmp/ua-file-analyzer-input-3.json","utf8"));
const S="tools/service/";
const files = {
 "tools/scan-attribution-cases.mjs":["Acceptance cases for Scan signer attribution: signs a fixture with the second of two trusted keys carrying different operator declarations, reorders roots, and asserts the verifier attributes the declaration of the actual signer.",["test","acceptance","scan-attribution","trust-boundary"],"complex"],
 [S+"artifacts.mjs"]:["Exact-byte artifact I/O for the backend worker: base64 helpers, byte-exact read/write/copy of files and trees, JSON file helpers, and session-relative path naming so the page never sees machine paths.",["utility","file-io","artifacts","serialization"],"moderate"],
 [S+"catalog-access.mjs"]:["Reads the installed @aihq/catalog through Catalog's published content reader, resolving the package root, looking up entries, joining descriptor paths safely, and reporting Catalog's own integrity result.",["service","catalog","adapter","integrity"],"moderate"],
 [S+"catalog-assessment.mjs"]:["Builds the optional assessment resolver handed to Core, supplying only the published Catalog assessment artifact bytes for the identity Core derived.",["service","catalog","adapter","resolver"],"simple"],
 [S+"catalog-categories.mjs"]:["Serves Catalog's curated per-entry categories through readCatalogCategoriesV1, reporting refusals rather than assigning or inferring categories.",["service","catalog","adapter","categories"],"moderate"],
 [S+"catalog-collections.mjs"]:["Serves Catalog's current collection view through readCatalogCollectionsV1, bound to the exact index bytes; loaded on demand by the worker.",["service","catalog","adapter","collections"],"simple"],
 [S+"catalog-publisher.mjs"]:["Serves publisher titles, descriptions and categories from Catalog's display-only presentation sidecar via readCatalogPresentationV1, reporting unavailable values with Catalog's reason.",["service","catalog","adapter","presentation"],"moderate"],
 [S+"catalog-qualification.mjs"]:["Serves Catalog's publisher qualification states via readCatalogQualificationV1, which re-verifies the shipped signed head and receipts, stamped with the instant they hold at.",["service","catalog","adapter","qualification"],"moderate"],
 [S+"catalog-served.mjs"]:["Projects the output of Catalog's public content reader member by member into the document served to the page, so no field the reader drops can reach the UI.",["service","catalog","projection","serialization","validation"],"moderate"],
 [S+"core-adapter.mjs"]:["Calls @aihq/core's public API for subject derivation, evidence parsing, preparation and independent consumption of governance input, wiring in the Catalog assessment resolver and Scan verification without reproducing Core logic.",["service","adapter","core","governance"],"complex"],
 [S+"core-service.mjs"]:["Backend worker entry point and operation dispatcher: reads one JSON request on stdin, routes it to catalog, Core or validation operations (some lazily imported), and writes one JSON response.",["entry-point","service","dispatcher","ipc"],"moderate"],
 [S+"fixture-candidate.mjs"]:["Validation-only builder that assembles a ScanCandidateV2 over the installed Catalog content and signs it with an ephemeral key; no detector runs and nothing is a measurement.",["validation","fixture","scan","signing"],"complex"],
 [S+"scan-verifier.mjs"]:["Builds the Scan verifier adapter injected into Core consumption from @aihq/scan's public exports and the operator's own trust file, enforcing the trust boundary and attributing operator declarations to the verified signer.",["service","verification","trust-boundary","scan","security"],"complex"],
 [S+"validation-fixture.mjs"]:["Explicitly labelled validation mode: the only module that manufactures anything, producing an ephemeral signed scan candidate, example authority bundle and operator trust file for a Catalog entry.",["validation","fixture","governance","signing"],"complex"],
 ["tools/tests/catalog-served.test.mjs"]:["node:test cases asserting the served catalog document carries only members of the public reader's result types and serves the evidence summary exactly when the reader returned it.",["test","catalog","projection","contract"],"moderate"],
 ["tools/tests/session-relative.test.mjs"]:["node:test cases pinning that operator-side files are named by session-relative path for both path styles, and never by machine location.",["test","paths","privacy","artifacts"],"simple"],
};
const F = [
 ["tools/scan-attribution-cases.mjs","makeSigner","Generates an Ed25519 key pair and returns a signer with its Scan key id and public key for a test case.",["test-helper","signing","crypto"]],
 ["tools/scan-attribution-cases.mjs","writeTrust","Writes an operator trust file with the given roots and expectations into the case directory.",["test-helper","trust","file-io"]],
 ["tools/scan-attribution-cases.mjs","consumeWith","Runs buildScanVerification against scan material and a trust file and returns the attributed operator provenance.",["test-helper","verification","scan"]],
 [S+"artifacts.mjs","b64","Encodes bytes as base64.",["utility","encoding"]],
 [S+"artifacts.mjs","fromB64","Decodes a base64 string into a Buffer.",["utility","encoding"]],
 [S+"artifacts.mjs","sessionRelativePath","Returns a POSIX session-relative name for a file inside a session directory, or undefined when it has none.",["utility","paths","privacy"]],
 [S+"artifacts.mjs","writeExactBytes","Writes bytes exactly as given, creating parent directories.",["utility","file-io"]],
 [S+"artifacts.mjs","readExactBytes","Reads a file's exact bytes without re-serialization.",["utility","file-io"]],
 [S+"artifacts.mjs","recreateDirectory","Removes and recreates a directory to get a clean root.",["utility","file-io"]],
 [S+"artifacts.mjs","copyExactTree","Recursively copies a directory tree byte for byte.",["utility","file-io"]],
 [S+"artifacts.mjs","readJsonFile","Reads and parses a JSON file.",["utility","serialization"]],
 [S+"artifacts.mjs","writeJsonFile","Serializes a value to a JSON file (used for non-artifact operator files).",["utility","serialization"]],
 [S+"catalog-access.mjs","catalogRoot","Resolves the installed @aihq/catalog package root through package resolution.",["catalog","resolution"]],
 [S+"catalog-access.mjs","readCatalog","Reads and validates the content index through readCatalogContentV1, optionally verifying artifact hashes.",["catalog","reader","validation"]],
 [S+"catalog-access.mjs","catalogEntry","Looks up one catalog entry by id, refusing when it is absent.",["catalog","lookup"]],
 [S+"catalog-access.mjs","artifactPath","Joins a descriptor path under the Catalog root through resolveCatalogContentPathV1.",["catalog","paths","security"]],
 [S+"catalog-access.mjs","entryContentDir","Resolves the content directory of an entry within the Catalog package.",["catalog","paths"]],
 [S+"catalog-access.mjs","catalogIntegrity","Reports Catalog's own artifact integrity result for an entry without restating its rules.",["catalog","integrity","verification"]],
 [S+"catalog-assessment.mjs","createCatalogAssessmentResolver","Returns a resolver that supplies the published assessment artifact bytes for exactly one matching aih entry, or nothing.",["factory","resolver","catalog"]],
 [S+"catalog-categories.mjs","catalogCategories","Reads curated categories through Catalog's reader and returns them or the refusal.",["catalog","reader","categories"]],
 [S+"catalog-collections.mjs","catalogCollections","Reads the current collection view through Catalog's reader against the index bytes.",["catalog","reader","collections"]],
 [S+"catalog-publisher.mjs","catalogPublisher","Reads publisher presentation records through Catalog's reader, reporting unavailability when the contract is missing.",["catalog","reader","presentation"]],
 [S+"catalog-qualification.mjs","catalogQualification","Reads per-entry qualification through Catalog's qualification reader at the current instant and serves its words verbatim.",["catalog","reader","qualification"]],
 [S+"catalog-served.mjs","evidence","Projects one reader evidence record, copying the optional summary only when present.",["projection","catalog"]],
 [S+"catalog-served.mjs","subject","Projects an entry's subject member by member.",["projection","catalog"]],
 [S+"catalog-served.mjs","entry","Projects a CatalogEntryV1 field by field, including artifacts, evidence and subject.",["projection","catalog"]],
 [S+"catalog-served.mjs","servedCatalogDocument","Builds the catalog document served to the page solely from the reader's CatalogContentV1 result.",["projection","catalog","serialization"]],
 [S+"core-adapter.mjs","deriveSubject","Derives a subject identity from a catalog entry through Core's public functions.",["core","identity"]],
 [S+"core-adapter.mjs","subject","Returns the Core-derived subject for an entry and its content directory.",["core","identity","api-handler"]],
 [S+"core-adapter.mjs","parseEvidence","Parses operator-imported evidence bytes through Core's public parser, passing refusals through.",["core","parsing","api-handler"]],
 [S+"core-adapter.mjs","prepare","Prepares governance input with Core and saves the exact artifact bytes into the session directory.",["core","governance","api-handler"]],
 [S+"core-adapter.mjs","consume","Reopens saved bytes and independently re-derives the verdict via Core, injecting Scan verification, observation files and the assessment resolver.",["core","governance","verification","api-handler"]],
 [S+"core-service.mjs","main","Reads the stdin request, dispatches it to the OPS table and writes an ok or error JSON response.",["entry-point","dispatcher","ipc"]],
 [S+"fixture-candidate.mjs","stableJson","Serializes values with sorted keys for stable digests.",["utility","serialization"]],
 [S+"fixture-candidate.mjs","buildSignedFixture","Assembles and signs a ScanCandidateV2 and attestation envelope with an ephemeral key over the sealed Catalog source.",["validation","fixture","signing","scan"]],
 [S+"scan-verifier.mjs","attributeSigner","Matches the verified signer against the operator's trusted roots to pick the applicable operator declaration.",["verification","trust-boundary"]],
 [S+"scan-verifier.mjs","presentationFacts","Extracts presentation facts from verified scan material for display.",["verification","presentation"]],
 [S+"scan-verifier.mjs","buildScanVerification","Builds the Scan verifier adapter from scan material and operator trust, refusing material that supplies its own trust.",["factory","verification","scan","security"]],
 [S+"validation-fixture.mjs","closurePaths","Lists the file paths in an entry's content closure.",["validation","paths"]],
 [S+"validation-fixture.mjs","matchedPathOf","Finds the path the entry's profile artifact matches within the content closure.",["validation","paths"]],
 [S+"validation-fixture.mjs","exampleAuthority","Builds a labelled example authority bundle with an example governance decision.",["validation","fixture","governance"]],
 [S+"validation-fixture.mjs","buildValidationFixture","Produces the complete validation fixture set (signed scan material, authority bundle, operator trust) for an entry.",["validation","fixture","factory"]],
 ["tools/tests/catalog-served.test.mjs","record","Test helper creating an object with extra undeclared members.",["test-helper","fixture"]],
 ["tools/tests/catalog-served.test.mjs","readerResult","Builds a reader result carrying extra members at every level for projection tests.",["test-helper","fixture"]],
 ["tools/tests/catalog-served.test.mjs","undeclared","Walks the served document and collects members not declared by the reader result types.",["test-helper","validation"]],
];
const byPath = Object.fromEntries(R.results.map(r=>[r.path,r]));
const nodes=[], edges=[];
const E=(s,t,type,w)=>edges.push({source:s,target:t,type,direction:"forward",weight:w});
for (const [p,[sum,tags,cx]] of Object.entries(files)) nodes.push({id:`file:${p}`,type:"file",name:p.split("/").pop(),filePath:p,summary:sum,tags,complexity:cx});
for (const [p,n,sum,tags] of F){
  const r=byPath[p]; const fn=r.functions.find(f=>f.name===n); if(!fn) throw new Error(p+n);
  const len=fn.endLine-fn.startLine+1;
  const id=`function:${p}:${n}`;
  nodes.push({id,type:"function",name:n,filePath:p,lineRange:[fn.startLine,fn.endLine],summary:sum,tags,complexity:len>80?"complex":len>25?"moderate":"simple"});
  E(`file:${p}`,id,"contains",1.0);
  if ((r.exports||[]).some(e=>e.name===n)) E(`file:${p}`,id,"exports",0.8);
}
for (const [p,arr] of Object.entries(inp.batchImportData)) for (const t of arr) E(`file:${p}`,`file:${t}`,"imports",0.7);
const fid=(p,n)=>`function:${p}:${n}`;
const C=[
 [S+"catalog-assessment.mjs","createCatalogAssessmentResolver",S+"catalog-access.mjs","readCatalog"],
 [S+"catalog-assessment.mjs","createCatalogAssessmentResolver",S+"catalog-access.mjs","artifactPath"],
 [S+"catalog-categories.mjs","catalogCategories",S+"catalog-access.mjs","readCatalog"],
 [S+"catalog-collections.mjs","catalogCollections",S+"catalog-access.mjs","readCatalog"],
 [S+"catalog-publisher.mjs","catalogPublisher",S+"catalog-access.mjs","readCatalog"],
 [S+"catalog-qualification.mjs","catalogQualification",S+"catalog-access.mjs","readCatalog"],
 [S+"catalog-qualification.mjs","catalogQualification",S+"catalog-access.mjs","catalogRoot"],
 [S+"core-adapter.mjs","parseEvidence",S+"artifacts.mjs","fromB64"],
 [S+"core-adapter.mjs","prepare",S+"catalog-access.mjs","catalogEntry"],
 [S+"core-adapter.mjs","prepare",S+"artifacts.mjs","writeExactBytes"],
 [S+"core-adapter.mjs","consume",S+"artifacts.mjs","readExactBytes"],
 [S+"core-adapter.mjs","consume",S+"artifacts.mjs","recreateDirectory"],
 [S+"core-adapter.mjs","consume",S+"artifacts.mjs","sessionRelativePath"],
 [S+"core-adapter.mjs","consume",S+"scan-verifier.mjs","buildScanVerification"],
 [S+"core-adapter.mjs","consume",S+"catalog-assessment.mjs","createCatalogAssessmentResolver"],
 [S+"scan-verifier.mjs","buildScanVerification",S+"artifacts.mjs","readJsonFile"],
 [S+"scan-verifier.mjs","buildScanVerification",S+"artifacts.mjs","fromB64"],
 [S+"validation-fixture.mjs","buildValidationFixture",S+"catalog-access.mjs","catalogEntry"],
 [S+"validation-fixture.mjs","buildValidationFixture",S+"catalog-access.mjs","entryContentDir"],
 [S+"validation-fixture.mjs","buildValidationFixture",S+"core-adapter.mjs","deriveSubject"],
 [S+"validation-fixture.mjs","buildValidationFixture",S+"fixture-candidate.mjs","buildSignedFixture"],
 [S+"validation-fixture.mjs","buildValidationFixture",S+"artifacts.mjs","writeJsonFile"],
 [S+"validation-fixture.mjs","matchedPathOf",S+"catalog-access.mjs","artifactPath"],
 ["tools/scan-attribution-cases.mjs","consumeWith",S+"scan-verifier.mjs","buildScanVerification"],
];
for (const [a,b,c,d] of C) E(fid(a,b),fid(c,d),"calls",0.8);
for (const m of ["catalog-collections","catalog-publisher","catalog-qualification","catalog-categories","core-targets"]) E(`file:${S}core-service.mjs`,`file:${S}${m}.mjs`,"depends_on",0.6);
E(`file:${S}catalog-served.mjs`,"file:tools/tests/catalog-served.test.mjs","tested_by",0.5);
E(`file:${S}artifacts.mjs`,"file:tools/tests/session-relative.test.mjs","tested_by",0.5);
E(`file:${S}scan-verifier.mjs`,"file:tools/scan-attribution-cases.mjs","tested_by",0.5);
const ids=new Set(nodes.map(n=>n.id)); if(ids.size!==nodes.length) throw "dup";
const ext=new Set([`file:${S}core-targets.mjs`]);
for(const e of edges){ if(!ids.has(e.source)) throw "src "+e.source; if(!ids.has(e.target)&&!ext.has(e.target)) throw "tgt "+e.target; if(e.source===e.target) throw "self";}
const imp=edges.filter(e=>e.type==="imports").length, want=Object.values(inp.batchImportData).flat().length;
console.log("nodes",nodes.length,"edges",edges.length,"imports",imp,want);
const parts=Math.ceil(Math.max(nodes.length/60,edges.length/120));
const paths=Object.keys(files).sort(); const size=Math.ceil(paths.length/parts);
for(let k=0;k<parts;k++){
  const set=new Set(paths.slice(k*size,(k+1)*size));
  const pn=nodes.filter(n=>set.has(n.filePath)); const pid=new Set(pn.map(n=>n.id));
  const pe=edges.filter(e=>pid.has(e.source));
  const out=parts===1?"batch-3.json":`batch-3-part-${k+1}.json`;
  fs.writeFileSync("D:/dev/aih-ui/.ua/intermediate/"+out,JSON.stringify({nodes:pn,edges:pe},null,1));
  console.log(out,pn.length,pe.length);
}
