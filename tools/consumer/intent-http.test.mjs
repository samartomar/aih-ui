import test from 'node:test';
import assert from 'node:assert/strict';
import { startConsumer } from './server.mjs';

test('HTTP authoring journey saves/reopens/skips/removes/updates without execution authority', async () => {
  const { server, origin } = await startConsumer();
  const post = async (op, body = {}) => {
    const response = await fetch(`${origin}/api/${op}`, { method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body) });
    return { status:response.status, body:await response.json() };
  };
  const okay = result => { assert.equal(result.valid,true,JSON.stringify(result)); return result; };
  try {
    const page = await (await fetch(`${origin}/intent`)).text(); assert.match(page,/Illustrative content/); assert.match(page,/authoring only/);
    const catalog = await (await fetch(`${origin}/api/intent-catalog`)).json(); assert.equal(catalog.executionAvailable,false);
    const item = id => catalog.items.find(item=>item.id===id);
    let policy = okay((await post('intent-new',{inventory:'journey',mode:'vibe'})).body);
    for(const id of ['app.alpha','app.beta','shared.retired']) policy=okay((await post('intent-edit',{inventory:'journey',policyText:policy.policyText,operation:{type:'select',root:item(id).root}})).body);
    const {scope,configuration,...ref}=item('shared.optional').root;
    policy=okay((await post('intent-edit',{inventory:'journey',policyText:policy.policyText,operation:{type:'skip',ref}})).body);
    const original=policy.policyText;
    assert.equal(okay((await post('intent-reopen',{inventory:'journey',policyText:original})).body).policyText,original);
    const key=ref=>`${ref.releaseSha256}/${ref.itemId}`;
    const removed=okay((await post('intent-edit',{inventory:'journey',policyText:original,operation:{type:'remove-root',key:key(item('app.alpha').root),scope:'project'}})).body);
    assert.ok(removed.policy.selections.some(value=>value.id.endsWith('--shared.base')));
    const impact=(await post('intent-edit',{inventory:'journey',policyText:original,operation:{type:'remove-item',key:key(item('shared.base').root)}})).body;
    assert.equal(impact.valid,false); assert.equal(impact.affectedRoots.length,2);
    const review=(await post('intent-update',{inventory:'journey',policyText:original})).body;
    assert.equal(review.valid,false); assert.ok(review.changes.some(change=>change.state==='missing'));
    const resolutions=Object.fromEntries(review.changes.filter(change=>change.state!=='unchanged').map(change=>[change.key,change.current?'accept':'remove']));
    const candidate=okay((await post('intent-update',{inventory:'journey',policyText:original,resolutions})).body);
    assert.equal(candidate.originalPolicyText,original); assert.equal(candidate.requiresAcceptance,true); assert.equal(candidate.intent.exclusions[0].itemId,'shared.optional');
    assert.equal(okay((await post('intent-reopen',{inventory:'journey',stage:'next',policyText:candidate.policyText})).body).editable,true);
    assert.equal((await post('prepare',{policyText:original})).status,409);
    const foreign=await fetch(`${origin}/api/intent-new`,{method:'POST',headers:{origin:'https://foreign.example','content-type':'application/json'},body:'{}'}); assert.equal(foreign.status,403);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
