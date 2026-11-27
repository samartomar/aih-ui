import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { createLocalCatalog } from './workbench/local-catalog.mjs';
import { createEnterprisePolicy } from './server/enterprise-core-policy.mjs';
import { createEnterpriseExecution } from './server/enterprise-core-execution.mjs';

const [consumerArg, fixture] = process.argv.slice(2);
if (!consumerArg) throw Error('Pass a prepared consumer with public Core and Catalog installed and its pinned source cache.');
const consumer = resolve(consumerArg);
if (!fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'aih-workbench-enterprise-check-'));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), consumer, directory], {
      env:{...process.env,...homeEnvironment(join(directory,'home'))}, stdio:'inherit',
    });
    process.exitCode = result.status ?? 1;
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
} else {
  if (process.env.HOME !== join(fixture, 'home') || process.env.USERPROFILE !== join(fixture, 'home')) {
    throw Error('The check must run in the disposable home it creates. Pass only the prepared consumer path.');
  }
  await checkEnterpriseHandoff(fixture);
}

async function checkEnterpriseHandoff(dir) {
  const project = join(dir,'project');
  await mkdir(project);
  const home = join(dir, 'home');
  const initialHome = await readdir(home, {recursive:true});
  async function assertNoWrites() {
    assert.deepEqual(await readdir(project), []);
    assert.deepEqual(await readdir(home, {recursive:true}), initialHome);
  }
  const parts = await createLocalCatalog(consumer);
  const catalog = async () => parts;
  const framework = parts.catalog.frameworks.find(f => f.id === 'superpowers');
  const skill = 'superpowers.skill.brainstorming', blockedSkill = 'superpowers.skill.writing-plans';
  const frameworks = parts.catalog.frameworks.map(({id,sha256,...bits}) => ({...bits,frameworkId:id,id:sha256,sha256}));
  const items = parts.catalog.items.map(item => {
    const framework = frameworks.find(f => f.frameworkId === item.framework);
    return {...item,id:framework.sha256 + '/' + item.id,itemId:item.id,framework:framework.sha256};
  });
  const allowed = items.find(item => item.itemId === skill), blocked = items.find(item => item.itemId === blockedSkill);
  const versions = {core:'0.0.0-dev.1',catalog:'0.0.0-dev.1',scan:'0.0.0-dev.1'};
  const summary = {packages:Object.entries(versions).map(([name,version])=>({name,version}))};
  const policy = createEnterprisePolicy({consumer,summary,catalog,published:{items,frameworks}});
  const teamFiles = [{name:'team-notes.md',text:'# Review repository support notes\n',allowUpdates:false},
    {name:'team-faq.md',text:'# Team FAQ\n',allowUpdates:true}];
  const choices = {format:'aih-workbench-team-selection/1',organization:'Fixture Org',source:'',
    versions,clients:['claude-code'],items:[allowed.id],files:teamFiles,allowPersonal:true};
  const revision = {repository:'controlled/organization',baseBranch:'main',path:'policy.json',commitSha:'a'.repeat(40),blobSha:'b'.repeat(40)};
  // The managed source here is a controlled read seam. GitHub transport has its own tests.
  let managed;
  async function install(document, commitSha = revision.commitSha) {
    managed = {status:'ready',content:document,text:JSON.stringify(document)+'\n',
      source:{...revision,commitSha},selection:await policy.openPolicy(document)};
  }
  // Two frameworks may legitimately reuse an item ID. The second framework
  // is in scope, but only its independently selected item is permitted.
  const another = parts.catalog.frameworks.find(entry => entry.id !== framework.id &&
    parts.catalog.items.some(item => item.framework === entry.id));
  assert.ok(another);
  const otherSelection = items.find(item => item.framework === another.sha256);
  const duplicate = {...parts.catalog.items.find(item => item.id === skill), framework:another.id};
  const duplicateSource = {...parts, catalog:{...parts.catalog, items:[...parts.catalog.items, duplicate]}};
  const qualified = createEnterprisePolicy({consumer,summary,catalog:async () => duplicateSource,
    published:{frameworks, items:[...items, {...allowed, framework:another.sha256, id:another.sha256 + '/' + skill}]}});
  const distinct = await qualified.buildPolicy({...choices, items:[allowed.id,otherSelection.id]});
  assert.ok(distinct.content.entries.some(entry => entry.content?.item === skill &&
    entry.content.framework === another.id && entry.obligation === 'prohibited'));
  const output = await policy.buildPolicy(choices);
  // Earlier saved selections carried a typed owner; it still builds the same Core document.
  assert.deepEqual((await policy.buildPolicy({...choices, owner:'Fixture Steward'})).content, output.content);
  assert.equal(Object.hasOwn(output.selection, 'owner'), false);
  // A permitted Tool Setup recipe reaches members with its companion MCP item admitted
  // but not listed. An unselected recipe stays unavailable.
  const recipes = items.filter(item => item.kind === 'ai-setup');
  const [permittedRecipe, ...otherRecipes] = recipes;
  assert.ok(permittedRecipe?.setup?.mcpItem && otherRecipes.length);
  const recipePolicy = await policy.buildPolicy({...choices, clients:['claude-code','codex'], items:[permittedRecipe.id], files:[], allowPersonal:false});
  const recipeSelection = await policy.openPolicy(recipePolicy.content);
  assert.deepEqual(recipeSelection.items, [permittedRecipe.id], JSON.stringify(recipeSelection));
  assert.deepEqual(recipeSelection.itemClients[permittedRecipe.id], ['claude-code','codex']);
  for (const other of otherRecipes) assert.ok(!recipeSelection.items.includes(other.id));
  const withoutCompanion = {...recipePolicy.content, entries:recipePolicy.content.entries.map(entry =>
    entry.content?.item === permittedRecipe.setup.mcpItem && entry.obligation === 'permitted' ? {...entry, obligation:'prohibited'} : entry)};
  assert.deepEqual((await policy.openPolicy(withoutCompanion)).items, []);
  // A member host whose own platform is unqualified still receives a recipe the policy
  // permits when Catalog qualifies it on another platform; Core admits that plan.
  const qualifiedOn = item => new Set(item.setup.qualifications.filter(record => record.status === 'qualified').map(record => record.platform));
  const unqualifiedCell = ['windows-x64','darwin-arm64','linux-arm64','linux-x64'].find(cell => !qualifiedOn(permittedRecipe).has(cell));
  assert.ok(unqualifiedCell && qualifiedOn(permittedRecipe).size, 'The pinned recipe needs qualified and unqualified platforms.');
  const otherHost = {...parts, prepareSelection:(selected, client, cell = unqualifiedCell) => parts.prepareSelection(selected, client, cell)};
  assert.equal(otherHost.prepareSelection([permittedRecipe], 'claude-code').requestParts, null);
  const otherHostPolicy = createEnterprisePolicy({consumer,summary,catalog:async () => otherHost,published:{items,frameworks}});
  const otherHostSelection = await otherHostPolicy.openPolicy(recipePolicy.content);
  assert.deepEqual(otherHostSelection.items, [permittedRecipe.id], JSON.stringify(otherHostSelection));
  assert.deepEqual(otherHostSelection.itemClients[permittedRecipe.id], ['claude-code','codex']);
  assert.deepEqual((await otherHostPolicy.openPolicy(withoutCompanion)).items, []);
  const unqualified = {...otherHost, catalog:{...parts.catalog, items:parts.catalog.items.map(item => item.id === permittedRecipe.itemId ?
    {...item, setup:{...item.setup, qualifications:item.setup.qualifications.filter(record => record.status !== 'qualified')}} : item)}};
  const noQualified = createEnterprisePolicy({consumer,summary,catalog:async () => unqualified,published:{items,frameworks}});
  assert.deepEqual((await noQualified.openPolicy(recipePolicy.content)).items, [], 'A recipe without a qualified platform is not offered.');
  assert.equal(output.content.schema,'urn:aihq:core:organization:0.1.0');
  await install(output.content);
  assert.deepEqual(managed.selection.items,[allowed.id]);
  assert.deepEqual(managed.selection.clients,['claude-code']);
  assert.deepEqual(managed.selection.files,teamFiles.map(file => ({...file,clients:['claude-code']})));
  assert.deepEqual(managed.selection.catalogPin, {repository:parts.catalog.data.repository,commit:parts.catalog.data.commit});
  assert.deepEqual(managed.selection.itemClients, {[allowed.id]:['claude-code']});
  assert.deepEqual(managed.selection.personalClients,['claude-code']);
  assert.equal(Object.hasOwn(managed.selection, 'owner'),false);
  assert.equal(Object.hasOwn(managed.selection, 'versions'),false);
  const exception = {...output.content,entries:[...output.content.entries,{
    id:'override-with-prohibition',obligation:'prohibited',scopes:['project'],clients:['claude-code'],
    content:{item:skill,framework:'superpowers'},
  }]};
  assert.deepEqual((await policy.openPolicy(exception)).items,[]);
  assert.equal(managed.selection.allowPersonal,true);
  const native = createEnterpriseExecution({consumer,sourceConsumer:consumer,catalog,project,readPolicy:async()=>structuredClone(managed)});
  try {
    const input = {client:'claude-code',files:[],items:[allowed],binding:project,source:revision,session:'worker-approval'};
    const approve = result => native.apply({id:result.id,reviewDigest:result.review.reviewDigest,session:input.session,confirmed:true});
    const blockedPolicy = await policy.buildPolicy({...choices,allowPersonal:false});
    await install(blockedPolicy.content);
    const deniedPersonal = await native.prepare({...input,items:[],files:[{name:'my-notes.md',text:'# Do not write this'}]});
    assert.equal(deniedPersonal.status,'blocked',JSON.stringify(deniedPersonal));
    assert.equal(deniedPersonal.code,'AUTHORITY_DENIED');
    assert.equal(deniedPersonal.id,undefined);
    await assertNoWrites();
    await install(output.content);
    const mismatchedSource = await native.prepare({...input,source:{...revision,blobSha:'0'.repeat(40)}});
    assert.equal(mismatchedSource.status, 'rejected');
    await assertNoWrites();
    const mixed = await native.prepare({...input,items:[allowed,blocked]});
    assert.equal(mixed.status,'blocked',JSON.stringify(mixed));
    assert.equal(mixed.code,'AUTHORITY_DENIED');
    assert.equal(mixed.id,undefined);
    assert.equal(mixed.review.organization.admitted,false);
    await assertNoWrites();
    const wrongCLI = await native.prepare({...input,client:'codex'});
    assert.equal(wrongCLI.code,'AUTHORITY_DENIED',JSON.stringify(wrongCLI));
    await assertNoWrites();
    const staleReview = await native.prepare(input);
    assert.equal(staleReview.status,'ready',JSON.stringify(staleReview));
    await assertNoWrites();
    await install(output.content,'c'.repeat(40));
    const stale = await approve(staleReview);
    assert.equal(stale.status,'rejected');
    assert.equal(stale.diagnostics[0].code,'REVIEW_STALE');
    await assertNoWrites();
    await install(output.content);
    const prepared = await native.prepare(input);
    assert.equal(prepared.status,'ready',JSON.stringify(prepared));
    assert.equal((await native.apply({id:prepared.id,reviewDigest:prepared.review.reviewDigest,session:'different-session',confirmed:true})).status, 'unavailable');
    await assertNoWrites();
    const applied = await approve(prepared);
    assert.equal(applied.status,'applied',JSON.stringify(applied));
    assert.equal(applied.fileState,'match');
    assert.ok((await readFile(join(project,'.claude','skills','brainstorming','SKILL.md'),'utf8')).includes('brainstorming'));
    const personal = await native.prepare({...input,items:[],files:[{name:'my-notes.md',text:'# Personal project notes'}]});
    assert.equal(personal.status,'ready',JSON.stringify(personal));
    const personalApply = await approve(personal);
    assert.equal(personalApply.status,'applied',JSON.stringify(personalApply));
    assert.equal(await readFile(join(project,'workbench-personal','my-notes.md'),'utf8'),'# Personal project notes');
    const team = await native.prepare({...input,items:[],organizationFiles:true});
    assert.equal(team.status,'ready',JSON.stringify(team));
    assert.equal((await approve(team)).status,'applied');
    for (const file of teamFiles) assert.equal(await readFile(join(project,'workbench-organization',file.name),'utf8'),file.text);
    const present = await native.impact();
    assert.equal(present.status,'ready',JSON.stringify(present));
    assert.equal(present.entries.find(e=>e.itemId===skill)?.status,'allowed',JSON.stringify(present));
    const tightened = await policy.buildPolicy({...choices,items:[blocked.id]});
    await install(tightened.content,'d'.repeat(40));
    const changed = await native.impact();
    assert.equal(changed.entries.find(e=>e.itemId===skill)?.status,'denied',JSON.stringify(changed));
    assert.ok((await readdir(join(project,'.claude','skills'))).includes('brainstorming'));
    console.log(JSON.stringify({catalog:skill,recipe:permittedRecipe.itemId,otherHostCell:unqualifiedCell,fileState:applied.fileState,mixed:mixed.code,wrongCLI:wrongCLI.code,
    deniedPersonal:deniedPersonal.code,stale:stale.diagnostics[0],personal:personalApply.status,orgFiles:teamFiles.map(f=>f.name),
      installedImpact:changed.entries.find(e=>e.itemId===skill)?.status}));
  } finally {
    await native.close();
  }
}
