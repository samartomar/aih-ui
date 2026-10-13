import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../page/intent.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
function documentFixture() {
  const nodes = new Map();
  const node = () => ({ value: '', textContent: '', disabled: false, children: [], append(...values) { this.children.push(...values); }, replaceChildren() { this.children = []; }, setAttribute() {} });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node };
  document.getElementById('inventory').value = 'journey'; document.getElementById('mode').value = 'vibe';
  return { document, nodes };
}
const data = (count = 0) => ({ items: Array.from({length:count}, (_,i) => ({label:`Item${i}`,id:`item${i}`,releaseSha256:'release',package:{name:'example'},root:{},dependencies:{requires:[],optional:[]}})), templates: [] });
const draft = (text = 'empty') => ({ valid:true,policyText:text,policy:{mode:'vibe',selections:[]},intent:{origins:[],roots:[],exclusions:[]} });
const deferred = () => { let resolve; const promise = new Promise(deliver => { resolve = deliver; }); return {promise,resolve}; };

test('older inventory response cannot overwrite newer inventory', async () => {
  const {document,nodes} = documentFixture(), delay = deferred();
  const fetch = async url => ({ json: async () => url.includes('inventory=six') ? delay.promise : url.startsWith('/api/intent-catalog') ? data(url.includes('seven') ? 7 : 0) : draft() });
  await new AsyncFunction('document','fetch', source)(document,fetch);
  nodes.get('inventory').value='six'; const pending=nodes.get('new').onclick();
  nodes.get('inventory').value='seven'; await nodes.get('new').onclick();
  delay.resolve(data(6)); await pending;
  assert.match(nodes.get('count').textContent,/7 total/);
});

test('accept pending catalog fetch cannot replace a newer mode or policy edit', async () => {
  const {document,nodes} = documentFixture(), delay=deferred(); let accepting=false;
  const catalog={...data(),templates:[{id:'starter',sha256:'a'.repeat(64)}]};
  const fetch=async url => ({json:async()=>url.startsWith('/api/intent-catalog') ? accepting ? delay.promise : catalog : url==='/api/intent-edit' ? draft('candidate') : draft('original')});
  await new AsyncFunction('document','fetch',source)(document,fetch);
  await nodes.get('templates').children[0].onclick();
  accepting=true; const pending=nodes.get('accept').onclick();
  nodes.get('policy').value='newer policy'; nodes.get('policy').oninput();
  nodes.get('mode').value='enterprise'; nodes.get('mode').onchange();
  delay.resolve(catalog); await pending;
  assert.equal(nodes.get('policy').value,'newer policy'); assert.equal(nodes.get('mode').value,'enterprise');
});

test('network failures are visible and cannot leave an accept candidate', async () => {
  const {document,nodes}=documentFixture(); let fail=false;
  const fetch=async url=>{if(fail)throw new Error('network unavailable'); return {json:async()=>url.startsWith('/api/intent-catalog')?data():draft()};};
  await new AsyncFunction('document','fetch',source)(document,fetch);
  fail=true; await nodes.get('reopen').onclick();
  assert.match(nodes.get('proposal').textContent,/network unavailable/); assert.equal(nodes.get('accept').disabled,true);
  nodes.get('scan').files=[{size:10,arrayBuffer:async()=>{throw new Error('file read unavailable');}}];
  await nodes.get('scan').onchange(); assert.equal(nodes.get('scan-result').textContent,'file read unavailable');
});

test('rendered choose/remove and skip/clear buttons send exact item keys', async () => {
  const {document,nodes}=documentFixture(), operations=[];
  const root={releaseSha256:'a'.repeat(64),itemId:'example.root',itemSha256:'b'.repeat(64),scope:'project',configuration:{},originIds:['direct']};
  const item={id:root.itemId,label:'Example',root,package:{name:'example'},dependencies:{requires:[],optional:[]}};
  const fetch=async(url,options)=>({json:async()=>{if(url.startsWith('/api/intent-catalog'))return {items:[item],templates:[]}; if(url==='/api/intent-edit')operations.push(JSON.parse(options.body).operation); return draft();}});
  await new AsyncFunction('document','fetch',source)(document,fetch);
  const box=nodes.get('items').children[0];
  assert.equal(box.children[1].textContent,`Exact key: ${root.releaseSha256}/${root.itemId}`);
  for(const label of ['Choose explicit root','Remove explicit root','Skip optional choice','Clear skip','Remove item / inspect impact']) await box.children.find(child=>child.textContent===label).onclick();
  assert.deepEqual(operations.map(value=>value.type),['select','remove-root','skip','unskip','remove-item']);
  for(const operation of operations.filter(value=>'key' in value))assert.equal(operation.key,`${root.releaseSha256}/${root.itemId}`);
  assert.equal(operations[0].root.itemId,root.itemId); assert.equal(operations[2].ref.itemId,root.itemId);
});

