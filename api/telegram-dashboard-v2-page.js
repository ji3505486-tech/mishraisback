module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram Tracking Dashboard</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#09090b;color:#f4f4f5;font:15px system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1120px;margin:0 auto;padding:28px 18px 48px}.top{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
h1{font-size:26px;margin:0}.muted{color:#a1a1aa}.panel,.metric{background:#18181b;border:1px solid #33333b;border-radius:14px;padding:18px}
.auth{max-width:480px;margin:70px auto}.auth h2{margin:0 0 8px}input,button{font:inherit;border-radius:9px;padding:12px;border:1px solid #52525b}
input{width:100%;background:#09090b;color:#fff;margin:10px 0}button{background:#f4f4f5;color:#111;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
#status{margin-top:12px;color:#d4d4d8;white-space:pre-wrap}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
.metric .label{color:#a1a1aa;font-size:13px}.metric .value{font-size:30px;font-weight:750;margin-top:8px;font-variant-numeric:tabular-nums}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.stat{background:#09090b;border-radius:10px;padding:12px}.stat strong{display:block;font-size:22px;margin-top:5px}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:10px;border-bottom:1px solid #33333b;font-size:13px}th{color:#a1a1aa;font-weight:600}
.chart{display:flex;align-items:end;gap:5px;height:170px;margin-top:20px;padding:8px 0}.barwrap{flex:1;min-width:0;display:flex;align-items:center;justify-content:end;flex-direction:column;height:100%;gap:5px}
.bar{width:100%;max-width:22px;background:#a855f7;border-radius:5px 5px 0 0;min-height:2px}.barlabel{font-size:9px;color:#a1a1aa;writing-mode:vertical-rl;transform:rotate(180deg)}
.note{font-size:12px;color:#a1a1aa;line-height:1.5;margin-top:16px}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}.metric .value{font-size:25px}}
</style></head><body><main>
<section id="login" class="panel auth"><h2>Telegram Tracking Dashboard</h2><p class="muted">Enter your TELEGRAM_DASHBOARD_KEY to view aggregate channel statistics.</p>
<form id="loginForm"><input id="key" type="password" autocomplete="off" placeholder="Dashboard access key" required><button id="loginBtn" type="submit">Open dashboard</button></form><div id="status" role="status"></div>
</section>
<section id="app" hidden>
<div class="top"><div><h1>Telegram Tracking Dashboard</h1><div class="muted">Aggregate channel activity · Webhook v2</div></div><button id="refresh">Refresh data</button></div>
<div class="grid">
<div class="metric"><div class="label">Current channel members</div><div class="value" id="members">—</div></div>
<div class="metric"><div class="label">Join requests today</div><div class="value" id="todayRequests">—</div></div>
<div class="metric"><div class="label">Accepted joins today</div><div class="value" id="todayAccepted">—</div></div>
<div class="metric"><div class="label">Leaves today</div><div class="value" id="todayLeaves">—</div></div>
</div>
<div class="two">
<div class="panel"><h3>Last 7 days</h3><div class="stats" id="week"></div></div>
<div class="panel"><h3>Last 30 days</h3><div class="stats" id="month"></div></div>
</div>
<div class="panel" style="margin-top:14px"><h3>Daily activity · Last 30 days</h3><div class="chart" id="chart"></div><div class="muted">Bars show accepted joins per day.</div></div>
<div class="panel" style="margin-top:14px"><h3>Recent events</h3><table><thead><tr><th>Event</th><th>Date / time (UTC)</th></tr></thead><tbody id="events"></tbody></table></div>
<p class="note" id="note"></p><div class="muted" id="updated" style="margin-top:10px"></div>
</section></main>
<script>
let dashboardKey="";
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString();
const kinds=[["join_requests","Join requests"],["accepted_joins","Accepted joins"],["leaves","Leaves"]];
function statMarkup(data){return kinds.map(([k,label])=>'<div class="stat"><span class="muted">'+label+'</span><strong>'+fmt(data&&data[k])+'</strong></div>').join("")}
function render(d){
 $("members").textContent=fmt(d.current_members);
 $("todayRequests").textContent=fmt(d.today.join_requests);
 $("todayAccepted").textContent=fmt(d.today.accepted_joins);
 $("todayLeaves").textContent=fmt(d.today.leaves);
 $("week").innerHTML=statMarkup(d.last_7_days);
 $("month").innerHTML=statMarkup(d.last_30_days);
 const max=Math.max(1,...d.daily.map(x=>Number(x.accepted_joins||0)));
 $("chart").innerHTML=d.daily.slice().reverse().map(x=>'<div class="barwrap" title="'+x.date+': '+fmt(x.accepted_joins)+' accepted"><div class="bar" style="height:'+Math.max(2,(Number(x.accepted_joins||0)/max)*135)+'px"></div><div class="barlabel">'+x.date.slice(5)+'</div></div>').join("");
 $("events").innerHTML="";
 (d.recent_events||[]).forEach(ev=>{const tr=document.createElement("tr");const a=document.createElement("td");const b=document.createElement("td");a.textContent=(kinds.find(x=>x[0]===ev.type)||[null,"Event"])[1];b.textContent=ev.at||ev.date||"—";tr.append(a,b);$("events").append(tr)});
 $("note").textContent=d.note||"";
 $("updated").textContent="Last updated: "+new Date().toLocaleString();
}
async function load(){
 $("refresh").disabled=true;$("updated").textContent="Loading…";
 try{
  const r=await fetch("/api/telegram-report-v2",{headers:{Authorization:"Bearer "+dashboardKey},cache:"no-store"});
  const d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d.error||"Could not load report");
  render(d);$("status").textContent="";$("login").hidden=true;$("app").hidden=false;
 }catch(e){$("status").textContent="Error: "+e.message}
 finally{$("refresh").disabled=false}
}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();dashboardKey=$("key").value;$("key").value="";$("loginBtn").disabled=true;await load();$("loginBtn").disabled=false});
$("refresh").addEventListener("click",load);
</script></body></html>`);
};
