import json
N=[];E=[]
def node(id,type,name,summary,tags,cx,fp=None,lr=None,ln=None):
    n={"id":id,"type":type,"name":name,"summary":summary,"tags":tags,"complexity":cx}
    if fp: n["filePath"]=fp
    if lr: n["lineRange"]=lr
    if ln: n["languageNotes"]=ln
    N.append(n)
def edge(s,t,ty,w): E.append({"source":s,"target":t,"type":ty,"direction":"forward","weight":w})
F=lambda p:"file:"+p
node(F("prototype/index.html"),"file","index.html","Design-source index of the Policy Workbench prototype: a navigable deck that frames each prototype screen in an iframe with Back/Next controls, notes on the single design system, and a light/dark mode switch.",["prototype","design-source","navigation","entry-point","markup"],"complex","prototype/index.html")
node(F("prototype/screens/mode.js"),"file","mode.js","Light/dark mode switcher shared by prototype screens: picks the mode from ?mode, then localStorage, then dark, and toggles the html class and any mode-toggle button labels and icons.",["theme","utility","prototype","event-handler"],"simple","prototype/screens/mode.js",ln="Self-invoking function (IIFE) that runs before DOMContentLoaded to avoid a flash of the wrong theme.")
node(F("prototype/screens/shell.js"),"file","shell.js","Defines the global WB object that injects the shared admin chrome (header, sub-header, nav rail) from admin-sources.html into prototype admin screens via WB.top() and WB.nav().",["prototype","component","layout","admin-shell"],"simple","prototype/screens/shell.js")
node(F("prototype/screens/tw-config.js"),"file","tw-config.js","Tailwind CDN configuration shared by every prototype screen and the Workbench page: class-based dark mode and a Material-style color palette mapped to tokens.css custom properties.",["configuration","tailwind","design-tokens","theme"],"moderate","prototype/screens/tw-config.js")
node(F("prototype/screens/user-shell.js"),"file","user-shell.js","Defines the global WBU object rendering the user-facing page chrome, including the organization-policy strip that illustrates the policy lookup order (--policy, AIH_ORG_POLICY, aih-org-policy.json) selectable via ?source.",["prototype","component","layout","policy-source"],"moderate","prototype/screens/user-shell.js")
node(F("src/app/workbench.css"),"file","workbench.css","Local presentation rules the Workbench page adds on top of the prototype stylesheets: Material Symbols axes, a hidden-scrollbar fading kind-filter strip, provenance marker hiding, and theme-change transition handling.",["styles","theme","layout","markup"],"simple","src/app/workbench.css")
node(F("src/index.html"),"file","index.html","Main HTML page of the Policy Workbench: loads fonts, tokens, mode and Tailwind config, prototype and local stylesheets, and defines every element (masthead, source rails, catalog ledger, governance pane, organization modal) that main.js wires up.",["entry-point","page","markup","workbench","layout"],"complex","src/index.html",ln="Uses Tailwind via CDN with a shared runtime config and loads the app as a single ES module (main.js).")
node(F("tools/acceptance-sweep.mjs"),"file","acceptance-sweep.mjs","Browserless acceptance sweep against a running preview's /api/* endpoints, replaying the Governance pane's call order to check no filesystem paths leak, session sharing, reopen round-trips, and refusal of bad sessions or bodies.",["test","acceptance","api","cli","security"],"moderate","tools/acceptance-sweep.mjs")
node(F("tools/compare.html"),"file","compare.html","Layout-parity tool that renders the prototype and the implementation side by side or overlaid (difference blend) at the same 1600x1000 viewport to compare element geometry.",["tooling","visual-regression","markup","comparison"],"moderate","tools/compare.html")
node(F("tools/inspect-dom.mjs"),"file","inspect-dom.mjs","Reads a headless-rendered DOM dump of the preview page and prints acceptance facts such as the catalog error element, masthead, provenance strip, counts, and source rails.",["tooling","diagnostics","cli","dom"],"simple","tools/inspect-dom.mjs")
node(F("tools/probe-http.mjs"),"file","probe-http.mjs","Sends raw byte-exact HTTP requests over a socket to the preview server with malformed and traversal paths, then confirms the server still serves the catalog index afterwards.",["tooling","http","probe","security"],"simple","tools/probe-http.mjs")
node(F("tools/probe-old-handler.mjs"),"file","probe-old-handler.mjs","Reproduces the malformed-URL bug by running the pre-fix static server handler (unguarded decodeURIComponent) on a throwaway port and sending raw requests to it.",["tooling","bug-reproduction","http","probe"],"moderate","tools/probe-old-handler.mjs")
node(F("tools/probe-shell-quoting.mjs"),"file","probe-shell-quoting.mjs","Throwaway probe checking how spawnSync with and without shell:true quotes a JavaScript expression argument on the current platform.",["tooling","probe","child-process","platform"],"simple","tools/probe-shell-quoting.mjs")
node(F("tools/service/core-targets.mjs"),"file","core-targets.mjs","Service module exposing the AI CLI targets Core supports, read from @aihq/core's public SUPPORTED_CLIS export and validated; loaded on demand by core-service.mjs.",["service","adapter","validation","core"],"simple","tools/service/core-targets.mjs")
def fn(p,name,lr,s,tags,exp=False):
    id=f"function:{p}:{name}"
    node(id,"function",name,s,tags,"simple",p,lr)
    edge(F(p),id,"contains",1.0)
    if exp: edge(F(p),id,"exports",0.8)
