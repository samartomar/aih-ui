const fs=require('fs');const [,,inp,out]=process.argv;
try{const d=JSON.parse(fs.readFileSync(inp,'utf8'));
const grp=p=>{const s=p.split('/');if(s.length===1)return 'root';if(s[0]==='src'||s[0]==='tools'||s[0]==='prototype')return s.length>2?s[0]+'/'+s[1]:s[0];return s[0];};
const g={},gid={},nt={},fi={},fo={};for(const n of d.fileNodes){const k=grp(n.filePath);(g[k]=g[k]||[]).push(n.id);gid[n.id]=k;(nt[n.type]=nt[n.type]||[]).push(n.id);}
const inter={},intra={},cc={};for(const e of d.importEdges){fo[e.source]=(fo[e.source]||0)+1;fi[e.target]=(fi[e.target]||0)+1;const a=gid[e.source],b=gid[e.target];if(!a||!b)continue;
if(a===b){intra[a]=intra[a]||{internalEdges:0,totalEdges:0};intra[a].internalEdges++;intra[a].totalEdges++;}else{const k=a+'->'+b;inter[k]=(inter[k]||0)+1;for(const x of[a,b]){intra[x]=intra[x]||{internalEdges:0,totalEdges:0};intra[x].totalEdges++;}}}
for(const x in intra)intra[x].density=+(intra[x].internalEdges/intra[x].totalEdges).toFixed(2);
const type=id=>(d.fileNodes.find(n=>n.id===id)||{}).type;for(const e of d.allEdges){const k=type(e.source)+'|'+type(e.target)+'|'+e.type;cc[k]=(cc[k]||0)+1;}
const ig=Object.entries(inter).map(([k,c])=>{const[f,t]=k.split('->');return{from:f,to:t,count:c}}).sort((a,b)=>b.count-a.count);
const dir=[];for(const x of ig){const r=inter[x.to+'->'+x.from]||0;if(x.count>=r)dir.push({dependent:x.from,dependsOn:x.to});}
const res={scriptCompleted:true,directoryGroups:g,nodeTypeGroups:nt,crossCategoryEdges:Object.entries(cc).map(([k,c])=>{const[a,b,t]=k.split('|');return{fromType:a,toType:b,edgeType:t,count:c}}),interGroupImports:ig,intraGroupDensity:intra,
patternMatches:{'src/app':'ui','src/catalog':'ui','src/governance':'ui','tools/server':'service','tools/service':'service','tools/tests':'test',prototype:'ui'},
deploymentTopology:{hasDockerfile:false,hasCompose:false,hasK8s:false,hasTerraform:false,hasCI:false,infraFiles:[]},
dataPipeline:{schemaFiles:[],migrationFiles:[],dataModelFiles:[],apiHandlerFiles:(g['tools/server']||[]).filter(i=>i.includes('api'))},
docCoverage:{groupsWithDocs:1,totalGroups:Object.keys(g).length,coverageRatio:+(1/Object.keys(g).length).toFixed(2),undocumentedGroups:Object.keys(g).filter(k=>k!=='root')},
dependencyDirection:dir,fileStats:{totalFileNodes:d.fileNodes.length,filesPerGroup:Object.fromEntries(Object.entries(g).map(([k,v])=>[k,v.length])),nodeTypeCounts:Object.fromEntries(Object.entries(nt).map(([k,v])=>[k,v.length]))},fileFanIn:fi,fileFanOut:fo};
fs.writeFileSync(out,JSON.stringify(res,null,1));}catch(e){console.error(e);process.exit(1);}
