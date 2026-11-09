'use strict';

module.exports = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MGU Video Hub</title><style>
*{box-sizing:border-box}body{margin:0;background:#08121e;color:#ecf4ff;font:16px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
main{max-width:720px;margin:auto;padding:26px 18px 90px}header{display:flex;align-items:center;gap:14px;margin-bottom:26px}
.logo{display:grid;place-items:center;width:53px;height:53px;border-radius:16px;background:#183e55;color:#72d9ff;font-size:30px}
h1{font-size:26px;margin:0}small,.sub{color:#91a9be}h2{font-size:19px;margin:0 0 14px}.sub{line-height:1.5}
section{border:1px solid #243849;background:#132538;border-radius:19px;padding:22px;margin:16px 0}
input,button{font:inherit;border-radius:11px;padding:14px;width:100%}input{background:#081a2a;border:1px solid #38536a;color:white;min-width:0}
button{border:0;background:#56bfe8;color:#06131d;font-weight:750;margin-top:10px;cursor:pointer}
button:disabled{opacity:.6}.ghost{background:#213a50;color:#c9e1f4}
#status{min-height:24px;color:#92dbc0}#error{color:#ffa69b}#video{width:100%;margin:5px 0}
progress{width:100%;height:10px;accent-color:#66d9ff}.row{display:flex;gap:10px}.row>*{flex:1;min-width:0}
</style></head><body><main>
<header><div class="logo">▶</div><div><h1>MGU Video Hub</h1><small>Phone companion · Local network</small></div></header>
<p class="sub">Choose a video on this phone to import to the MGU, or send a YouTube link. The car must be parked. This page itself does not decode video for the head unit.</p>
<section><h2>Import a local video</h2><input id="video" type="file" accept="video/mp4,video/x-m4v,video/quicktime,video/x-matroska,video/webm,video/x-msvideo,.mp4,.m4v,.mov,.mkv,.webm,.avi">
<button id="upload">Upload to car</button><progress id="progress" value="0" max="100" hidden></progress>
<p class="sub">Up to 256 MB per file, 768 MB total. For large movies use a USB drive.</p></section>
<section><h2>YouTube</h2><input id="link" type="url" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off">
<button id="add">Send link to car</button><p class="sub">Playback on the MGU is experimental and requires an Internet uplink, ffmpeg and yt-dlp on the head unit. No videos are downloaded from YouTube.</p></section>
<section><h2>Status</h2><div id="status">Waiting</div><div id="error"></div><button class="ghost" id="refresh">Refresh</button></section>
<section><h2>Diagnostics / Logs</h2><p class="sub">Download the app's diagnostic JSON to send it for troubleshooting. Includes timestamps, player errors, decoder availability and MGU Store Internet status. Pairing tokens and stream URLs are excluded.</p>
<button id="download" class="ghost">Download diagnostic JSON</button></section>
<script>
const token=new URLSearchParams(location.search).get('t');
const el=id=>document.getElementById(id);
function msg(text,error){el('status').textContent=error?'Error':text;el('error').textContent=error||''}
function api(name){return name+'?t='+encodeURIComponent(token)}
async function sendLink(){const url=el('link').value.trim();if(!url)return;el('add').disabled=true;
try{const r=await fetch(api('/youtube'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
const j=await r.json();if(!r.ok)throw Error(j.error||r.status);msg('Link added: '+j.id);el('link').value=''}catch(e){msg('',e.message)}finally{el('add').disabled=false}}
function upload(){const file=el('video').files[0];if(!file)return msg('','Choose a file first');
if(file.size>256*1024*1024)return msg('','File exceeds 256 MB');
const p=el('progress'),x=new XMLHttpRequest();p.hidden=false;p.value=0;el('upload').disabled=true;
x.open('POST',api('/upload'));x.setRequestHeader('X-Filename',encodeURIComponent(file.name));
x.upload.onprogress=e=>{if(e.lengthComputable)p.value=Math.floor(100*e.loaded/e.total)};
x.onload=()=>{el('upload').disabled=false;try{const j=JSON.parse(x.responseText);if(x.status!==201)throw Error(j.error);msg('Imported: '+j.name);el('video').value=''}catch(e){msg('',e.message)}};
x.onerror=()=>{el('upload').disabled=false;msg('','Network connection failed')};x.send(file)}
async function refresh(){try{const r=await fetch(api('/status'));const j=await r.json();
if(!r.ok)throw Error(j.error);msg(j.files+' videos on car; '+j.links+' YouTube links; '+j.logs+' log entries')}
catch(e){msg('',e.message)}}
el('add').onclick=sendLink;el('upload').onclick=upload;el('refresh').onclick=refresh;
el('download').onclick=()=>{location.assign(api('/diagnostics.json'))};refresh();
</script></main></body></html>`;
