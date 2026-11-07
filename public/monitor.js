(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    let j = null; try { j = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((j && j.error) || 'Erro');
    return j;
  }
  let role = null, siteId = 'local', timer = null, lastOv = null;

  const LEVEL = {
    normal: ['b-normal', '✅ Tráfego normal', 'Nenhum sinal de ataque.'],
    elevado: ['b-elevado', '⚠️ Requisições acima do normal', 'Mais de 1.000 pedidos por minuto — acompanhe.'],
    suspeito: ['b-suspeito', '🟠 Provável ataque DDoS', 'Mais de 5.000 pedidos/min — defesa automática LIGADA (limites 4× mais apertados, IPs novos esperam).'],
    extremo: ['b-extremo', '🚨 CASO EXTREMO — ataque em andamento', 'Mais de 10.000 pedidos/min — defesa MÁXIMA ligada (limites 8× mais apertados). Derrube os IPs abaixo se necessário.'],
  };

  async function boot() {
    const w = await api('/shield/whoami');
    role = w.role;
    if (!role) { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); return; }
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    if (role === 'admin') {
      $('who').textContent = 'Administrador';
      $('site').classList.remove('hidden'); $('admin-box').classList.remove('hidden');
      await loadSites();
    } else {
      $('who').textContent = '👤 ' + (w.username || '') + ' · ' + w.site.name;
      siteId = w.site.id;
    }
    refresh(); clearInterval(timer); timer = setInterval(refresh, 10000);
  }

  async function loadSites() {
    const d = await api('/monitor/sites');
    const sel = $('site'); const keep = sel.value || 'local';
    sel.innerHTML = `<option value="local">Este servidor (Protection BLUEX)</option>` + d.sites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'local'; siteId = sel.value;
    const age = (t) => { if (!t) return 'nunca'; const m = Math.round((Date.now() - new Date(t + (t.includes('Z') ? '' : 'Z')).getTime()) / 60000); return m < 1 ? 'agora' : m + ' min atrás'; };
    $('sites').innerHTML = d.sites.length ? d.sites.map((s) => `<tr>
      <td><b>${esc(s.name)}</b></td><td>${s.level ? `<span class="pill p-${s.level}">${s.level}</span>` : '<span class="mut">—</span>'}</td>
      <td class="mut">${age(s.last_report_at)}</td><td>${fmt(s.peak24h)}</td><td class="mut">${esc((s.users || []).join(', ') || '—')}</td>
      <td class="row"><button class="ghost sm" data-key="${esc(s.id)}">Chave</button><button class="ghost sm" data-user="${esc(s.id)}">+ Usuário</button><button class="danger sm" data-del="${esc(s.id)}">Excluir</button></td></tr>`).join('') : '<tr><td colspan="6" class="mut">Nenhum site ainda. Cadastre o jogo do seu amigo acima.</td></tr>';
    $('sites').querySelectorAll('[data-key]').forEach((b) => b.onclick = async () => showSetup((await api('/admin/shield-sites/' + b.dataset.key + '/key')).key, d.sites.find((x) => x.id === b.dataset.key).name));
    $('sites').querySelectorAll('[data-user]').forEach((b) => b.onclick = async () => {
      const username = prompt('Nome de usuário para o site (ex.: joao):'); if (!username) return;
      const password = prompt('Senha (mínimo 8 caracteres):'); if (!password) return;
      try { await api('/admin/shield-sites/' + b.dataset.user + '/user', { method: 'POST', body: JSON.stringify({ username, password }) }); alert('Usuário criado!\nEntrada: ' + location.origin + '/monitor.html\nUsuário: ' + username); loadSites(); } catch (e) { alert(e.message); }
    });
    $('sites').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Excluir esse site e todo o histórico?')) { await api('/admin/shield-sites/' + b.dataset.del, { method: 'DELETE' }); loadSites(); } });
  }

  function showSetup(key, name) {
    $('newsite').innerHTML = `<div class="note" style="margin-top:12px"><b>${esc(name)}</b> — no Render do site, crie estas variáveis de ambiente:
<pre>BLUEX_SHIELD_KEY=${esc(key)}
BLUEX_SHIELD_URL=${esc(location.origin)}
BLUEX_SHIELD_SITE=${esc(name)}</pre>
Depois reinicie. Em ~1 minuto o site aparece aqui com dados.</div>`;
  }

  $('nsb').onclick = async () => {
    const name = $('ns').value.trim(); if (!name) return;
    try { const r = await api('/admin/shield-sites', { method: 'POST', body: JSON.stringify({ name }) }); $('ns').value = ''; showSetup(r.key, r.name); loadSites(); } catch (e) { alert(e.message); }
  };
  $('site').onchange = () => { siteId = $('site').value; refresh(); };
  $('lb').onclick = async () => {
    try { await api('/shield/login', { method: 'POST', body: JSON.stringify({ username: $('lu').value, password: $('lp').value }) }); boot(); } catch (e) { $('le').textContent = e.message; }
  };
  $('lp').onkeydown = (e) => { if (e.key === 'Enter') $('lb').click(); };
  $('logout').onclick = async () => { await api('/shield/logout', { method: 'POST', body: '{}' }); if (role === 'admin') await api('/admin/logout', { method: 'POST', body: '{}' }); location.reload(); };

  async function cmd(type, ip, minutes) {
    const r = await api('/monitor/command', { method: 'POST', body: JSON.stringify({ site: siteId, type, ip, minutes }) });
    $('bmsg').textContent = r.applied ? '✔ Aplicado agora.' : '✔ ' + (r.note || 'Enfileirado.');
    setTimeout(refresh, 800);
  }
  $('bgo').onclick = () => { const ip = $('bip').value.trim(); if (ip) cmd('ban', ip, +$('bmin').value).catch((e) => ($('bmsg').textContent = e.message)); };

  async function refresh() {
    let o;
    try { o = await api('/monitor/overview?site=' + encodeURIComponent(siteId)); } catch (e) { $('banner').className = 'banner b-off'; $('banner').textContent = e.message; return; }
    lastOv = o;
    const cur = o.current || { total: 0, blocked: 0, level: 'normal' };
    const noData = o.active === false;
    const lv = LEVEL[cur.level] || LEVEL.normal;
    const b = $('banner');
    if (noData) { b.className = 'banner b-off'; b.innerHTML = '<div>⏳ Sem dados recentes<small>' + (o.site && o.site.id === 'local' ? 'O Shield não está ativo neste servidor.' : 'O Shield deste site ainda não enviou resumo (precisa das 3 variáveis de ambiente e reiniciar).') + '</small></div>'; }
    else { b.className = 'banner ' + lv[0]; b.innerHTML = `<div>${lv[1]}<small>${lv[2]}</small></div>`; }
    $('k-total').textContent = fmt(cur.total); $('k-total').style.color = { elevado: 'var(--warn)', suspeito: 'var(--org)', extremo: 'var(--red)' }[cur.level] || '';
    $('k-total-s').textContent = 'nível: ' + (cur.level || 'normal');
    $('k-blk').textContent = fmt(cur.blocked);
    const d = o.defense || 0; $('k-def').textContent = ['Normal', 'Automática', 'MÁXIMA'][d]; $('k-def').style.color = ['var(--ok)', 'var(--org)', 'var(--red)'][d];
    $('k-def-s').textContent = d ? 'limites mais apertados' : 'sem restrição extra';
    $('k-ban').textContent = fmt((o.banned || []).length);
    const peak = Math.max(0, ...(o.history || []).map((h) => h.total)); $('k-peak').textContent = fmt(peak);
    $('k-last').textContent = o.lastReportAt ? 'atualizado ' + new Date(o.lastReportAt).toLocaleTimeString('pt-BR') : '';
    draw(o);
    const topRows = (o.top || []);
    $('top').innerHTML = topRows.length ? `<table><thead><tr><th>IP</th><th>Pedidos/min</th><th></th></tr></thead><tbody>${topRows.map((t) => `<tr><td class="mono">${esc(t.ip)}</td><td><b>${fmt(t.n)}</b></td><td><button class="danger sm" data-ban="${esc(t.ip)}">Derrubar</button></td></tr>`).join('')}</tbody></table>` : '<span class="mut">Nenhum IP abusivo agora ✔</span>';
    $('top').querySelectorAll('[data-ban]').forEach((x) => x.onclick = () => cmd('ban', x.dataset.ban, 60).catch((e) => alert(e.message)));
    const bn = o.banned || [];
    $('banned').innerHTML = bn.length ? `<table><thead><tr><th>IP</th><th>Restante</th><th></th></tr></thead><tbody>${bn.map((x) => `<tr><td class="mono">${esc(x.ip)}</td><td>${x.minutesLeft} min</td><td><button class="ghost sm" data-un="${esc(x.ip)}">Liberar</button></td></tr>`).join('')}</tbody></table>` : '<span class="mut">Nenhum IP derrubado ✔</span>';
    $('banned').querySelectorAll('[data-un]').forEach((x) => x.onclick = () => cmd('unban', x.dataset.un).catch((e) => alert(e.message)));
    const ev = (o.events || []).slice().reverse().slice(0, 40);
    const NAMES = { limite: 'passou do limite', banido: 'IP já banido', sob_ataque: 'IP novo durante ataque', armadilha_scanner: 'scanner de brechas', rota_sensivel_abuso: 'abuso em login/cadastro', sem_user_agent: 'pedido de script', varredura_404: 'varredura de URLs' };
    $('events').innerHTML = ev.length ? `<table><thead><tr><th>Hora</th><th>IP</th><th>Motivo</th></tr></thead><tbody>${ev.map((e) => `<tr><td class="mut">${e.t ? new Date(e.t).toLocaleTimeString('pt-BR') : ''}</td><td class="mono">${esc(e.ip)}</td><td><span class="pill p-r">${esc(NAMES[e.reason] || e.reason)}</span></td></tr>`).join('')}</tbody></table>` : '<span class="mut">Sem eventos suspeitos ✔</span>';
  }

  function draw(o) {
    const c = $('chart'), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const hist = (o.history || []).slice(-120); const th = o.thresholds || { elevated: 1000, suspect: 5000, extreme: 10000 };
    const max = Math.max(th.extreme * 1.15, ...hist.map((h) => h.total), 1); const pad = { l: 44, r: 8, t: 8, b: 20 };
    const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
    g.font = '11px sans-serif'; g.textBaseline = 'middle';
    [[th.elevated, '#facc15', '1 mil'], [th.suspect, '#fb923c', '5 mil'], [th.extreme, '#ef4444', '10 mil']].forEach(([v, col, lab]) => {
      g.strokeStyle = col + '88'; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(pad.l, y(v)); g.lineTo(W - pad.r, y(v)); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.textAlign = 'right'; g.fillText(lab, pad.l - 6, y(v));
    });
    g.fillStyle = '#8f98ab'; g.textAlign = 'right'; g.fillText('0', pad.l - 6, y(0));
    if (!hist.length) { g.fillStyle = '#8f98ab'; g.textAlign = 'center'; g.fillText('Aguardando dados…', W / 2, H / 2); return; }
    const bw = Math.max(2, (W - pad.l - pad.r) / Math.max(hist.length, 30) - 1);
    hist.forEach((h, i) => {
      const x = pad.l + i * (bw + 1);
      g.fillStyle = h.total >= th.extreme ? '#ef4444' : h.total >= th.suspect ? '#fb923c' : h.total >= th.elevated ? '#facc15' : '#3b82f6';
      g.fillRect(x, y(h.total), bw, y(0) - y(h.total));
      if (h.blocked) { g.fillStyle = '#ffffff55'; g.fillRect(x, y(h.blocked), bw, y(0) - y(h.blocked)); }
    });
    g.fillStyle = '#8f98ab'; g.textAlign = 'left'; g.fillText(new Date(hist[0].at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), pad.l, H - 7);
    g.textAlign = 'right'; g.fillText('agora', W - pad.r, H - 7);
  }
  window.addEventListener('resize', () => lastOv && draw(lastOv));
  boot();
})();
