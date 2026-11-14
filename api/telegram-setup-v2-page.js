module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram Webhook Setup</title>
<style>
body{margin:0;background:#09090b;color:#f4f4f5;font:16px system-ui;display:grid;min-height:100vh;place-items:center}
main{width:min(92vw,440px);padding:26px;background:#18181b;border:1px solid #3f3f46;border-radius:16px;box-sizing:border-box}
h1{font-size:22px;margin:0 0 10px}p{color:#a1a1aa;line-height:1.5}
input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:9px;font-size:16px;margin-top:12px}
input{background:#09090b;color:white;border:1px solid #52525b}button{background:#fff;color:#111;font-weight:700;border:0;cursor:pointer}
#status{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:16px;color:#d4d4d8}
</style></head><body><main>
<h1>Telegram Webhook v2 Setup</h1>
<p>Vercel me save ki hui <b>TELEGRAM_SETUP_KEY_V2</b> enter karein. Key yahan chat me share na karein. Setup Telegram bot ka webhook v2 endpoint par switch karega.</p>
<form id="f"><input id="k" type="password" autocomplete="off" placeholder="TELEGRAM_SETUP_KEY_V2" required>
<button id="b" type="submit">Connect new webhook</button></form>
<div id="status" role="status"></div>
<script>
document.getElementById("f").addEventListener("submit",async function(e){
 e.preventDefault();
 const input=document.getElementById("k"),button=document.getElementById("b"),status=document.getElementById("status");
 const key=input.value; if(!key)return;
 button.disabled=true; status.textContent="Connecting...";
 try{
  const r=await fetch("/api/telegram-setup-v2",{method:"POST",headers:{"Authorization":"Bearer "+key}});
  const j=await r.json();
  if(!r.ok||!j.ok)throw new Error(j.error||"Setup failed");
  status.textContent="Success: new Telegram webhook v2 connected.";
  input.value="";
 }catch(err){status.textContent="Error: "+err.message;}
 finally{button.disabled=false;}
});
</script></main></body></html>`);
};