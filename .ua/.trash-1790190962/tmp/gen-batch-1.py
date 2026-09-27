import json, math
root='D:/dev/aih-ui/.ua/'
inp=json.load(open(root+'tmp/ua-file-analyzer-input-1.json'))
ext={r['path']:r for r in json.load(open(root+'tmp/ua-file-extract-results-1.json'))['results']}
imp=inp['batchImportData']

files={
'src/app/dom.js':("Shared DOM primitives (text normalization, element creation via textContent, and fail-loud id lookup) used by every UI component so package data is never parsed as HTML.",["utility","dom","security","shared"],"simple"),
'src/catalog/cards.js':("Renders the catalog grid: one card per visible entry with kind icon, publisher title and description, curated or declared category badge, and placeholder scan/token slots that say Not published.",["component","rendering","catalog","ui"],"moderate"),
'src/catalog/categories.js':("Rebinds Catalog's curated category records to served index entries and exposes badge, note and count helpers, never inferring categories that Catalog did not curate.",["data-model","catalog","curation","utility"],"moderate"),
'src/catalog/collections.js':("Applies Catalog's published collection view to the index to decide which entries are current inventory, counting older entries only as diagnostics.",["data-model","catalog","filtering","inventory"],"moderate"),
'src/catalog/controller.js':("Sources & Catalogs feature controller that owns the single selection/filter state, loads the catalog, and wires all catalog components through models and callbacks.",["controller","entry-point","state-management","catalog"],"moderate"),
'src/catalog/details.js':("Renders the inspector's Details and Security tabs: publisher overview, declared capabilities, upstream provenance, evidence statements and Catalog qualification, with explicit absence wording.",["component","inspector","rendering","catalog","security"],"complex"),
'src/catalog/elements.js':("Looks up all Sources & Catalogs DOM elements once and groups them per owning component so no component queries the DOM itself.",["dom","configuration","catalog","ui"],"moderate"),
'src/catalog/entry.js':("Pure readers over a single published catalog entry: source identity by source type, digests, labels, evidence statements, kind icons and search text.",["utility","data-model","catalog","pure-functions"],"moderate"),
'src/catalog/index-source.js':("Loads the served @aihq/catalog index and preview summary, enforces the index format/version contract, and applies collections, publisher, qualification and category sidecars.",["data-loading","validation","catalog","service"],"moderate"),
'src/catalog/metrics.js':("Renders the six-kind ledger metric tiles above the split, counting only kinds the index carries and showing Not published for the rest.",["component","metrics","catalog","ui"],"moderate"),
'src/catalog/navigation.js':("Renders the left-rail Catalog Scopes: one row per published source identity or Catalog collection, with revision markers, curated category breakdown and organization additions.",["component","navigation","catalog","ui"],"moderate"),
'src/catalog/provenance.js':("Renders the installed-package provenance strip, the masthead naming the selected source, and the source status line, stating unconnected organization/Core state explicitly.",["component","provenance","catalog","ui"],"complex"),
'src/catalog/publisher.js':("Rebinds Catalog's publisher presentation metadata (titles, descriptions, categories) to index entries and reads it back with Catalog's own unavailability reasons.",["data-model","catalog","publisher-metadata","utility"],"moderate"),
'src/catalog/qualification.js':("Rebinds Catalog's publisher qualification reader results to index entries, with tooltips for each state word and attestation sentences, never treating qualified as approval.",["data-model","catalog","qualification","security"],"moderate"),
'src/catalog/selectors.js':("Pure presentation selectors for search, filtering, sorting, inventory counts and source scopes, computing every displayed number from the installed index at run time.",["selectors","filtering","pure-functions","catalog"],"complex"),
'src/catalog/toolbar.js':("Renders the filter toolbar: the primary review pills (with unavailable Needs Review/Egress Out) and secondary kind, source-type and sort controls with scroll affordance.",["component","filtering","toolbar","ui"],"moderate"),
'src/catalog/view-state.js':("Persists the catalog view (query, filters, sort) in sessionStorage and restores it validated against the installed index counts.",["state-management","persistence","utility","catalog"],"simple"),
'tools/tests/publisher-refusal.test.mjs':("Node test suite verifying that a refused publisher-metadata sidecar is reported with the reader's reason rather than as Catalog publishing nothing.",["test","publisher-metadata","regression","catalog"],"moderate"),
}
fn={
'src/app/dom.js':{'text':"Normalizes a value to a non-empty string or null, treating empty and undefined as absence.",'el':"Creates a DOM element with an optional class and text content set safely via textContent.",'collectIds':"Looks up a list of element ids and returns them camelCase-keyed, throwing on the first missing element."},
'src/catalog/cards.js':{'badgeOf':"Chooses a card's category badge from Catalog's curated category or the upstream-declared category.",'card':"Builds one catalog card with header, publisher description and footer slots for scan status, token estimate and a disabled allow toggle.",'createCards':"Creates the cards grid component that renders visible entries and the visible count caption."},
'src/catalog/categories.js':{'applyCategories':"Binds served curated category records to index entries by entry id and subject digest, returning state, taxonomy and a per-entry map.",'curatedCategoryOf':"Returns the curated category record for an entry, if any.",'curationNote':"Produces the tooltip note explaining a category is curated by Catalog maintainers.",'categoryBadge':"Builds the badge label and title for an entry's curated category or Not curated.",'categoryRows':"Counts curated categories across entries into sorted rows for display."},
'src/catalog/collections.js':{'applyCollections':"Filters index entries to current inventory using Catalog's collection membership and subject digests, reporting non-current entries as diagnostics."},
'src/catalog/controller.js':{'createCatalog':"Creates the catalog feature: loads data, holds view/selection state, and renders cards, details, metrics, navigation, provenance and toolbar on each change."},
'src/catalog/details.js':{'row':"Builds a labelled key/value row for the inspector details panes.",'capability':"Renders one declared-capability row, distinguishing Not declared from Not published.",'renderQualification':"Renders the Security tab's qualification block with state, receipt window, signature and attestation.",'createDetails':"Creates the inspector component that renders the Details and Security tabs for the selected entry."},
'src/catalog/elements.js':{'catalogElements':"Collects all catalog DOM ids and groups them by owning component (provenance, navigation, toolbar, grid, inspector)."},
'src/catalog/entry.js':{'shortDigest':"Shortens a sha256 digest for compact display.",'sourceIdentity':"Reads an entry's source identity according to its source.type discriminator (github, npm, aih).",'sourceLabelOf':"Returns a short display label for an entry's source.",'sourceLabelTitle':"Returns a descriptive tooltip for an entry's source label.",'sourceDetailRows':"Builds the detail rows describing an entry's upstream source per source type.",'identity':"Returns an entry's displayable identity fields (name, kind, ids, digest).",'statement':"Normalizes a single evidence statement from an entry.",'statementsOf':"Lists an entry's evidence statements with summaries as Catalog's reader returns them.",'firstSummary':"Returns the first available statement summary for an entry.",'searchText':"Builds the lowercase searchable text for an entry from its identity, source and publisher fields."},
'src/catalog/index-source.js':{'loadJson':"Fetches and parses a served JSON document, raising a descriptive error on failure.",'loadCatalog':"Loads the catalog index and summary, validates the contract, and applies collections, publisher, qualification and category data."},
'src/catalog/metrics.js':{'tile':"Builds one ledger metric tile, clickable only for kinds the index counts.",'createMetrics':"Creates the metric tiles component that renders the six-kind ledger."},
'src/catalog/navigation.js':{'badgeNode':"Builds a small badge element for a scope row.",'categoriesReason':"Explains why curated categories are unavailable for a scope.",'curatedCategories':"Renders the curated category breakdown under the selected source row.",'scopeRow':"Renders one source or collection scope row with count, revision and selection state.",'additionsRow':"Renders the organization's own additions row, empty until something is imported.",'createNavigation':"Creates the left-rail navigation component listing catalog scopes."},
'src/catalog/provenance.js':{'createProvenance':"Creates the provenance component rendering the package strip, masthead and source status line with diagnostic details."},
'src/catalog/publisher.js':{'applyPublisher':"Binds served publisher metadata records to index entries, keeping the reader's refusal reason when unavailable.",'publisherOf':"Returns the publisher record for an entry, if bound.",'categoryCoverage':"Counts how many entries carry an upstream-declared category.",'publishedText':"Returns a published publisher value or null, never inventing text.",'provenanceNote':"Explains where a publisher value came from or why it is missing."},
'src/catalog/qualification.js':{'attestationSentence':"Describes the attestation state of a qualification in words.",'applyQualification':"Binds qualification reader records to index entries by entry id and subject digest.",'qualificationOf':"Returns the qualification record for an entry, if bound."},
'src/catalog/selectors.js':{'sourceFilterValue':"Encodes a source filter value from type, identity and revision.",'matchesSourceFilter':"Tests whether an entry matches a nested source filter.",'visibleEntries':"Applies search, kind, source filters and sorting to produce the visible entries.",'sortedCounts':"Sorts a count map into descending rows.",'inventoryCounts':"Computes kind, source-type and scope counts from the installed entries.",'sourceScopes':"Groups entries into source identity and collection scopes with counts and revisions.",'scopeCountOf':"Returns the item count for a scope.",'collectionOf':"Returns the Catalog collection an entry is a current member of.",'selectedScope':"Resolves the currently selected scope from the view.",'scopeEntries':"Returns entries belonging to the selected scope.",'scopeTotal':"Returns the item total for the selected scope.",'describeCollection':"Describes a collection scope with owner, release and package-mismatch marker.",'describeScope':"Describes a source scope's label, revision and details for navigation and masthead."},
'src/catalog/toolbar.js':{'reviewPill':"Builds a primary review pill, disabled with a reason when no data can back its count.",'kindPill':"Builds a kind filter pill with its count and active state.",'createToolbar':"Creates the toolbar component rendering review pills, kind pills, search, source filter and sort."},
'src/catalog/view-state.js':{'emptyView':"Returns the default empty catalog view.",'saveView':"Saves the view to sessionStorage, ignoring blocked storage.",'restoreView':"Restores a saved view, dropping filters and sort keys the installed index does not publish."},
}
nodes=[];edges=[]
def E(s,t,ty,w): edges.append({"source":s,"target":t,"type":ty,"direction":"forward","weight":w})
for p,(s,tags,cx) in files.items():
    fid='file:'+p
    nodes.append({"id":fid,"type":"file","name":p.split('/')[-1],"filePath":p,"summary":s,"tags":tags,"complexity":cx})
    r=ext[p]; exps={e['name'] for e in r.get('exports',[])}
    fmap={f['name']:f for f in r.get('functions',[])}
    for name,summ in fn.get(p,{}).items():
        f=fmap[name]; nid=f'function:{p}:{name}'
        n=f['endLine']-f['startLine']+1
        nodes.append({"id":nid,"type":"function","name":name,"filePath":p,"lineRange":[f['startLine'],f['endLine']],"summary":summ,"tags":tags[:2]+(["exported"] if name in exps else ["internal"]),"complexity":"complex" if n>100 else "moderate" if n>30 else "simple"})
        E(fid,nid,"contains",1.0)
        if name in exps: E(fid,nid,"exports",0.8)
    for t in imp.get(p,[]): E(fid,'file:'+t,"imports",0.7)
