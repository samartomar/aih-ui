/* Throwaway Workbench: can an admin supply choices, a developer use them, and Vibe stand alone? */
'use strict';
(async function () {
var framework, records=[];
var kinds=['skill','command','agent','mcp','hook','token'];
var frameworkRules={}, itemRules={}, kindRules={};
var evidenceGroups={}, evidenceGrouping='concern', evidenceOpenIndex=null;
var state=initialState(), busy=false, pendingHistory=false, session=await fetch('/api/session').then(function(r){if(!r.ok)throw Error('Start the local host to use this prototype');return r.json();});
var catalog=await fetch('/api/catalog').then(function(r){if(!r.ok)throw Error('Full Catalog could not load');return r.json();});
var data=session.comparison||{update:null,scan:{}};
framework=data.framework||catalog.frameworks.find(function(f){return f.id==='superpowers';});
var profiles=[],profileExample=null,profileIndex=0,profilePreview=null,profileTexts=new Map(),profileLoadError='',profilePaste='',profileImportOpen=false,profilePicker={search:'',framework:'all',kind:'all',page:0};
try{var suppliedProfiles=await fetch('/api/profiles').then(function(r){if(!r.ok)throw Error('Profiles could not load');return r.json();});profiles=suppliedProfiles.profiles||[];profileExample=suppliedProfiles.example||null;}catch(error){profileLoadError=error.message;}
records=catalog.items.map(function(item){return Object.assign({findings:[]},item);});kinds=Array.from(new Set(records.map(function(item){return item.kind;})));
applyRemote(session.enterprise);applyRemote(session.vibe);
document.getElementById('connection-state').textContent='Connected local host';
function localState() { return {choices:{extensions:false,superpowers:false,instructions:false},text:'Use the project conventions. Review changes before committing.',dirty:false,remote:null,prepared:null,check:null,clientCheck:null,reports:[],outcome:null,lastOperation:null}; }
function initialState() { return {mode:'enterprise',role:'admin',view:'catalog',frameworkFilter:'all',page:0,findingPage:0,catalogClient:'claude-code',toolClient:'claude-code',toolItems:[],toolConfigured:false,toolPreview:null,toolError:'',planItems:[],planPreview:null,policyDraftDirty:false,policyPosture:'catalog-default',allowedFrameworks:null,policyItemId:'',planCollapsed:false,scanReturn:'catalog',inspector:'details',recordId:null,findingIndex:null,expandedFindings:false,revealReview:false,kind:'all',search:'',severity:'all',obligation:'permitted',policyId:'team-extensions',allowCustom:true,result:null,published:null,enterprise:localState(),vibe:localState(),preview:false,intentSaved:false,notice:''}; }
function $(id) { return document.getElementById(id); }
function esc(v) { return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function badge(v,t) { return '<span class="badge '+(t||'')+'">'+esc(v)+'</span>'; }
function short(v) { return String(v||'').slice(0,12); }
function kind(v) { return {skills:'skill',commands:'command',agents:'agent',hooks:'hook',tokens:'token','mcp-server':'mcp'}[v]||String(v||'').toLowerCase(); }
function sourceUrl(v) { return /^https?:/.test(v||'')?v:'https://github.com/'+v; }
function link(url,label) { return typeof url==='string'&&(/^https:\/\//i.test(url)||url.startsWith('/catalog-assets/'))?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(label)+' ↗</a>':esc(label); }
function record() { return records.find(function(r){return r.id===state.recordId;}); }
function toolItems() { return records.filter(function(item){return item.kind==='ai-setup';}); }
function toolFrameworkIds() { return new Set(toolItems().map(function(item){return item.framework;})); }
function frameworkSources() { var ids=toolFrameworkIds();return catalog.frameworks.filter(function(source){return !ids.has(source.id);}); }
function itemPlanAction(item,compact) { return item.kind==='ai-setup'?go('tools','Open Tools chooser'):button('catalog-add:'+item.id,state.planItems.includes(item.id)?compact?'Remove from preview':'Remove from plan preview':compact?'Add to preview':'Add to plan preview',!state.planItems.includes(item.id)&&itemProhibited(item),true); }
function finding() { var r=record(); return r&&state.findingIndex!=null?(r.findings||[])[state.findingIndex]:null; }
function readable(v) { return v&&typeof v==='object'?JSON.stringify(v):String(v==null?'Not supplied':v); }
function admin() { return state.mode==='enterprise'&&state.role==='admin'; }
function local() { return state[state.mode]; }
function boundary() { return state.mode==='enterprise'?state.published:null; }
function unitProhibited(unit) { var p=boundary();if(!p)return false;if(unit!=='instructions'&&Array.isArray(p.policy.sources?.frameworks)&&!p.policy.sources.frameworks.includes(unit))return true;if(unit==='instructions')return p.policy.entries.some(function(e){return e.id==='project-instructions'&&e.obligation==='prohibited';});return p.policy.entries.some(function(e){return e.content?.framework===unit&&e.obligation==='prohibited'&&(!e.scopes||e.scopes.includes('project'))&&(!e.clients||e.clients.includes('claude-code'))&&!e.repositories;}); }
function itemProhibited(item) { var p=boundary();return !!p&&(Array.isArray(p.policy.sources?.frameworks)&&!p.policy.sources.frameworks.includes(item.framework)||p.policy.entries.some(function(e){var c=e.content;return c&&e.obligation==='prohibited'&&(!e.scopes||e.scopes.includes('project'))&&(!e.clients||e.clients.includes(state.catalogClient))&&!e.repositories&&(!c.framework||c.framework===item.framework)&&(!c.item||c.item===item.id)&&(!c.kind||c.kind===item.kind)&&!c.recipe;})); }
function canChoose(item) { return !busy&&!unitProhibited(item); }
function ready() { return !admin()&&(state.mode==='vibe'||!!boundary()); }
function names(choices) { return [choices.extensions?'AIH Extensions '+connectedFramework().version:null,choices.superpowers?('Superpowers'+(framework.version?' '+framework.version:'')):null,choices.instructions?'Project instructions':null].filter(Boolean); }
function invalidate() { local().dirty=true;local().prepared=null;local().clientCheck=null; }
function clearClientChecks() { state.enterprise.clientCheck=null;state.vibe.clientCheck=null; }
function hasInstalledSuperpowers(remote) { return (remote?.inventory?.entries||[]).some(function(entry){return entry.framework==='superpowers'&&entry.localPlugin;}); }
function connectedFramework(remote) { return (remote||local().remote)?.connectedFramework||{unit:'extensions',id:'extensions',name:'AIH Extensions',version:'0.6.0'}; }
function hasInstalledConnectedPlugin(remote) { var id=connectedFramework(remote).id;return (remote?.inventory?.entries||[]).some(function(entry){return entry.framework===id&&(entry.localPlugin||entry.plugins?.some(function(plugin){return plugin.cli==='claude-code';}));}); }
function connectedObligation(policy) { return policy?.entries.find(function(entry){return entry.content?.framework==='extensions';})?.obligation||'No specific rule'; }
function clientCheckState(remote) { return JSON.stringify([remote?.project,remote?.home,remote?.policyDigest,remote?.generation,remote?.inventory]); }
function button(action,label,disabled,primary,ariaLabel) { return '<button data-action="'+esc(action)+'" '+(ariaLabel?'aria-label="'+esc(ariaLabel)+'" ':'')+(disabled||busy?'disabled ':'')+'class="'+(primary?'primary':'')+'">'+label+'</button>'; }
function go(view,label) { return '<button data-view="'+view+'">'+label+'</button>'; }
var reviewDraft = {company:'',reviewer:'',team:'',note:'',decision:'Accepted risk',itemId:'',concern:null};
function currentReviews() {
  var remote=state.enterprise.remote;
  return remote?.policyDigest?(remote.reviews||[]).filter(entry=>entry.policySha256===remote.policyDigest).sort(compareReviews):[];
}
function compareReviews(a,b) {
  var first=Date.parse(a.recordedAt),second=Date.parse(b.recordedAt);
  return (Number.isFinite(first)?first:-Infinity)-(Number.isFinite(second)?second:-Infinity)||String(a.id||'').localeCompare(String(b.id||''));
}
function itemOrganizationReview(item) {
  if(state.mode!=='enterprise'||!item?.scanKey)return '';
  var matches=currentReviews().filter(function(entry){var evidence=entry.evidence;return evidence&&evidence.itemId===item.id&&evidence.scanKey===item.scanKey&&evidence.catalogCommit===catalog.data.commit&&(item.summary?.revision==null||evidence.revision===item.summary.revision);});
  if(!matches.length)return '';
  var latest=matches.at(-1);
  function details(entry) {
    return (entry.concern?'<p><b>Concern:</b> '+esc(entry.concern.tool)+' · '+esc(entry.concern.ruleId)+'</p>':'<p>Whole item review</p>')+'<p><strong>'+esc(entry.decision||'No decision recorded')+'</strong></p><dl class="review-list"><dt>Reviewed by</dt><dd>'+esc(entry.reviewer||'No reviewer recorded')+'</dd><dt>Organization</dt><dd>'+esc(entry.company||'No organization recorded')+(entry.team?' · '+esc(entry.team):'')+'</dd><dt>Recorded at</dt><dd>'+esc(entry.recordedAt||'Time not recorded')+'</dd></dl><p class="organization-review-note"><strong>Reason</strong><br>'+esc(entry.note?.trim()?entry.note:'No reason recorded.')+'</p>';
  }
  return '<section class="panel item-organization-review" aria-label="Organization review"><h3>Organization review</h3><p class="help">Latest recorded review for this item · current policy</p>'+details(latest)+'<p class="help">Self-declared local reviewer. This review is separate from the Scan assessment and Core admission.</p>'+(item.summary?.revision==null?'<p class="help">The current assessment revision has not been read in this view.</p>':'')+(matches.length>1?'<details><summary>'+esc(matches.length-1)+' earlier '+(matches.length===2?'review':'reviews')+' for this item</summary>'+matches.slice(0,-1).reverse().map(function(entry){return '<section><p class="help">Earlier review</p>'+details(entry)+'</section>';}).join('')+'</details>':'')+'</section>';
}
function contextSummary() { var p=boundary(); return state.mode==='vibe'?'Your local choices · no organization boundary':p?((currentReviews().at(-1)?.company || 'Local workspace')+' · saved policy '+p.policy.id+' · AIH Extensions '+connectedObligation(p.policy)):'Local workspace · no saved policy'; }
function render() {
  document.querySelectorAll('[data-view]').forEach(function(b){var active=b.dataset.view===state.view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  ['mode','role','inspect'].forEach(function(attr){document.querySelectorAll('[data-'+attr+']').forEach(function(b){var active=b.dataset[attr]===state[attr==='inspect'?'inspector':attr];b.classList.toggle('active',active);b.setAttribute(attr==='inspect'?'aria-selected':'aria-pressed',String(active));});});
  $('page-head').classList.toggle('catalog-page',state.view==='catalog');
  $('inspector-tabs').hidden=!['catalog','scan'].includes(state.view);
  if(['catalog','scan'].includes(state.view)){$('inspector-content').setAttribute('role','tabpanel');$('inspector-content').setAttribute('aria-labelledby','inspector-tab-'+state.inspector);}else{$('inspector-content').removeAttribute('role');$('inspector-content').removeAttribute('aria-labelledby');}
  $('role-switch').hidden=state.mode!=='enterprise';
  $('source-rail').innerHTML='<button class="source-link-static '+(state.frameworkFilter==='all'?'active':'')+'" data-framework="all"><b>All Catalog content</b> '+badge(records.length)+'</button>'+frameworkSources().map(function(f){return '<button class="source-link-static '+(state.frameworkFilter===f.id?'active':'')+'" data-framework="'+esc(f.id)+'"><b>'+esc(f.name)+'</b> '+badge(f.count)+'</button>';}).join('');
  if($('catalog-source-count'))$('catalog-source-count').textContent=frameworkSources().length+' frameworks · '+toolItems().length+' tools · '+records.length+' items';
  $('context-note').innerHTML='<b>'+esc(state.mode==='vibe'?'Vibe · individual':admin()?'Enterprise · admin':'Enterprise · developer')+'</b><p>'+esc(contextSummary())+'</p><p>'+(state.view==='tools'?esc(state.toolClient)+' · tool configuration preview':state.view==='catalog'?esc(state.catalogClient)+' · project scope':state.view==='profiles'?esc(state.catalogClient)+' · project preview<br>Portable contributor content':'Claude Code · project scope<br>Dedicated local example workspace')+'</p>';
  $('finding-count').textContent=catalog.coverage.indexed+' indexed';
  $('policy-state').textContent=state.mode==='vibe'?'NONE':state.published?'SAVED':'UNSAVED';
  $('breadcrumb').textContent=(state.mode==='vibe'?'Vibe':admin()?'Enterprise / admin':'Enterprise / developer')+(state.view==='profiles'?' / Portable content':' / Local project');
  $('page-title').textContent={catalog:'Catalog & choices',tools:'Tools',profiles:'Profiles',core:'Core tools',scan:'Recorded Scan evidence',policy:state.mode==='vibe'?'Your independent Vibe workspace':admin()?'Connected example policy':'Saved connected example policy',installed:'Installed & configure',reports:'Reports',repair:'Environment & repair',update:'Recorded Superpowers update example'}[state.view];
  document.title=$('page-title').textContent+' · AIHQ Workbench';
  var job=({installed:'workspace',update:'workspace',reports:'diagnostics',repair:'diagnostics',core:'diagnostics',policy:'policy'})[state.view]||'choose';
  document.querySelectorAll('[data-job]').forEach(function(b){b.classList.toggle('active',b.dataset.job===job);});
  document.querySelectorAll('[data-section]').forEach(function(b){b.hidden=b.dataset.section!==job;});
  $('source-rail').hidden=$('framework-heading').hidden=state.view!=='catalog';
  $('scope-chip').textContent=({tools:'CONFIGURE & PREVIEW',profiles:'AUTHOR & PREVIEW',catalog:'PINNED CATALOG',scan:'ITEM EVIDENCE',core:'PUBLIC INTERFACE',reports:'LOCAL DIAGNOSTICS',repair:'LOCAL ENVIRONMENT',installed:'CORE INVENTORY',update:'RECORDED COMPARISON'})[state.view] || (state.mode==='vibe'?'YOUR CHOICES':state.published?'POLICY SAVED':'NO SAVED POLICY');
  $('ledger').hidden=state.view!=='catalog';
  $('ledger').innerHTML=kinds.map(function(k){return '<button data-kind="'+k+'" class="'+(state.kind===k?'active':'')+'"><strong class="kind-'+k+'">'+records.filter(function(r){return kind(r.kind)===k&&(state.frameworkFilter==='all'||r.framework===state.frameworkFilter);}).length+'</strong><span>'+({mcp:'MCP servers',token:'Context tokens','ai-setup':'AI setups',rule:'Rules',document:'Documents'}[k]||k[0].toUpperCase()+k.slice(1)+'s')+'</span></button>';}).join('');
  var c=local(),p=boundary();
  $('journey').hidden=['catalog','tools','scan','profiles','core','reports','repair'].includes(state.view);
  $('journey').innerHTML='<span>'+esc(admin()?'Admin draft → organization boundary → developer choices':contextSummary())+'</span><span class="push">'+badge(admin()?(!state.policyDraftDirty&&state.published?'Matches saved policy':state.result?'Draft validated':state.policyDraftDirty?'Draft changed':'New policy'):(names(c.choices).length+' chosen · '+(c.remote?c.remote.inventory.entries.length:0)+' Core inventory entries'))+'</span>';
  $('notice').textContent=busy?'Working… Draft editing is paused until this operation finishes.':state.notice;
  $('main-content').innerHTML=selectionHandoffView()+{catalog:catalogView,tools:toolsView,profiles:profilesView,core:coreView,scan:scanView,policy:policyView,installed:installedView,reports:reportsView,repair:repairView,update:updateView}[state.view]();
  if(data.update && ((state.view==='catalog' && (state.frameworkFilter==='superpowers'||record()?.framework==='superpowers')) ||
    (state.view==='installed' && c.remote?.inventory?.entries?.some(function(entry){return entry.framework==='superpowers'&&entry.localPlugin;})))){
    $('main-content').insertAdjacentHTML('beforeend','<section class="panel">'+go('update','Compare recorded Superpowers versions')+'</section>');
  }
  $('inspector-content').innerHTML=inspectorView();
  $('main-content').setAttribute('aria-busy',String(busy));
  document.querySelectorAll('input, select, textarea').forEach(function(control){control.disabled=busy;});
  document.querySelectorAll('button').forEach(function(control){if(busy&&!control.disabled){control.disabled=true;control.dataset.pendingDisabled='true';}else if(!busy&&control.dataset.pendingDisabled==='true'){control.disabled=false;delete control.dataset.pendingDisabled;}});
  document.querySelectorAll('[data-inspect]').forEach(function(control){control.setAttribute('tabindex',control.dataset.inspect===state.inspector?'0':'-1');});
  $('footer-state').textContent=(state.mode==='vibe'?'Vibe':'Enterprise / '+state.role)+' · '+(state.mode==='vibe'?'no organization boundary':state.published?'saved policy '+state.published.policy.id:'no saved policy')+' · '+(c.prepared?'review '+preparedStatus(c.prepared):'no prepared change');
}
function choiceRow(item,title,detail) {
  var c=local(),p=boundary(),on=c.choices[item],entry=p&&p.policy.entries.find(function(e){return e.id==='project-instructions'&&typeof e.change?.identity==='string';}),why=item==='extensions'?(p?connectedObligation(p.policy):'Your choice'):item==='superpowers'?(p?p.obligation:'Your choice'):(p?entry?entry.obligation[0].toUpperCase()+entry.obligation.slice(1)+' by organization':'No matching organization entry':'Your choice');
  return '<tr><td><strong>'+title+'</strong><small>'+detail+'</small></td><td>'+esc(why)+'</td><td>'+button('toggle-'+item,on?'✓ Chosen':'Choose',!ready()||(!on&&!canChoose(item)),false,(on?'Remove ':'Choose ')+title)+'</td></tr>';
}
function selectionHandoffView() {
  var selected=state.selectionHandoff;
  if(state.view!=='installed'||!selected?.title)return '';
  if(selected.view==='catalog')return '<section class="callout"><b>'+esc(selected.title)+'</b><p>Open the Catalog selection to preview its project changes and review an eligible installation.</p>'+go('catalog','Return to Catalog selection')+'</section>';
  return '<section class="callout"><b>Selected setup · '+esc(selected.title)+'</b><p>This selection is retained in '+esc(selected.view==='profiles'?'Profiles':'Catalog')+'. Its supported path here ends at placement preview and the returned admission. The connected examples below apply Project instructions or the AIH Extensions native plugin as separately chosen units.</p>'+go(selected.view,'Return to '+(selected.view==='profiles'?'selected profile':'Catalog selection'))+'</section>';
}
function catalogView() {
  var filtered=records.filter(matchesRecord),size=40,pages=Math.max(1,Math.ceil(filtered.length/size));state.page=Math.min(state.page,pages-1);
  var shown=filtered.slice(state.page*size,(state.page+1)*size),selected=record();
  var out='<div class="catalog-controls"><div class="toolbar catalog-search"><input type="search" id="search" value="'+esc(state.search)+'" placeholder="Search names, descriptions and IDs…" aria-label="Search Catalog"><select id="framework-filter" aria-label="Framework filter"><option value="all" '+(state.frameworkFilter==='all'?'selected':'')+'>All sources ('+records.length+')</option>'+frameworkSources().map(function(f){return '<option value="'+esc(f.id)+'" '+(state.frameworkFilter===f.id?'selected':'')+'>'+esc(f.name)+' ('+f.count+')</option>';}).join('')+(toolFrameworkIds().has(state.frameworkFilter)?'<optgroup label="Tool content"><option value="'+esc(state.frameworkFilter)+'" selected>'+esc(catalog.frameworks.find(function(f){return f.id===state.frameworkFilter;}).name)+'</option></optgroup>':'')+'</select><select id="kind-filter" aria-label="Content kind filter"><option value="all">All kinds</option>'+kinds.map(function(k){return '<option value="'+esc(k)+'" '+(state.kind===k?'selected':'')+'>'+esc(k)+'</option>';}).join('')+'</select><select id="catalog-client" aria-label="Plan preview client">'+catalog.clients.map(function(client){return '<option value="'+esc(client.id)+'" '+(client.id===state.catalogClient?'selected':'')+'>'+esc(client.name)+(detectedClients().has(client.id)?' · detected':'')+'</option>';}).join('')+'</select></div><div class="toolbar catalog-actions"><span class="preview-scope">Placement preview</span>'+button('catalog-plan','Preview '+state.planItems.length+' '+(state.planItems.length===1?'item':'items'),!state.planItems.length,true)+button('catalog-clear-plan','Clear',!state.planItems.length,false)+'</div><p class="session-selection-note">Items in preview are separate from the item in focus. Preview selection is kept for this page session.</p>'+(state.planItems.length?'<details><summary>'+state.planItems.length+' selected items</summary><ul class="preview-selection-list">'+state.planItems.map(function(id){return '<li><span>'+esc(itemTitle(id))+'</span>'+button('catalog-add:'+id,'Remove',false,false,'Remove '+itemTitle(id)+' from preview')+'</li>';}).join('')+'</ul></details>':'')+'</div><div class="inline-actions">'+button('catalog-results','Skip to Catalog results')+go('tools','Tools')+go('installed','Installed workspace')+(state.mode==='enterprise'?go('policy','Organization policy'):'')+'</div>' +inlineInspector()+(state.planPreview?planPreviewView(state.planPreview):'')+'<div class="section-head catalog-results-head"><h2 id="catalog-results-heading" tabindex="-1">'+esc(state.frameworkFilter==='all'?'All Catalog content':(toolFrameworkIds().has(state.frameworkFilter)?'Tool content · ':'')+catalog.frameworks.find(function(f){return f.id===state.frameworkFilter;}).name)+'</h2><span class="push">'+filtered.length+' matches</span>'+button('clear','Clear filters',false,false)+'</div><div class="content-list">'+(shown.map(function(item){var available=item.availability[state.catalogClient];return '<button class="content-row catalog-row '+(state.recordId===item.id?'active':'')+'" data-record="'+esc(item.id)+'"><span class="kind">'+esc(item.kind)+'</span><div><code>'+esc(item.title)+'</code><small>'+esc(item.frameworkName)+' · '+esc(item.description.slice(0,130))+'</small></div><span class="catalog-row-meta">'+badge(item.status==='missing'?'No assessment':item.status==='ready'?'Evidence loaded':item.status==='unverified'?'Evidence unverified':'Evidence indexed')+badge(item.kind==='ai-setup'?'Tool · choose in Tools':available.label||(available.available?'Placeable':'No placement'))+(state.planItems.includes(item.id)?badge('IN PREVIEW','blue'):'')+'</span></button>';}).join('')||'<div class="empty">No Catalog items match these filters.</div>')+'</div><div class="inline-actions">'+button('catalog-prev','← Previous',state.page===0,false)+'<span>Page '+(state.page+1)+' / '+pages+'</span>'+button('catalog-next','Next →',state.page>=pages-1,false)+'</div>';

  return out+connectedExamples();
}
function planPreviewView(value) {
  if(!value.configuration&&state.planCollapsed)return '<section class="panel"><h2 id="plan-preview-heading">Placement preview</h2><p>'+esc(value.plan.status)+' · '+(value.selection||[]).length+' selected items</p>'+button('catalog-preview-toggle','Show preview')+'</section>';
  var plan=value.plan,counts={};(plan.plan||[]).forEach(function(step){counts[step.op]=(counts[step.op]||0)+1;});
  var client=catalog.clients.find(function(c){return c.id===value.client;});
  return '<section class="panel plan-preview-result"><h2 id="plan-preview-heading" tabindex="-1">'+(value.configuration?'Configuration preview · '+esc(plan.status==='ok'?'Ready to review':plan.status==='incomplete'?'Needs input':'Unavailable'):'Placement preview · '+esc(plan.status))+'</h2>'+(value.configuration?'<p>'+esc(configurationExplanation(plan))+'</p>':'')+'<p><b>Client:</b> '+esc(client?client.name:value.client||state.catalogClient)+' · project scope</p><p><b>Selected:</b> '+esc((value.selection||state.planItems).map(itemTitle).join(', '))+'</p><p>'+esc(Object.keys(counts).map(function(op){return counts[op]+' '+operationName(op,counts[op]);}).join(' · ')||'No placement operations returned')+'</p>'+((plan.plan||[]).some(function(step){return step.scanned===false||step.bundle;})?'<p>'+esc((plan.plan||[]).filter(function(step){return step.bundle;}).length)+' shared bundle operations · '+esc((plan.plan||[]).filter(function(step){return step.scanned===false;}).length)+' generated outputs marked not scanned. See the placement operations for their paths.</p>':'')+(value.configuration?'<details><summary>Requirements &amp; qualification details</summary>'+producerMessages(plan)+'</details>':producerMessages(plan))+(value.policy||value.policyNote?'<section><h3>Organization admission</h3><p>'+esc(value.policy?.status==='ok'?(value.policy.value.admitted?'Admitted':'Denied'):value.policy?.status||'')+' '+esc(value.policyNote||'')+'</p>'+(value.policy?profilePolicyReasons(value.policy):'')+'</section>':'')+'<details><summary>View all '+(plan.plan||[]).length+' placement operations</summary><div class="placement-operations">'+(plan.plan||[]).map(function(step,index){var destination=(step.root?step.root+' / ':'')+(step.path||step.file||step.into||step.plugin||'Not supplied'),source=step.from?step.from.sourceId+' / '+step.from.sourcePath:step.sourcePath?(step.source||'source')+' / '+step.sourcePath:step.repository?step.repository+(step.commit?' @ '+step.commit:''):step.render?'Catalog render: '+step.render.name:'Not supplied',clis=step.clis||[step.cli].filter(Boolean);return '<div class="placement-operation"><div class="placement-line"><strong>'+(index+1)+'. '+esc(operationName(step.op,1))+'</strong><code>'+esc(destination)+'</code></div><small><b>Source:</b> '+esc(source)+(step.key?' · Entry '+esc(step.key):'')+'</small>'+(clis.some(function(cli){return cli!==value.client;})?'<small><b>Clients:</b> '+esc(clis.join(', '))+'</small>':'')+(step.command||step.argv?'<small><b>Declared command:</b> '+esc((step.command||step.argv).join(' '))+'</small>':'')+'</div>';}).join('')+'</div></details>'+(value.configuration?'<p class="help">This configuration is a read-only preview. No tool installation, source acquisition or native-client verification has run.</p>':'<p>Review the proposed project changes before preparing installation.</p>')+(!value.configuration?'<div class="inline-actions">'+button('catalog-preview-toggle','Hide preview')+(!admin()&&plan.status==='ok'&&value.installable===true&&value.policy?.value?.admitted!==false?button('catalog-prepare','Review installation',false,true):'')+'</div>'+(value.installReason?'<p>'+esc(value.installReason)+'</p>':''):'')+'<details><summary>Exact public Catalog result</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details></section>';
}
function itemTitle(id) { var item=records.find(function(r){return r.id===id;});return item?item.title+' ('+item.frameworkName+')':id; }
function selectedTools() { return toolItems().filter(function(item){return state.toolItems.includes(item.id);}); }
function combinedToolDefaults() {
  var combination=catalog.toolCombination,selected=selectedTools().map(function(item){return item.id;}).sort();
  return combination&&JSON.stringify(selected)===JSON.stringify(combination.members.slice().sort())?combination:null;
}
function toolDefaultsView(item,combination) {
  var setup=Object.assign({},item.setup||{},combination?.overrides?.[item.id]||{});
  var args=setup.launch?.clis?.[state.toolClient]||setup.launch?.args,command=setup.executable&&args?[setup.executable].concat(args).join(' '):null;
  function row(label,value) { return value==null||Array.isArray(value)&&!value.length?'':'<dt>'+label+'</dt><dd>'+esc(factText(value))+'</dd>'; }
  return '<section class="panel tool-defaults"><h3>'+esc(item.title)+(setup.version?' · '+esc(setup.version):'')+'</h3><dl class="review-list">'+row('Platform',setup.platform)+row('Runtime',setup.runtime)+row('Launch command',command)+'</dl>'+(!item.setup?'<p>Configuration defaults are not available.</p>':'')+'<details><summary>Tool settings &amp; exposed MCP tools</summary><dl class="review-list">'+row('Safety restrictions',setup.doNotRun)+row('Qualifications',setup.qualifications)+row('Settings commands',setup.settings?.commands?.map(function(setting){return setting.argv?.join(' ')||factText(setting); }))+row('Settings files',setup.settings?.files)+row('Environment',setup.env)+row('Enabled tools',setup.enabledTools)+row('Disabled tools',setup.disabledTools)+row('Startup timeout (seconds)',setup.startupSeconds)+row('Call timeout (seconds)',setup.callSeconds)+'</dl></details><div class="inline-actions">'+button('tools-content:'+item.id,'Inspect supporting MCP &amp; content')+'</div><details><summary>Exact configuration defaults</summary><pre>'+esc(JSON.stringify(setup,null,2))+'</pre></details></section>';
}
function configurationExplanation(plan) {
  var qualifications=(plan.unavailable||[]).filter(function(row){return ['no-qualification','not-qualified'].includes(row.reason);});
  if(qualifications.length){var platform=qualifications.find(function(row){return row.cell;})?.cell||selectedTools()[0]?.setup?.platform||'this platform';return 'This selection has no complete qualification for '+platform.replace(/^windows-/,'Windows ').replace(/^darwin-/,'macOS ').replace(/^linux-/,'Linux ')+'. Catalog cannot produce a complete configuration plan for it yet.';}
  return plan.status==='ok'?'Review the configuration operations below. Nothing has been installed.':'The selected tools need additional inputs or are unsupported for this client and platform. Review the requirements below.';
}
function toolsView() {
  var selected=selectedTools(),combination=combinedToolDefaults();
  return '<section class="panel"><h2>Choose tools</h2><p>Configure any selection together for one client. This previews configuration without installing or running tools.</p><p>Platform: '+esc(toolItems()[0]?.setup?.platform||'not supplied')+'. Qualification is specific to each tool and platform.</p><div class="tool-choices">'+toolItems().map(function(item){return '<label class="tool-choice"><input type="checkbox" id="tool-choice-'+esc(item.id)+'" data-tool-choice="'+esc(item.id)+'" '+(state.toolItems.includes(item.id)?'checked':'')+'><span><strong>'+esc(item.title)+'</strong><small>'+esc(item.description)+'</small></span></label>';}).join('')+'</div><div class="inline-actions"><label for="tools-client">Client</label><select id="tools-client">'+catalog.clients.map(function(client){return '<option value="'+esc(client.id)+'" '+(state.toolClient===client.id?'selected':'')+'>'+esc(client.name)+'</option>';}).join('')+'</select>'+button('tools-configure','Configure',!selected.length,true)+'</div></section>'+(state.toolConfigured?'<section class="tool-settings"><div class="section-head"><h2 id="tool-settings-heading" tabindex="-1">Configuration defaults</h2></div><p class="help">'+(combination?'Combined Catalog recipe · '+esc(combination.id):'Catalog defaults for the selected tools')+' · '+esc(catalog.clients.find(function(client){return client.id===state.toolClient;})?.name||state.toolClient)+'</p>'+selected.map(function(item){return toolDefaultsView(item,combination);}).join('')+'</section>':'')+(state.toolError?'<section class="panel"><h2>Configuration preview unavailable</h2><p>The configuration could not be read. Try Configure again.</p><details><summary>Technical details</summary><pre>'+esc(state.toolError)+'</pre></details></section>':'')+(state.toolPreview?planPreviewView(Object.assign({},state.toolPreview,{configuration:true})):'' );
}
function selectedProfile() { return profiles[profileIndex]||null; }
function localProfile(profile) { return profile&&profile.format==='workbench-profile/2'; }
function profileIdentity(profile) {
  return localProfile(profile)?'selection:'+profile.id:String(profile.plugin?.name||profile.plugin?.id||profile.recipe?.id||profile.title)+'@'+String(profile.plugin?.version||'');
}
function profileText(profile) { return profileTexts.get(profileIdentity(profile))||JSON.stringify(profile,null,2)+'\n'; }
function profileBytes(profile) { return new Blob([profileText(profile)]).size; }
function profileCanShare(profile) {
  return !localProfile(profile)||(!!profilePreview&&JSON.stringify(profilePreview.profile)===JSON.stringify(profile)&&profileBytes(profile)<=65536);
}
function downloadText(text,name,type) { var url=URL.createObjectURL(new Blob([text],{type:type||'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url); }
function profileFilename(profile) {
  var title=localProfile(profile)?String(profile.title||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80).replace(/-$/,''):'';
  var name=localProfile(profile)?title||profile.id:profile.plugin?.name||profile.recipe?.id||'workbench-profile';
  return String(name).replace(/[^a-zA-Z0-9._-]/g,'-')+'.json';
}
function profileClientPicker() {
  return '<label for="profile-client">Client</label><select id="profile-client">'+catalog.clients.map(function(client){return '<option value="'+esc(client.id)+'" '+(client.id===state.catalogClient?'selected':'')+'>'+esc(client.name)+'</option>';}).join('')+'</select>';
}
function analystTemplate() { return profiles.find(function(profile){return !localProfile(profile)&&profile.recipe?.id==='analyst-design-review';}); }
function createProfile(source) {
  var unique=window.crypto?.randomUUID?window.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  var profile={format:'workbench-profile/2',id:'profile-'+unique,title:source?source.title+' copy':'',role:source?.role||'',outcome:source?.outcome||'',author:'',firstTask:source?.firstTask||'',items:source?(source.recipe?.members||[]).filter(function(member){return member.preTicked&&records.some(function(item){return item.id===member.item;});}).map(function(member){return member.item;}):[],data:{repository:catalog.data.repository,commit:catalog.data.commit},files:source?JSON.parse(JSON.stringify(source.files||[])):[]};
  profiles.push(profile);profileIndex=profiles.length-1;profilePreview=null;profilePicker={search:'',framework:'all',kind:'all',page:0};
  state.view='profiles';state.revealResult='profile-builder-heading';state.notice=source?'Analyst copied into an editable local selection. The original pinned recipe is unchanged.':'New local profile. Add the task, instructions and Catalog items, then preview to share.';
}
function profileEdited(profile) {
  profilePreview=null;profileTexts.delete(profileIdentity(profile));
  state.notice='Profile changed. Preview the current selection before sharing.';
}
function profileDraftStatus(profile) {
  var ready=profileDraftReady(profile),bytes=profileBytes(profile);
  return (!ready?'Complete the title, role, outcome and first task, and choose at least one Catalog item. ':!profileCanShare(profile)?'Preview the current draft to enable download. ':'Ready to share this previewed selection. ')+bytes.toLocaleString()+' / 65,536 bytes · draft kept for this page session.';
}
function profileLiveText(node,text) {
  if(!node)return;
  if(node.childNodes.length===1&&node.firstChild.nodeType===3)node.firstChild.data=text;
  else if(node.textContent!==text)node.textContent=text;
}
function updateProfileDraftControls(profile) {
  var bytes=profileBytes(profile),preview=$('profile-preview-heading');
  if(preview)preview.closest('section').hidden=true;
  var download=document.querySelector('[data-action="profile-download"]'),previewButton=document.querySelector('[data-action="profile-preview"]');
  if(download)download.disabled=true;
  if(previewButton)previewButton.disabled=!profileDraftReady(profile)||bytes>65536;
  profileLiveText($('profile-builder-status'),profileDraftStatus(profile));
  profileLiveText($('notice'),state.notice);
  var warning=$('profile-builder-size-warning');if(warning)warning.hidden=bytes<=65536;
  var bundle=$('profile-bundle-details');if(bundle)bundle.hidden=true;
  var card=document.querySelector('.profile-options .profile-option.active');
  if(card){profileLiveText(card.querySelector('strong'),profile.title||'Untitled profile');profileLiveText(card.querySelector('span'),profile.role||'Local selection');profileLiveText(card.querySelector('small'),profile.outcome);}
}
function profileCompanions(profile) {
  return '<section class="panel" id="profile-companions"><h2>Supporting instructions · '+(profile.files||[]).length+' files</h2>'+(profile.files||[]).map(function(file,index){return '<details class="profile-file"><summary>'+esc(file.path)+'</summary><div class="inline-actions">'+button('profile-file:'+index,'Download file',false,false)+'</div><pre data-profile-file-text="'+esc(file.path)+'">'+esc(file.text)+'</pre></details>';}).join('')+'<details id="profile-bundle-details"><summary>Exact profile bundle</summary><pre id="profile-bundle-json">'+esc(profileText(profile))+'</pre></details></section>';
}
function refreshProfileArtifacts(profile) {
  var section=$('profile-companions');
  if(section)section.outerHTML=profileCompanions(profile);
}
function profileDraftReady(profile) {
  return ['title','role','outcome','firstTask'].every(function(key){return typeof profile[key]==='string'&&profile[key].trim();})&&profile.items.length>0;
}
function profileField(profile,key,label,multiline) {
  var id='profile-field-'+key;
  return '<div class="profile-field"><label for="'+id+'">'+label+'</label>'+(multiline?'<textarea id="'+id+'" data-profile-field="'+key+'" rows="2">'+esc(profile[key])+'</textarea>':'<input type="text" id="'+id+'" data-profile-field="'+key+'" value="'+esc(profile[key])+'">')+'</div>';
}
function profileInstructions(profile) {
  return profile.files.find(function(file){return file.path.toLowerCase()==='agents.md';});
}
function profileBuilderView(profile) {
  var agents=profileInstructions(profile),ready=profileDraftReady(profile),bytes=profileBytes(profile);
  var actions='<div id="profile-builder-actions" class="inline-actions profile-builder-actions">'+profileClientPicker()+button('profile-preview','Preview setup',!ready||bytes>65536,true)+button('profile-download','Download profile',!profileCanShare(profile),false)+'</div>';
  return '<section class="panel profile-builder"><div class="card-title"><h2 id="profile-builder-heading" tabindex="-1">Create Profile</h2>'+badge('LOCAL SELECTION','blue')+'</div><p class="help">Choose Catalog items and author your workspace instructions. This profile is a local selection, separate from a contributor’s pinned recipe.</p>'+actions+
    '<div class="profile-fields">'+profileField(profile,'title','Title')+profileField(profile,'role','Role')+profileField(profile,'author','Author (optional)')+profileField(profile,'outcome','Outcome',true)+'</div>'+profileField(profile,'firstTask','First task',true)+
    '<div class="profile-field"><label for="profile-field-agents">AGENTS.md · workspace instructions (optional)</label><textarea id="profile-field-agents" data-profile-field="agents" rows="6">'+esc(agents?.text||'')+'</textarea></div>'+
    '<p id="profile-builder-status" class="help">'+esc(profileDraftStatus(profile))+'</p><p id="profile-builder-size-warning" class="warning" '+(bytes<=65536?'hidden':'')+'>This profile exceeds 64 KiB. Shorten its text before previewing or sharing.</p>'+
    profileCatalogPicker(profile)+'<details><summary>Stable profile identity & Catalog pin</summary><dl class="review-list"><dt>Profile ID</dt><dd><code>'+esc(profile.id)+'</code></dd><dt>Catalog</dt><dd>'+esc(factText(profile.data))+'</dd></dl></details></section>';
}
function profileCatalogPicker(profile) {
  var filtered=records.filter(function(item){return (profilePicker.framework==='all'||item.framework===profilePicker.framework)&&(profilePicker.kind==='all'||item.kind===profilePicker.kind)&&(!profilePicker.search||(item.title+' '+item.id+' '+item.description+' '+item.frameworkName).toLowerCase().includes(profilePicker.search.toLowerCase()));});
  var pageSize=20,pages=Math.max(1,Math.ceil(filtered.length/pageSize));profilePicker.page=Math.min(profilePicker.page,pages-1);
  return '<section class="profile-picker" aria-label="Choose profile Catalog items"><div class="section-head"><h3>Catalog selection</h3><span class="push">'+profile.items.length+' selected</span></div>'+(profile.items.length?'<ul class="preview-selection-list profile-builder-selection">'+profile.items.map(function(id){return '<li><span>'+esc(itemTitle(id))+'</span>'+button('profile-item:'+id,'Remove',false,false,'Remove '+itemTitle(id)+' from profile')+'</li>';}).join('')+'</ul>':'<p class="help">No items selected.</p>')+'<div class="toolbar profile-picker-filters"><input type="search" id="profile-picker-search" aria-label="Search profile Catalog" placeholder="Search the full Catalog…" value="'+esc(profilePicker.search)+'"><select id="profile-picker-framework" aria-label="Profile framework filter"><option value="all">All sources</option>'+frameworkSources().map(function(framework){return '<option value="'+esc(framework.id)+'" '+(profilePicker.framework===framework.id?'selected':'')+'>'+esc(framework.name)+'</option>';}).join('')+'</select><select id="profile-picker-kind" aria-label="Profile kind filter"><option value="all">All kinds</option>'+kinds.map(function(value){return '<option value="'+esc(value)+'" '+(profilePicker.kind===value?'selected':'')+'>'+esc(value)+'</option>';}).join('')+'</select>'+button('profile-picker-clear','Clear filters',false,false)+'</div><p class="help">'+filtered.length+' matches · all '+records.length+' Catalog items are available to search. Placement depends on the selected client.</p><div class="content-list">'+(filtered.slice(profilePicker.page*pageSize,(profilePicker.page+1)*pageSize).map(function(item){var selected=profile.items.includes(item.id),available=item.availability[state.catalogClient];return '<div class="profile-picker-row"><div><strong>'+esc(item.title)+'</strong><small>'+esc(item.frameworkName)+' · '+esc(item.kind)+' · '+esc(item.description.slice(0,140))+'</small><code>'+esc(item.id)+'</code></div><div>'+badge(available?.available?'Placeable':'No placement')+button('profile-item:'+item.id,selected?'Remove':'Add',false,selected,(selected?'Remove ':'Add ')+item.kind+' '+itemTitle(item.id)+(selected?' from profile':' to profile'))+'</div></div>';}).join('')||'<div class="empty">No Catalog items match these filters.</div>')+'</div><div class="inline-actions">'+button('profile-picker-prev','← Previous items',profilePicker.page===0,false)+'<span>Page '+(profilePicker.page+1)+' / '+pages+'</span>'+button('profile-picker-next','Next items →',profilePicker.page>=pages-1,false)+'</div></section>';
}
function profileSummaryView(profile) {
  return '<section class="panel profile-summary"><div class="card-title"><h2>'+esc(profile.title)+'</h2>'+badge('PINNED RECIPE')+'</div><p class="profile-byline"><b>Author:</b> '+esc(factText(profile.plugin?.author))+' · <b>Role:</b> '+esc(profile.role)+'</p><div class="inline-actions">'+profileClientPicker()+button('profile-preview','Preview setup',false,true)+button('profile-download','Download profile',false,false)+'</div><p class="help">Read-only project preview. Placing content, installing it and checking client loading remain separate steps.</p><div class="profile-task"><h3>Your first task</h3><p>'+esc(profile.firstTask)+'</p>'+button('profile-copy-task','Copy task',!navigator.clipboard,false)+'</div><details><summary>Profile identity & declared source</summary><dl class="review-list"><dt>Plugin</dt><dd><code>'+esc(profile.plugin?.name)+' @ '+esc(profile.plugin?.version)+'</code></dd><dt>Recipe</dt><dd><code>'+esc(profile.recipe?.id)+'</code></dd><dt>Source pin</dt><dd>'+esc(factText(profile.source))+'</dd></dl><p class="help">Contributor-declared metadata; no origin trust is established.</p></details></section>';
}
function profilesView() {
  var profile=selectedProfile(),preview=profilePreview;
  var out='<div class="section-head profile-library-head"><h2>What do you want to do?</h2><span class="push">'+profiles.length+' profiles</span></div><div class="inline-actions profile-create-actions">'+button('profile-create','Create Profile',false,true)+button('profile-copy-analyst','Copy analyst',!analystTemplate(),false)+'</div>';
  out+='<div class="profile-options" role="group" aria-label="Available profiles">'+profiles.map(function(value,index){return '<button class="profile-option '+(index===profileIndex?'active':'')+'" data-action="profile-select:'+index+'" aria-pressed="'+(index===profileIndex)+'"><strong>'+esc(value.title||'Untitled profile')+'</strong><span>'+esc(value.role||'Local selection')+'</span><small>'+esc(value.outcome)+'</small><b class="profile-choice-action">'+(index===profileIndex?'Selected':localProfile(value)?'Edit profile →':'View profile →')+'</b></button>';}).join('')+'</div><details id="profile-import-tools" class="profile-import-tools" '+(profileImportOpen?'open':'')+'><summary>Import or share profiles</summary><div class="profile-import"><label for="profile-import">Import JSON <small>Maximum 64 KiB · profile v1 or v2</small></label><input id="profile-import" type="file" accept=".json,application/json">'+(profileExample?button('profile-example','Download contributor example',false,false):'')+'</div><div class="profile-paste"><label for="profile-paste">Or paste profile JSON</label><textarea id="profile-paste" rows="4" spellcheck="false" placeholder="Paste a workbench-profile/1 or /2 bundle…">'+esc(profilePaste)+'</textarea>'+button('profile-paste-import','Import pasted JSON',false,false)+'</div><p class="help">Maximum 64 KiB for either import method. Imports stay in this page session.</p></details>'+(profileLoadError?'<p class="warning">'+esc(profileLoadError)+'. You can still create or import a profile.</p>':'');
  if(!profile)return out+'<div class="empty">Create or import a profile to choose its task, content and destinations.</div>';
  out+=localProfile(profile)?profileBuilderView(profile):profileSummaryView(profile);
  if(preview)out+=profilePreviewView(preview);
  out+=profileCompanions(profile);
  out+='<div class="inline-inspector">'+profileEvidenceView()+go('installed','Connected installation examples')+'</div>';
  return out;
}
function profilePreviewView(value) {
  var plan=value.plan||{},steps=plan.plan||[],policy=value.policy,isLocal=localProfile(value.profile);
  return '<section class="panel plan-preview-result"><h2 id="profile-preview-heading" tabindex="-1">Profile preview · '+esc(plan.status||value.status)+'</h2><p><b>Client:</b> '+esc(state.catalogClient)+' · project scope</p>'+(isLocal?'<div class="inline-actions">'+button('profile-edit','Edit profile',false,false)+'</div>':'')+'<p><b>'+(isLocal?'Profile digest':'Recipe digest')+':</b> <code>'+esc(isLocal?value.profileDigest:value.recipeDigest)+'</code></p>'+producerMessages(plan)+'<details class="profile-destinations"><summary>Catalog destinations · '+steps.length+' operations</summary>'+(steps.length?steps.map(function(step,index){return '<div class="placement-operation"><div class="placement-line"><strong>'+(index+1)+'. '+esc(operationName(step.op,1))+'</strong><code>'+esc((step.root?step.root+' / ':'')+(step.path||step.file||step.into||step.plugin||'Destination not supplied'))+'</code></div><small>'+esc(step.from?factText(step.from):step.repository||step.render&&factText(step.render)||'See exact public plan for operation inputs')+'</small></div>';}).join(''):'<p>No placement operations returned. Read the producer’s reasons above.</p>')+'</details><h3 class="profile-subheading">Selected items & recorded evidence</h3><ul class="profile-items">'+(value.items||[]).map(function(item,index){var available=records.some(function(r){return r.id===item.id;});return '<li><div><strong>'+esc(item.title||item.id)+'</strong><small><code>'+esc(item.id)+'</code> · '+esc(available?(item.status||'Evidence state not supplied'):'Generated or unavailable item · no Catalog evidence lookup')+'</small></div>'+button('profile-evidence:'+index,available?'Open Scan':'No Catalog item',!available,false,available?'Open Scan for '+itemTitle(item.id):null)+'</li>';}).join('')+'</ul><div class="profile-policy"><h3>Organization admission</h3><p>'+esc(value.policyNote||'No admission result supplied.')+'</p>'+(policy?'<p>Public Core result: <b>'+esc(policy.status)+'</b>'+(typeof (policy.value||policy).admitted==='boolean'?' · '+esc((policy.value||policy).admitted?'admitted':'denied'):'')+'</p>'+producerMessages(policy)+profilePolicyReasons(policy):'')+'</div><p class="help">'+esc(value.notice||'Preview only. No installation or native client verification has run.')+'</p><details><summary>Exact public Catalog plan and Core admission result</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details></section>';
}
function profilePolicyReasons(policy) { var value=policy.value||policy;return ['denials','advisory','fulfilment','contradictions'].map(function(key){var rows=value[key];if(!rows)return '';return '<h3>'+esc(key[0].toUpperCase()+key.slice(1))+'</h3>'+(Array.isArray(rows)?'<ul>'+rows.map(function(row){return '<li>'+esc(factText(row))+'</li>';}).join('')+'</ul>':'<p>'+esc(factText(rows))+'</p>');}).join(''); }
async function previewProfile(profile) {
  profilePreview=null;
  if(localProfile(profile)&&profileBytes(profile)>65536)throw Error('The downloadable profile exceeds 64 KiB. Shorten its text before previewing.');
  var value=await api('profile-preview',{profile:profile,client:state.catalogClient});
  profilePreview=value;state.revealResult='profile-preview-heading';state.notice=value.notice||'Profile preview returned. No installation ran.';return value;
}
async function importProfile(file) {
  if(!file)return;
  busy=true;state.notice='Reading profile and previewing its Catalog content…';render();
  try{
    if(file.size>65536)throw Error('Profile is larger than 64 KiB. Choose a smaller JSON bundle.');
    var text=await file.text(),profile;try{profile=JSON.parse(text);}catch(error){throw Error('Profile is not valid JSON. Choose a workbench-profile/1 or /2 bundle.');}
    if(!profile||!['workbench-profile/1','workbench-profile/2'].includes(profile.format))throw Error('Expected a workbench-profile/1 or /2 bundle.');
    var value=await api('profile-preview',{profile:profile,client:state.catalogClient}),accepted=value.profile||profile,key=profileIdentity(accepted),index=profiles.findIndex(function(p){return profileIdentity(p)===key;});
    if(index<0){index=profiles.length;profiles.push(accepted);}else profiles[index]=accepted;
    profileTexts.set(key,JSON.stringify(accepted)===JSON.stringify(profile)?text:JSON.stringify(accepted,null,2)+'\n');profileIndex=index;profilePreview=value;profilePicker={search:'',framework:'all',kind:'all',page:0};state.view='profiles';state.revealResult='profile-preview-heading';state.notice='Imported '+accepted.title+'. Fresh Catalog and policy preview returned. No installation ran.';
  }catch(error){state.notice=error.message;}
  finally{busy=false;render();if(state.revealResult){revealResult(state.revealResult);state.revealResult=null;}}
}
function operationName(op,count) { var names={write:'file write',merge:'configuration merge',fetch:'source file acquisition',link:'folder link',plugin:'plugin operation',acquire:'artifact acquisition','tool-command':'tool command','upstream-setup':'upstream setup','upstream-installer':'upstream installer'};return (names[op]||op)+(count===1?'':'s'); }
function factText(value) {
  if(value==null)return 'not supplied';
  if(Array.isArray(value))return value.map(factText).join(', ');
  if(typeof value==='object')return Object.keys(value).map(function(key){return key+': '+factText(value[key]);}).join(' · ');
  return String(value);
}
function producerMessages(result) {
  var groups=[['Problems',result.problems],['Missing requirements',result.missing],['Unavailable placements',result.unavailable],['Clashes',result.clashes],['Duplicates',result.duplicates],['References',result.references],['Warnings',result.warnings]];
  var html=groups.filter(function(g){return g[1]&&g[1].length;}).map(function(group){return '<section class="producer-messages"><h3>'+group[0]+'</h3><ul>'+group[1].map(function(problem){return '<li>'+esc(factText(problem))+'</li>';}).join('')+'</ul></section>';}).join('');
  if(result.code||result.reason)html+='<p class="warning">'+esc([result.code,result.reason].filter(Boolean).join(' · '))+'</p>';
  (result.entries||[]).forEach(function(entry){if(entry.reason||entry.code||entry.problems?.length)html+='<section class="producer-messages"><h3>'+esc(entry.managementId||'Operation')+'</h3><p>'+esc([entry.code,entry.reason].filter(Boolean).join(' · '))+'</p>'+producerMessages({problems:entry.problems})+'</section>';});
  return html;
}
function selectItem(id) { if(state.recordId!==id){state.recordId=id;state.severity='all';state.findingIndex=null;state.findingPage=0;evidenceOpenIndex=null;} }
function clearFilteredSelection() { if(record()&&!matchesRecord(record()))selectItem(null); }
function clearOffPageSelection() {
  clearFilteredSelection();
  if(record()&&Math.floor(records.filter(matchesRecord).findIndex(function(item){return item.id===state.recordId;})/40)!==state.page)selectItem(null);
}
function navigationParams() {
  var params=new URLSearchParams();
  params.set('view',state.view);params.set('mode',state.mode);if(state.mode==='enterprise')params.set('role',state.role);
  if(state.recordId)params.set('item',state.recordId);
  if(state.inspector!=='details')params.set('tab',state.inspector);
  if(state.frameworkFilter!=='all')params.set('framework',state.frameworkFilter);
  if(state.kind!=='all')params.set('kind',state.kind);
  if(state.search)params.set('q',state.search);
  if(state.page)params.set('page',String(state.page+1));
  if(state.severity!=='all')params.set('severity',state.severity);
  if(state.findingIndex!=null)params.set('finding',String(state.findingIndex));
  if(evidenceGrouping==='file')params.set('group','file');
  if(evidenceOpenIndex!=null)params.set('evidence',String(evidenceOpenIndex));
  var navigationClient=state.view==='tools'?state.toolClient:state.catalogClient;if(navigationClient!=='claude-code'||state.explicitClient)params.set('client',navigationClient);
  if(state.view==='profiles'&&selectedProfile()&&!localProfile(selectedProfile()))params.set('profile',profileIdentity(selectedProfile()));
  return params;
}
function writeNavigation(replace) {
  if(!window.history||!window.location)return;
  var next='?'+navigationParams().toString();
  if(next===window.location.search)return;
  window.history[replace?'replaceState':'pushState'](null,'',window.location.pathname+next+window.location.hash);
}
function detectedClients() {
  var ids={'claude':'claude-code','cursor':'cursor-ide','codex':'codex-cli','gemini':'gemini-cli','copilot':'github-copilot'};
  var observed=local().remote?.report?.snapshot?.tools||[];
  return new Set(observed.filter(function(tool){return ['runnable','binary'].includes(tool.state);}).map(function(tool){return catalog.clients.some(function(c){return c.id===tool.id;})?tool.id:ids[tool.id];}).filter(function(id){return catalog.clients.some(function(c){return c.id===id;});}));
}
function readNavigation() {
  if(!window.location)return;
  var previousMode=state.mode,previousRole=state.role,previousClient=state.catalogClient,previousToolClient=state.toolClient,previousProfile=profileIndex;
  var params=new URLSearchParams(window.location.search),views=['catalog','tools','profiles','core','scan','policy','installed','reports','repair','update'];
  state.view=views.includes(params.get('view'))?params.get('view'):'catalog';
  state.mode=params.get('mode')==='vibe'?'vibe':'enterprise';state.role=params.get('role')==='developer'?'developer':'admin';
  if(previousMode!==state.mode||previousRole!==state.role)clearClientChecks();
  state.frameworkFilter=catalog.frameworks.some(function(f){return f.id===params.get('framework');})?params.get('framework'):'all';
  state.kind=kinds.includes(params.get('kind'))?params.get('kind'):'all';state.search=params.get('q')||'';
  state.page=Math.min(Math.max(0,(Number(params.get('page'))||1)-1),Math.max(0,Math.ceil(records.filter(matchesRecord).length/40)-1));
  selectItem(records.some(function(r){return r.id===params.get('item');})?params.get('item'):null);
  state.inspector=['details','security','policy'].includes(params.get('tab'))?params.get('tab'):'details';
  state.severity=params.get('severity')||'all';state.findingIndex=params.has('finding')&&/^\d+$/.test(params.get('finding'))?Number(params.get('finding')):null;
  evidenceGrouping=params.get('group')==='file'?'file':'concern';evidenceGroups={};
  evidenceOpenIndex=params.has('evidence')&&/^\d+$/.test(params.get('evidence'))?Number(params.get('evidence')):null;
  state.explicitClient=params.has('client');var detected=detectedClients(),client=catalog.clients.some(function(c){return c.id===params.get('client');})?params.get('client'):detected.size===1?[...detected][0]:'claude-code';if(state.view==='tools')state.toolClient=client;else state.catalogClient=client;
  if(previousMode!==state.mode||previousRole!==state.role||previousToolClient!==state.toolClient)state.toolPreview=null;
  var profile=profiles.findIndex(function(p){return !localProfile(p)&&profileIdentity(p)===params.get('profile');});if(profile>=0)profileIndex=profile;
  if(previousMode!==state.mode || previousClient!==state.catalogClient){
    state.planPreview=null;profilePreview=null;state.selectionHandoff=null;
  }else if(previousProfile!==profileIndex)profilePreview=null;
  if(state.view==='catalog' && state.recordId && !params.has('page')){
    var itemIndex=records.filter(matchesRecord).findIndex(function(item){return item.id===state.recordId;});
    if(itemIndex>=0)state.page=Math.floor(itemIndex/40);
  }
  if(state.view==='catalog')clearOffPageSelection();
}
function focusCurrentPage() {
  var target=state.view==='catalog'&&record()?visibleTarget('[data-record="'+state.recordId+'"]'):null;
  if(!target&&state.view==='catalog')target=$('catalog-results-heading');
  (target||$('page-title')).focus({preventScroll:true});
  if(window.matchMedia?.('(max-width:820px)').matches)(target||$('page-title')).scrollIntoView?.({block:'start'});
}
function findingPanel(f) { return f?'<section class="panel selected-finding"><h2 id="selected-finding-heading" tabindex="-1">Selected finding</h2><p>'+esc(f.message)+'</p><p><b>'+esc(f.severity)+'</b> · '+esc(f.tool)+' · '+esc(f.ruleId||'')+'</p><code>'+esc(f.path)+(f.line?':'+esc(f.line):'')+'</code></section>':''; }
function connectedExamples() {
  return '<details class="panel"><summary>Connected execution examples · AIH Extensions + Project instructions</summary><p>Choose AIH Extensions to install the whole native plugin. Choose Project instructions to manage CLAUDE.md. For individual Catalog items, use Review installation on an eligible placement preview.</p>'+(admin()?'<div class="inline-actions">'+go('policy','Define organization policy →')+'</div>':'<table class="choice-table"><tbody>'+choiceRow('extensions','AIH Extensions '+connectedFramework().version,'Native plugin · reviewed Claude commands · pinned source')+choiceRow('instructions','Project instructions','Independent Core change · actual CLAUDE.md')+'</tbody></table><div class="inline-actions">'+go('installed','Open connected installation & configuration →')+'</div>')+'</details>';
}
function reviewPanel(editable) {
  var remote=state.enterprise.remote, current=currentReviews(), records=remote?.reviews||[];
  var out='<section class="panel"><h2>Company &amp; evidence record</h2>';
  if(editable && remote?.policyDigest) {
    var input=(key,label,limit)=>'<label for="review-'+key+'">'+label+'</label><input type="text" id="review-'+key+'" maxlength="'+limit+'" value="'+esc(reviewDraft[key])+'">';
    var attached=catalog.items.find(item=>item.id===reviewDraft.itemId);
    out+='<p>This local record links the reviewer and evidence to this policy revision. Names are self-declared. Adding evidence does not grant permission to install its subject.</p><div class="policy-controls">'+input('company','Company',300)+input('reviewer','Reviewed by',300)+input('team','Team or project (optional)',300)+
      '<label for="review-decision">Decision</label><select id="review-decision">'+['False alarm','Accepted risk','Accepted for this use','Follow-up needed','Declined'].map(d=>'<option '+(d===reviewDraft.decision?'selected':'')+'>'+d+'</option>').join('')+'</select>'+
      '<label for="review-note">Reason</label><textarea id="review-note" maxlength="2000">'+esc(reviewDraft.note)+'</textarea></div>'+
      '<p>False alarm and Accepted risk record your judgment; Declined is advisory. To block installation, save a prohibited policy rule.</p>'+(reviewDraft.concern?'<p><b>Concern:</b> '+esc(reviewDraft.concern.tool)+' · '+esc(reviewDraft.concern.ruleId)+'</p>':'')+'<p><strong>Evidence</strong> · '+(attached?esc(attached.title)+' ('+esc(attached.id)+')':'No assessment attached')+'</p><div class="inline-actions">'+button('review-pick','Choose Scan evidence')+(attached?button('review-detach','Detach evidence'):'')+button('review-save','Record review',!attached&&['False alarm','Accepted risk'].includes(reviewDraft.decision),true)+'</div>';
  } else if(editable)out+='<p>Save the policy above to record a company, reviewer, decision and supporting evidence for that revision.</p>';
  out+='<p>'+current.length+' review(s) for this policy revision.</p>';
  for (const entry of records.slice().sort(compareReviews).reverse()) {
    const e=entry.evidence;
    out+='<details><summary>'+esc(entry.company)+' · '+esc(entry.decision)+' · '+esc(entry.recordedAt)+'</summary><p>'+esc(entry.reviewer)+' · '+esc(entry.team||'No team specified')+'</p><p>'+esc(entry.note)+'</p><p>'+esc(entry.policyId)+' · '+(entry.policySha256===remote.policyDigest?'Current policy revision':'Historical policy revision')+' · <code>'+esc(entry.policySha256)+'</code></p><p>'+ (e?esc(e.itemId)+' · '+esc(e.verdict||e.status)+' '+(e.summary?link(e.summary.url,'Recorded Scan summary'):''):'No Scan assessment attached')+'</p>'+button('export-review:'+entry.id,'Download review record')+'</details>';
  }
  return out+'</section>';
}
function coreView() {
  return '<section class="panel"><h2>Public Core interfaces</h2><dl>'+
    '<dt>Installation</dt><dd><code>prepare · apply · list · checkFiles · prepareUpdate · prepareRemoval</code><p>Review project changes, approve them, check installed files and review removal from Workspace.</p></dd>'+
    '<dt>Native client</dt><dd><code>verifyClient</code><p>Check in Claude Code asks the client whether it loaded AIH Extensions.</p></dd>'+
    '<dt>Policy</dt><dd><code>validateOrganizationPolicy · previewAdmission</code><p>Validate the organization’s rules and check the selected project plan against them.</p></dd>'+
    '<dt>Diagnostics</dt><dd><code>inspect · createReport · getGuidance</code><p>Read local checks, report evidence and operation history in Diagnostics.</p></dd></dl></section>';
}
function frameworkRulesView() {
  var count=Object.keys(frameworkRules).filter(function(id){return !toolFrameworkIds().has(id);}).length;
  return '<details class="panel" id="framework-policy"><summary>Catalog framework permissions · '+count+' configured</summary><div class="policy-controls">'+frameworkSources().filter(function(f){return !['superpowers','extensions'].includes(f.id);}).map(function(f){
    var id='policy-framework-'+f.id;
    return '<label for="'+esc(id)+'">'+esc(f.name)+'</label><select id="'+esc(id)+'" data-framework-rule="'+esc(f.id)+'">'+['','permitted','recommended','required','prohibited'].map(function(value){
      return '<option value="'+value+'" '+((frameworkRules[f.id]||'')===value?'selected':'')+'>'+ (value||'No rule')+'</option>';
    }).join('')+'</select>';
  }).join('')+'</div><p>No rule adds no framework-specific obligation. The framework boundary, other source rules and prohibited item or kind rules still apply.</p></details>';
}
function extensionsRuleControl() {
  return '<label for="policy-framework-extensions">AIH Extensions obligation</label><select id="policy-framework-extensions" data-framework-rule="extensions">'+['','permitted','recommended','required','prohibited'].map(function(value){return '<option value="'+value+'" '+((frameworkRules.extensions||'')===value?'selected':'')+'>'+(value||'No rule')+'</option>';}).join('')+'</select>';
}
function toolRulesView() {
  var sources=catalog.frameworks.filter(function(source){return toolFrameworkIds().has(source.id);}),count=sources.filter(function(source){return frameworkRules[source.id];}).length;
  return '<details class="panel" id="tool-policy"><summary>Tool permissions · '+count+' configured</summary><div class="policy-controls">'+sources.map(function(source){var id='policy-framework-'+source.id;return '<label for="'+esc(id)+'">'+esc(source.name)+'</label><select id="'+esc(id)+'" data-framework-rule="'+esc(source.id)+'">'+['','permitted','recommended','required','prohibited'].map(function(value){return '<option value="'+value+'" '+((frameworkRules[source.id]||'')===value?'selected':'')+'>'+(value||'No rule')+'</option>';}).join('')+'</select>';}).join('')+'</div><p>These tool rules apply to Claude Code project plans. No rule can still allow content from the pinned Catalog, subject to the policy’s other rules.</p></details>';
}
function savedToolRules(policy) {
  var entries=policy.entries.filter(function(entry){return typeof entry.content?.framework==='string'&&entry.id==='catalog-framework-'+entry.content.framework&&toolFrameworkIds().has(entry.content.framework);});
  return entries.length?'<section><h3>Tool permissions</h3>'+entries.map(function(entry){return '<p>'+esc(catalog.frameworks.find(function(source){return source.id===entry.content.framework;})?.name||entry.content.framework)+' · '+esc(entry.obligation)+'</p>';}).join('')+'</section>':'';
}
function policyGranularControls() {
  var selected=state.policyItemId||record()?.id||'',obligations=['','permitted','recommended','required','prohibited'];
  function rule(attribute,key,value){return '<select '+attribute+'="'+esc(key)+'">'+obligations.map(function(o){return '<option value="'+o+'" '+(value===o?'selected':'')+'>'+(o||'No rule')+'</option>';}).join('')+'</select>';}
  return '<section><label for="policy-posture">Catalog boundary</label><select id="policy-posture"><option value="catalog-default" '+(state.policyPosture==='catalog-default'?'selected':'')+'>Pinned Catalog unless prohibited (current default)</option><option value="only-selected" '+(state.policyPosture==='only-selected'?'selected':'')+'>Only these frameworks</option></select><p>The framework limit is an additional boundary. Other source and permission rules still apply; Project instructions have their own permission.</p>'+(state.policyPosture==='only-selected'?'<fieldset><legend>Allowed framework sources</legend>'+frameworkSources().map(function(f){return '<label><input type="checkbox" data-framework-allow="'+esc(f.id)+'" '+((state.allowedFrameworks||[]).includes(f.id)?'checked':'')+'> '+esc(f.name)+'</label>';}).join('')+'<details><summary>Tool sources</summary>'+catalog.frameworks.filter(function(f){return toolFrameworkIds().has(f.id);}).map(function(f){return '<label><input type="checkbox" data-framework-allow="'+esc(f.id)+'" '+((state.allowedFrameworks||[]).includes(f.id)?'checked':'')+'> '+esc(f.name)+'</label>';}).join('')+'</details>'+(state.allowedFrameworks||[]).filter(function(id){return !catalog.frameworks.some(function(f){return f.id===id;});}).map(function(id){return '<label><input type="checkbox" data-framework-allow="'+esc(id)+'" checked> Imported source: '+esc(id)+' (outside this Catalog)</label>';}).join('')+'<p>With no sources selected, all Catalog content is outside this boundary.</p></fieldset>':'')+'<details><summary>Item and kind rules</summary><label for="policy-item">Catalog item</label><select id="policy-item"><option value="">Choose an item</option>'+records.map(function(item){return '<option value="'+esc(item.id)+'" '+(selected===item.id?'selected':'')+'>'+esc(itemTitle(item.id))+'</option>';}).join('')+'</select>'+(selected?rule('data-item-rule',selected,itemRules[selected]||''):'')+Object.keys(itemRules).filter(function(id){return id!==selected;}).map(function(id){return '<p>'+esc(itemTitle(id))+' '+rule('data-item-rule',id,itemRules[id])+'</p>';}).join('')+'<h3>Content kinds</h3>'+kinds.map(function(k){return '<label>'+esc(k)+' '+rule('data-kind-rule',k,kindRules[k]||'')+'</label>';}).join('')+'</details></section>';
}
function policyDraftImpactView() {
  var draft=state.result,selection=draft.selectionImpact;
  function status(value){return value?.status==='ok'?(value.value.admitted?'Admitted':'Denied'):value?value.status:'No saved policy';}
  return '<section class="policy-draft-impact"><h3>Changes from saved policy</h3>'+(draft.changes?.length?'<ul>'+draft.changes.map(function(change){return '<li>'+esc(change)+'</li>';}).join('')+'</ul>':'<p>No policy changes.</p>')+(selection?'<h3>Current preview selection · '+esc(selection.client)+'</h3><p>'+esc(selection.unavailable||('Saved policy: '+status(selection.before)+' → draft: '+status(selection.after)))+'</p>':'')+'<h3>Installed content under this draft</h3>'+(draft.impact?.length?'<ul>'+draft.impact.map(function(row){return '<li>'+esc(row.unit)+' · '+esc(row.status)+'</li>';}).join('')+'</ul>':'<p>No retained installed requests to evaluate.</p>')+'<p>Core evaluated the retained requests against this draft. Saving changes permissions; installed files stay in place.</p></section>';
}
function policyView() {
  var p=state.published;
  if(state.mode==='vibe')return '<div class="panel"><h2>Your independent Vibe workspace</h2><p>Vibe uses its own real project, dedicated Core home and installed inventory, without an organization boundary.</p><code>'+esc(local().remote.project)+'</code><div class="inline-actions">'+go('installed','Choose connected install examples →')+go('repair','Environment & repair →')+'</div></div>';
  var supplied=p?'<div class="panel"><div class="card-title"><h2 id="policy-saved-heading" tabindex="-1">Saved connected example policy</h2>'+badge('CORE VALIDATED','mint')+'</div><p>Superpowers <strong>'+esc(p.obligation)+'</strong> · Project instructions '+(p.allowCustom?'permitted':'prohibited')+'. Core reads this exact policy again at Prepare and Apply.</p><p>'+esc(Array.isArray(p.policy.sources?.frameworks)?'Only these framework sources: '+(p.policy.sources.frameworks.join(', ')||'none')+'. Other source and permission rules also apply.':'Pinned Catalog content without a matching rule can still be admitted, subject to other rules. Prohibited rules explicitly block matching content.')+'</p>'+p.policy.entries.filter(function(e){return typeof e.content?.framework==='string'&&e.id==='catalog-framework-'+e.content.framework&&!toolFrameworkIds().has(e.content.framework);}).map(function(e){return '<p>'+esc(catalog.frameworks.find(function(f){return f.id===e.content.framework;})?.name||e.content.framework)+' · '+esc(e.obligation)+'</p>';}).join('')+savedToolRules(p.policy)+'<p>Developers on this Workbench can open Enterprise → Developer → Policy or download this exact revision to share.</p><div class="inline-actions">'+button('download-supplied','Download saved Core policy',false,false)+(admin()?button('switch-developer','Use as developer →',false,true):go('installed','Choose connected install examples →'))+'</div><details><summary>Saved policy JSON</summary><pre>'+esc(JSON.stringify(p.policy,null,2))+'</pre></details></div>':'<div class="callout"><b>No saved organization policy</b><p>Save a Core-validated local policy before Enterprise installation. Environment inspection and repair preparation are independent.</p></div>';
  if(!admin())return supplied+reviewPanel(false);
  return '<div class="panel"><h2>Connected execution examples · admin policy</h2>'+badge(state.policyDraftDirty||!p?'UNSAVED DRAFT':'SAVED FIELDS')+'<p>Set framework obligations for Claude Code project plans from the allowed pinned Catalog. Core evaluates the complete plan against the saved policy. This walkthrough installs AIH Extensions through reviewed native Claude commands, or applies Project instructions. Existing Superpowers state is preserved.</p><div class="policy-controls"><label for="policy-id">Policy ID</label><input type="text" id="policy-id" value="'+esc(state.policyId)+'">'+extensionsRuleControl()+'<label for="obligation">Preserved Superpowers obligation</label><select id="obligation">'+['permitted','recommended','required','prohibited'].map(function(v){return '<option value="'+v+'" '+(state.obligation===v?'selected':'')+'>'+v+'</option>';}).join('')+'</select></div><div class="assignment-row"><span><b>Policy scope</b> Local project · Claude Code</span><label><input type="checkbox" id="allow-custom" '+(state.allowCustom?'checked':'')+'> Permit Project instructions</label></div>'+frameworkRulesView()+toolRulesView()+policyGranularControls()+'<div class="inline-actions">'+button('generate','Validate draft with Core',false,true)+'</div></div>'+(state.result?'<div class="panel"><h2 id="policy-validation-heading" tabindex="-1">Draft validated</h2>'+badge('VALID · CORE','mint')+policyDraftImpactView()+'<div class="inline-actions">'+button('publish','Save local organization policy',false,true)+button('download-policy','Download validated draft',false,false)+'</div><details><summary>Validated draft JSON</summary><pre>'+esc(JSON.stringify(state.result.policy,null,2))+'</pre></details></div>':'')+supplied+'<p class="help">Draft edits leave the saved policy unchanged until you validate and save again.</p>'+reviewPanel(true);
}
function checkSummary(value) {
  var checks=value.checks||[{unit:'Retained request',check:value.check,admission:value.admission}];
  return '<div class="panel"><h2 id="check-heading" tabindex="-1">Installed file & admission check</h2><p class="help">Read at '+esc(value.readAt||'this session')+'</p><table class="choice-table"><thead><tr><th>Retained unit</th><th>Files &amp; settings</th><th>Admission</th></tr></thead><tbody>'+checks.map(function(row){return '<tr><td>'+esc(row.unit)+'</td><td>'+esc(row.explanation?.label||row.check.fileState||row.check.status)+'<small>'+esc(row.check.observation||row.check.reason||'')+'</small></td><td>'+esc(state.mode==='vibe'?'Independent workspace':row.admission?row.admission.status==='ok'?(row.admission.value.admitted?'Allowed by current policy':'Denied by current policy'):row.admission.status:'not evaluated')+'</td></tr>';}).join('')+'</tbody></table>'+checks.filter(function(row){return row.explanation;}).map(function(row){var explanation=row.explanation;return '<section class="file-check-explanation" aria-label="'+esc(row.unit)+' file check explanation"><h3>'+esc(explanation.title)+'</h3><ul>'+explanation.details.map(function(detail){return '<li>'+esc(detail)+'</li>';}).join('')+'</ul><p>'+esc(explanation.next)+'</p></section>';}).join('')+(value.coverage&&value.coverage.untrackedInventory.length?'<p class="warning">No retained request to check: '+esc(value.coverage.untrackedInventory.join(', '))+'</p>':'')+'<p class="help">These checks compare managed files and current admission. Claude Code loading requires its separate client check.</p><details><summary>Exact coverage and reasons</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details></div>';
}
function installedPolicyView(remote) {
  if(state.mode!=='enterprise'||admin()||!remote.inventory.entries.length)return '';
  var checks=remote.installedPolicyChecks;
  if(local().policyStatusStale||!Array.isArray(checks))return '<section class="panel"><h2>Policy status unknown</h2><p>The current organization policy status of installed units could not be read. Refresh to check again.</p></section>';
  return checks.filter(function(check){return check.status==='denied'||check.status==='unknown';}).map(function(check){
    var label=check.label||check.unit;
    if(check.status==='unknown')return '<section class="panel"><h2>Policy status unknown</h2><p><strong>'+esc(label)+'</strong> is still installed. Its current organization policy status could not be determined.</p></section>';
    return '<section class="panel"><h2>Needs attention</h2><p><strong>'+esc(label)+'</strong> is still installed. The current organization policy prohibits it.</p>'+(check.removalId?'<div class="inline-actions">'+button('remove:'+check.removalId,'Review removal',false,false,'Review removal for '+label)+'</div>':'<p class="help">A connected removal route is unavailable for this unit.</p>')+'</section>';
  }).join('');
}
function claudeCheckView(remote) {
  if(admin()||!hasInstalledConnectedPlugin(remote))return '';
  var check=local().clientCheck,title=check?check.status==='loaded'?'Loaded in Claude Code':check.status==='not-loaded'?'Not loaded in Claude Code':'Load not confirmed':'Check AIH Extensions in Claude Code';
  return '<section class="panel client-check" aria-label="Claude Code load check"><h2 id="client-check-heading" tabindex="-1">'+title+'</h2><p class="client-check-message">'+esc(check?check.message:'AIH Extensions is in Core’s installed inventory. Request a client check to find out what can be confirmed.')+'</p><div class="inline-actions">'+button('check-claude','Check in Claude Code',false,true)+'</div>'+(check?'<p class="help">'+(check.checkedAt?'Checked at '+esc(check.checkedAt):'Check time not supplied')+'</p><details><summary>Client check evidence</summary><pre>'+esc(JSON.stringify(check,null,2))+'</pre></details>':'')+'</section>';
}
function extensionsProvenanceView(remote) {
  return remote.extensionsDerivation?'<details class="panel"><summary>Extensions plan inputs &amp; origin</summary><p>The whole-plugin inventory is derived by Workbench through public Catalog producer APIs from the exact pinned Extensions source. It is additional to the published Catalog item document. The recipe and both input identities are recorded below.</p><pre>'+esc(JSON.stringify(remote.extensionsDerivation,null,2))+'</pre></details>':'';
}
function reviewOriginView(review) {
  if(!review)return '';
  var recipe=review.origin&&typeof review.origin==='object'?review.origin.recipe:null,data=review.plan?.data;
  return (recipe||data?'<section><h3>Source and recipe origin</h3>'+(data?'<p>Catalog: '+esc(data.repository)+' @ '+esc(data.commit)+'</p>':'')+(recipe?'<p>Core proved recipe '+esc(recipe.id)+' @ '+esc(recipe.commit)+'.</p>':!review.originNote?'<p>Individually chosen Catalog content.</p>':'')+'</section>':'')+(review.versions?.length?'<details><summary>Client version comparisons · '+review.versions.length+'</summary>'+review.versions.map(function(value){return '<p>'+esc(value.message||factText(value))+'</p>';}).join('')+'</details>':'');
}
function installedView() {
  if(admin())return '<div class="panel"><h2>Developer workspace</h2><p>Developers prepare and apply actual changes under the saved policy.</p>'+button('switch-developer','Switch to developer →',false,true)+'</div>';
  var c=local(),remote=c.remote,p=c.prepared,entries=remote.inventory.entries||[];
  var groups=remote.installedGroups||entries.map(function(entry){return {id:entry.managementId,label:entry.managementId,entries:[entry],managementIds:[entry.managementId]};});
  var inventory='<p>'+groups.length+' installed units · '+entries.length+' Core records. Shared notices and ownership records are grouped with their plugin.</p><table class="choice-table"><thead><tr><th>Installed unit</th><th>Managed members</th><th>Lifecycle</th></tr></thead><tbody>'+groups.map(function(group){return '<tr><td><strong>'+esc(group.label)+'</strong><details><summary>'+group.entries.length+' ownership records</summary>'+group.managementIds.map(function(id){return '<p><code>'+esc(id)+'</code></p>';}).join('')+'</details></td><td>'+group.entries.reduce(function(total,e){return total+(e.members||[]).length;},0)+'</td><td>'+button('remove:'+group.id,'Review removal',false,false,'Review removal for '+group.label)+'</td></tr>';}).join('')+'</tbody></table>';
  var out='<div class="source-header"><div><strong>Actual project inventory</strong></div>'+badge('PUBLIC CORE','mint')+'</div>'+installedPolicyView(remote)+'<details class="workspace-context"><summary>Dedicated example workspace · personal setup unchanged</summary><dl><dt>Project</dt><dd class="mono">'+esc(remote.project)+'</dd><dt>Core home</dt><dd class="mono">'+esc(remote.home)+'</dd></dl></details>'+(entries.length?inventory:'<div class="empty">Core lists no installed units in this project.</div>')+claudeCheckView(remote)+'<div class="section-head"><h2>Next change</h2></div><p class="help">Review each unit separately. Choices stay selected and existing units remain in Core inventory. AIH Extensions uses the native Claude plugin route; Apply runs its reviewed marketplace and install commands.</p><table class="choice-table"><tbody>'+choiceRow('extensions','AIH Extensions '+connectedFramework().version,'Native plugin · pinned source · Workbench-authored recipe')+choiceRow('instructions','Project instructions','Independent change · actual CLAUDE.md configuration')+'</tbody></table>'+(c.choices.instructions?'<label class="config-label" for="instructions-text">Project instruction text</label><textarea id="instructions-text">'+esc(c.text)+'</textarea>':'')+'<div class="inline-actions">'+(c.choices.extensions?button('prepare-extensions','Review AIH Extensions',!ready()||unitProhibited('extensions'),true):'')+(c.choices.instructions?button('prepare-instructions','Review Project instructions',!ready()||unitProhibited('instructions'),true):'')+(c.outcome?'':button('check',state.mode==='vibe'?'Check installed files':'Check installed files & admission',!entries.length,false))+go('reports','Open Core reports →')+'</div>';
  if(c.choices.superpowers||entries.some(function(entry){return entry.framework==='superpowers';}))out+='<details class="panel"><summary>Preserved Superpowers setup</summary><p>The saved Superpowers inventory, policy rule and request retain their original identity.</p><table class="choice-table"><tbody>'+choiceRow('superpowers',('Superpowers'+(framework.version?' '+framework.version:'')),'Retained whole-plugin local route')+'</tbody></table>'+(c.choices.superpowers?button('prepare-superpowers','Review preserved Superpowers',!ready()||unitProhibited('superpowers'),false):'')+'</details>';
  out+=extensionsProvenanceView(remote);
  if(p) {
    var result=p.result,review=result.review,steps=review&&review.steps||[],counts={};steps.forEach(function(step){counts[step.effect]=(counts[step.effect]||0)+1;});
    out+='<div class="panel review-panel"><div class="card-title"><h2 id="review-heading" tabindex="-1">Core '+esc(p.operation)+' review</h2>'+badge(result.status,p.applyAllowed?'mint':'amber')+'</div>'+producerMessages(review?.organization?.denials?.length?{...result,code:null,reason:null}:result)+'<p>'+esc(Object.keys(counts).map(function(effect){return counts[effect]+' '+effect;}).join(' · ')||result.reason||'See Core response below')+'</p>'+(review&&review.organization?'<p><b>Organization admission:</b> '+esc(review.organization.admitted?'admitted':'denied')+'</p>'+review.organization.denials.map(function(d){return '<p class="warning">'+esc(d.code+' · '+d.reason+': '+d.message)+'</p>';}).join(''):'')+'<div class="review-effect-list">'+representativeEffects(steps).map(function(step){return '<div><span>'+esc(step.effect)+'</span><code>'+esc(step.path||step.sentence)+'</code></div>';}).join('')+'</div>'+(steps.length>5?'<p class="help">Representative effects from '+steps.length+' reviewed operations. Use View all operations for the complete review.</p>':'')+'<p class="help">Apply approves this exact review once.</p>'+(review?.origin&&typeof review.origin==='object'?'<p><b>Verified recipe:</b> '+esc(review.origin.recipe?.id||'Catalog recipe')+'</p>':'')+reviewOriginView(review)+(review?.originNote?'<section><h3>Recipe origin</h3><p>'+esc(review.originNote==='origin not proven'?'Core could not reproduce this recipe from its source. Review the individual changes before approving.':review.originNote)+'</p></section>':'')+'<p>Counts are Core’s reviewed operations; several operations can belong to one installed unit. Already-satisfied operations need no change.</p>'+installationSummary(p)+'<div class="inline-actions">'+button('install',p.operation==='remove'?'Approve removal':p.operation==='update'?'Approve update':'Approve installation',!p.applyAllowed,true)+'</div><details><summary>View all '+steps.length+' operations</summary><ol class="review-operations">'+steps.map(reviewOperationDetails).join('')+'</ol></details><details><summary>Full public Core result</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details></div>';
  }
  if(c.check)out+=checkSummary(c.check);
  if(c.outcome)out+=operationResultView(c.outcome,c.lastOperation);
  return out;
}
function reviewUnits(prepared) {
  if(prepared.catalogSelection)return prepared.catalogSelection.items.map(itemTitle).join(', ');
  var steps=prepared.result.review?.steps||[];
  if(steps.some(function(step){return step.framework==='extensions';}))return 'AIH Extensions';
  if(steps.some(function(step){return step.framework==='superpowers';}))return 'Superpowers';
  if(steps.some(function(step){return step.managementId==='project-instructions';}))return 'Project instructions';
  var ids=Array.from(new Set(steps.map(function(step){return step.managementId;}).filter(Boolean)));
  return ids.length===1?ids[0]:ids.length+' managed entries';
}
function installationSummary(prepared) {
  if(prepared.operation!=='install')return '';
  var review=prepared.result.review,steps=review?.steps||[];
  if(!prepared.applyAllowed||!review||prepared.result.status!=='ready')return '<section class="install-summary" aria-label="Installation summary"><h3>Installation unavailable</h3><p>This review cannot be approved. Read Core’s returned reason above.</p></section>';
  var changes=steps.filter(function(step){return step.effect!=='already-satisfied';}),satisfied=steps.length-changes.length,files=changes.filter(function(step){return ['create-file','replace-file'].includes(step.effect);}),lines=[];
  changes.filter(function(step){return step.commands?.length;}).forEach(function(step){
    lines.push('Runs '+step.commands.map(function(command){return '<code>'+esc(command.argv.join(' '))+'</code>';}).join(', then ')+'.');
  });
  if(prepared.nativePlugin){var native=prepared.nativePlugin;lines.push('Installs AIH Extensions from <code>'+esc(native.repository)+' @ '+esc(native.commit)+'</code> for this project only, using the dedicated example account. Personal and machine-wide settings stay unchanged.');if(native.hooks?.length)lines.push('The whole plugin includes these project hooks: '+native.hooks.map(function(hook){return '<strong>'+esc(hook.name)+'</strong> ('+esc(hook.event)+')';}).join(', ')+'. These can run in normal Claude Code sessions for this project. The separate load check sends no prompt and runs no hooks.');}
  var instructions=files.filter(function(step){return step.managementId==='project-instructions'&&step.path;});
  instructions.forEach(function(step){lines.push((step.effect==='create-file'?'Creates ':'Replaces ')+'<code>'+esc(step.path)+'</code> with the reviewed project instructions.');});
  var pluginFiles=files.filter(function(step){return step.route==='local-plugin'&&step.framework&&step.op==='write'&&step.root==='project'&&step.path;});
  Array.from(new Set(pluginFiles.map(function(step){return step.framework;}))).forEach(function(id){
    var paths=pluginFiles.filter(function(step){return step.framework===id;}).map(function(step){return step.path.split('/').slice(0,-1);}),parts=paths[0].slice();while(parts.length&&!paths.every(function(path){return parts.every(function(part,index){return path[index]===part;});}))parts.pop();var common=parts.join('/');
    var name=catalog.frameworks.find(function(source){return source.id===id;})?.name||id;
    lines.push('Writes the project-local '+esc(name)+' plugin files'+(common?' under <code>'+esc(common)+'</code>':'')+'.');
  });
  files.filter(function(step){return step.op==='merge'&&step.path&&step.key;}).forEach(function(step){
    if(step.key.startsWith('/enabledPlugins/')&&step.entry===true)lines.push('Enables <code>'+esc(step.key.slice('/enabledPlugins/'.length))+'</code> in <code>'+esc(step.path)+'</code>.');
    else if(step.key.startsWith('/extraKnownMarketplaces/')&&step.entry?.source?.source==='directory')lines.push('Registers the local marketplace <code>'+esc(step.entry.source.path)+'</code> in <code>'+esc(step.path)+'</code>.');
  });
  var hooks=files.filter(function(step){return step.executableConfiguration?.kind==='hook'&&(step.executableConfiguration.launches||[]).some(function(launch){return /(?:^|[\s"'/\\])session-start(?:$|[\s"'])/.test([launch.command].concat(launch.args||[]).join(' '));});});
  if(hooks.length)lines.push('Includes session-start hook configuration in '+hooks.length+' reviewed '+(hooks.length===1?'file':'files')+'.');
  if(!lines.length&&files.length)files.slice(0,3).forEach(function(step){lines.push((step.effect==='create-file'?'Creates ':'Replaces ')+'<code>'+esc(step.path||step.sentence)+'</code>.');});
  if(!lines.length&&changes.length)lines.push(changes.length+' changes are proposed. Read their reviewed effects below.');
  return '<section class="install-summary" aria-label="Installation summary"><h3>On approval</h3>'+(lines.length?'<ul>'+lines.map(function(line){return '<li>'+line+'</li>';}).join('')+'</ul>':'<p>No new file effects are proposed in this review.</p>')+(satisfied?'<p><strong>Already satisfied:</strong> '+satisfied+' reviewed '+(satisfied===1?'operation needs':'operations need')+' no change.</p>':'')+'</section>';
}
function reviewOperationDetails(step,index) {
  var launches=step.executableConfiguration?.launches||[];
  return '<li class="review-operation"><div><strong>'+(index+1)+'. '+esc(step.effect)+'</strong>'+(step.path?'<code>'+esc((step.root?step.root+' / ':'')+step.path)+'</code>':'')+'</div><p>'+esc(step.sentence||step.op||'Reviewed operation')+'</p>'+(step.key?'<p><b>Configuration key:</b> <code>'+esc(step.key)+'</code></p>':'')+(Object.hasOwn(step,'entry')?'<pre>'+esc(JSON.stringify(step.entry,null,2))+'</pre>':'')+(launches.length?'<p><b>Declared launch:</b></p><ul>'+launches.map(function(launch){return '<li><code>'+esc([launch.command].concat(launch.args||[]).join(' '))+'</code></li>';}).join('')+'</ul>':'')+(step.details?'<details><summary>Reviewed operation details</summary><pre>'+esc(JSON.stringify(step.details,null,2))+'</pre></details>':'')+(step.commands?.length?'<pre>'+esc(JSON.stringify(step.commands,null,2))+'</pre>':'')+(step.cantPromise?'<p class="help">'+esc(step.cantPromise)+'</p>':'')+'</li>';
}
function representativeEffects(steps) { var seen=new Set();return steps.filter(function(step){var key=step.effect+'\0'+(step.path||step.sentence);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,5); }
function countFacts(rows,key) { var counts={};rows.forEach(function(row){var value=key(row);counts[value]=(counts[value]||0)+1;});return Object.keys(counts).map(function(value){return counts[value]+' '+value;}).join(' · '); }

function preparedStatus(prepared) { var result=prepared.result;if(result.status!=='ok')return result.status;var entries=result.entries||[];return entries.some(function(entry){return entry.status==='blocked';})?'blocked':entries.some(function(entry){return entry.status==='partial';})?'partial':entries.find(function(entry){return entry.status;})?.status||result.status; }
function operationResultView(result,context) {
  var action=context?context.action:'operation',units=context&&context.units||'the reviewed unit',rows=result.members||[],steps=result.steps||[],seen=new Set();
  var sample=rows.filter(function(member){var key=[member.path,member.intent,member.outcome,member.check].join('\0');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,5);
  function members(list){return list.map(function(member){return '<div class="result-member"><code>'+esc(member.path||member.managementId)+'</code><span>'+esc([member.intent,member.outcome,member.check].filter(Boolean).join(' · '))+'</span></div>';}).join('');}
  return '<section class="panel"><h2 id="latest-operation-heading" tabindex="-1">'+esc(action[0].toUpperCase()+action.slice(1))+' result · '+esc(result.completion||result.status)+'</h2><p><b>'+esc(units)+'</b> · '+steps.length+' operation results · '+rows.length+' member outcomes</p>'+producerMessages(result)+(steps.length?'<p>'+esc(countFacts(steps,function(step){return step.application;}))+'</p><p class="help">Step verification: '+esc(countFacts(steps,function(step){return step.verification?.status||'not supplied';}))+'</p>':'')+(sample.length?'<h3>Representative file outcomes</h3>'+members(sample):'')+(rows.length?'<details><summary>All '+rows.length+' member outcomes</summary>'+members(rows)+'</details>':'')+'<p>Operation verification records what Core checked during Apply. Unverified operations are not client-load tests. Use the file check and the separate native client check for their respective evidence.</p><p><b>Next:</b> '+(context?.units==='AIH Extensions'&&context.action!=='remove'&&hasInstalledConnectedPlugin(local().remote)?'Use Check in Claude Code above to check the installed plugin. File and admission checks are separate.':'Check installed files and current admission. Client loading needs its own observation.')+'</p><div class="inline-actions">'+button('check',state.mode==='vibe'?'Check installed files':'Check installed files & admission',!local().remote.inventory.entries.length,true)+'</div><details><summary>Original public operation result</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details></section>';
}

function visibleTarget(selector) { return Array.from(document.querySelectorAll(selector)).find(function(node){return !node.getClientRects||node.getClientRects().length;}); }
function revealNode(node) {
  node.focus();if(node.scrollIntoView)node.scrollIntoView({block:'start'});
  if(!node.getBoundingClientRect||!window.getComputedStyle)return;
  var scroller=node.parentElement;
  while(scroller&&(!/(auto|scroll)/.test(window.getComputedStyle(scroller).overflowY)||scroller.scrollHeight<=scroller.clientHeight))scroller=scroller.parentElement;
  if(!scroller||!scroller.scrollBy)return;
  var controls=document.querySelector('.catalog-controls'),offset=8;
  if(controls&&window.getComputedStyle(controls).position==='sticky')offset+=controls.getBoundingClientRect().height;
  scroller.scrollBy({top:node.getBoundingClientRect().top-scroller.getBoundingClientRect().top-offset});
}
function revealResult(id) { var heading=$(id);if(heading)revealNode(heading); }
function reportSummary(report) {
  if(report.status!=='ok')return '';
  var snapshot=report.snapshot;
  return '<p>'+Object.keys(snapshot.metrics.counts).map(function(key){return esc(key)+': '+snapshot.metrics.counts[key];}).join(' · ')+'</p><table class="choice-table"><thead><tr><th>Target / check</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>'+snapshot.checks.map(function(check){return '<tr><td>'+esc(check.target)+'<small>'+esc(check.id)+'</small></td><td>'+esc(check.outcome)+'</td><td>'+esc(check.reason)+'</td></tr>';}).join('')+'</tbody></table>';
}
function reportsView() {
  var c=local(),rows=c.remote.history||[],report=c.remote.report;
  var reportRoot='/reports/'+state.mode+'/',digest=c.remote.reportDigest?encodeURIComponent(c.remote.reportDigest):null;
  var consoleUrl=reportRoot+(digest?digest+'/':'')+'console.html',diagnosticUrl=digest?reportRoot+digest+'.html':null;
  var collected=report?.status==='ok'&&diagnosticUrl;
  var capture='<section class="panel"><h2 id="report-heading" tabindex="-1">'+(collected?'Workspace checks':'No workspace report collected')+'</h2>'+
    (collected?'<p>Collected '+esc(report.snapshot.capture.observedAt)+'</p>'+reportSummary(report):'<p>Collect an offline report to see which local checks passed, failed or could not run.</p>')+
    '<div class="inline-actions">'+button('report',collected?'Refresh offline Core report':'Collect offline Core report',false,true)+(collected?'<a target="_blank" rel="noopener" href="'+esc(diagnosticUrl)+'">Open Core diagnostics ↗</a><a download="aih-core-diagnostics.html" href="'+esc(diagnosticUrl)+'">Download diagnostics HTML</a>':'')+(collected||rows.length?button('download-report','Download actual results',false,false):'')+'</div></section>';
  var history=rows.slice().reverse().map(function(row){
    var result=row.result||{},guidance=row.guidance||{};
    return '<details class="panel"><summary>#'+esc(row.sequence)+' · '+esc(row.kind)+' · '+esc(result.completion||result.status)+' · '+esc(row.at)+'</summary>'+
      (guidance.status==='invalid'?'<p>Core could not explain this saved result. '+esc(guidance.diagnostics?.map(function(d){return d.reason||d.code;}).join(', ')||'')+'</p>':'')+(guidance.items||[]).map(function(g){return '<h3>'+esc(g.summary)+'</h3><p>'+esc(g.steps.join(' '))+'</p>';}).join('')+
      (row.support?.status==='rendered'?'<details><summary>Support guidance</summary><pre>'+esc(row.support.markdown)+'</pre></details>':'')+
      '<details><summary>Original Core result</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details></details>';
  }).join('');
  return '<div class="source-header"><strong>Reports</strong><code>'+esc(c.remote.project)+'</code></div>'+capture+
    (history?'<h2>Workspace history</h2>'+history:'')+
    '<details class="panel"><summary>View example</summary><p>The V9 Developer Console demonstrates the dashboard with sample scores and support tickets.</p><a target="_blank" rel="noopener" href="'+esc(consoleUrl)+'">Open V9 Developer Console example ↗</a></details>';
}
function repairPrerequisites(remote) {
  var info=remote.repairInfo,definition=info?.definition;
  if(!definition)return '<p>Repair prerequisites are unavailable from this Core build.</p>';
  var variants=definition.variants||[],supported=variants.some(function(variant){return [info.platform,info.platform==='win32'?'windows':info.platform].includes(variant.os);});
  return '<section class="panel"><h3>Repair prerequisites</h3><p>'+esc(info.platform==='win32'?'Windows':info.platform)+' · '+(supported?'A repair variant is declared for this platform.':'No variant of this repair is declared for this platform.')+'</p><p>Prepare becomes available when the actual inspection suggests a repair. Skipped network checks are not a diagnosed trust failure.</p><details><summary>Supported platforms and inputs</summary><ul>'+variants.map(function(variant){return '<li>'+esc(variant.os)+' · '+esc(variant.architectures.join(', '))+' · '+esc(variant.targets.join(', '))+'</li>';}).join('')+'</ul>'+Object.entries(definition.inputs||{}).map(function(pair){return '<p>'+esc(pair[0])+' · '+esc(pair[1].description)+(pair[1].required?' (required)':' (optional)')+'</p>';}).join('')+'</details></section>';
}
function repairView() {
  var c=local(),inspection=c.remote.inspection,repair=c.remote.repair;
  return '<div class="source-header"><div><strong>Environment & independent repair</strong><code>Core / Harness · node-npm-ca · no organization policy required</code></div>'+badge('REAL OFFLINE INSPECTION','blue')+'</div><p>Real machine tools and offline diagnostics, using the dedicated example home <code>'+esc(c.remote.home)+'</code>. Personal account trust configuration is outside this inspection.</p><div class="inline-actions">'+button('inspect','Inspect offline',false,true)+button('review-repair','Prepare suggested repair',!c.remote.repairInfo?.suggestedTargets?.length,false)+go('reports','Open reports →')+'</div>'+(inspection?'<div class="panel"><h2 id="inspection-heading" tabindex="-1">Core inspection · '+esc(inspection.observation||inspection.status)+'</h2><table class="choice-table"><thead><tr><th>Check</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>'+(inspection.checks||[]).map(function(check){return '<tr><td>'+esc(check.id)+'</td><td>'+esc(check.outcome)+'</td><td>'+esc(check.reason)+'</td></tr>';}).join('')+'</tbody></table><details><summary>Full inspection and gaps</summary><pre>'+esc(JSON.stringify(inspection,null,2))+'</pre></details></div>':'<div class="empty">No environment observation has run in this session.</div>')+(repair?'<div class="panel"><h2 id="repair-heading" tabindex="-1">Actual repair preparation · '+esc(repair.status)+'</h2><p>'+esc(repair.reason||(repair.review&&repair.review.environment&&repair.review.environment.unavailable||repair.diagnostics||[]).map(function(d){return d.message||d.code+': '+d.reason;}).join(' · ')||'Core preparation returned the exact review below.')+'</p><details><summary>Exact repair review / refusal</summary><pre>'+esc(JSON.stringify(repair,null,2))+'</pre></details></div>':'')+repairPrerequisites(c.remote)+'<div class="callout"><b>Repair target · node-npm-ca</b><p>This example does not apply system or account trust changes. Review Core’s actual result, supply any required trust inputs, then prepare and approve the repair in the intended account. No repair success is simulated here.</p></div>';
}
function availabilityLabel(value) { return value.label?(value.label+(value.available&&value.how?' via '+value.how:'')):value.available?'Placeable via '+value.how:'Not placeable: '+(value.reason||value.how); }
function profileEvidenceMembers() {
  var profile=selectedProfile();if(!profile)return [];
  var ids=localProfile(profile)?profile.items:(profile.recipe?.members||[]).filter(function(member){return member.preTicked;}).map(function(member){return member.item;});
  return (ids||[]).map(function(id){return records.find(function(item){return item.id===id;});}).filter(Boolean);
}
function profileEvidenceView() {
  var members=profileEvidenceMembers();
  return '<section tabindex="-1"><h3>Selected members & recorded evidence</h3><p>Choose the exact member to read.</p>'+(members.length?'<ul class="profile-items">'+members.map(function(item){return '<li><span>'+esc(itemTitle(item.id))+'</span>'+button('profile-member-evidence:'+item.id,'Open Scan for '+item.title,false,false)+'</li>';}).join('')+'</ul>':'<p>No selected Catalog members in this profile.</p>')+'</section>';
}
function jobInspectorView() {
  var c=local(),remote=c.remote;
  if(state.view==='update'&&!data.update)return '<h2>Recorded update</h2><p>No source comparison was supplied.</p>';
  if(state.view==='tools')return '<div class="eyebrow">Tools</div><h2>Configure a tool selection</h2><p>Choose any subset, inspect its supplied defaults and preview the configuration together. Preview does not install or run tools.</p>';
  if(state.view==='policy')return policyContextView(null);
  if(state.view==='reports')return '<div class="eyebrow">Reports</div><h2>'+esc(remote.reportDigest?'Saved capture':'No saved capture')+'</h2><p>'+esc(state.mode)+' · '+esc(remote.reportDigest||'Collect an offline Core report to save readable diagnostics.')+'</p><p>Inspection results and saved captures are separate.</p>';
  if(state.view==='update')return '<div class="eyebrow">Recorded Superpowers comparison</div><h2>'+esc(framework.version)+' → '+esc(data.update.version)+'</h2><dl><dt>Retained pin</dt><dd class="mono">'+esc(framework.commit)+'</dd><dt>Candidate pin</dt><dd class="mono">'+esc(data.update.commit)+'</dd></dl><p>Candidate Catalog plan and matching Scan evidence are not available.</p>';
  if(state.view==='repair')return '<div class="eyebrow">Environment & repair</div><h2>'+esc(remote.repair?'Repair preparation · '+remote.repair.status:remote.inspection?'Inspection available':'Inspect this workspace')+'</h2><p>Target: '+esc(remote.home)+'</p><p>Inspect reads offline tool state. Prepare repair reports proposed effects or the returned refusal.</p>';
  if(state.view==='core')return '<div class="eyebrow">Core tools</div><h2>Choose a Core job</h2><p>Open inventory, environment, reports or policy. The reference disclosure describes further public operations.</p>';
  return '<div class="eyebrow">Installed & configure</div><h2>'+esc(admin()?'Developer workspace':remote.inventory.entries.length+' managed entries')+'</h2><p>'+esc(admin()?'Switch to Developer to prepare and apply a connected example.':c.prepared?'Prepared '+c.prepared.operation+' · '+preparedStatus(c.prepared):'Prepare a connected unit to review exact effects.')+'</p>'+policyContextView(null)+'<details><summary>Local workspace paths</summary><dl><dt>Project</dt><dd class="mono">'+esc(remote.project)+'</dd><dt>Dedicated Core home</dt><dd class="mono">'+esc(remote.home)+'</dd></dl></details>';
}
function inspectorView() {
  return (record()&&['catalog','scan'].includes(state.view)?'<div class="inspector-close">'+button('selection-close','Close item inspector')+'</div>':'')+(state.view==='catalog'?itemOrganizationReview(record()):'')+inspectorBodyView();
}
function inspectorBodyView() {
  var r=record(),f=finding(),c=local();
  if(state.view==='profiles')return '<div class="eyebrow">Portable profiles</div><h2>'+esc(selectedProfile()?.title||'Create or import a profile')+'</h2><p>Author → preview → share. Evidence belongs to the selected members of this profile.</p>'+profileEvidenceView()+'<section><h3>Delivery boundary</h3><p>Catalog supplies placement results. Core supplies any available organization admission. No profile install, source acquisition or native-client loading is connected here.</p></section>';
  if(!['catalog','scan'].includes(state.view))return jobInspectorView();
  if(!r&&state.view==='scan')return '<h2>Recorded Scan evidence</h2><p>The main view shows coverage for this Catalog pin. An assessment is separate from permission to install.</p>';
  if(!r)return '<div class="eyebrow">Item inspector</div><h2>Select a Catalog item</h2><p>Choose an item to inspect its source, placement and exact recorded evidence.</p><div class="inline-actions">'+go('catalog','Browse Catalog items')+'</div>';
  if(state.inspector==='policy')return policyContextView(r);
  if(state.inspector==='security')return '<div class="eyebrow">'+esc(r.frameworkName)+' · Recorded Scan evidence</div><h2>'+esc(r.title||r.id)+'</h2><p class="identity-line">'+esc(r.id)+'</p>'+securityInspector(r,f);
  if(r&&['catalog','scan'].includes(state.view))return '<div class="eyebrow">'+esc(r.frameworkName)+' · '+esc(r.kind)+'</div><h2>'+esc(r.title)+'</h2><div class="inline-actions">'+itemPlanAction(r,false)+(state.view!=='scan'?button('open-item-findings','Open item findings →'):'')+'</div><p>'+esc(r.description)+'</p>'+(r.setup?toolDefaultsView(r,combinedToolDefaults()):'')+'<section><dl><dt>'+esc(state.catalogClient)+' placement</dt><dd>'+esc(availabilityLabel(r.availability[state.catalogClient]))+'</dd><dt>Catalog ID</dt><dd class="mono">'+esc(r.id)+'</dd><dt>Source</dt><dd>'+(r.sources.map(function(source){return link(source.repository||source.package&&'https://www.npmjs.com/package/'+source.package,source.repository||source.package||source.id)+'<small>'+esc(source.commit||source.version||source.kind)+'</small>';}).join('')||(r.setup?'Tool distribution; see platform and qualification details above.':'Source not supplied in this item view'))+'</dd><dt>Material size / paths</dt><dd>'+(r.paths.length?r.bytes+' bytes · '+r.paths.length+' paths':r.setup?'Tool distribution; platform-dependent acquisition':'No file materials listed')+'</dd></dl></section><details><summary>All client availability & source paths</summary><pre>'+esc(JSON.stringify({availability:r.availability,paths:r.paths,sources:r.sources},null,2))+'</pre></details><p class="help">Plan preview uses item placement. The active native-plugin walkthrough is AIH Extensions; saved Superpowers inventory is retained.</p>';

}
function policyContextView(item) {
  var p=boundary();
  if(!p)return '<h2>'+esc(state.mode==='vibe'?'Your independent choices':'No saved policy')+'</h2><p>'+esc(state.mode==='vibe'?'Your Vibe workspace has no organization boundary.':'Save a policy to evaluate a selected item.')+'</p>';
  var matching=item?p.policy.entries.filter(function(e){var c=e.content;return c&&(!c.item||c.item===item.id)&&(!c.framework||c.framework===item.framework)&&(!c.kind||c.kind===item.kind)&&!c.recipe&&(!e.scopes||e.scopes.includes('project'))&&(!e.clients||e.clients.includes(state.catalogClient));}):[];
  var preview=state.itemPolicyPreview,key=JSON.stringify([item?.id,state.catalogClient,local().remote.policyDigest]);
  return '<h2>'+esc(item?item.title:'Saved policy')+'</h2><p>'+esc(p.policy.id)+' · '+esc(state.catalogClient)+' · project</p>'+(item&&Array.isArray(p.policy.sources?.frameworks)?'<p>'+esc(p.policy.sources.frameworks.includes(item.framework)?'This framework is inside the selected source boundary.':'This framework is outside the selected source boundary.')+'</p>':'')+(item?'<h3>Rules naming this item, kind or framework</h3>'+(matching.length?'<ul>'+matching.map(function(e){return '<li>'+esc(e.obligation)+' · '+esc(e.content.item||e.content.kind||e.content.framework)+(e.repositories?' · repository restriction applies':'')+'</li>';}).join('')+'</ul>':'<p>No matching content rule. Complete-plan admission still checks the allowed sources and other policy rules.</p>')+button('item-policy-check:'+item.id,'Check item admission',false,true)+(preview?.key===key?'<p>'+esc(preview.value.policy?.value?.admitted===true?'Admitted':preview.value.policy?.value?.admitted===false?'Denied':'Admission unavailable')+'</p>'+(preview.value.policy?profilePolicyReasons(preview.value.policy):producerMessages(preview.value.plan)):''):'')+'<div class="inline-actions">'+go('policy','Open organization policy')+'</div>';
}
function inlineInspector() {
  var item=record();if(!item)return '';
  return '<section id="inline-selection" class="inline-inspector" aria-label="Selected item" tabindex="-1"><div class="inline-selection-title"><strong>'+esc(item.frameworkName)+' · '+esc(item.title)+'</strong>'+button('show-selected-item','Show Catalog row')+button('selection-close','Close')+itemPlanAction(item,true)+'</div><div class="inspector-tabs" role="tablist" aria-label="Selected item inspector">'+['details','security','policy'].map(function(tab){return '<button id="inline-tab-'+tab+'" aria-controls="inline-inspector-content" data-inspect="'+tab+'" role="tab" aria-selected="'+(state.inspector===tab)+'" class="'+(state.inspector===tab?'active':'')+'">'+tab[0].toUpperCase()+tab.slice(1)+'</button>';}).join('')+'</div><div id="inline-inspector-content" class="inline-inspector-body" role="tabpanel" aria-labelledby="inline-tab-'+state.inspector+'">'+inspectorView()+'</div></section>';
}
function matchesRecord(r) {
  return (state.frameworkFilter==='all'||r.framework===state.frameworkFilter)&&(state.kind==='all'||r.kind===state.kind)&&(!state.search||(r.title+' '+r.id+' '+r.description+' '+r.frameworkName).toLowerCase().includes(state.search.toLowerCase()));
}
function detector(r,f) { return (r.summary?.tools||[]).find(function(tool){return tool.tool===f.tool;}); }
function findingOrigin(r,f) {
  var tool=detector(r,f),mode=tool?.mode;
  return (mode==='ai'?'AI':mode==='static'?'Static':mode||'Mode not supplied')+' · '+(f.tool||'Tool not supplied')+(tool?.ai?.model?' · '+tool.ai.model:'');
}
function findingLocation(f) { return (f.path||'Location not supplied')+(f.line?':'+f.line:''); }
function evidenceRows(r) { return (r.findings||[]).map(function(f,index){return {finding:f,index:index};}).filter(function(row){return state.severity==='all'||String(row.finding.severity||'unknown').toLowerCase()===state.severity;}); }
function groupedEvidence(r) {
  var groups=[],lookup=new Map();
  evidenceRows(r).forEach(function(row){
    var f=row.finding,key=evidenceGrouping==='file'?f.path||'Location not supplied':JSON.stringify([f.tool,f.ruleId||f.code||f.message||f.text]);
    if(!lookup.has(key)){var group={key:JSON.stringify([r.id,evidenceGrouping,row.index]),rows:[]};lookup.set(key,group);groups.push(group);}
    lookup.get(key).rows.push(row);
  });
  var order={critical:0,high:1,medium:2,low:3,info:4,unknown:5};
  function priority(group){return Math.min.apply(null,group.rows.map(function(row){return order[String(row.finding.severity||'unknown').toLowerCase()]??5;}));}
  return groups.sort(function(a,b){return priority(a)-priority(b)||b.rows.length-a.rows.length;});
}
function sourceExcerpt(f) {
  if(!Array.isArray(f.excerpt?.lines)||!f.excerpt.lines.length)return '';
  return '<div class="evidence-excerpt"><span>Pinned source · reported location</span><div class="evidence-source-lines">'+f.excerpt.lines.map(function(line,index){return '<span class="source-line"><span class="line-number">'+esc(Number(f.excerpt.startLine)+index)+'</span><code>'+esc(line)+'</code></span>';}).join('')+'</div></div>';
}
function evidenceNote(f) { return f.evidenceNote||(f.ruleTitle&&(f.message||f.text)===f.ruleTitle?'The recorded message repeats the rule title. Read the cited line for context.':(f.message===f.ruleId||f.text===f.ruleId)?'The report supplies a rule code without further explanation.':''); }
function recordedModeCounts(r) {
  var counts={},modes=new Map((r.summary?.tools||[]).map(function(tool){return [tool.tool,tool.mode];}));
  evidenceRows(r).forEach(function(row){var supplied=modes.get(row.finding.tool),mode=supplied==='ai'?'AI':supplied==='static'?'static':supplied||'unspecified mode';counts[mode]=(counts[mode]||0)+1;});
  return Object.keys(counts).map(function(mode){return counts[mode]+' '+mode+' records';}).join(' · ');
}
function evidenceRecord(r,row,seenLocations) {
  var f=row.finding,text=f.message||f.text||f.ruleId||f.code||'Finding text not supplied',location=findingLocation(f),shown=seenLocations.has(location);seenLocations.add(location);
  var limited=text===f.ruleId||text===f.code;
  return '<article class="evidence-record '+(state.findingIndex===row.index?'selected':'')+'" data-evidence-index="'+row.index+'"><div class="evidence-record-head"><strong>Record '+(row.index+1)+'</strong><span>'+esc(f.severity||'Severity not supplied')+'</span>'+(f.confidence!=null?'<span>Confidence '+esc(readable(f.confidence))+'</span>':'')+'</div><p class="evidence-message">'+esc(text)+'</p><p class="evidence-location"><b>Reported location</b> <code>'+esc(location)+'</code></p><div class="evidence-links">'+(f.sourceUrl?link(f.sourceUrl,'Open pinned source'):'')+(f.evidenceUrl?link(f.evidenceUrl,'Matching SARIF'):'')+'<button data-finding="'+row.index+'" data-record-id="'+esc(r.id)+'" aria-label="Link to record '+(row.index+1)+'">'+(state.findingIndex===row.index?'Linked record':'Link to record')+'</button></div>'+(!shown?sourceExcerpt(f):'')+(limited&&!shown?'<p class="evidence-limitation">The report supplies a rule or title without further rationale for this location. The reported location alone does not explain the concern.</p>':'')+'<p class="evidence-provenance">'+esc(findingOrigin(r,f))+(f.ruleId?' · Rule '+esc(f.ruleId):'')+'</p><details class="evidence-raw"><summary>Finding details</summary><pre>'+esc(JSON.stringify(f,null,2))+'</pre></details></article>';
}
function evidenceRecordList(r,group) { var seen=new Set();return group.rows.map(function(row){return evidenceRecord(r,row,seen);}).join(''); }
function evidenceGroupBody(r,group) {
  var first=group.rows[0].finding,counts={},locations=new Set(),seen=new Set();
  group.rows.forEach(function(row){var severity=row.finding.severity||'Unknown';counts[severity]=(counts[severity]||0)+1;locations.add(findingLocation(row.finding));});
  return '<div class="evidence-group-overview">'+(evidenceGrouping==='file'?'<p class="evidence-message">'+esc(first.message||first.text||first.ruleId||'Finding text not supplied')+'</p>':'')+'<p class="evidence-distribution">'+Object.keys(counts).map(function(severity){return '<span>'+counts[severity]+' '+esc(severity)+'</span>';}).join(' · ')+'</p><p class="evidence-group-note">'+locations.size+' reported '+(locations.size===1?'location':'locations')+(group.rows.length>1?' · '+group.rows.length+' records, not necessarily distinct issues':'')+'</p><p class="evidence-location"><b>Reported location</b> <code>'+esc(findingLocation(first))+'</code></p>'+(evidenceNote(first)?'<p class="evidence-limitation">'+esc(evidenceNote(first))+'</p>':'')+'<div class="evidence-links">'+(first.sourceUrl?link(first.sourceUrl,'Open pinned source'):'')+(first.evidenceUrl?link(first.evidenceUrl,'Matching SARIF'):'')+'</div>'+sourceExcerpt(first)+'<p class="evidence-provenance">'+esc(findingOrigin(r,first))+(first.ruleId?' · Rule '+esc(first.ruleId):'')+'</p></div><details class="individual-records" data-evidence-records="'+esc(group.key)+'" '+(group.rows.some(function(row){return row.index===state.findingIndex;})?'open data-evidence-filled="true"':'')+'><summary>'+group.rows.length+' individual '+(group.rows.length===1?'record':'records')+'</summary><div class="evidence-record-list">'+(group.rows.some(function(row){return row.index===state.findingIndex;})?evidenceRecordList(r,group):'')+'</div></details>';
}
function evidenceExplorer(r,context) {
  var groups=groupedEvidence(r),severities=Array.from(new Set((r.findings||[]).map(function(f){return String(f.severity||'unknown').toLowerCase();}))),count=evidenceRows(r).length;
  return '<section class="evidence-explorer" data-evidence-context="'+context+'"><div class="evidence-heading"><h3>Explore findings</h3><span>'+count+' '+(count===1?'record':'records')+' · '+groups.length+' '+(evidenceGrouping==='file'?'files':'concerns')+'</span></div>'+(recordedModeCounts(r)?'<p class="evidence-mode-counts">'+esc(recordedModeCounts(r))+'</p>':'')+'<div class="evidence-controls"><label>Group by <select data-evidence-grouping aria-label="Group findings by"><option value="concern" '+(evidenceGrouping==='concern'?'selected':'')+'>Concern</option><option value="file" '+(evidenceGrouping==='file'?'selected':'')+'>File</option></select></label><label>Severity <select data-evidence-severity aria-label="Finding severity"><option value="all">All severities</option>'+severities.map(function(severity){return '<option value="'+esc(severity)+'" '+(state.severity===severity?'selected':'')+'>'+esc(severity)+'</option>';}).join('')+'</select></label></div>'+originalAssessment(r)+groups.map(function(group,index){var first=group.rows[0].finding,title=evidenceGrouping==='file'?(first.path||'Location not supplied'):(first.ruleTitle||first.ruleId||first.code||first.message||first.text||'Finding text not supplied'),origins=Array.from(new Set(group.rows.map(function(row){return findingOrigin(r,row.finding);}))),locations=Array.from(new Set(group.rows.map(function(row){return findingLocation(row.finding);}))),levels=Array.from(new Set(group.rows.map(function(row){return row.finding.severity||'Unknown';}))),open=evidenceGroups[group.key]||group.rows.some(function(row){return row.index===state.findingIndex||row.index===evidenceOpenIndex;}),seen=new Set();return '<details class="evidence-group" data-evidence-key="'+esc(group.key)+'" data-evidence-first="'+group.rows[0].index+'" '+(open?'open':'')+'><summary><span class="evidence-group-title">'+esc(title)+'</span><span class="evidence-group-count">'+group.rows.length+' '+(group.rows.length===1?'record':'records')+'</span><span class="evidence-group-meta">'+esc(levels.join(' / '))+' · '+esc(origins.join(' / '))+'</span><span class="evidence-group-location">'+esc(locations.slice(0,2).join(' · '))+(locations.length>2?' · +'+(locations.length-2)+' locations':'')+'</span></summary><div class="evidence-group-body">'+(open?evidenceGroupBody(r,group):'')+'</div></details>';}).join('')+(!groups.length?'<div class="empty">'+((r.findings||[]).length?'No findings match this severity.':'This recorded assessment contains zero findings. Read its coverage and scope before drawing a conclusion.')+'</div>':'')+'</section>';
}
function originalAssessment(r) {
  return '<details class="original-assessment"><summary>Original assessment · producer label, score & raw assets</summary><dl><dt>Recorded producer label</dt><dd>'+esc(readable(r.verdict))+'</dd><dt>Recorded risk score</dt><dd>'+esc(readable(r.riskScore))+'</dd><dt>Exact item identity</dt><dd class="mono">'+esc(r.scanKey)+'</dd><dt>Coverage</dt><dd>'+esc(readable(r.coverage))+'</dd><dt>Verified during this local read</dt><dd>'+esc(r.verifiedAt)+'</dd><dt>Raw assets</dt><dd>'+link(r.summaryUrl,'Summary')+' · '+link(r.bundleUrl,'Signature bundle')+' '+(r.assets||[]).map(function(asset,index){return link(asset.url,'SARIF '+(index+1));}).join(' · ')+'</dd></dl><details><summary>Exact recorded summary</summary><pre>'+esc(JSON.stringify(r.summary,null,2))+'</pre></details><p>'+esc(r.scopeNote)+'</p><div class="inline-actions">'+button('catalog-load-evidence','Re-read evidence',false,false)+'</div></details>';
}
function scanView() {
  var r=record();if(!r)return '<section class="panel"><h2>Scan coverage</h2><p>'+catalog.coverage.indexed+' of '+records.length+' Catalog items have an indexed assessment. '+catalog.coverage.missing+' have no assessment for their exact identity.</p><p>Choose a Catalog item to read its coverage and concerns.</p>'+go('catalog','Browse Catalog items')+'</section>';
  var ready=['ready','unverified'].includes(r.status);
  return '<div class="source-header evidence-subject"><div><strong>'+esc(r.frameworkName)+' · '+esc(r.title)+'</strong><code>'+esc(r.id)+'</code></div>'+badge(ready?'RECORDED EVIDENCE':r.status==='missing'?'NO ASSESSMENT':r.status==='indexed'?'NOT LOADED':'UNREADABLE')+'</div>'+itemOrganizationReview(r)+'<div class="inline-actions">'+button('scan-return',state.scanReturn==='policy'?'Back to Policy':'Back to Catalog')+(!ready&&r.status!=='missing'?button('catalog-load-evidence','Load recorded assessment',false,false):'')+'</div>'+(ready?'<p class="evidence-verification">'+badge(r.verificationLabel,r.status==='ready'?'blue':'amber')+' · Coverage: '+esc(readable(r.coverage))+'</p>'+evidenceExplorer(r,'scan'):securityInspector(r,null))+(admin()?'<div class="inline-actions evidence-review-action">'+button('review-attach','Use this item in a policy review')+(finding()?.ruleId?button('review-concern','Review selected concern'):'')+'</div>':'')+'<details class="scan-description"><summary>About '+esc(r.title)+'</summary><p>'+esc(r.description)+'</p></details>';
}
function updateView() {
  var update=data.update;
  if(!update)return '<section class="panel"><h2>Recorded update</h2><p>No comparison is available.</p></section>';
  var installed=local().remote.inventory?.entries?.some(function(entry){return entry.framework==='superpowers'&&entry.localPlugin;});
  return '<section class="panel"><h2>Superpowers '+esc(framework.version)+' → '+esc(update.version)+'</h2><p>'+(
    installed?'Superpowers is installed in this project. Compare its installed revision with the revisions below before choosing an update.':
      'This recorded comparison covers two upstream revisions of Superpowers.')+'</p><p>'+link(update.compareUrl,'Read the upstream comparison')+' · '+link(update.releaseUrl,'Release notes')+'</p><p>'+esc(update.catalogStatus)+' · '+esc(update.scanStatus)+'</p>'+
    '<details><summary>'+esc((update.changedFiles||[]).length)+' changed files</summary><ul>'+(update.changedFiles||[]).map(function(f){return '<li>'+esc(f.status)+' · <code>'+esc(f.path)+'</code></li>';}).join('')+'</ul></details><div class="inline-actions">'+button('save-intent','Download planning intent',false,false)+button('return-superpowers-evidence','Open Superpowers evidence',false,false)+'</div></section>';
}
function securityInspector(r,f) {
  if(!r)return '<section><h3>Recorded evidence</h3><p>Select any Catalog item. Evidence is loaded only for its exact scan identity.</p></section>';
  if(!['ready','unverified'].includes(r.status))return '<section><h3>'+esc(r.status==='missing'?'No assessment available':r.status==='indexed'?'Recorded assessment not loaded':'Recorded assessment unreadable')+'</h3><p>'+esc(r.status==='missing'?'No assessment indexed for this exact item identity':r.reason||r.verificationLabel||(r.status==='indexed'?'An index entry exists; select the item or load its evidence to verify the retained assets.':'Recorded evidence could not be read.'))+'</p><code>'+esc(r.scanKey)+'</code><p>Missing or unreadable evidence is not a safety verdict and does not block Catalog planning.</p></section>';
  if(state.view==='scan')return '<section class="evidence-scope"><h3>Evidence scope</h3><code>'+esc(r.scanKey)+'</code><p>Coverage: '+esc(readable(r.coverage))+'</p><h3>Recorded detectors</h3>'+(r.summary?.tools||[]).map(function(tool){return '<p>'+esc(tool.tool)+' · '+esc(tool.mode==='ai'?'AI':tool.mode==='static'?'Static':tool.mode||'Mode not supplied')+(tool.ai?.model?' · '+esc(tool.ai.model):'')+'<small>'+esc(tool.result||'Result not supplied')+' · '+esc(tool.version||'Version not supplied')+'</small></p>';}).join('')+'<p>'+esc(r.scopeNote)+'</p></section>';
  return '<p class="evidence-verification">'+badge(r.verificationLabel,r.status==='ready'?'blue':'amber')+' · Coverage: '+esc(readable(r.coverage))+'</p>'+evidenceExplorer(r,'catalog')+'<div class="inline-actions">'+button('open-item-findings','Open in Scan')+'</div>';
}
function download(value,name) {
  var blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
function draftChanged() { state.policyDraftDirty=true;state.result=null;state.notice='Draft changed. The saved organization policy remains unchanged.'; }
function applyRemote(remote) {
  var c=state[remote.mode];if(clientCheckState(c.remote)!==clientCheckState(remote))c.clientCheck=null;c.remote=remote;c.policyStatusStale=false;
  if(!c.dirty){c.choices=JSON.parse(JSON.stringify(remote.draft.choices));c.text=remote.draft.text;c.prepared=remote.prepared;}
  else c.prepared=null;
  if(remote.mode==='enterprise') {
    var previous=state.published&&state.published.policy,policy=remote.organization;
    if(JSON.stringify(previous||null)!==JSON.stringify(policy||null)){c.check=null;profilePreview=null;state.planPreview=null;state.toolPreview=null;}
    if(policy){var entry=policy.entries.find(function(e){return e.id==='superpowers-framework'&&e.content?.framework==='superpowers';}),own=policy.entries.find(function(e){return e.id==='project-instructions'&&typeof e.change?.identity==='string';});state.published={policy:policy,obligation:entry?entry.obligation:'not specified',allowCustom:!!own&&own.obligation!=='prohibited'};
      if(!state.policyDraftDirty){state.allowedFrameworks=Array.isArray(policy.sources?.frameworks)?policy.sources.frameworks.slice():Object.entries(frameworkRules).filter(function(pair){return pair[1]!=='prohibited';}).map(function(pair){return pair[0];});state.policyPosture=Array.isArray(policy.sources?.frameworks)||policy.entries.some(function(e){return typeof e.content?.framework==='string'&&e.id==='workbench-only-framework-'+e.content.framework;})?'only-selected':'catalog-default';itemRules=Object.fromEntries(policy.entries.filter(function(e){return typeof e.content?.item==='string'&&e.id==='workbench-item-'+e.content.item;}).map(function(e){return [e.content.item,e.obligation];}));kindRules=Object.fromEntries(policy.entries.filter(function(e){return typeof e.content?.kind==='string'&&e.id==='workbench-kind-'+e.content.kind;}).map(function(e){return [e.content.kind,e.obligation];}));var rules=Object.fromEntries(policy.entries.filter(function(e){return typeof e.content?.framework==='string'&&e.id==='catalog-framework-'+e.content.framework;}).map(function(e){return [e.content.framework,e.obligation];}));if(JSON.stringify(frameworkRules)!==JSON.stringify(rules))state.result=null;frameworkRules=rules;var obligation=entry?entry.obligation:'permitted',allowCustom=!!own&&own.obligation!=='prohibited';if(state.policyId!==policy.id||state.obligation!==obligation||state.allowCustom!==allowCustom)state.result=null;state.policyId=policy.id;state.obligation=obligation;state.allowCustom=allowCustom;}
    }else state.published=null;
  }
  if(remote.outcome)c.outcome=remote.outcome;
}
async function refreshInstalledSession() {
  if(busy||state.view!=='installed'||state.mode!=='enterprise'||admin())return;
  var c=local(),prepared=c.prepared,digest=c.remote?.policyDigest,active=document.activeElement,focusId=active?.id,start=active?.selectionStart,end=active?.selectionEnd;
  busy=true;render();
  try {
    var response=await fetch('/api/session');if(!response.ok)throw Error('Current organization policy could not be refreshed.');
    session=await response.json();
    var remote=session.enterprise;
    applyRemote(remote);
    c.prepared=prepared&&!c.dirty&&digest===remote.policyDigest&&prepared.id===remote.prepared?.id&&prepared.context===remote.prepared?.context?prepared:null;
    if(prepared&&!c.prepared)state.notice='The prepared review or organization policy changed. Prepare the unit again before applying.';
  }catch(error){c.policyStatusStale=true;state.notice=error.message;}
  finally{busy=false;render();var target=focusId&&$(focusId);if(target){target.focus({preventScroll:true});if(typeof start==='number'&&target.setSelectionRange)target.setSelectionRange(start,end);}}
}

async function api(action,body,mode) {
  var response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':session.token},body:JSON.stringify(Object.assign({mode:mode||state.mode},body||{}))});
  var value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||value.code||'Request failed'),{code:value.code,status:response.status});return value;
}
async function saveDraft(c,mode) {
  var saved=await api('draft',{choices:c.choices,text:c.text},mode);
  c.dirty=false;applyRemote(saved);
}
async function runAction(action) {
  var c=local(),mode=state.mode;
  if(['install','check','inspect','report','review-repair'].includes(action)||action.startsWith('prepare')||action.startsWith('remove:'))c.clientCheck=null;
  if(action==='check-claude') {
    if(admin()||!hasInstalledConnectedPlugin(c.remote))return;
    c.clientCheck=null;
    var observed=await api('check-claude',{unit:connectedFramework(c.remote).unit},mode);applyRemote(observed);c.clientCheck=observed.clientCheck||null;
    state.revealResult='client-check-heading';state.notice='Claude Code check returned. Read its observed result and limits.';return;
  }
  if(action==='tools-configure') {
    state.toolPreview=null;state.toolError='';state.toolConfigured=true;
    try{state.toolPreview=await api('catalog-plan',{items:selectedTools().map(function(item){return item.id;}),client:state.toolClient});state.notice='Configuration preview returned. No tools were installed or run.';}
    catch(error){state.toolError=error.message;state.notice='Configuration preview could not be read. Try Configure again.';}
    state.revealResult='tool-settings-heading';return;
  }
  if(action.startsWith('tools-content:')) {
    var tool=toolItems().find(function(item){return item.id===action.slice(14);});if(!tool)return;
    state.view='catalog';state.frameworkFilter=tool.framework;state.kind='all';state.search='';state.page=0;selectItem(null);state.notice='Supporting Catalog content for '+tool.title+'. Tool configuration stays in Tools.';return;
  }
  if(action==='show-selected-item'&&record()){state.frameworkFilter='all';state.kind='all';state.search='';state.page=Math.floor(records.findIndex(function(item){return item.id===state.recordId;})/40);state.view='catalog';state.revealResult=null;return;}
  if(action==='open-item-findings'&&record()){state.scanReturn=state.reviewPicking||state.view==='policy'?'policy':'catalog';state.reviewPicking=false;state.view='scan';state.inspector='security';return;}
  if(action==='selection-close'){selectItem(null);state.notice='Item inspector closed. Items in your plan preview are retained.';return;}
  if(action.startsWith('profile-member-evidence:')){var memberId=action.slice(24);if(profileEvidenceMembers().some(function(item){return item.id===memberId;})){selectItem(memberId);state.view='scan';state.inspector='security';state.notice='Exact selected profile member. Return to Profiles for the retained bundle.';}return;}
  if(action==='profile-create'){createProfile();return;}
  if(action==='profile-copy-analyst'){var source=analystTemplate();if(source)createProfile(source);return;}
  if(action==='profile-edit'){if(localProfile(selectedProfile()))state.revealResult='profile-builder-heading';return;}
  if(action.startsWith('profile-item:')){
    var draft=selectedProfile(),id=action.slice(13);
    if(localProfile(draft)&&records.some(function(item){return item.id===id;})){draft.items=draft.items.includes(id)?draft.items.filter(function(value){return value!==id;}):draft.items.concat(id);profileEdited(draft);}
    return;
  }
  if(action==='profile-picker-clear'){profilePicker={search:'',framework:'all',kind:'all',page:0};return;}
  if(action==='profile-picker-prev'){profilePicker.page=Math.max(0,profilePicker.page-1);return;}
  if(action==='profile-picker-next'){profilePicker.page++;return;}
  if(action.startsWith('profile-select:')){var index=Number(action.slice(15));if(profiles[index]){profileIndex=index;profilePreview=null;state.notice='Profile selected. Preview its destinations and current policy result.';}return;}
  if(action==='profile-preview'){if(selectedProfile())await previewProfile(selectedProfile());return;}
  if(action==='profile-paste-import'){await importProfile(new Blob([profilePaste],{type:'application/json'}));return;}
  if(action==='profile-download'){var profile=selectedProfile();if(profile){if(!profileCanShare(profile))throw Error('Preview the current profile before sharing it.');if(profileBytes(profile)>65536)throw Error('The downloadable profile exceeds 64 KiB. Shorten its text before sharing.');downloadText(profileText(profile),profileFilename(profile),'application/json');}return;}
  if(action==='profile-example'){if(profileExample)download(profileExample,profileFilename(profileExample));state.notice='Another contributor’s profile downloaded. Use Import profile JSON to preview it through the same flow.';return;}
  if(action==='profile-copy-task'){if(selectedProfile()&&navigator.clipboard){await navigator.clipboard.writeText(String(selectedProfile().firstTask||''));state.notice='First task copied. Paste it in your client after setting up the content it needs.';}return;}
  if(action.startsWith('profile-file:')){var file=selectedProfile()?.files?.[Number(action.slice(13))];if(file)downloadText(file.text,String(file.path).split(/[\\/]/).pop()||'profile-instructions.txt');return;}
  if(action.startsWith('profile-evidence:')){var item=profilePreview?.items?.[Number(action.slice(17))];if(item&&records.some(function(r){return r.id===item.id;})){state.frameworkFilter='all';state.kind='all';state.search='';selectItem(item.id);state.view='scan';state.inspector='security';state.notice='Exact-item recorded evidence. Use Profiles to return to your bundle and preview.';}return;}
  if(action==='scan-prev'){state.findingPage=Math.max(0,state.findingPage-1);return;}
  if(action==='scan-next'){state.findingPage++;return;}
  if(action==='catalog-prev'){state.page=Math.max(0,state.page-1);clearOffPageSelection();return;}
  if(action==='catalog-next'){state.page++;clearOffPageSelection();return;}
  if(action.startsWith('catalog-add:')){var id=action.slice(12);if(toolItems().some(function(item){return item.id===id;})){state.view='tools';state.notice='Choose tools together, then Configure the selection.';return;}state.planItems=state.planItems.includes(id)?state.planItems.filter(function(item){return item!==id;}):state.planItems.concat(id);state.planPreview=null;return;}
  if(action==='catalog-clear-plan'){state.planItems=[];state.planPreview=null;return;}
  if(action==='catalog-prepare'){
    var selection=state.planPreview;
    if(!selection?.installable||admin())return;
    var remote=await api('catalog-prepare',{items:selection.selection,client:selection.client});
    c.dirty=false;applyRemote(remote);c.result=remote.outcome||null;
    if(!remote.prepared){state.notice=remote.outcome?.reason||'Installation could not be prepared.';return;}
    state.selectionHandoff=null;state.view='installed';state.revealReview=true;
    state.notice='Review the exact changes below before approving installation.';return;
  }
  if(action.startsWith('item-policy-check:')){var id=action.slice(18),value=await api('catalog-plan',{items:[id],client:state.catalogClient});state.itemPolicyPreview={key:JSON.stringify([id,state.catalogClient,c.remote.policyDigest]),value:value};return;}
  if(action==='catalog-results'){state.revealResult='catalog-results-heading';return;}
  if(action==='catalog-preview-toggle'){state.planCollapsed=!state.planCollapsed;return;}
  if(action==='catalog-plan'){state.planCollapsed=false;state.planPreview=await api('catalog-plan',{items:state.planItems,client:state.catalogClient});state.revealPlan=true;state.notice='Preview ready. Review the proposed changes below.';return;}
  if(action==='catalog-load-evidence'){await loadCatalogEvidence(record());return;}

  if(action==='switch-admin'||action==='switch-developer') {state.mode='enterprise';state.role=action==='switch-admin'?'admin':'developer';clearClientChecks();state.toolPreview=null;state.toolError='';state.view=action==='switch-admin'?'policy':'installed';state.recordId=null;state.inspector='details';return;}
  if(action==='generate'||action==='publish') {
    var result=await api(action==='generate'?'policy-preview':'policy',{id:state.policyId,obligation:state.obligation,allowCustom:state.allowCustom,frameworkRules:frameworkRules,itemRules:itemRules,kindRules:kindRules,posture:state.policyPosture,allowedFrameworks:state.allowedFrameworks||[],...(state.planItems.length?{selection:{items:state.planItems,client:state.catalogClient}}:{})},'enterprise');
    if(result.validation.status!=='ok'){state.result=null;throw Error((result.validation.problems||[]).map(function(problem){return [problem.path,problem.message||problem.reason].filter(Boolean).join(': ');}).join('; ')||result.validation.status);}
    if(action==='generate'){state.result={policy:result.policy,changes:result.changes,impact:result.impact,selectionImpact:result.selectionImpact};state.revealResult='policy-validation-heading';state.notice='Core validated this complete organization draft, including actual Project instructions permissions.';}
    else{state.policyDraftDirty=false;applyRemote(result);state.enterprise.prepared=null;state.enterprise.check=null;state.revealResult='policy-saved-heading';state.notice='Organization policy saved locally. Core will read these exact bytes at Prepare and Apply.';}
    return;
  }
  if(action==='download-policy'&&state.result){download(state.result.policy,state.result.policy.id+'.json');return;}
  if(action==='download-supplied'&&state.published){download(state.published.policy,state.published.policy.id+'.json');return;}
  if(action.startsWith('toggle-')){var item=action.slice(7);if(!['extensions','superpowers','instructions'].includes(item)||!ready()||!c.choices[item]&&unitProhibited(item))return;c.choices[item]=!c.choices[item];invalidate();state.notice='Selection changed. Prepare the exact unit before applying.';return;}
  if(action==='prepare'||action==='prepare-extensions'||action==='prepare-superpowers'||action==='prepare-instructions') {
    if(action==='prepare'&&['extensions','superpowers','instructions'].filter(function(unit){return c.choices[unit];}).length>1){state.view='installed';state.recordId=null;state.notice='Choices stay selected. Use the separate Review action for the exact unit you want to apply.';return;}
    await saveDraft(c,mode);var prepared=await api('prepare',action==='prepare'?{}:{unit:action.slice(8)},mode);applyRemote(prepared);c.outcome=prepared.outcome||null;state.revealReview=true;state.view='installed';state.recordId=null;state.notice=prepared.containment||prepared.outcome&&prepared.outcome.reason||'Core preparation finished. Review the exact effects and any admission reasons.';return;
  }
  if(action==='install'&&c.prepared){var p=c.prepared;c.prepared=null;c.check=null;
    try{var applied=await api('apply',{id:p.id,context:p.context,reviewDigest:p.result.review.reviewDigest},mode);applyRemote(applied);c.lastOperation={action:p.operation,units:reviewUnits(p)};var checkAvailable=p.operation!=='remove'&&c.lastOperation.units==='AIH Extensions'&&hasInstalledConnectedPlugin(c.remote);state.revealResult=checkAvailable?'client-check-heading':'latest-operation-heading';state.notice='Core returned the '+p.operation+' result. '+(checkAvailable?'Use Check in Claude Code for a client observation; file and admission checks are separate.':'Check installed files next.');}
    catch(error){c.prepared=null;error.message=error.status===409?'This approval is obsolete. Prepare the unit again before applying.':'Apply was not confirmed. Refresh actual state, inspect the outcome, and prepare again before retrying. '+error.message;throw error;}
    return;
  }
  if(action.startsWith('remove:')){await saveDraft(c,mode);applyRemote(await api('remove',{managementId:action.slice(7)},mode));state.revealReview=true;state.view='installed';state.notice='Core prepared removal. Review its exact retained/removed member effects before Apply.';return;}
  if(action==='check'){var checked=await api('check',{},mode);applyRemote(checked);c.check={check:checked.check,admission:checked.admission,checks:checked.checks,coverage:checked.coverage,readAt:new Date().toISOString()};state.revealResult='check-heading';state.notice=state.mode==='enterprise'?'Core checked the installed files and the current organization policy.':'Core checked the installed files.';return;}
  if(action==='inspect'||action==='report'||action==='review-repair'){var actual=await api(action==='review-repair'?'repair':action,{},mode);applyRemote(actual);if(action==='report'&&!state.explicitClient){var detected=detectedClients();if(detected.size===1){state.catalogClient=[...detected][0];state.planPreview=null;}}state.revealResult=action==='report'?'report-heading':action==='inspect'?'inspection-heading':'repair-heading';state.notice=actual.repairApply||'Actual offline Core results collected under the displayed dedicated execution home.';return;}
  if(action==='scan-return'){state.view=state.scanReturn==='policy'?'policy':'catalog';return;}
  if(action==='review-concern'&&admin()&&finding()){reviewDraft.itemId=record().id;reviewDraft.concern={tool:finding().tool,ruleId:finding().ruleId};state.view='policy';return;}
  if(action==='review-pick' && admin()) {
    state.reviewPicking=true;state.scanReturn='policy';state.view='catalog';state.notice='Select the item you reviewed, then open its findings to attach the evidence.';
    return;
  }
  if(action==='review-attach' && admin() && record()) {reviewDraft.itemId=record().id;reviewDraft.concern=null;state.view='policy';state.notice='Selected evidence for the review record.';return;}
  if(action==='review-detach') {reviewDraft.itemId='';reviewDraft.concern=null;return;}
  if(action==='review-save' && admin()) {
    const updated=await api('record-review',{...reviewDraft,digest:c.remote.policyDigest});
    applyRemote(updated);reviewDraft.note='';reviewDraft.itemId='';state.notice='Review recorded against the saved policy revision.';return;
  }
  if(action.startsWith('export-review:')) {
    const entry=(c.remote.reviews||[]).find(row=>row.id===action.slice(14));if(entry)download(entry,'policy-review-'+entry.id+'.json');return;
  }
  if(action==='download-report'){download({project:c.remote.project,inventory:c.remote.inventory,history:c.remote.history,report:c.remote.report,check:c.check},mode+'-core-results.json');return;}
  if(action==='clear'){state.frameworkFilter='all';state.kind='all';state.search='';state.severity='all';state.page=0;return;}
  if(action==='return-superpowers-evidence'){var item=records.find(function(r){return r.framework==='superpowers'&&r.id.includes('brainstorming');})||records.find(function(r){return r.framework==='superpowers';});if(item){selectItem(item.id);state.view='scan';state.inspector='security';}return;}
  if(action==='save-intent'){download({type:'non-executable-update-intent',current:{version:framework.version,commit:framework.commit},candidate:{version:data.update.version,commit:data.update.commit},notice:'Recorded source comparison only; no executable candidate plan.'},'superpowers-update-intent.json');state.intentSaved=true;}
}
async function loadCatalogEvidence(item) {
  if(!item||item.status==='missing')return;
  var wasBusy=busy;busy=true;state.notice='Loading and verifying exact recorded item evidence…';render();
  try{var evidence=await api('catalog-evidence',{itemId:item.id});if(evidence.id!==item.id||evidence.scanKey!==item.scanKey)throw Error('The returned evidence does not match the selected item identity.');Object.assign(item,evidence);state.notice='Recorded evidence read for '+item.title+'. Findings do not act as an installation gate.';}
  catch(error){item.status='unreadable';item.reason=error.message;item.findings=[];if(state.recordId===item.id){state.findingIndex=null;state.findingPage=0;state.severity='all';}throw error;}
  finally{busy=wasBusy;}
}
document.addEventListener('click',async function(event) {
  var b=event.target.closest('button');if(!b||b.disabled||busy)return;
  var previousView=state.view,previousMode=state.mode,previousRole=state.role,selector=b.id?'#'+b.id:null;
  for(var attr of ['mode','role','view','inspect','kind','record','action','framework'])if(b.dataset[attr])selector='[data-'+attr+'="'+b.dataset[attr]+'"]';
  if(b.dataset.mode&&['enterprise','vibe'].includes(b.dataset.mode)) {state.mode=b.dataset.mode;clearClientChecks();state.planPreview=null;state.toolPreview=null;profilePreview=null;state.notice='';}
  else if(b.dataset.role&&['admin','developer'].includes(b.dataset.role)&&state.mode==='enterprise') {state.role=b.dataset.role;clearClientChecks();profilePreview=null;state.toolPreview=null;state.toolError='';state.notice='';}
  else if(b.dataset.view&&['catalog','tools','profiles','core','scan','policy','installed','reports','repair','update'].includes(b.dataset.view)) {state.view=b.dataset.view;state.notice='';if(state.view==='scan'){if(['catalog','policy'].includes(previousView))state.scanReturn=previousView;state.inspector='security';}if(state.view==='catalog')clearOffPageSelection();if(state.view==='installed'&&['catalog','profiles'].includes(previousView)){state.selectionHandoff={view:previousView,title:previousView==='profiles'?selectedProfile()?.title:record()?itemTitle(record().id):state.planItems.map(itemTitle).join(', ')};}}
  else if(b.dataset.inspect)state.inspector=b.dataset.inspect;
  else if(b.dataset.framework){state.frameworkFilter=b.dataset.framework;state.page=0;selectItem(null);state.view='catalog';state.notice='Catalog framework filter changed; search and kind filters remain visible.';}
  else if(b.dataset.kind) {state.page=0;state.kind=state.kind===b.dataset.kind?'all':b.dataset.kind;clearOffPageSelection();if(!['catalog','scan'].includes(state.view))state.view='catalog';}
  else if(b.dataset.finding!=null) {state.recordId=b.dataset.recordId;state.findingIndex=Number(b.dataset.finding);state.inspector='security';selector='[data-finding="'+b.dataset.finding+'"][data-record-id="'+b.dataset.recordId+'"]';}
  else if(b.dataset.record) {selectItem(b.dataset.record);state.findingIndex=null;state.findingPage=0;state.expandedFindings=false;}
  else if(b.id==='reset') {clearClientChecks();busy=true;render();try{session=await fetch('/api/session').then(function(r){if(!r.ok)throw Error('State refresh failed');return r.json();});applyRemote(session.enterprise);applyRemote(session.vibe);state.notice='Actual Core state refreshed. Local draft edits, files and saved organization policy retained.';}catch(error){state.notice=error.message;}finally{busy=false;}}
  else if(b.id==='theme') {var dark=document.documentElement.classList.toggle('dark');document.documentElement.classList.toggle('light',!dark);b.textContent=dark?'Light':'Dark';b.setAttribute('aria-label','Switch to '+(dark?'light':'dark')+' theme');}
  else if(b.dataset.action){busy=true;render();try{await runAction(b.dataset.action);}catch(error){state.notice=error.message;}finally{busy=false;}}
  try{if(record()&&(b.dataset.record||state.view==='scan')&&record().status==='indexed')await loadCatalogEvidence(record());}catch(error){state.notice=error.message;}
  var historyChanged=pendingHistory;
  if(pendingHistory){pendingHistory=false;readNavigation();try{if(record()?.status==='indexed')await loadCatalogEvidence(record());}catch(error){state.notice=error.message;}}
  if(state.view==='installed'&&(b.dataset.view==='installed'||previousView!==state.view||previousMode!==state.mode||previousRole!==state.role||historyChanged))await refreshInstalledSession();
  render();writeNavigation(historyChanged);
  if(previousView!==state.view){
    $('work-pane').scrollTop=0;
    $('selection-pane').scrollTop=0;
    focusCurrentPage();
  }else{
    var target=selector?visibleTarget(selector):null;(target||$('page-title')).focus({preventScroll:true});
  }
  if(state.revealReview){var heading=$('review-heading');if(heading)revealNode(heading);state.revealReview=false;}
  if(state.revealResult){revealResult(state.revealResult);state.revealResult=null;}
  if(state.revealPlan){var planHeading=$('plan-preview-heading');if(planHeading)revealNode(planHeading);state.revealPlan=false;}
  if(b.dataset.record&&window.matchMedia&&window.matchMedia('(max-width:820px)').matches){var inline=$('inline-selection');if(inline)revealNode(inline);}
});
// Keep the active filter mounted so typing, composition and native Undo keep working.
function refreshFilterResults(toolbar, markup) {
  var template=document.createElement('template');
  template.innerHTML=markup;
  var current=document.querySelector(toolbar);
  var next=template.content.querySelector(toolbar);
  while(current.nextElementSibling)current.nextElementSibling.remove();
  while(next.nextElementSibling)current.parentElement.appendChild(next.nextElementSibling);
}
document.addEventListener('input',function(event) {
  if(busy)return;
  var t=event.target;
  if(t.id?.startsWith('review-') && Object.hasOwn(reviewDraft,t.id.slice(7))){reviewDraft[t.id.slice(7)]=t.value;return;}
  if(t.dataset?.profileField&&localProfile(selectedProfile())){
    var profile=selectedProfile(),field=t.dataset.profileField;
    if(field==='agents'){
      var file=profileInstructions(profile);
      if(!t.value.trim()){if(file)profile.files.splice(profile.files.indexOf(file),1);}
      else if(file)file.text=t.value;
      else profile.files.unshift({path:'AGENTS.md',text:t.value});
    }else if(['title','role','outcome','author','firstTask'].includes(field))profile[field]=t.value;
    else return;
    profileEdited(profile);updateProfileDraftControls(profile);return;
  }
  if(t.id==='profile-picker-search'){
    profilePicker.search=t.value;profilePicker.page=0;
    refreshFilterResults('.profile-picker-filters',profileCatalogPicker(selectedProfile()));return;
  }
  if(t.id==='profile-paste'){profilePaste=t.value;return;}
  if(t.id==='search'){
    state.search=t.value;state.page=0;clearOffPageSelection();writeNavigation(true);
    refreshFilterResults('.catalog-controls',catalogView());
    $('inspector-content').innerHTML=inspectorView();
    return;
  }
  if(t.id==='policy-id'&&admin()) {
    state.policyId=t.value;draftChanged();
    $('policy-validation-heading')?.closest('.panel')?.remove();
    profileLiveText(t.closest('.panel')?.querySelector('.badge'),'UNSAVED DRAFT');
    profileLiveText($('journey').querySelector('.badge'),'Draft not validated');
  } else if(t.id==='instructions-text'&&!admin()&&ready()&&local().choices.instructions) {
    local().text=t.value;invalidate();state.notice='Configuration changed locally. Prepare again before applying.';
    document.querySelector('.review-panel')?.remove();
    $('inspector-content').innerHTML=inspectorView();
    $('footer-state').textContent=$('footer-state').textContent.replace(/ · review [^·]+$/, ' · no prepared change');
  } else return;
  $('notice').textContent=state.notice;
});
document.addEventListener('change',function(event) {
  if(busy)return;
  var t=event.target;
  if(t.dataset?.toolChoice){var id=t.dataset.toolChoice;if(!toolItems().some(function(item){return item.id===id;}))return;state.toolItems=t.checked?Array.from(new Set(state.toolItems.concat(id))):state.toolItems.filter(function(value){return value!==id;});state.toolConfigured=false;state.toolPreview=null;state.toolError='';render();$(t.id)?.focus();return;}
  if(t.id==='tools-client'){state.toolClient=t.value;state.toolPreview=null;state.toolConfigured=false;state.toolError='';render();writeNavigation(false);$(t.id)?.focus();return;}

  if(t.dataset?.evidenceGrouping!=null||t.dataset?.evidenceSeverity!=null){
    var context=t.closest('[data-evidence-context]').dataset.evidenceContext,attr=t.dataset?.evidenceGrouping!=null?'data-evidence-grouping':'data-evidence-severity';
    var scrolls=Array.from(document.querySelectorAll('#work-pane,#selection-pane,.inline-inspector-body')).map(function(node){return {id:node.id,inline:node.classList.contains('inline-inspector-body'),top:node.scrollTop};});
    if(attr==='data-evidence-grouping'){evidenceGrouping=t.value;evidenceGroups={};}
    else {state.severity=t.value;state.findingIndex=null;evidenceOpenIndex=null;evidenceGroups={};}
    render();writeNavigation(false);
    scrolls.forEach(function(saved){var node=saved.inline?document.querySelector('.inline-inspector-body'):$(saved.id);if(node)node.scrollTop=saved.top;});
    visibleTarget('[data-evidence-context="'+context+'"] ['+attr+']')?.focus({preventScroll:true});return;
  }
  if(t.dataset?.profileField&&localProfile(selectedProfile())){refreshProfileArtifacts(selectedProfile());return;}
  if(t.dataset?.frameworkAllow&&admin()){var id=t.dataset.frameworkAllow;state.allowedFrameworks=(state.allowedFrameworks||[]).filter(function(value){return value!==id;});if(t.checked)state.allowedFrameworks.push(id);draftChanged();render();return;}
  if(t.id==='policy-posture'&&admin()){if(t.value==='only-selected'&&state.policyPosture!=='only-selected')state.allowedFrameworks=Object.entries({...frameworkRules,superpowers:state.obligation}).filter(function(pair){return pair[1]!=='prohibited';}).map(function(pair){return pair[0];});state.policyPosture=t.value;draftChanged();render();$('policy-posture').focus();return;}
  if(t.id==='policy-item'&&admin()){state.policyItemId=t.value;render();$('policy-item').focus();return;}
  if((t.dataset?.itemRule||t.dataset?.kindRule)&&admin()){var rules=t.dataset.itemRule?itemRules:kindRules,key=t.dataset.itemRule||t.dataset.kindRule;if(t.value)rules[key]=t.value;else delete rules[key];draftChanged();render();return;}
  if(t.dataset?.frameworkRule&&admin()){
    if(t.value)frameworkRules[t.dataset.frameworkRule]=t.value;else delete frameworkRules[t.dataset.frameworkRule];
    draftChanged();render();if(t.dataset.frameworkRule!=='extensions')$(toolFrameworkIds().has(t.dataset.frameworkRule)?'tool-policy':'framework-policy').open=true;$(t.id).focus();return;
  }
  if(t.id==='review-decision'){reviewDraft.decision=t.value;return;}
  if(t.id==='profile-import'){importProfile(t.files&&t.files[0]);return;}
  if(t.id==='profile-picker-framework'){profilePicker.framework=t.value;profilePicker.page=0;}
  else if(t.id==='profile-picker-kind'){profilePicker.kind=t.value;profilePicker.page=0;}
  else if(t.id==='profile-client'){state.explicitClient=true;state.catalogClient=t.value;state.planPreview=null;profilePreview=null;}
  else if(t.id==='framework-filter'){state.frameworkFilter=t.value;state.page=0;selectItem(null);}
  else if(t.id==='kind-filter'){state.kind=t.value;state.page=0;clearOffPageSelection();}
  else if(t.id==='catalog-client'){state.explicitClient=true;state.catalogClient=t.value;state.planPreview=null;profilePreview=null;}
  else if(t.id==='severity'){state.severity=t.value;state.findingPage=0;state.findingIndex=null;}
  else if(t.id==='obligation'&&admin()) {state.obligation=t.value;draftChanged();}
  else if(t.id==='allow-custom'&&admin()) {state.allowCustom=t.checked;draftChanged();}
  else return;
  render();writeNavigation(false);$(t.id).focus();
});
document.addEventListener('keydown',function(event){
  if(busy||!event.target.dataset?.inspect)return;
  var tabs=['details','security','policy'],index=tabs.indexOf(event.target.dataset.inspect),next;
  if(event.key==='ArrowRight')next=(index+1)%tabs.length;
  else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=tabs.length-1;
  else return;
  event.preventDefault();state.inspector=tabs[next];render();writeNavigation(false);
  visibleTarget('[data-inspect="'+state.inspector+'"]')?.focus();
});
if(window.addEventListener)window.addEventListener('popstate',async function(){
  if(busy){pendingHistory=true;return;}
  readNavigation();
  await refreshInstalledSession();
  try{if(record()?.status==='indexed')await loadCatalogEvidence(record());}catch(error){state.notice=error.message;}
  render();
  var selected=state.findingIndex!=null?visibleTarget('[data-evidence-index="'+state.findingIndex+'"]'):evidenceOpenIndex!=null?visibleTarget('[data-evidence-first="'+evidenceOpenIndex+'"] summary'):null;
  if(selected)selected.closest('.evidence-group')?.querySelector('summary')?.focus({preventScroll:true});else focusCurrentPage();
});
if(window.addEventListener)window.addEventListener('focus',function(){if(document.visibilityState!=='hidden')refreshInstalledSession();});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')refreshInstalledSession();});
document.addEventListener('toggle',function(event){
  var node=event.target;if(!node.isConnected)return;
  if(node.classList.contains('evidence-group')){
    var group=record()&&groupedEvidence(record()).find(function(group){return group.key===node.dataset.evidenceKey;});if(!group)return;
    if(node.open){var body=node.querySelector('.evidence-group-body');if(body&&!body.childElementCount)body.innerHTML=evidenceGroupBody(record(),group);var alreadyOpen=evidenceGroups[group.key];evidenceGroups[group.key]=true;if(alreadyOpen||group.rows.some(function(row){return row.index===state.findingIndex||row.index===evidenceOpenIndex;}))return;evidenceOpenIndex=group.rows[0].index;}
    else {var body=node.querySelector('.evidence-group-body');if(body)body.innerHTML='';delete evidenceGroups[group.key];if(group.rows.some(function(row){return row.index===state.findingIndex;}))state.findingIndex=null;if(group.rows.some(function(row){return row.index===evidenceOpenIndex;}))evidenceOpenIndex=null;}
    document.querySelectorAll('[data-evidence-index]').forEach(function(record){record.classList.toggle('selected',Number(record.dataset.evidenceIndex)===state.findingIndex);});
    writeNavigation(false);
  }
  if(node.classList.contains('individual-records')){
    var group=record()&&groupedEvidence(record()).find(function(group){return group.key===node.dataset.evidenceRecords;});
    var list=node.querySelector('.evidence-record-list');
    if(group&&list){if(node.open&&!node.dataset.evidenceFilled){list.innerHTML=evidenceRecordList(record(),group);node.dataset.evidenceFilled='true';}else if(!node.open){list.innerHTML='';delete node.dataset.evidenceFilled;}}
  }
  if(node.id==='more-findings')state.expandedFindings=node.open;if(node.id==='profile-import-tools')profileImportOpen=node.open;
},true);
document.querySelectorAll('[data-startup-disabled]').forEach(function(control){control.disabled=false;control.removeAttribute('data-startup-disabled');});
if(document.body)document.body.setAttribute('aria-busy','false');
readNavigation();
try{if(record()?.status==='indexed')await loadCatalogEvidence(record());}catch(error){state.notice=error.message;}
render();writeNavigation(true);
})().catch(function(error){document.getElementById('connection-state').textContent='Local host unavailable';document.getElementById('notice').textContent='Local functionality could not connect: '+error.message;var retry=document.getElementById('reset');retry.disabled=false;retry.textContent='Retry connection';if(retry.addEventListener)retry.addEventListener('click',function(){window.location.reload();});document.getElementById('main-content').innerHTML='<div class="callout"><b>Start the functional local host</b><p>The page needs its loopback Node host and pinned public package consumer. No installation or repair has run.</p></div>';});