const changedReview = { valid: false, changes: [{ key: 'old/item', state: 'changed', saved: { itemId: 'item' }, current: {} }] };

test('resolution change while update review is pending cannot enable its stale candidate', async () => {
  const {document,nodes}=documentFixture(), delay=deferred(); let updates=0;
  const fetch=async url=>({json:async()=>url.startsWith('/api/intent-catalog') ? data() : url==='/api/intent-update' ? ++updates===1 ? changedReview : delay.promise : draft('original')});
  await new AsyncFunction('document','fetch',source)(document,fetch);
  await nodes.get('update').onclick();
  const resolution=nodes.get('decisions').children[0].children[0];
  resolution.value='accept'; resolution.onchange();
  const pending=nodes.get('resolve').onclick();
  resolution.value='keep'; resolution.onchange();
  assert.equal(nodes.get('resolve').disabled,false, 'the changed decisions can be reviewed again');
  delay.resolve({...draft('stale candidate'),changes:changedReview.changes}); await pending;
  assert.equal(nodes.get('accept').disabled,true); assert.equal(nodes.get('policy').value,'original');
  assert.equal(resolution.value,'keep');
});

test('resolution change while acceptance is pending prevents stale candidate publication', async () => {
  const {document,nodes}=documentFixture(), delay=deferred(); let updates=0, accepting=false;
  const fetch=async url=>({json:async()=>url.startsWith('/api/intent-catalog') ? accepting ? delay.promise : data() : url==='/api/intent-update'
    ? ++updates===1 ? changedReview : {...draft('accepted old decision'),changes:changedReview.changes} : draft('original')});
  await new AsyncFunction('document','fetch',source)(document,fetch);
  await nodes.get('update').onclick();
  let resolution=nodes.get('decisions').children[0].children[0]; resolution.value='accept'; resolution.onchange();
  await nodes.get('resolve').onclick();
  accepting=true; const pending=nodes.get('accept').onclick();
  resolution=nodes.get('decisions').children[0].children[0]; resolution.value='remove'; resolution.onchange();
  assert.equal(nodes.get('resolve').disabled,false);
  delay.resolve(data()); await pending;
  assert.equal(nodes.get('policy').value,'original'); assert.equal(nodes.get('accept').disabled,true);
});

test('reopen adopts the server snapshot stage and rejects a stale catalog response', async () => {
  const {document,nodes}=documentFixture(), delay=deferred(), catalogStarted=deferred(); let delayed=false; const catalogRequests=[];
  const fetch=async url=>({json:async()=>{
    if(url.startsWith('/api/intent-catalog')) { catalogRequests.push(url); if(delayed) { catalogStarted.resolve(); return delay.promise; } return data(url.includes('stage=next') ? 2 : 0); }
    return url==='/api/intent-reopen' ? {...draft('exact updated JSON'),editable:true,stage:'next'} : draft('original');
  }});
  await new AsyncFunction('document','fetch',source)(document,fetch);
  await nodes.get('reopen').onclick();
  assert.match(catalogRequests.at(-1),/stage=next/); assert.equal(nodes.get('policy').value,'exact updated JSON'); assert.match(nodes.get('count').textContent,/2 total/);
  delayed=true; const pending=nodes.get('reopen').onclick();
  await catalogStarted.promise;
  nodes.get('policy').value='newer edit'; nodes.get('policy').oninput();
  delay.resolve(data(5)); await pending;
  assert.equal(nodes.get('policy').value,'newer edit'); assert.match(nodes.get('count').textContent,/2 total/);
});