C='src/catalog/'
def F(p,n): return f'function:{p}:{n}'
for callee_file,names in [('cards.js',['createCards']),('details.js',['createDetails']),('metrics.js',['createMetrics']),('navigation.js',['createNavigation']),('provenance.js',['createProvenance']),('toolbar.js',['createToolbar']),('elements.js',['catalogElements']),('index-source.js',['loadCatalog']),('publisher.js',['categoryCoverage']),('categories.js',['categoryRows']),('selectors.js',['inventoryCounts','scopeEntries','scopeTotal','selectedScope','visibleEntries']),('view-state.js',['emptyView','restoreView','saveView'])]:
    for n in names: E(F(C+'controller.js','createCatalog'),F(C+callee_file,n),"calls",0.8)
for n,f in [('applyCollections','collections.js'),('applyPublisher','publisher.js'),('applyQualification','qualification.js'),('applyCategories','categories.js')]:
    E(F(C+'index-source.js','loadCatalog'),F(C+f,n),"calls",0.8)
for n,f in [('categoryBadge','categories.js'),('publishedText','publisher.js'),('publisherOf','publisher.js'),('provenanceNote','publisher.js'),('identity','entry.js')]:
    E(F(C+'cards.js','card'),F(C+f,n),"calls",0.8)
for n,f in [('qualificationOf','qualification.js'),('attestationSentence','qualification.js')]:
    E(F(C+'details.js','renderQualification'),F(C+f,n),"calls",0.8)
