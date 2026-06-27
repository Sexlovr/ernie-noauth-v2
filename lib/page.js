// Admin dashboard for the ernie-noauth proxy. Self-contained HTML strings.
// Tabbed, mobile-first, GitHub-dark with a blue/indigo accent. All dynamic data
// is fetched client-side, so the embedded <script> avoids backticks and ${}.

const STYLE = `
:root{
  --bg:#0d1117; --bg2:#010409; --card:#161b22; --bd:#30363d; --bd2:#21262d;
  --fg:#e6edf3; --mut:#8b949e; --acc:#4f8cff; --acc2:#8b7cff;
  --ok:#3fb950; --bad:#f85149; --warn:#d29922;
}
*{box-sizing:border-box}
html,body{margin:0;overflow-x:hidden;max-width:100%}
body{
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg); color:var(--fg); -webkit-text-size-adjust:100%;
  background-image:
    radial-gradient(900px 500px at 12% -10%, rgba(79,140,255,.12), transparent 60%),
    radial-gradient(800px 500px at 100% 0%, rgba(139,124,255,.08), transparent 55%);
  background-attachment:fixed; min-height:100vh;
}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1040px;margin:0 auto;padding:22px 16px calc(60px + env(safe-area-inset-bottom))}
.bar{display:flex;align-items:center;gap:13px;margin-bottom:18px}
.logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:23px;flex:none;
  background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 6px 22px rgba(79,140,255,.35)}
.bar h1{font-size:21px;margin:0;font-weight:700;letter-spacing:-.01em}
.bar h1 b{background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.bar .sub{color:var(--mut);font-size:12.5px;margin-top:1px}
.bar .out{margin-left:auto}
.tabs{position:sticky;top:0;z-index:20;display:flex;gap:6px;padding:7px;margin:0 0 20px;
  background:rgba(13,17,23,.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid var(--bd);border-radius:13px}
.tab{flex:1;background:transparent;color:var(--mut);border:0;padding:11px 8px;border-radius:9px;
  cursor:pointer;font-weight:600;font-size:14px;transition:.15s;white-space:nowrap}
.tab:hover{color:var(--fg)}
.tab.on{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;box-shadow:0 4px 14px rgba(79,140,255,.3)}
.panel[hidden]{display:none}
.card{background:linear-gradient(180deg,var(--card),rgba(22,27,34,.6));border:1px solid var(--bd);
  border-radius:14px;padding:18px;margin-bottom:16px}
.card h2{font-size:12px;margin:0 0 14px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.card h2 .n{color:var(--acc);background:rgba(79,140,255,.12);border:1px solid rgba(79,140,255,.25);
  border-radius:20px;padding:1px 9px;margin-left:8px;font-size:11px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.stat{background:var(--bg);border:1px solid var(--bd2);border-radius:12px;padding:14px 12px;text-align:center}
.stat b{display:block;font-size:25px;font-weight:700;line-height:1.1}
.stat span{color:var(--mut);font-size:11.5px}
input,button,textarea{font:inherit}
input,textarea{background:var(--bg2);border:1px solid var(--bd);color:var(--fg);
  padding:11px 13px;border-radius:10px;width:100%;transition:.15s;font-size:15px}
input:focus,textarea:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(79,140,255,.18)}
button{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;border:0;
  padding:11px 17px;border-radius:10px;cursor:pointer;font-weight:600;white-space:nowrap;transition:.15s}
button:hover{filter:brightness(1.07)}button:active{transform:translateY(1px)}
button:disabled{opacity:.5;cursor:default;filter:none}
button.ghost{background:transparent;border:1px solid var(--bd);color:var(--fg)}
button.ghost:hover{border-color:var(--acc);background:rgba(79,140,255,.08)}
button.sm{padding:7px 13px;font-size:13px;border-radius:9px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.err{color:var(--bad);font-size:13px;min-height:16px;margin-top:8px}
.hint{color:var(--mut);font-size:13px}
.copyline{display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:11px 13px;cursor:pointer;transition:.15s}
.copyline:hover{border-color:var(--acc)}
.copyline .v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--acc);word-break:break-all}
.copyline .ic{color:var(--mut);font-size:13px;flex:none}
.kv{display:grid;grid-template-columns:auto 1fr;gap:10px 16px;align-items:center}
.kv .k{color:var(--mut);font-size:13px}
table.egress{width:100%;border-collapse:collapse;font-size:13px}
table.egress th,table.egress td{border:1px solid var(--bd2);padding:8px 10px;text-align:left;white-space:nowrap}
table.egress th{background:var(--bg);color:var(--mut);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em}
table.egress td.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.dot.ok{background:var(--ok)}.dot.cool{background:var(--warn)}
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.mcard{text-align:left;background:var(--card);border:1px solid var(--bd);border-radius:11px;
  padding:12px 13px;cursor:pointer;transition:.13s;display:flex;flex-direction:column;gap:8px;min-width:0}
.mcard:hover{border-color:var(--acc);background:rgba(79,140,255,.07);transform:translateY(-1px)}
.mcard .mid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600;word-break:break-all}
.mcard .abs{display:flex;gap:6px;flex-wrap:wrap}
.ab{font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:6px;border:1px solid transparent}
.ab-t{color:#c4b5ff;background:rgba(139,124,255,.12);border-color:rgba(139,124,255,.25)}
.ab-s{color:#7ee0a5;background:rgba(63,185,80,.12);border-color:rgba(63,185,80,.25)}
.mcard .cp{font-size:11px;color:var(--mut)}
.pxr{display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:var(--bg);border:1px solid var(--bd2);border-radius:10px;padding:9px 12px;margin-top:8px;flex-wrap:wrap}
.pxr .srv{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-all}
.pxr .res{font-size:12.5px;font-weight:600;white-space:nowrap}
.pxr .res.ok{color:var(--ok)}.pxr .res.bad{color:var(--bad)}
.tag{font-family:ui-monospace,monospace;font-size:12px;background:var(--bg2);border:1px solid var(--bd);
  border-radius:6px;padding:2px 7px;white-space:nowrap;color:var(--fg)}
#toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translate(-50%,160%);
  background:var(--acc);color:#fff;padding:11px 18px;border-radius:11px;font-weight:600;font-size:13.5px;
  box-shadow:0 10px 30px rgba(0,0,0,.5);z-index:999;transition:transform .25s cubic-bezier(.2,.9,.3,1);max-width:90vw}
#toast.show{transform:translate(-50%,0)}
.gate{min-height:100vh;display:grid;place-items:center;padding:20px}
.gate .box{width:100%;max-width:400px}
.gate .box .card{margin:0}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:6px}
@media(max-width:560px){
  .wrap{padding:16px 12px 50px}
  .stats{grid-template-columns:repeat(2,1fr)}
  .row{flex-direction:column;align-items:stretch}.row>input,.row>button{width:100%}
  .mgrid{grid-template-columns:1fr}
  .kv{grid-template-columns:1fr;gap:3px 0}.kv .k{margin-top:9px}
  table.egress{font-size:12px}table.egress th,table.egress td{padding:6px}
}
`;

