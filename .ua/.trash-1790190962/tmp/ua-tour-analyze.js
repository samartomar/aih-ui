const fs = require('fs');
try {
  const [inp, out] = process.argv.slice(2);
  const g = JSON.parse(fs.readFileSync(inp, 'utf8'));
  const nodes = g.nodes || [], edges = g.edges || [], layers = g.layers || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const fanIn = new Map(), fanOut = new Map();
  const inSet = new Map(), outSet = new Map();
  for (const n of nodes) { inSet.set(n.id, new Set()); outSet.set(n.id, new Set()); }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    outSet.get(e.source).add(e.target); inSet.get(e.target).add(e.source);
  }
  for (const n of nodes) { fanIn.set(n.id, inSet.get(n.id).size); fanOut.set(n.id, outSet.get(n.id).size); }
  const fanInRanking = nodes.map(n => ({ id: n.id, fanIn: fanIn.get(n.id), name: n.name })).sort((a, b) => b.fanIn - a.fanIn).slice(0, 20);
  const fanOutRanking = nodes.map(n => ({ id: n.id, fanOut: fanOut.get(n.id), name: n.name })).sort((a, b) => b.fanOut - a.fanOut).slice(0, 20);
  const outs = [...fanOut.values()].sort((a, b) => a - b), ins = [...fanIn.values()].sort((a, b) => a - b);
  const outTop = outs[Math.floor(outs.length * 0.9)] || 0, inLow = ins[Math.floor(ins.length * 0.25)] || 0;
  const entryNames = new Set('index.ts index.js main.ts main.js app.ts app.js server.ts server.js mod.rs main.go main.py main.rs manage.py app.py wsgi.py asgi.py run.py __main__.py Application.java Main.java Program.cs config.ru index.php App.swift Application.kt main.cpp main.c index.mjs main.mjs'.split(' '));
  const cands = nodes.map(n => {
    const fp = (n.filePath || '').replace(/\\/g, '/'); const depth = fp.split('/').length - 1; const base = fp.split('/').pop();
    let s = 0;
    if (n.type === 'document') { if (/^readme\.md$/i.test(fp)) s += 5; else if (depth === 0 && /\.md$/i.test(fp)) s += 2; }
    else if (n.type === 'file') {
      if (entryNames.has(base)) s += 3; if (depth <= 1) s += 1;
      if (fanOut.get(n.id) >= outTop && outTop > 0) s += 1; if (fanIn.get(n.id) <= inLow) s += 1;
    }
    return { id: n.id, score: s, name: n.name, type: n.type, summary: n.summary };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  const codeEntry = byId.has('file:src/main.js') ? 'file:src/main.js' : (cands.find(c => c.type === 'file') || {}).id;
  const adj = new Map();
  for (const e of edges) { if (e.type !== 'imports' && e.type !== 'calls') continue; if (!adj.has(e.source)) adj.set(e.source, []); adj.get(e.source).push(e.target); }
  const depthMap = {}, order = [];
  if (codeEntry) { depthMap[codeEntry] = 0; const q = [codeEntry];
    while (q.length) { const c = q.shift(); order.push(c); for (const t of adj.get(c) || []) if (!(t in depthMap) && byId.has(t)) { depthMap[t] = depthMap[c] + 1; q.push(t); } } }
  const byDepth = {}; for (const id of order) (byDepth[depthMap[id]] ||= []).push(id);
  const cat = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) { const o = { id: n.id, name: n.name, type: n.type, summary: n.summary };
    if (n.type === 'document') cat.documentation.push(o);
    else if (['service', 'pipeline', 'resource'].includes(n.type)) cat.infrastructure.push(o);
    else if (['table', 'schema', 'endpoint'].includes(n.type)) cat.data.push(o);
    else if (n.type === 'config') cat.config.push(o); }
  // clusters
  const pairs = [];
  for (const [a, s] of outSet) for (const b of s) if (a < b && outSet.get(b).has(a)) pairs.push([a, b]);
  const clusters = [], used = new Set();
  const nb = id => new Set([...outSet.get(id), ...inSet.get(id)]);
  for (const [a, b] of pairs) { if (used.has(a) && used.has(b)) continue;
    const c = new Set([a, b]);
    for (const x of nodes) { if (c.size >= 5) break; if (c.has(x.id)) continue; const n = nb(x.id); let k = 0; for (const m of c) if (n.has(m)) k++; if (k >= 2) c.add(x.id); }
    let ec = 0; for (const e of edges) if (c.has(e.source) && c.has(e.target)) ec++;
    clusters.push({ nodes: [...c], edgeCount: ec }); for (const m of c) used.add(m); }
  clusters.sort((x, y) => y.edgeCount - x.edgeCount);
  const nodeSummaryIndex = {}; for (const n of nodes) nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
  const edgeTypes = {}; for (const e of edges) edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1;
  fs.writeFileSync(out, JSON.stringify({ scriptCompleted: true, entryPointCandidates: cands, fanInRanking, fanOutRanking,
    bfsTraversal: { startNode: codeEntry, order, depthMap, byDepth }, nonCodeFiles: cat, clusters: clusters.slice(0, 10),
    layers: { count: layers.length, list: layers }, edgeTypes, nodeSummaryIndex, totalNodes: nodes.length, totalEdges: edges.length }, null, 1));
} catch (e) { console.error(e.stack || e); process.exit(1); }