for n,f in [('publisherOf','publisher.js'),('publishedText','publisher.js'),('statementsOf','entry.js'),('sourceDetailRows','entry.js'),('identity','entry.js'),('collectionOf','selectors.js')]:
    E(F(C+'details.js','createDetails'),F(C+f,n),"calls",0.8)
for n in ['describeScope','sourceScopes']:
    E(F(C+'navigation.js','createNavigation'),F(C+'selectors.js',n),"calls",0.8)
    E(F(C+'provenance.js','createProvenance'),F(C+'selectors.js',n),"calls",0.8)
E(F(C+'navigation.js','curatedCategories'),F(C+'categories.js','curationNote'),"calls",0.8)
E(F(C+'toolbar.js','createToolbar'),F(C+'selectors.js','sortedCounts'),"calls",0.8)
T='file:tools/tests/publisher-refusal.test.mjs'
for n in ['applyPublisher','provenanceNote','publisherOf']: E(T,F(C+'publisher.js',n),"calls",0.8)
E('file:'+C+'publisher.js',T,"tested_by",0.5)
E(F(C+'elements.js','catalogElements'),F('src/app/dom.js','collectIds'),"calls",0.8)
ids={n['id'] for n in nodes}
assert len(ids)==len(nodes)
for e in edges:
    for k in ('source','target'):
        v=e[k]
        if v not in ids: assert v.startswith('file:') and any(v[5:] in l for l in imp.values()), v
    assert e['source']!=e['target']
assert sum(1 for e in edges if e['type']=='imports')==sum(len(v) for v in imp.values())
nc,ec=len(nodes),len(edges)
print(nc,ec)
out=root+'intermediate/'
if nc<=60 and ec<=120:
    json.dump({"nodes":nodes,"edges":edges},open(out+'batch-1.json','w'),indent=1)
else:
    parts=math.ceil(max(nc/60,ec/120)); fl=sorted(files); size=math.ceil(len(fl)/parts)
    for k in range(parts):
        grp=set(fl[k*size:(k+1)*size])
        pn=[n for n in nodes if n['filePath'] in grp]; pid={n['id'] for n in pn}
        pe=[e for e in edges if e['source'] in pid]
        json.dump({"nodes":pn,"edges":pe},open(out+f'batch-1-part-{k+1}.json','w'),indent=1)
        print('part',k+1,len(pn),len(pe))