const head = (title) =>
  '<!doctype html><html lang=en><head><meta charset=utf-8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name=color-scheme content=dark><title>' + title + '</title><style>' + STYLE + '</style></head>';

// ───────── setup (first run) ─────────
export const setupHtml = head('ernie · setup') + `<body><div class="gate"><div class="box">
  <div class="bar"><div class="logo">🦊</div><div><h1><b>ernie-noauth</b></h1><div class="sub">first-run setup</div></div></div>
  <div class="card">
    <h2>Create admin password</h2>
    <p class="hint" style="margin-top:0">Protects the dashboard (proxy upload, status). Min 8 characters. Stored hashed in /data.</p>
    <input id=pw type=password placeholder="New admin password" autocomplete=new-password>
    <input id=pw2 type=password placeholder="Confirm password" autocomplete=new-password style="margin-top:10px">
    <button style="margin-top:12px;width:100%" id=btn onclick=go()>Create &amp; enter</button>
    <div class="err" id=err></div>
  </div></div></div>
<div id=toast>ok</div>
<script>
function go(){
  var p=document.getElementById('pw').value, p2=document.getElementById('pw2').value;
  var e=document.getElementById('err'); e.textContent='';
  if(p.length<8){ e.textContent='Password must be at least 8 characters.'; return; }
  if(p!==p2){ e.textContent='Passwords do not match.'; return; }
  var b=document.getElementById('btn'); b.disabled=true; b.textContent='Creating…';
  fetch('/admin/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:p})})
   .then(function(r){return r.json();}).then(function(d){
     if(d.ok) location.reload(); else { e.textContent=d.error||'Failed.'; b.disabled=false; b.textContent='Create & enter'; }
   }).catch(function(){ e.textContent='Network error.'; b.disabled=false; b.textContent='Create & enter'; });
}
document.getElementById('pw2').addEventListener('keydown',function(ev){ if(ev.key==='Enter') go(); });
</script></body></html>`;