fn("tools/acceptance-sweep.mjs","post",[36,50],"Posts a JSON body to a preview API route and returns the status and parsed response for the sweep's checks.",["http","api","utility"])
fn("tools/probe-http.mjs","request",[8,23],"Opens a raw TCP socket, sends a hand-built GET request for the given path, and resolves with the parsed HTTP status and byte count.",["http","socket","probe"])
fn("tools/probe-old-handler.mjs","oldServer",[13,31],"Recreates the pre-fix static file server whose unguarded decodeURIComponent threw on malformed percent escapes.",["http","server","bug-reproduction"])
fn("tools/probe-old-handler.mjs","raw",[36,45],"Sends a raw GET request over a socket to the old handler and reports what came back.",["http","socket","probe"])
fn("tools/service/core-targets.mjs","coreTargets",[17,30],"Validates @aihq/core's SUPPORTED_CLIS as a non-empty, duplicate-free list of well-formed target ids and returns a copy of it.",["validation","service","core"],True)
pi,si=F("prototype/index.html"),F("src/index.html")
edge(pi,F("prototype/screens/mode.js"),"depends_on",0.6)
edge(si,F("prototype/screens/mode.js"),"depends_on",0.6)
edge(si,F("prototype/screens/tw-config.js"),"depends_on",0.6)
edge(si,F("src/app/workbench.css"),"depends_on",0.6)
edge(si,F("src/main.js"),"depends_on",0.6)
edge(F("tools/service/core-service.mjs"),F("tools/service/core-targets.mjs"),"depends_on",0.6)
edge(F("tools/compare.html"),pi,"related",0.5)
edge(F("tools/compare.html"),si,"related",0.5)
edge(F("tools/inspect-dom.mjs"),si,"related",0.5)
edge(F("tools/probe-http.mjs"),F("tools/preview-request.mjs"),"related",0.5)
edge(F("tools/probe-old-handler.mjs"),F("tools/preview-request.mjs"),"related",0.5)
edge(F("tools/acceptance-sweep.mjs"),F("tools/preview.mjs"),"related",0.5)
json.dump({"nodes":N,"edges":E},open("D:/dev/aih-ui/.ua/intermediate/batch-8.json","w"),indent=1)
print(len(N),len(E))
