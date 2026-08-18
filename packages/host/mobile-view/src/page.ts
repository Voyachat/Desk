/** Self-contained responsive read-only mobile viewer. */

/**
 * Render the mobile page with one bounded polling interval.
 * @param pollIntervalMs - refresh interval interpolated into the page script.
 * @returns a self-contained HTML document.
 */
export function renderMobilePage(pollIntervalMs: number): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voyaseek Mobile View</title><style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,sans-serif;background:#111827;color:#f9fafb}body{margin:0}header{position:sticky;top:0;background:#111827ee;padding:12px;border-bottom:1px solid #374151}main{max-width:760px;margin:auto;padding:12px}input,select,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #4b5563;background:#1f2937;color:inherit}input{width:min(55vw,360px)}button{cursor:pointer}.bar{display:flex;gap:8px;flex-wrap:wrap}.status{font-size:12px;color:#9ca3af;margin-top:8px}.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;padding:12px;border-radius:12px;background:#1f2937}.user{border-left:4px solid #60a5fa}.assistant{border-left:4px solid #34d399}.meta{font-size:12px;color:#9ca3af;margin-bottom:6px}.empty{padding:32px;text-align:center;color:#9ca3af}@media(max-width:520px){input,select,button{width:100%;box-sizing:border-box}}
</style></head><body><header><div class="bar"><input id="token" type="password" autocomplete="off" placeholder="VOYASEEK_MOBILE_VIEW_TOKEN"><button id="connect">连接</button><select id="sessions" hidden></select></div><div class="status" id="status">Token 只保存在当前页面内存中。</div></header><main id="messages"><div class="empty">连接后选择会话。</div></main>
<script type="module">
let token='',active='',timer=0;const status=document.querySelector('#status'),sessions=document.querySelector('#sessions'),messages=document.querySelector('#messages');
async function api(path){const response=await fetch(path,{headers:{authorization:'Bearer '+token},cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);return response.json()}
function text(tag,value){const node=document.createElement(tag);node.textContent=value;return node}
async function loadSessions(){const data=await api('/mobile-view/api/sessions');sessions.replaceChildren();for(const item of data.sessions){const option=text('option',item.title||item.sessionId);option.value=item.sessionId;sessions.append(option)}sessions.hidden=false;if(!active&&data.sessions[0])active=data.sessions[0].sessionId;sessions.value=active;await loadMessages()}
async function loadMessages(){if(!active)return;const data=await api('/mobile-view/api/session?sessionId='+encodeURIComponent(active));const fragment=document.createDocumentFragment();for(const item of data.messages){const card=document.createElement('article');card.className='message '+item.role;card.append(text('div',(item.role==='user'?'用户':'助手')+' · '+new Date(item.time).toLocaleString()));card.lastChild.className='meta';card.append(text('div',item.text));fragment.append(card)}messages.replaceChildren(fragment.childNodes.length?fragment:text('div','没有可显示的消息。'));status.textContent='只读 · 更新至 '+new Date().toLocaleTimeString()}
async function connect(){token=document.querySelector('#token').value;clearInterval(timer);try{await loadSessions();timer=setInterval(()=>loadMessages().catch(error=>status.textContent=error.message),${String(pollIntervalMs)})}catch(error){status.textContent=error.message}}
document.querySelector('#connect').addEventListener('click',()=>void connect());sessions.addEventListener('change',()=>{active=sessions.value;void loadMessages()});
</script></body></html>`
}
