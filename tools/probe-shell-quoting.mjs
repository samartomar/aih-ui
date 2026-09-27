// Throwaway: how does spawnSync with shell:true quote a JS expression on this platform?
import { spawnSync } from "node:child_process";
const expression = "(() => { const b = document.getElementById('visible-count'); return JSON.stringify({v: b.textContent}); })()";
for (const shell of [false, true]) {
  const result = spawnSync("node", ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", "--raw", "eval", expression], { encoding: "utf8", shell });
  console.log(JSON.stringify({ shell, status: result.status, error: result.error?.code ?? null, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim().slice(0, 200) }));
}
