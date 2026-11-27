import { action, downloadJson, facts, fileField, hint, link, node, readStored, section, store } from './dom.js';
import { renderGitHubRecovery, teamProfileRequest, canRetryProposal } from './profile-sharing.js';
import { companionNotice } from './organization.js';

const endpoint = '/api/enterprise/github/';
let configuration = {status:'loading'};
let policy, difference, message = '', pending;
const restored = new URLSearchParams(location.search);
let handoff = restored.has('policy-repo') ? {
  repository:restored.get('policy-repo'), branch:restored.get('policy-branch'), path:restored.get('policy-path'), commit:restored.get('policy-commit'),
} : null;

async function request(route, body) {
  const options = body === undefined ? {cache:'no-store'} :
    {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  const response = await fetch(endpoint + route, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.reason || data.error || 'The organization repository could not be read.');
  return data;
}

function sameDestination(dest) {
  return !handoff || (dest?.repository.toLowerCase() === handoff.repository?.toLowerCase() &&
    dest.baseBranch === handoff.branch && dest.policyPath === handoff.path && /^[a-f0-9]{40}$/.test(handoff.commit || ''));
}

export async function loadConfiguration() {
  try {configuration = await request('config');}
  catch (error) {configuration = {status:'unavailable',error:error.message};}
}

export function managedMode() {
  return configuration.status !== 'unconfigured' || Boolean(handoff);
}

export function currentPolicy() {
  return configuration.status === 'ready' && sameDestination(configuration.destination) ? policy : undefined;
}

export function refreshPolicy() {
  if (pending) return pending;
  if (configuration.status !== 'ready' || !sameDestination(configuration.destination)) return Promise.resolve();
  pending = (async()=>{
    try {
      const result = await request('policy');
      if (!result.selection || !result.source?.commitSha) throw Error(result.reason || 'No merged organization policy is available.');
      const historyKey='aih-member-policy-seen:'+JSON.stringify(configuration.destination);
      const old=policy || readStored(historyKey,null);
      policy = {selection:result.selection,revision:result.source.commitSha,source:result.source,publisher:result.publisher,origin:'Administrator-configured GitHub branch'};
      store(historyKey,{revision:policy.revision,selection:{items:policy.selection.items,clients:policy.selection.clients}});
      if (old && Array.isArray(old.selection?.items) && Array.isArray(old.selection.clients) && old.revision !== policy.revision) {
        const before = new Set(old.selection.items), after = new Set(policy.selection.items);
        difference = {before:old.revision, added:[...after].filter(id=>!before.has(id)), removed:[...before].filter(id=>!after.has(id)),
          previousClients:old.selection.clients.join(', '), currentClients:policy.selection.clients.join(', ')};
      }
      message = handoff && handoff.commit !== policy.revision ? 'The configured branch currently points to a different commit than this handoff. Review the current policy.' : '';
    } catch (error) {policy = undefined;difference = undefined;message = error.message;}
    finally {pending = undefined;}
  })();
  return pending;
}

export function managedNotice(host, api) {
  const dest = configuration.destination;
  const notice = section('Trusted policy source');
  if (dest) notice.append(facts([['Repository',dest.repository],['Branch',dest.baseBranch],['Policy file',dest.policyPath]]));
  if (handoff && !sameDestination(dest) && dest) {
    notice.append(hint('This handoff does not match the policy source configured by your administrator.'),
      action('Open the configured policy',async()=>{
        handoff=null;
        const url=new URL(location.href);
        for(const key of ['policy-repo','policy-path','policy-branch','policy-commit']) url.searchParams.delete(key);
        history.replaceState(history.state,'',url);
        await refreshPolicy();api.refresh();
      }));
  } else if (configuration.status !== 'ready') notice.append(hint(configuration.error || 'Waiting for a trusted organization source.'),
    action('Retry connection',async event=>{event.currentTarget.disabled=true;await loadConfiguration();await refreshPolicy();api.refresh();}));
  else {
    if (message) notice.append(hint(message));
    if (difference) notice.append(facts([['Previous revision',difference.before],['Added selections',difference.added.join(', ') || 'None'],
      ['Removed selections',difference.removed.join(', ') || 'None'],['Previous clients',difference.previousClients],['Current clients',difference.currentClients]]));
    notice.append(action('Check for a newer revision',async event=>{
      event.currentTarget.disabled=true;
      await refreshPolicy();api.refresh();
    }));
  }
  if (policy) {
    const output=node('div');
    notice.append(action('Check installed policy impact',async event=>{
      const button=event.currentTarget;
      button.disabled=true;
      try {
        const response=await fetch('/api/approved-enterprise-impact',{cache:'no-store'});
        const value=await response.json();
        if(!response.ok || !Array.isArray(value.entries)) throw Error(value.reason || 'Installed impact is unavailable for this project.');
        const denied=value.entries.filter(row=>row.status==='denied').length;
        const unknown=value.entries.filter(row=>row.status==='unknown').length;
        output.replaceChildren(hint(value.entries.length+' installed entries checked · '+denied+' denied · '+unknown+' unknown'));
        for(const row of value.entries) output.append(hint([row.itemId,row.client,row.status].filter(Boolean).join(' · ')));
        if(value.reason) output.append(hint(value.reason));
      } catch(error) {output.replaceChildren(hint(error.message));} finally {button.disabled=false;}
    }),output);
  }
  notice.append(fileField('Open a member handoff', '.json,application/json', async file=>{
    if(file.size>8192) throw Error('Choose a Workbench member handoff.');
    const ref=JSON.parse(await file.text());
    if(ref?.format!=='aih-member-handoff/1' || ![ref.repository,ref.branch,ref.path,ref.commit].every(value=>typeof value==='string')) throw Error('Choose a Workbench member handoff.');
    handoff=ref;
    policy=undefined;
    difference=undefined;
    await refreshPolicy();
    api.refresh();
  },api.status));
  const inspected=node('div');
  notice.append(fileField('Preview a policy file', '.json,application/json',async file=>{
    if(file.size>1024*1024) throw Error('Choose a policy file smaller than 1 MiB.');
    const result=await request('inspect',{content:await file.text()});
    if(!result.selection) throw Error(result.error || result.reason || 'Core could not open the file.');
    const selection=result.selection;
    inspected.replaceChildren(node('h3','File preview'),facts([['Organization',selection.organization],['CLI targets',selection.clients.join(', ')],['Catalog items',selection.items.length]]),hint('The trusted source configured on this machine continues to govern setup.'));
  },api.status),inspected);
  host.append(notice);
}

function handoffLink(receipt,destination) {
  const url = new URL(configuration.memberUrl || location.pathname, location.origin);
  for (const [key,value] of Object.entries({'policy-repo':destination.repository,'policy-branch':destination.baseBranch,
    'policy-path':destination.policyPath,'policy-commit':receipt.mergeCommitSha})) url.searchParams.set(key,value);
  url.hash='intake/enterprise/start';
  return url.href;
}

export function publishPolicy(host, api, selection, reviewed) {
  const dest=configuration.destination;
  const pane=section('Publish to GitHub');
  host.append(pane);
  if (configuration.status!=='ready' || !dest) {
    pane.append(hint(configuration.error || 'An administrator can configure the GitHub repository, branch, and policy file on this host.'),
      action('Retry GitHub connection',async event=>{event.currentTarget.disabled=true;await loadConfiguration();api.refresh();}));
    return;
  }
  const key='aih-policy-pr:'+JSON.stringify([dest.repository,dest.baseBranch,dest.policyPath]);
  const output=node('div',null,'ix-stack');
  const proposal=node('div',null,'ix-stack');
  const proposalNotice=hint('');
  const receiptNotice=hint('');
  proposalNotice.setAttribute('role','status');
  receiptNotice.setAttribute('role','status');
  let shownReceipt;
  async function status(receipt, button) {
    if(button) button.disabled=true;
    receiptNotice.textContent='Checking publication status…';
    try {
      const checked=await teamProfileRequest('/status',api.signal,{receipt});
      if(shownReceipt === receipt) { draw(checked.receipt); receiptNotice.textContent=''; }
    } catch(error) {
      if(!api.signal.aborted && shownReceipt === receipt) receiptNotice.textContent=error.message;
    } finally {
      if(button) button.disabled=false;
    }
  }
  function draw(receipt, verified=true) {
    if(!receipt || !Number.isSafeInteger(receipt.number)) throw Error('GitHub did not return a publication receipt.');
    shownReceipt=receipt;
    if(verified) store(key,receipt);
    output.replaceChildren(node('h3',(verified && ({pending:'Awaiting merge',merged:'Published',closed:'Closed without publication',changed:'Pull request changed'})[receipt.status]) || 'Check publication status'));
    output.append(link('Open pull request #'+receipt.number,'https://github.com/'+dest.repository+'/pull/'+Number(receipt.number)));
    if(verified && receipt.status==='merged' && /^[a-f0-9]{40}$/.test(receipt.mergeCommitSha)) {
      const url=handoffLink(receipt,dest);
      output.append(facts([['Published commit',receipt.mergeCommitSha]]),link('Open member handoff',url),
        action('Download member handoff',()=>downloadJson('workbench-handoff.json',{format:'aih-member-handoff/1',repository:dest.repository,
          branch:dest.baseBranch,path:dest.policyPath,commit:receipt.mergeCommitSha})),
        action('Copy member handoff link',async()=>{try {await navigator.clipboard.writeText(url);api.status('Member handoff link copied.');} catch {output.append(hint(url));}}));
    } else output.append(action('Refresh publication status',event=>status(receipt,event.currentTarget)));
  }
  let busy=false, retrying=false;
  const preview=action('Preview policy pull request',async()=>{
    if(busy || retrying) return;
    busy=true;
    preview.disabled=true;
    proposal.replaceChildren();
    proposalNotice.textContent='Checking the GitHub destination…';
    try {
      const result=await teamProfileRequest('/preview',api.signal,{kind:'policy',selection});
      if(!result.confirmationId) throw Error(result.reason || result.error || 'The policy could not be prepared.');
      const confirm=action('Create policy pull request',async()=>{
        if(busy) return;
        busy=true;
        confirm.disabled=true;
        preview.disabled=true;
        proposalNotice.textContent='Opening the pull request…';
        try {
          const created=await teamProfileRequest('/propose',api.signal,{confirmationId:result.confirmationId,confirmed:true});
          draw(created.receipt);
          receiptNotice.textContent='';
          proposal.replaceChildren();
          proposalNotice.textContent='Pull request opened.';
          retrying=false;
        } catch(error) {
          if(!api.signal.aborted) {
            proposalNotice.textContent=error.message;
            retrying=canRetryProposal(error);
            confirm.disabled=!retrying;
            confirm.textContent='Retry this pull request';
          }
        } finally {
          busy=false;
          preview.disabled=retrying;
        }
      },true);
      const document=node('details');
      document.append(node('summary','Review the exact policy file'),node('pre',result.content));
      proposal.replaceChildren(facts([['GitHub account',result.identity?.login],['Repository',result.target.repository],['Branch',result.target.baseBranch],
        ['File',result.target.path],['Base commit',result.target.baseSha],['Document digest',result.digest]]),
        ...(result.companions ?? []).map(companion=>hint(companionNotice(companion))),document,confirm);
      proposalNotice.textContent='';
    } catch(error){if(!api.signal.aborted) proposalNotice.textContent=error.message;} finally{busy=false;preview.disabled=false;}
  },true);
  preview.disabled=!reviewed || !configuration.canPropose;
  if(!configuration.canPropose) pane.append(hint('Your current GitHub account needs repository write access to open a publication pull request.'));
  pane.append(facts([['GitHub account',configuration.identity?.login],['Repository',dest.repository],['Branch',dest.baseBranch],['Policy file',dest.policyPath]]),
    preview,proposal,proposalNotice,output,receiptNotice,renderGitHubRecovery('policy',api.signal,receipt=>{draw(receipt);void status(receipt);}));
  if(!reviewed) pane.append(hint('Record a review of this draft before opening a pull request.'));
  const receipt=readStored(key,null);
  if(Number.isSafeInteger(receipt?.number)) { draw(receipt,false); void status(receipt); }
}
