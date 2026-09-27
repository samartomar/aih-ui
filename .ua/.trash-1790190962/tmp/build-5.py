import json
N=[];E=[]
def node(id,type,name,fp,summary,tags,cx,lr=None,ln=None):
    n={"id":id,"type":type,"name":name,"filePath":fp,"summary":summary,"tags":tags,"complexity":cx}
    if lr: n["lineRange"]=lr
    if ln: n["languageNotes"]=ln
    N.append(n)
def edge(s,t,ty,w): E.append({"source":s,"target":t,"type":ty,"direction":"forward","weight":w})
def fn(fp,name,lr,summary,tags,cx,exported):
    id=f"function:{fp}:{name}"
    node(id,"function",name,fp,summary,tags,cx,lr)
    edge(f"file:{fp}",id,"contains",1.0)
    if exported: edge(f"file:{fp}",id,"exports",0.8)
    return id

A="src/app/ai-tools.js"; EL="src/app/elements.js"; O="src/app/organization.js"; S="src/app/shell.js"; T="src/app/theme.js"; M="src/main.js"
node(f"file:{A}","file","ai-tools.js",A,"Header AI tools control that lists the AI CLI targets @aihq/core publishes as supported, keeps the user's selection as a browser-local draft, and never implies installation or connection status.",["component","ui-control","local-storage","state-management"],"moderate",ln="Deliberately separates three facts (supported, selected, connected) and renders explicit absence markers instead of sample data.")
node(f"file:{EL}","file","elements.js",EL,"Looks up the DOM nodes owned by the application shell, the organization setup popup and the AI tools control by element id.",["utility","dom","element-lookup"],"simple")
node(f"file:{O}","file","organization.js",O,"Organization setup popup in the header: a user-entered draft (name, short id, policy repo, emails, signing posture) persisted in localStorage, validated on save and discarded on cancel, with no claim of policy authority.",["component","form","validation","local-storage","modal"],"complex",ln="Uses regex validators for short ids, emails and policy repository references, with a versioned localStorage draft format.")
node(f"file:{S}","file","shell.js",S,"Application shell controller owning the collapsible navigation and inspector rails, keyboard-accessible inspector tabs and the error banner, exposing openInspector and showError to features.",["component","layout","accessibility","event-handler"],"moderate")
node(f"file:{T}","file","theme.js",T,"Observes theme changes on <html> and briefly suppresses CSS transitions so already-rendered elements repaint against the new theme variables instead of keeping stale colours.",["utility","theming","css","mutation-observer"],"moderate",ln="Uses a MutationObserver plus a double requestAnimationFrame with a setTimeout fallback, so transitions are restored even in tabs that are not painting.")
node(f"file:{M}","file","main.js",M,"Policy Workbench page entry point that composes the shell, theme, AI tools, organization, catalog and governance features and wires their callbacks together without holding state.",["entry-point","composition-root","bootstrap"],"moderate")

fa=fn(A,"createAiTools",[44,135],"Builds the AI tools popup controller: renders supported targets from Core with checkboxes, persists the selection draft, and shows not-published/not-connected notices; exposes setTargets.",["factory","component","ui-control"],"moderate",True)
f1=fn(EL,"shellElements",[8,16],"Collects the shell's rail, toggle, inspector pane and error banner elements plus the inspector tab buttons.",["utility","dom","element-lookup"],"simple",True)
f2=fn(EL,"organizationElements",[19,28],"Collects every element id of the header organization control and its setup popup form.",["utility","dom","element-lookup"],"simple",True)
f3=fn(EL,"aiToolsElements",[31,33],"Collects the header AI tools trigger, count, popup, list and note elements.",["utility","dom","element-lookup"],"simple",True)
fl=fn(O,"loadDraft",[59,81],"Reads and sanitizes the versioned organization draft from localStorage, falling back to an empty draft on missing or malformed data.",["local-storage","serialization","utility"],"simple",False)
fv=fn(O,"validateDraft",[93,113],"Validates an organization draft's name, short id, policy repository reference and email list, returning per-field error messages.",["validation","form","utility"],"simple",True)
fo=fn(O,"createOrganization",[119,359],"Builds the organization setup popup controller: open/close handling, email list editing, posture choice, validation on save and change notification; exposes current().",["factory","component","modal","form"],"complex",True)
fs=fn(S,"createShell",[14,91],"Wires rail toggles, inspector tab switching with arrow/Home/End keys and disabled nav links, returning openInspector and showError.",["factory","layout","accessibility","event-handler"],"moderate",True)
ft=fn(T,"createTheme",[40,92],"Starts a MutationObserver on <html> that settles theme switches by suppressing transitions for a frame; returns settle and stop.",["factory","theming","mutation-observer"],"moderate",True)
fm=fn(M,"main",[24,65],"Async bootstrap that creates theme, shell, governance, AI tools, catalog and organization controllers, connects selection and summary callbacks, and starts the catalog, surfacing errors in the shell banner.",["entry-point","bootstrap","composition-root"],"moderate",False)

imp=json.load(open('.ua/tmp/ua-file-analyzer-input-5.json'))['batchImportData']
for f,ts in imp.items():
    for t in ts: edge(f"file:{f}",f"file:{t}","imports",0.7)
for s,t in [(fm,fs),(fm,f1),(fm,f2),(fm,f3),(fm,fa),(fm,fo),(fm,ft),
            (fm,"function:src/catalog/controller.js:createCatalog"),(fm,"function:src/governance/controller.js:createGovernance"),
            (f1,"function:src/app/dom.js:collectIds"),(f2,"function:src/app/dom.js:collectIds"),(f3,"function:src/app/dom.js:collectIds"),
            (fa,"function:src/app/dom.js:el"),(fo,"function:src/app/dom.js:el"),(fo,fl),(fo,fv)]:
    edge(s,t,"calls",0.8)
ids={n["id"] for n in N}; assert len(ids)==len(N)
print(len(N),len(E),sum(1 for e in E if e["type"]=="imports"))
json.dump({"nodes":N,"edges":E},open('.ua/intermediate/batch-5.json','w'),indent=1)