// ───────── login ─────────
export const loginHtml = head('ernie · login') + `<body><div class="gate"><div class="box">
  <div class="bar"><div class="logo">🦊</div><div><h1><b>ernie-noauth</b></h1><div class="sub">admin login</div></div></div>
  <div class="card">
    <h2>Enter admin password</h2>
    <input id=pw type=password placeholder="Admin password" autocomplete=current-password autofocus>
    <button style="margin-top:12px;width:100%" id=btn onclick=go()>Unlock</button>
    <div class="err" id=err></div>
  </div></div></div>
<div id=toast>ok</div>
<script>
function go(){
  var p=document.getElementById('pw').value, e=document.getElementById('err'); e.textContent='';
  var b=document.getElementById('btn'); b.disabled=true; b.textContent='…';
  fetch('/admin/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:p})})
   .then(function(r){return r.json();}).then(function(d){
     if(d.ok) location.reload(); else { e.textContent=d.error||'Wrong password.'; b.disabled=false; b.textContent='Unlock'; }
   }).catch(function(){ e.textContent='Network error.'; b.disabled=false; b.textContent='Unlock'; });
}
document.getElementById('pw').addEventListener('keydown',function(ev){ if(ev.key==='Enter') go(); });
</script></body></html>`;

// ───────── dashboard ─────────
export const dashboardHtml = head('ernie-noauth · dashboard') + `<body>
<div id="toast">copied</div>
<div class="wrap">
  <div class="bar">
    <div class="logo">🦊</div>
    <div><h1><b>ernie-noauth</b> dashboard</h1><div class="sub">OpenAI-compatible proxy for chat.baidu.com</div></div>
    <button class="ghost sm out" onclick="logout()">Log out</button>
  </div>

  <div class="tabs" role="tablist">
    <button class="tab on" data-t="overview" onclick="tab('overview')">Overview</button>
    <button class="tab" data-t="models" onclick="tab('models')">Models</button>
    <button class="tab" data-t="proxies" onclick="tab('proxies')">Proxies</button>
  </div>

  <!-- OVERVIEW -->
  <section id="t-overview" class="panel">
    <div class="card">
      <div class="stats">
        <div class="stat"><b id="s-healthy">–</b><span>healthy IPs</span></div>
        <div class="stat"><b id="s-total">–</b><span>egress IPs</span></div>
        <div class="stat"><b id="s-req">–</b><span>requests served</span></div>
        <div class="stat"><b id="s-models">–</b><span>models</span></div>
      </div>
    </div>
    <div class="card">
      <h2>Connect your client</h2>
      <div class="kv">
        <div class="k">Base URL</div>
        <div class="copyline" onclick="copy(location.origin+'/v1','Base URL')">
          <span class="v" id="base-url">/v1</span><span class="ic">📋 copy</span></div>
        <div class="k">API key</div>
        <div class="copyline" id="apikey-line" onclick="copy('ernie','API key')">
          <span class="v" id="apikey-v">any value works (auth not enforced)</span><span class="ic">📋</span></div>
        <div class="k">Models list</div>
        <div class="copyline" onclick="copy(location.origin+'/v1/models','Models endpoint')">
          <span class="v" id="models-url">/v1/models</span><span class="ic">📋</span></div>
      </div>
      <p class="hint" style="margin-bottom:0">Drops into <b>JanitorAI</b>, <b>SillyTavern</b>, or any OpenAI client. Paste the Base URL as the custom endpoint, then pick a model from the <a onclick="tab('models')" style="cursor:pointer">Models</a> tab.</p>
    </div>
    <div class="card">
      <h2>Egress pool <span class="n" id="eg-n">0</span></h2>
      <p class="hint" style="margin-top:0;margin-bottom:12px">chat.baidu.com's guest quota is enforced per <b>egress IP</b>, not per cookie. Capacity scales with the number of IPs. A walled IP cools ~60s then auto-recovers.</p>
      <div style="overflow-x:auto"><table class="egress" id="eg-table">
        <tr><th>egress</th><th>state</th><th>tokens</th><th>cookie</th><th>ok</th><th>walled</th><th>err</th></tr>
        <tr><td colspan=7 class="hint">Loading…</td></tr>
      </table></div>
    </div>
  </section>

  <!-- MODELS -->
  <section id="t-models" class="panel" hidden>
    <div class="card">
      <h2>Models <span class="n" id="m-count">0</span></h2>
      <div class="mgrid" id="m-grid"><span class="hint">Loading…</span></div>
      <p class="hint" style="margin-top:14px;margin-bottom:0">Tap any model to copy its id. Badges: <span class="ab ab-t">🧠 think</span> adds reasoning, <span class="ab ab-s">🌐 search</span> adds live web search.</p>
    </div>
    <div class="card">
      <h2>Base models</h2>
      <p class="hint" style="margin-top:0">All run as guest, no login. Pick a base, then stack suffixes.</p>
      <div class="kv">
        <div class="k"><span class="tag">baidu-smart</span></div><div class="hint">auto-routes to the best model (default; also <span class="tag">ernie-noauth</span>)</div>
        <div class="k"><span class="tag">deepseek-v4</span></div><div class="hint">DeepSeek-V4 Pro — strongest coding &amp; reasoning</div>
        <div class="k"><span class="tag">deepseek-v4-flash</span></div><div class="hint">DeepSeek-V4 Flash — fast everyday answers</div>
        <div class="k"><span class="tag">deepseek-r1</span></div><div class="hint">DeepSeek-R1 — always deep-thinks</div>
        <div class="k"><span class="tag">ernie-5.1</span></div><div class="hint">文心 ERNIE 5.1 — Baidu's latest</div>
      </div>
    </div>
    <div class="card">
      <h2>Stackable suffixes</h2>
      <p class="hint" style="margin-top:0">Append to any base id (e.g. <span class="tag">deepseek-v4-search</span>, <span class="tag">ernie-5.1-think-en</span>):</p>
      <div class="kv">
        <div class="k"><span class="tag">-think</span> / <span class="tag">-reason</span></div><div class="hint">deep reasoning (emits thinking)</div>
        <div class="k"><span class="tag">-search</span> / <span class="tag">-web</span></div><div class="hint">live web search grounding</div>
        <div class="k"><span class="tag">-research</span></div><div class="hint">deep research = search + reasoning together</div>
        <div class="k"><span class="tag">-en</span> / <span class="tag">-english</span></div><div class="hint">force the reply in English</div>
      </div>
    </div>
  </section>

  <!-- PROXIES -->
  <section id="t-proxies" class="panel" hidden>
    <div class="card">
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><b id="px-count">–</b><span>proxies saved</span></div>
        <div class="stat"><b id="px-direct">–</b><span>direct IP</span></div>
        <div class="stat"><b id="px-live">–</b><span>egress IPs live</span></div>
      </div>
    </div>
    <div class="card">
      <h2>Egress proxy pool</h2>
      <p class="hint" style="margin-top:0;margin-bottom:12px">One proxy per line. More IPs = more throughput before the per-IP wall. Saving applies <b>instantly</b> (no restart).</p>
      <textarea id="px-text" rows="7" spellcheck="false" placeholder="host:port:user:pass&#10;host:port&#10;http://user:pass@host:port&#10;user:pass@host:port" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;resize:vertical"></textarea>
      <label class="row" style="margin-top:13px;cursor:pointer;gap:8px;flex-wrap:nowrap;align-items:center">
        <input type="checkbox" id="px-incdirect" style="width:18px;height:18px;flex:none;accent-color:var(--acc)">
        <span>Also use the Space's own IP (direct) as an egress slot</span>
      </label>
      <div class="row" style="margin-top:14px">
        <button id="px-save" onclick="saveProxy()">Save &amp; apply</button>
        <button class="ghost" id="px-test" onclick="testProxy()">Test all</button>
        <button class="ghost" id="px-copy" onclick="copySecret()">Copy as PROXIES secret</button>
      </div>
      <div class="err" id="px-err"></div>
      <div id="px-results" style="margin-top:6px"></div>
      <p class="hint" style="margin-top:14px;margin-bottom:0">Formats: <span class="tag">host:port:user:pass</span> (Webshare) · <span class="tag">host:port</span> · <span class="tag">scheme://user:pass@host:port</span> · <span class="tag">user:pass@host:port</span>. Saved to /data — survives rebuilds if persistent storage is on; otherwise paste the copied value into the Space's <b>PROXIES</b> secret to persist.</p>
    </div>
  </section>

  <p class="hint" style="text-align:center;opacity:.6;margin-top:8px">browser-free · cookies are auto-harvested per egress IP · the limit is per-IP, scale with proxies</p>
</div>
<script>
function tab(name){
  ['overview','models','proxies'].forEach(function(n){ var p=document.getElementById('t-'+n); if(p) p.hidden=(n!==name); });
  var tabs=document.querySelectorAll('.tab');
  for(var i=0;i<tabs.length;i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-t')===name);
  window.scrollTo({top:0,behavior:'smooth'});
}
function toast(m){ var t=document.getElementById('toast'); t.textContent=m; t.classList.add('show');
  clearTimeout(window._tt); window._tt=setTimeout(function(){t.classList.remove('show');},1700); }
function copy(text,label){
  function ok(){ toast((label||'Copied')+' copied ✓'); }
  function fb(){ try{ var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); ok(); }catch(e){ toast('Copy failed'); } }
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(ok,fb); } else { fb(); }
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function logout(){ fetch('/admin/api/logout',{method:'POST'}).then(function(){ location.reload(); }); }

function renderModels(ids){
  var grid=document.getElementById('m-grid');
  document.getElementById('m-count').textContent=ids.length;
  document.getElementById('s-models').textContent=ids.length;
  grid.innerHTML=ids.map(function(id){
    var bz='';
    if(/think|reason|r1|research/.test(id)) bz+='<span class="ab ab-t">🧠 think</span>';
    if(/search|web|research/.test(id)) bz+='<span class="ab ab-s">🌐 search</span>';
    var absHtml = bz? '<div class="abs">'+bz+'</div>' : '';
    return '<button class="mcard" data-m="'+esc(id)+'"><span class="mid">'+esc(id)+'</span>'+absHtml+'<span class="cp">📋 tap to copy</span></button>';
  }).join('');
}
document.addEventListener('click',function(e){
  var m=e.target.closest && e.target.closest('[data-m]'); if(m){ copy(m.getAttribute('data-m'),'Model'); }
});

function refresh(){
  fetch('/admin/api/status').then(function(r){ if(r.status===401){ location.reload(); throw 0; } return r.json(); }).then(function(d){
    var pool=d.pool||{slots:[]};
    document.getElementById('s-healthy').textContent=pool.healthy;
    document.getElementById('s-total').textContent=pool.size;
    var req=0; (pool.slots||[]).forEach(function(s){ req+=(s.ok||0); });
    document.getElementById('s-req').textContent=req;
    document.getElementById('eg-n').textContent=pool.size;
    var rows='<tr><th>egress</th><th>state</th><th>tokens</th><th>cookie</th><th>ok</th><th>walled</th><th>err</th></tr>';
    (pool.slots||[]).forEach(function(s){
      var state=s.cooling? '<span class="dot cool"></span>cooling '+Math.ceil(s.cooldownInMs/1000)+'s' : '<span class="dot ok"></span>ready';
      rows+='<tr><td class="mono">'+esc(s.label)+'</td><td>'+state+'</td><td>'+s.tokens+'</td><td>'+(s.hasCookie?'✓':'—')+'</td><td>'+s.ok+'</td><td>'+s.depleted+'</td><td>'+s.errors+'</td></tr>';
    });
    document.getElementById('eg-table').innerHTML=rows;
    if(d.models){ renderModels(d.models); }
    if(d.proxies){
      document.getElementById('px-count').textContent=d.proxies.count;
      document.getElementById('px-direct').textContent=d.proxies.includeDirect?'on':'off';
      document.getElementById('px-live').textContent=pool.size;
      if(!window._pxLoaded){ document.getElementById('px-text').value=d.proxies.text||''; document.getElementById('px-incdirect').checked=!!d.proxies.includeDirect; window._pxLoaded=true; }
    }
    var ak=document.getElementById('apikey-v');
    if(d.auth_required){ ak.textContent='required — set in your client (server API_KEY)'; }
  }).catch(function(){});
}
function saveProxy(){
  var text=document.getElementById('px-text').value, inc=document.getElementById('px-incdirect').checked;
  var err=document.getElementById('px-err'); err.textContent='';
  var b=document.getElementById('px-save'); b.disabled=true; b.textContent='Applying…';
  fetch('/admin/api/proxies',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text,includeDirect:inc})})
   .then(function(r){return r.json();}).then(function(d){
     if(d.ok){ toast('Saved · '+d.count+' prox'+(d.count===1?'y':'ies')+' · '+d.size+' egress IP'+(d.size===1?'':'s')+' ✓'); refresh(); }
     else err.textContent=d.error||'Failed to save.';
   }).catch(function(){ err.textContent='Network error.'; })
   .then(function(){ b.disabled=false; b.textContent='Save & apply'; });
}
function testProxy(){
  var text=document.getElementById('px-text').value;
  var err=document.getElementById('px-err'); err.textContent='';
  var box=document.getElementById('px-results');
  var b=document.getElementById('px-test'); b.disabled=true; b.textContent='Testing…';
  box.innerHTML='<div class="hint" style="margin-top:10px">Probing egress IPs… (up to 12s each)</div>';
  fetch('/admin/api/proxies/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text})})
   .then(function(r){return r.json();}).then(function(d){
     var rs=d.results||[];
     if(!rs.length){ box.innerHTML='<div class="hint" style="margin-top:10px">No valid proxies to test.</div>'; return; }
     box.innerHTML='<div class="hint" style="margin:12px 0 2px">'+(d.okCount||0)+' / '+rs.length+' working</div>'+rs.map(function(r){
       var label=esc(r.server||'')+(r.username?' <span style="color:var(--mut)">('+esc(r.username)+')</span>':'');
       var right=r.ok? '<span class="res ok">✓ '+esc(r.ip)+' · '+r.ms+'ms</span>' : '<span class="res bad">✗ '+esc((r.error||'failed').slice(0,40))+'</span>';
       return '<div class="pxr"><span class="srv">'+label+'</span>'+right+'</div>';
     }).join('');
   }).catch(function(){ box.innerHTML='<div class="err" style="margin-top:10px">Test request failed.</div>'; })
   .then(function(){ b.disabled=false; b.textContent='Test all'; });
}
function copySecret(){
  var lines=document.getElementById('px-text').value.split(/\\r?\\n/).map(function(s){return s.trim();}).filter(Boolean);
  copy(lines.join(','),'PROXIES secret');
}
document.getElementById('base-url').textContent=location.origin+'/v1';
document.getElementById('models-url').textContent=location.origin+'/v1/models';
refresh(); setInterval(refresh,3000);
</script></body></html>`;
