'use strict';

// All assets are embedded because the BMW source builder copies JavaScript,
// but does not expose arbitrary top-level HTML files to the installed OAP app.
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>MGU GameStation Controller</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0c1321;color:#f5f9ff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;overscroll-behavior:none;touch-action:none}
header{padding:15px 20px;display:flex;align-items:center;justify-content:space-between;background:#151f30;border-bottom:1px solid #334359}h1{font-size:19px;margin:0}#status{font-size:13px;color:#ffa365}#status.good{color:#70e6ab}
main{max-width:900px;margin:auto;padding:15px}.hint{font-size:13px;color:#b1c3d7}#pad{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:290px}
.dpad{display:grid;grid-template-columns:repeat(3,58px);grid-template-rows:repeat(3,58px);gap:4px}.actions{display:grid;grid-template-columns:repeat(2,65px);gap:13px;transform:rotate(-9deg)}
.key{border:1px solid #627895;border-radius:15px;background:#22314a;color:white;font-size:20px;font-weight:700;touch-action:none;user-select:none;-webkit-user-select:none}.key.down{background:#4a8bd3;border-color:#a6d9ff;transform:scale(.95)}.key:active{background:#4a8bd3}.actions .key{height:65px;border-radius:50%;background:#463350;border-color:#a46aa8}.actions .key.down{background:#c74c95}
.mid{display:flex;justify-content:center;gap:12px} .mid .key{font-size:12px;min-width:83px;padding:12px;border-radius:26px}
#uploads{margin-top:30px;padding:16px;border:1px solid #33435a;border-radius:14px}select,input{max-width:100%;color:white;background:#1d2d45;padding:9px;border:1px solid #526684;border-radius:9px}#upload{margin-top:8px}button[type=submit]{background:#2e7db5;padding:10px 17px;border:0;border-radius:8px;color:white}
@media(max-width:440px){.dpad{grid-template-columns:repeat(3,45px);grid-template-rows:repeat(3,45px)}.actions{grid-template-columns:repeat(2,51px)}.actions .key{height:51px}.key{font-size:17px}#pad{min-height:245px}}
</style></head><body>
<header><h1>GAMESTATION · P<span id="player"></span></h1><span id="status">Connecting…</span></header>
<main><div id="pad"><div class="dpad"><i></i><button class="key" data-key="up">▲</button><i></i><button class="key" data-key="left">◀</button><i></i><button class="key" data-key="right">▶</button><i></i><button class="key" data-key="down">▼</button><i></i></div>
<div class="actions"><button class="key" data-key="b">B</button><button class="key" data-key="a">A</button><button class="key" data-key="y">Y</button><button class="key" data-key="x">X</button></div></div>
<div class="mid"><button class="key" data-key="select">SELECT</button><button class="key" data-key="start">START</button></div>
<p class="hint">Keep this page open. Both phones must join the BMW hotspot. Long-press to hold a button.</p>
<details id="uploads"><summary>Add your own legally obtained game file</summary><form id="upload"><select id="platform"><option value="nes">NES (.nes)</option><option value="gb">Game Boy / Color (.gb, .gbc)</option><option value="snes">SNES (.sfc, .smc)</option></select><p><input type="file" id="rom" required></p><button type="submit">Upload to GameStation</button><p id="result" class="hint"></p></form></details></main>
<script>
(function(){'use strict';var params=new URLSearchParams(location.search),token=params.get('t')||'',player=params.get('p')==='2'?2:1,keys={},ws=null,timer=null;
document.getElementById('player').textContent=String(player);var status=document.getElementById('status');
function send(){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'buttons',keys:Object.keys(keys).filter(function(k){return keys[k]})}));}
function release(){keys={};document.querySelectorAll('.key.down').forEach(function(el){el.classList.remove('down')});send()}
function connect(){ws=new WebSocket('ws://'+location.host+'/?t='+encodeURIComponent(token)+'&p='+player);
ws.onopen=function(){status.textContent='Connected';status.className='good';release();timer=setInterval(send,400)};
ws.onclose=function(){status.textContent='Disconnected — retrying';status.className='';clearInterval(timer);release();setTimeout(connect,1500)};
ws.onerror=function(){status.textContent='Connection error'};
}
Array.prototype.forEach.call(document.querySelectorAll('[data-key]'),function(b){function set(v,e){if(e){e.preventDefault()}keys[b.dataset.key]=v;b.classList.toggle('down',v);send()}
b.addEventListener('pointerdown',function(e){b.setPointerCapture(e.pointerId);set(true,e)});b.addEventListener('pointerup',function(e){set(false,e)});b.addEventListener('pointercancel',function(e){set(false,e)});b.addEventListener('lostpointercapture',function(){set(false)})});
window.addEventListener('blur',release);document.addEventListener('visibilitychange',function(){if(document.hidden)release()});
document.getElementById('upload').addEventListener('submit',function(e){e.preventDefault();var file=document.getElementById('rom').files[0];if(!file)return;var kind=document.getElementById('platform').value;var result=document.getElementById('result');
result.textContent='Uploading…';fetch('/rom?t='+encodeURIComponent(token)+'&platform='+encodeURIComponent(kind)+'&name='+encodeURIComponent(file.name),{method:'POST',body:file}).then(function(r){return r.text().then(function(t){if(!r.ok)throw Error(t);return t})}).then(function(t){result.textContent=t}).catch(function(e){result.textContent=e.message})});connect();
})();
</script></body></html>`;

module.exports = HTML;
