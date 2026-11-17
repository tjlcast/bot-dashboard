const $ = (s) => document.querySelector(s);
const app = $('#app');
const notificationPreferenceKey = 'platform-system-notifications';
const savedNotificationPreference = () => { try { return localStorage.getItem(notificationPreferenceKey) === 'enabled'; } catch { return false; } };
const state = { page: 'workspace', traces: [], selectedTrace: null, nodes: [], selectedNode: null, drawerOpen: false, mobileTracesOpen: false, unreadOnly: false, sort: 'recent_activity', newNodeIdsByTrace: {}, canvasViewByTrace: {}, selectedTraceIds: new Set(), multiSelectMode: false, editingTraceName: null, settingsOpen: false, systemNotifications: savedNotificationPreference(), focusNodeId: null, focusLatestNode: false, viewMode: 'canvas', loadingTrace: null, traceLoadRequestId: 0 };
const esc = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
const time = (iso) => { const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); };
const typeName = { report: '汇报', decision: '结论', checkpoint: '检查点', blocked: '待介入' };
async function api(path, options) { const r = await fetch(`/v1${path}`, options); const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || '请求失败'); return d; }
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }
async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('COPY_FAILED');
    }
    toast('已复制');
  } catch {
    toast('复制失败，请手动复制');
  }
}
const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="1.5"></rect><path d="M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16H9"></path></svg>';
function nav(active) { return `<nav class="side"><div class="brand">A</div><button class="nav ${active === 'workspace' ? 'active' : ''}" data-page="workspace" title="工作台">⌘</button><button class="nav ${active === 'inbox' ? 'active' : ''}" data-page="inbox" title="收件箱">▣</button><button class="nav ${active === 'devices' ? 'active' : ''}" data-page="devices" title="接入">⌁</button><button class="nav bottom ${state.settingsOpen ? 'active' : ''}" data-settings title="设置">⚙</button></nav>`; }
async function loadTraces() { state.traces = (await api(`/traces?sort=${state.sort}&unreadOnly=${state.unreadOnly}`)).traces; state.selectedTraceIds = new Set([...state.selectedTraceIds].filter((id) => state.traces.some((trace) => trace.id === id))); if (!state.selectedTrace || !state.traces.some((x) => x.id === state.selectedTrace)) state.selectedTrace = state.traces[0]?.id; }
async function loadNodes() { if (!state.selectedTrace) return; state.nodes = (await api(`/traces/${state.selectedTrace}/nodes`)).nodes; if (state.selectedNode && !state.nodes.some((node) => node.id === state.selectedNode)) state.selectedNode = null; }
const traceName = (trace) => trace.name || trace.title;
const displayTraceName = (trace) => { const name = traceName(trace); const characters = Array.from(name); return characters.length > 20 ? `${characters.slice(0, 20).join('')}…` : name; };
const nodeContext = (node) => (node.input || node.detail || node.title || '').trim();
const displayNodeContext = (node) => { const context = nodeContext(node); const characters = Array.from(context); return characters.length > 12 ? `${characters.slice(0, 12).join('')}…` : context; };
function traceList() { return state.traces.map((t) => { const loading = t.id === state.loadingTrace; return `<div class="trace-item ${state.multiSelectMode ? 'multi-selecting' : ''}">${state.multiSelectMode ? `<label class="trace-select" title="选择汇报链"><input type="checkbox" data-select-trace="${t.id}" ${state.selectedTraceIds.has(t.id) ? 'checked' : ''} /><span class="sr-only">选择 ${esc(traceName(t))}</span></label>` : ''}<button class="trace ${t.id === state.selectedTrace ? 'selected' : ''} ${t.unread_count ? 'unread' : ''} ${loading ? 'loading' : ''}" data-trace="${t.id}" ${loading ? 'aria-busy="true"' : ''}>${t.unread_count ? '<i class="trace-new-dot" aria-label="有新汇报"></i>' : ''}<div class="trace-row"><strong class="trace-name" title="${esc(traceName(t))}">${loading ? '<i class="trace-loading-spinner" aria-hidden="true"></i>' : ''}${esc(displayTraceName(t))}</strong>${t.pending_count ? `<span class="pending">待介入 ${t.pending_count}</span>` : ''}</div><small class="trace-source">${loading ? '正在加载…' : `${esc(t.source_summary)} · ${time(t.last_activity_at)}`}</small><p class="trace-meta">${t.node_count} 个节点${t.pending_count ? ' · 等待处理' : ' · 正常推进'}</p></button><button class="trace-edit" type="button" data-edit-trace="${t.id}" aria-label="修改汇报链名字" title="修改名字">✎</button><button class="trace-delete" type="button" data-delete-trace="${t.id}" aria-label="删除汇报链" title="删除汇报链">×</button></div>`; }).join('') || '<div class="empty">没有符合条件的汇报链</div>'; }
function positions(nodes) {
  const byParent = new Map(); nodes.forEach((n) => { const key = n.parent_node_id || 'root'; byParent.set(key, [...(byParent.get(key) || []), n]); });
  const pos = new Map(); let row = 0;
  function walk(node, depth) { const children = byParent.get(node.id) || []; if (!children.length) { pos.set(node.id, { x: 46 + depth * 215, y: 130 + row++ * 140 }); return; } children.forEach((c) => walk(c, depth + 1)); const ys = children.map((c) => pos.get(c.id).y); pos.set(node.id, { x: 46 + depth * 215, y: (Math.min(...ys) + Math.max(...ys)) / 2 }); }
  (byParent.get('root') || []).forEach((n) => walk(n, 0)); return pos;
}
function canvas() {
  if (state.loadingTrace) return `<section class="canvas canvas-loading" aria-busy="true"><div class="canvas-loader"><i class="canvas-loading-spinner" aria-hidden="true"></i><strong>正在加载汇报链</strong><span>正在从云端获取最新节点…</span></div></section>`;
  const pos = positions(state.nodes); const edges = state.nodes.filter((n) => n.parent_node_id).map((n) => { const a = pos.get(n.parent_node_id), b = pos.get(n.id); return `<path class="${n.id === state.selectedNode ? 'active' : ''}" d="M ${a.x + 170} ${a.y + 48} C ${a.x + 190} ${a.y + 48}, ${b.x - 20} ${b.y + 48}, ${b.x} ${b.y + 48}" />`; }).join('');
  const newNodeIds = new Set(state.newNodeIdsByTrace[state.selectedTrace] || []);
  const cards = state.nodes.map((n) => { const p = pos.get(n.id); const status = n.status === 'blocked' ? 'blocked' : n.status === 'replied' ? 'replied' : ''; return `<button class="node ${status} ${newNodeIds.has(n.id) ? 'new-report' : ''} ${n.id === state.selectedNode ? 'selected' : ''}" data-node="${n.id}" style="left:${p.x}px;top:${p.y}px"><span class="node-type"><i class="dot ${status}"></i>${typeName[n.node_type] || n.node_type}</span><strong class="node-context" title="${esc(nodeContext(n))}">${esc(displayNodeContext(n))}</strong><span class="node-title" title="${esc(n.title)}">${esc(n.title)}</span><time>${new Date(n.occurred_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · ${esc(n.app)}</time></button>`; }).join('');
  return `<section class="canvas"><div class="canvas-inner"><svg class="edges" width="100%" height="100%">${edges}</svg>${cards}<div class="legend"><span><i class="dot"></i> 已完成</span><span><i class="dot blocked"></i> 待介入</span><span>点击节点查看详情</span></div></div></section>`;
}
function drawer() { const n = state.nodes.find((x) => x.id === state.selectedNode); if (!n) return '<aside class="drawer"></aside>'; const source = n.source_url ? `<a href="${esc(n.source_url)}">打开原始会话 ↗</a>` : '<span>此来源暂不支持跳转</span>'; const content = n.conclusion || n.detail || ''; const input = n.input || ''; const copyButton = (field, label) => `<button class="copy-icon" type="button" data-copy-node-field="${field}" aria-label="复制${label}" title="复制${label}">${copyIcon}</button>`; return `<aside class="drawer ${state.drawerOpen ? 'open' : ''}" id="drawer"><div class="drawer-head"><div><div class="node-type"><i class="dot ${n.status === 'blocked' ? 'blocked' : n.status === 'replied' ? 'replied' : ''}"></i>${typeName[n.node_type]}</div><h2>${esc(n.title)}</h2></div><button class="close" data-close>×</button></div><div class="status">${n.status === 'blocked' ? '等待你的介入' : n.status === 'replied' ? '已回复，等待 Agent' : '已完成'}</div><div class="section"><div class="section-heading"><h3>内容</h3>${copyButton('content', '内容')}</div><p>${esc(content || '暂无结论')}</p></div><div class="section"><div class="section-heading"><h3>输入 / 上下文</h3>${copyButton('input', '输入/上下文')}</div><p>${esc(input || '暂无输入内容')}</p></div><div class="section"><h3>来源</h3><dl class="meta"><dt>设备</dt><dd>${esc(n.device_id)}</dd><dt>应用</dt><dd>${esc(n.app)}</dd><dt>会话</dt><dd>${esc(n.session_id)}</dd><dt>时间</dt><dd>${new Date(n.occurred_at).toLocaleString('zh-CN')}</dd><dt>原始会话</dt><dd>${source}</dd></dl></div>${n.status === 'blocked' ? `<div class="section"><h3>介入并发送</h3><textarea class="reply" id="reply" placeholder="输入给 Agent 的回复…"></textarea><div class="reply-actions"><button class="btn" data-close>取消</button><button class="btn primary" data-send="${n.id}">发送</button></div></div>` : ''}<div class="section danger-zone"><h3>危险操作</h3><p>删除此汇报链会同时删除全部汇报节点与人工介入记录。</p><button class="btn danger" data-delete-trace="${n.trace_id}">删除此汇报链</button></div></aside>`; }
function settingsMenu() { if (!state.settingsOpen) return ''; const supported = 'Notification' in window; return `<section class="settings-menu" aria-label="设置"><h2>设置</h2><fieldset ${supported ? '' : 'disabled'}><legend>系统提示</legend><label><input type="radio" name="system-notifications" value="enabled" ${state.systemNotifications ? 'checked' : ''} /> 开启系统提示</label><label><input type="radio" name="system-notifications" value="disabled" ${state.systemNotifications ? '' : 'checked'} /> 关闭系统提示</label></fieldset>${supported ? '<p>开启后，浏览器会在收到新汇报时发出系统通知。</p>' : '<p>当前浏览器不支持系统提示。</p>'}</section>`; }
async function workspace() {
  await loadTraces(); await loadNodes();
  if (state.focusLatestNode) {
    state.focusNodeId = state.nodes.length ? state.nodes.reduce((latest, node) => new Date(node.occurred_at) > new Date(latest.occurred_at) ? node : latest).id : null;
    state.focusLatestNode = false;
  }
  const trace = state.traces.find((t) => t.id === state.selectedTrace);
  const loadingTrace = state.traces.find((t) => t.id === state.loadingTrace);
  const displayedTrace = loadingTrace || trace;
  const selectedCount = state.selectedTraceIds.size;
  const traceHeading = loadingTrace
    ? `<span class="trace-heading trace-heading-loading" aria-busy="true"><i class="trace-loading-spinner" aria-hidden="true"></i>${esc(displayTraceName(loadingTrace))}</span>`
    : trace && state.editingTraceName === trace.id
    ? `<form class="trace-name-editor" data-trace-name-editor="${trace.id}"><input id="trace-name-input" value="${esc(traceName(trace))}" aria-label="汇报链名字" maxlength="500" /><button class="tiny primary" type="submit">保存</button><button class="tiny" type="button" data-cancel-trace-name>取消</button></form>`
    : `<button class="trace-heading" type="button" data-edit-current-trace title="点击修改汇报链名字">${esc(trace ? displayTraceName(trace) : '工作台')}</button>`;
  const filters = `<div class="filters"><button class="filter ${!state.unreadOnly ? 'active' : ''}" data-unread="false">全部</button><button class="filter ${state.unreadOnly ? 'active' : ''}" data-unread="true">有新汇报</button></div>`;
  app.innerHTML = `<div class="shell">${nav('workspace')}<main class="main"><header class="top"><div class="top-title"><div class="title" title="${esc(displayedTrace ? traceName(displayedTrace) : '工作台')}">${traceHeading}</div><div class="eyebrow">${esc(displayedTrace?.source_summary || '选择一条汇报链')} · ${displayedTrace?.node_count || 0} 个节点</div></div><div class="toolbar"><button class="tiny mobile-traces-trigger" data-mobile-traces>汇报链</button><button class="tiny" data-fit>适应画板</button><button class="tiny" data-refresh>刷新</button></div></header>${canvas()}</main><div class="mobile-traces-backdrop ${state.mobileTracesOpen ? 'open' : ''}" data-close-mobile-traces></div><aside class="traces ${state.mobileTracesOpen ? 'open' : ''}" aria-label="汇报链"><div class="trace-head"><div class="trace-list-title"><h2>汇报链</h2><div class="trace-list-actions"><button class="tiny mobile-traces-close" data-close-mobile-traces aria-label="关闭汇报链">×</button><button class="tiny" data-toggle-multi-select>${state.multiSelectMode ? '取消多选' : '多选'}</button>${state.multiSelectMode ? `<button class="tiny" data-select-all>全部选择</button><button class="tiny danger" data-delete-selected ${selectedCount ? '' : 'disabled'}>删除${selectedCount ? `（${selectedCount}）` : ''}</button>` : ''}</div></div>${filters}<select class="sort" id="sort"><option value="recent_activity">最近活跃</option><option value="pending_first">待介入优先</option><option value="recent_created">最近创建</option></select></div><div class="trace-list">${traceList()}</div><div class="live"><i class="online"></i>实时同步正常</div></aside></div>${drawer()}${settingsMenu()}`;
  $('#sort').value = state.sort;
  renderViewMode();
  if (state.viewMode === 'conversation') {
    bind();
    bindConversationCollapsing();
    const nameInput = $('#trace-name-input'); if (nameInput) { nameInput.focus(); nameInput.select(); }
    return;
  }
  const canvasElement = $('.canvas');
  const focusNode = state.nodes.find((node) => node.id === state.focusNodeId);
  const position = focusNode ? positions(state.nodes).get(focusNode.id) : null;
  if (focusNode && position) {
    canvasElement.scrollLeft = Math.max(0, position.x + 85 - canvasElement.clientWidth / 2);
    canvasElement.scrollTop = Math.max(0, position.y + 48 - canvasElement.clientHeight / 2);
    state.canvasViewByTrace[state.selectedTrace] = { left: canvasElement.scrollLeft, top: canvasElement.scrollTop };
    state.focusNodeId = null;
  } else {
    const view = state.canvasViewByTrace[state.selectedTrace];
    if (view) { canvasElement.scrollLeft = view.left; canvasElement.scrollTop = view.top; }
  }
  bind();
  const nameInput = $('#trace-name-input'); if (nameInput) { nameInput.focus(); nameInput.select(); }
}
async function viewTrace(traceId) { const { newNodeIds } = await api(`/traces/${traceId}/view`, { method: 'POST' }); state.newNodeIdsByTrace[traceId] = newNodeIds; return newNodeIds; }
function showTraceLoading(traceId) {
  const trace = state.traces.find((item) => item.id === traceId);
  const heading = $('.top .title');
  if (trace && heading) {
    heading.title = traceName(trace);
    heading.innerHTML = `<span class="trace-heading trace-heading-loading" aria-busy="true"><i class="trace-loading-spinner" aria-hidden="true"></i>${esc(displayTraceName(trace))}</span>`;
  }
  document.querySelectorAll('[data-trace]').forEach((button) => {
    const loading = button.dataset.trace === traceId;
    button.classList.toggle('loading', loading);
    button.toggleAttribute('aria-busy', loading);
    if (!loading) return;
    const name = button.querySelector('.trace-name');
    if (name && !name.querySelector('.trace-loading-spinner')) name.insertAdjacentHTML('afterbegin', '<i class="trace-loading-spinner" aria-hidden="true"></i>');
    const source = button.querySelector('.trace-source');
    if (source) source.textContent = '正在加载…';
  });
  const canvasElement = $('.canvas');
  if (canvasElement) canvasElement.outerHTML = canvas();
}
async function updateTraceName(traceId, name) { const trimmed = name.trim(); if (!trimmed) return toast('汇报链名字不能为空'); try { await api(`/traces/${traceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmed }) }); state.editingTraceName = null; toast('汇报链名字已更新'); await workspace(); } catch (error) { toast(error.message); } }
async function renameTrace(traceId) { const trace = state.traces.find((item) => item.id === traceId); const name = prompt('修改汇报链名字', traceName(trace)); if (name !== null) await updateTraceName(traceId, name); }
async function deleteTraces(traceIds) { const traces = traceIds.map((id) => state.traces.find((trace) => trace.id === id)).filter(Boolean); if (!traces.length) return; const names = traces.map((trace) => `• ${traceName(trace)}`).join('\n'); const label = traces.length === 1 ? '此汇报链' : `这 ${traces.length} 条汇报链`; if (!confirm(`确认删除${label}吗？\n\n${names}\n\n将同时删除其中全部汇报节点、节点详情与人工介入记录。此操作无法撤销。`)) return; try { await api('/traces', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ traceIds }) }); traceIds.forEach((id) => { state.selectedTraceIds.delete(id); delete state.canvasViewByTrace[id]; delete state.newNodeIdsByTrace[id]; }); state.selectedNode = null; state.drawerOpen = false; toast(`已删除 ${traces.length} 条汇报链`); await workspace(); } catch (error) { toast(error.message); } }
async function setSystemNotifications(enabled) { if (!enabled) { state.systemNotifications = false; try { localStorage.setItem(notificationPreferenceKey, 'disabled'); } catch {} toast('系统提示已关闭'); await workspace(); return; } if (!('Notification' in window)) { toast('当前浏览器不支持系统提示'); return; } const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); if (permission !== 'granted') { state.systemNotifications = false; toast('未获得系统提示权限，请在浏览器设置中允许通知'); await workspace(); return; } state.systemNotifications = true; try { localStorage.setItem(notificationPreferenceKey, 'enabled'); } catch {} toast('系统提示已开启'); await workspace(); }
async function notifyNewReport(event) { if (!state.systemNotifications || !('Notification' in window) || Notification.permission !== 'granted') return; try { const { nodeId } = JSON.parse(event.data); const { node } = await api(`/nodes/${nodeId}`); const preview = Array.from(nodeContext(node)).slice(0, 40).join(''); new Notification('收到新的汇报', { body: `${node.trace_title}\n${preview}`, tag: `report-${nodeId}` }); } catch { new Notification('收到新的汇报', { body: '打开 Platform 查看详情。' }); } }
function bindCanvasPan() {
  const canvas = $('.canvas'); if (!canvas) return;
  let pointer = null;
  canvas.onscroll = () => { state.canvasViewByTrace[state.selectedTrace] = { left: canvas.scrollLeft, top: canvas.scrollTop }; };
  canvas.onpointerdown = (event) => {
    if (event.button !== 0 || event.target.closest('[data-node], button, input, textarea, select, a')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
  };
  canvas.onpointermove = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    canvas.scrollLeft = pointer.left - (event.clientX - pointer.x);
    canvas.scrollTop = pointer.top - (event.clientY - pointer.y);
  };
  const stopPanning = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointer = null; canvas.classList.remove('dragging');
  };
  canvas.onpointerup = stopPanning; canvas.onpointercancel = stopPanning;
}
function bind() {
  document.querySelectorAll('[data-page]').forEach((b) => b.onclick = () => navigate(b.dataset.page));
  document.querySelectorAll('[data-trace]').forEach((b) => b.onclick = async () => {
    const traceId = b.dataset.trace;
    const requestId = ++state.traceLoadRequestId;
    state.loadingTrace = traceId;
    showTraceLoading(traceId);
    try {
      await viewTrace(traceId);
      if (requestId !== state.traceLoadRequestId) return;
      state.selectedTrace = traceId; state.focusNodeId = null; state.focusLatestNode = true; state.selectedNode = null; state.drawerOpen = false; state.mobileTracesOpen = false;
    } catch (error) {
      if (requestId === state.traceLoadRequestId) toast(error.message);
    } finally {
      if (requestId !== state.traceLoadRequestId) return;
      state.loadingTrace = null;
      await workspace();
    }
  });
  const openMobileTraces = $('[data-mobile-traces]'); if (openMobileTraces) openMobileTraces.onclick = () => { state.mobileTracesOpen = true; workspace(); };
  document.querySelectorAll('[data-close-mobile-traces]').forEach((b) => b.onclick = () => { state.mobileTracesOpen = false; workspace(); });
  const currentTraceEditor = $('[data-edit-current-trace]'); if (currentTraceEditor) currentTraceEditor.onclick = () => { state.editingTraceName = state.selectedTrace; workspace(); };
  const traceNameEditor = $('[data-trace-name-editor]'); if (traceNameEditor) traceNameEditor.onsubmit = (event) => { event.preventDefault(); updateTraceName(traceNameEditor.dataset.traceNameEditor, $('#trace-name-input').value); };
  document.querySelectorAll('[data-cancel-trace-name]').forEach((b) => b.onclick = () => { state.editingTraceName = null; workspace(); });
  const multiSelect = $('[data-toggle-multi-select]'); if (multiSelect) multiSelect.onclick = () => { state.multiSelectMode = !state.multiSelectMode; if (!state.multiSelectMode) state.selectedTraceIds.clear(); workspace(); };
  const selectAll = $('[data-select-all]'); if (selectAll) selectAll.onclick = () => { state.traces.forEach((trace) => state.selectedTraceIds.add(trace.id)); workspace(); };
  document.querySelectorAll('[data-select-trace]').forEach((input) => input.onchange = () => { if (input.checked) state.selectedTraceIds.add(input.dataset.selectTrace); else state.selectedTraceIds.delete(input.dataset.selectTrace); workspace(); });
  document.querySelectorAll('[data-edit-trace]').forEach((b) => b.onclick = () => renameTrace(b.dataset.editTrace));
  document.querySelectorAll('[data-delete-trace]').forEach((b) => b.onclick = () => deleteTraces([b.dataset.deleteTrace]));
  const deleteSelected = $('[data-delete-selected]'); if (deleteSelected) deleteSelected.onclick = () => deleteTraces([...state.selectedTraceIds]);
  document.querySelectorAll('[data-node]').forEach((b) => b.onclick = async () => { state.selectedNode = b.dataset.node; state.drawerOpen = true; await workspace(); });
  document.querySelectorAll('[data-copy-node-field]').forEach((b) => b.onclick = () => {
    const node = state.nodes.find((item) => item.id === state.selectedNode);
    if (!node) return;
    copyText(b.dataset.copyNodeField === 'input' ? (node.input || '') : (node.conclusion || node.detail || ''));
  });
  document.querySelectorAll('[data-copy-conversation]').forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    const node = state.nodes.find((item) => item.id === button.dataset.copyConversation);
    if (!node) return;
    copyText(button.dataset.conversationField === 'question'
      ? (node.input || node.title || '')
      : (node.conclusion || node.detail || node.title || ''));
  });
  document.querySelectorAll('[data-copy-conversation]').forEach((button) => button.ondblclick = (event) => event.stopPropagation());
  document.querySelectorAll('[data-unread]').forEach((b) => b.onclick = async () => { state.unreadOnly = b.dataset.unread === 'true'; await workspace(); });
  const sort = $('#sort'); if (sort) sort.onchange = async () => { state.sort = sort.value; await workspace(); };
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { state.drawerOpen = false; workspace(); });
  const refresh = $('[data-refresh]'); if (refresh) refresh.onclick = workspace;
  const fit = $('[data-fit]'); if (fit) fit.onclick = () => {
    const canvas = $('.canvas');
    if (!canvas || !state.nodes.length) return;
    const layout = positions(state.nodes);
    const points = [...layout.values()];
    const left = Math.min(...points.map((p) => p.x)); const right = Math.max(...points.map((p) => p.x + 170));
    const top = Math.min(...points.map((p) => p.y)); const bottom = Math.max(...points.map((p) => p.y + 96));
    canvas.scrollLeft = Math.max(0, (left + right - canvas.clientWidth) / 2);
    canvas.scrollTop = Math.max(0, (top + bottom - canvas.clientHeight) / 2);
  };
  const send = $('[data-send]'); if (send) send.onclick = () => sendIntervention(send.dataset.send);
  bindCanvasPan();
}
async function sendIntervention(id) { const body = $('#reply').value.trim(); if (!body) return toast('请输入回复内容'); try { await api(`/nodes/${id}/interventions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); toast('已发送给 Agent'); state.selectedNode = null; await workspace(); } catch (e) { toast(e.message); } }
async function inbox() { const { items } = await api('/inbox?status=pending'); app.innerHTML = `<div class="shell">${nav('inbox')}<main class="page"><header class="page-header"><div><h1>需要你处理</h1><p>只显示会阻塞 Agent 前进的事项。</p></div><span class="pending">${items.length} 项待处理</span></header><section class="queue">${items.map((n) => `<article class="queue-item"><i class="priority"></i><div><strong>${esc(n.title)}</strong><p>${esc(n.detail)}</p><p>${esc(n.trace_title)} · ${esc(n.device_name)} · ${time(n.occurred_at)}</p></div><button class="btn primary" data-inbox-node="${n.id}">${n.input ? '处理事项' : '查看'}</button></article>`).join('') || '<div class="empty">当前没有待处理事项</div>'}</section></main></div>`; document.querySelectorAll('[data-page]').forEach((b) => b.onclick = () => navigate(b.dataset.page)); document.querySelectorAll('[data-inbox-node]').forEach((b) => b.onclick = async () => { const node = (await api(`/nodes/${b.dataset.inboxNode}`)).node; state.selectedTrace = node.trace_id; state.selectedNode = node.id; await workspace(); }); }
async function devices() { const { devices } = await api('/devices'); app.innerHTML = `<div class="shell">${nav('devices')}<main class="page"><header class="page-header"><div><h1>接入</h1><p>每台设备及其连接健康度。</p></div><button class="btn primary" id="pair">添加设备</button></header><section class="devices">${devices.map((d) => `<article class="device"><div class="device-state ${d.state === 'offline' ? 'offline' : ''}">● ${d.state === 'online' ? '在线' : '离线'}</div><h3>${esc(d.name)}</h3><p>上次上报：${time(d.last_seen_at)}</p><p>设备 ID：${esc(d.id)}</p></article>`).join('')}</section></main></div>`; document.querySelectorAll('[data-page]').forEach((b) => b.onclick = () => navigate(b.dataset.page)); $('#pair').onclick = async () => { const name = prompt('设备名称'); if (!name) return; try { const d = await api('/devices/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); toast(`设备已配对，token：${d.token}`); await devices(); } catch (e) { toast(e.message); } }; }
function navigate(page) { state.page = page; ({ workspace, inbox, devices })[page](); }
const stream = new EventSource('/v1/events');
stream.addEventListener('node.created', (event) => { notifyNewReport(event); if (state.page === 'workspace') workspace(); });
['node.updated', 'intervention.created', 'device.updated', 'trace.updated', 'trace.deleted'].forEach((type) => stream.addEventListener(type, () => { if (state.page === 'workspace') workspace(); }));
document.addEventListener('click', (event) => { const settings = event.target.closest('[data-settings]'); if (!settings) return; state.settingsOpen = !state.settingsOpen; state.page = 'workspace'; workspace(); });
document.addEventListener('change', (event) => { if (event.target.matches('input[name="system-notifications"]')) setSystemNotifications(event.target.value === 'enabled'); });
document.addEventListener('keydown', (event) => { if (event.key !== 'Escape' || state.page !== 'workspace') return; if (state.mobileTracesOpen) { state.mobileTracesOpen = false; workspace(); return; } if (state.editingTraceName) { state.editingTraceName = null; workspace(); return; } if (state.drawerOpen && state.selectedNode) { state.drawerOpen = false; workspace(); } });
navigate('workspace');

function conversationNodes() {
  return state.nodes.map((node, index) => ({ node, index })).sort((a, b) => {
    const difference = new Date(a.node.occurred_at).getTime() - new Date(b.node.occurred_at).getTime();
    return Number.isNaN(difference) || difference === 0 ? a.index - b.index : difference;
  }).map(({ node }) => node);
}

function bindConversationCollapsing() {
  document.querySelectorAll('.conversation-bubble').forEach((bubble) => {
    const content = bubble.querySelector('.conversation-content');
    if (!content || content.scrollHeight <= content.clientHeight + 1) return;
    bubble.classList.add('is-truncatable');
    bubble.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const expanded = bubble.classList.toggle('is-expanded');
      bubble.setAttribute('aria-expanded', String(expanded));
    };
    bubble.ondblclick = (event) => { event.preventDefault(); toggle(); };
    bubble.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); toggle();
    };
  });
}

function conversation() {
  const nodes = conversationNodes();
  if (!nodes.length) return '<section class="conversation"><div class="conversation-empty">当前会话还没有可展示的内容</div></section>';
  const turns = nodes.map((node) => {
    const question = node.input || node.title || '暂无提问内容';
    const answer = node.conclusion || node.detail || node.title || '暂无回答内容';
    const occurredAt = new Date(node.occurred_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' });
    const actions = (field) => `<span class="conversation-actions"><button class="conversation-action" type="button" data-copy-conversation="${node.id}" data-conversation-field="${field}" aria-label="复制${field === 'question' ? '提问' : '回答'}" title="复制">${copyIcon}</button></span>`;
    return `<article class="conversation-turn"><p class="conversation-time">${esc(occurredAt)}</p><div class="conversation-message question"><span class="conversation-avatar">你</span><div class="conversation-bubble" role="button" tabindex="0" aria-label="提问内容，双击展开或折叠">${actions('question')}<span class="conversation-meta">提问</span><span class="conversation-content">${esc(question)}</span><span class="conversation-collapse-hint" aria-hidden="true">…⌄</span></div></div><div class="conversation-message answer"><span class="conversation-avatar">${esc((node.app || 'AI').slice(0, 2).toUpperCase())}</span><div class="conversation-bubble" role="button" tabindex="0" aria-label="回答内容，双击展开或折叠">${actions('answer')}<span class="conversation-meta">${esc(node.app || 'Agent')}</span><span class="conversation-content">${esc(answer)}</span><span class="conversation-collapse-hint" aria-hidden="true">…⌄</span></div></div></article>`;
  }).join('');
  return `<section class="conversation" aria-label="按时间排序的问答对话"><div class="conversation-inner">${turns}</div></section>`;
}

function renderViewMode() {
  const toolbar = $('.toolbar');
  const canvas = $('.canvas');
  if (!toolbar || !canvas) return;
  const switcher = document.createElement('div');
  switcher.className = 'view-switch';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', '展现方式');
  switcher.innerHTML = `<button type="button" class="${state.viewMode === 'canvas' ? 'active' : ''}" data-view-mode="canvas">画板</button><button type="button" class="${state.viewMode === 'conversation' ? 'active' : ''}" data-view-mode="conversation">对话</button>`;
  toolbar.prepend(switcher);
  if (state.viewMode === 'conversation') {
    canvas.replaceWith(document.createRange().createContextualFragment(conversation()));
    $('[data-fit]')?.remove();
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view-mode]');
  if (!button || state.page !== 'workspace') return;
  state.viewMode = button.dataset.viewMode;
  state.selectedNode = null;
  state.drawerOpen = false;
  workspace();
});
