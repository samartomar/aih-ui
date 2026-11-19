import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pinned = source => source?.kind === 'git' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(source.repository) && /^[\da-f]{40}$/.test(source.commit);

// Only plans reconstructed from the pinned Catalog arrive here. Commands, external
// acquisitions and user-wide effects require their own preparation and evidence.
export function catalogInstallReason(parts) {
  if (!parts || parts.plan.status !== 'ok' || !parts.plan.plan.length) return 'A complete placement plan is required.';
  for (const step of parts.plan.plan) {
    if (step.root !== 'project' || !['write','merge','link'].includes(step.op)) return 'This plan requires actions beyond verified project files and settings.';
    if (step.from && !pinned(sourceFor(parts,step.from.sourceId))) return 'The required source has no verified Git revision in this Catalog.';
  }
  return null;
}
function sourceFor(parts,id) {
  const sources=parts.contents.flatMap(document=>document.sources).filter(source=>source.id===id);
  return sources.every(source=>source.commit===sources[0].commit && source.repository===sources[0].repository) ? sources[0] : null;
}
export async function cachedCatalogBytes(root,ref) {
  if (!/^[a-f0-9]{64}$/.test(ref.sha256)) return undefined;
  try {
    const bytes=await readFile(join(root,'catalog-materials',ref.sha256));
    if (sha(bytes)===ref.sha256) return bytes;
  } catch(error) { if (error.code!=='ENOENT') throw error; }
}
export async function verifiedCatalogFiles(parts,{root,catalogNode,sourceCache}) {
  const reason=catalogInstallReason(parts);
  if (reason) throw Error(reason);
  const sources=new Map(), refs=new Map();
  for (const step of parts.plan.plan) if(step.from) refs.set(JSON.stringify([step.from.sourceId,step.from.sourcePath]),step.from);
  const directory=join(root,'catalog-materials');
  await mkdir(directory,{recursive:true});
  const files=[];
  for(const ref of refs.values()) {
    let bytes=await cachedCatalogBytes(root,ref);
    if(!bytes) {
      const source=sourceFor(parts,ref.sourceId);
      let acquired=sources.get(source);
      if(!acquired) {
        if(sourceCache?.source?.repository===source.repository && sourceCache.source.commit===source.commit) acquired=sourceCache;
        else {
          const outDir=join(root,'acquisition');
          await mkdir(outDir,{recursive:true});
          acquired=await catalogNode.fetchSource({kind:'git',repository:source.repository,ref:source.commit},{outDir,timeoutMs:60000});
        }
        if(acquired.status!=='ok'||acquired.source?.repository!==source.repository||acquired.source.commit!==source.commit) throw Error('The pinned Catalog source is unavailable. No installation was prepared.');
        sources.set(source,acquired);
      }
      const supplied=acquired.files.find(file=>file.path===ref.sourcePath && file.sha256===ref.sha256);
      if(!supplied?.bytes || sha(supplied.bytes)!==ref.sha256) throw Error('The source file '+ref.sourcePath+' could not be verified. No installation was prepared.');
      bytes=Buffer.from(supplied.bytes);
      await writeFile(join(directory,ref.sha256),bytes);
    }
    files.push({sourceId:ref.sourceId,sourcePath:ref.sourcePath,sha256:ref.sha256,bytes});
  }
  return files;
}
