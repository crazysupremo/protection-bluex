function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function api(path, opts) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((json && json.error) || 'Erro na requisição');
  return json;
}

async function checkSession() {
  const me = await api('/admin/me');
  if (me.isAdmin) showApp();
  else showLogin();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  loadHealth();
  loadClients();
}

document.getElementById('btn-login').onclick = async () => {
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await api('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    document.getElementById('login-password').value = '';
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
};
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

document.getElementById('btn-logout').onclick = async () => {
  await api('/admin/logout', { method: 'POST' });
  showLogin();
};

// ---------- Abas ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'usage') loadUsage();
    if (btn.dataset.tab === 'flagged') loadFlagged();
  };
});

// ---------- Saúde do sistema ----------
async function loadHealth() {
  try {
    const health = await fetch('/health').then((r) => r.json());
    const row = document.getElementById('health-row');
    row.innerHTML = `
      <span class="health-pill ${health.groq_configured ? 'health-ok' : 'health-off'}">Groq (IA de análise): ${health.groq_configured ? 'configurado' : 'faltando GROQ_API_KEY'}</span>
      <span class="health-pill ${health.turso_configured ? 'health-ok' : 'health-off'}">Banco: ${health.turso_configured ? 'Turso (nuvem)' : 'SQLite local (some ao reiniciar)'}</span>
      <span class="health-pill ${health.dual_model_vision ? 'health-ok' : 'health-neutral'}">Checagem dupla (imagem): ${health.dual_model_vision ? 'ativa' : 'desligada (1 modelo só)'}</span>
      <span class="health-pill ${health.dual_model_text ? 'health-ok' : 'health-neutral'}">Checagem dupla (texto): ${health.dual_model_text ? 'ativa' : 'desligada (1 modelo só)'}</span>
      <span class="health-pill health-neutral">Áudio e vídeo: moderação ativa</span>
    `;
  } catch (_) {}
}

// ---------- Clientes ----------
let cachedClients = [];

function populateClientFilters() {
  ['usage-filter-client', 'flagged-filter-client'].forEach((id) => {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML = '<option value="">Todas as empresas</option>';
    cachedClients.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.company_name;
      select.appendChild(opt);
    });
    select.value = current;
  });
}

async function loadClients() {
  const clients = await api('/admin/clients');
  cachedClients = clients;
  populateClientFilters();
  const tbody = document.querySelector('#clients-table tbody');
  tbody.innerHTML = '';
  document.getElementById('clients-empty').classList.toggle('hidden', clients.length > 0);
  clients.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.company_name)}</td>
      <td>${escapeHtml(c.contact_email || '—')}</td>
      <td>${escapeHtml(c.plan)}</td>
      <td><span class="tag ${c.is_active ? 'tag-active' : 'tag-inactive'}">${c.is_active ? 'Ativo' : 'Inativo'}</span></td>
      <td>${new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
      <td>
        <button class="small-btn" data-action="toggle" data-id="${c.id}">${c.is_active ? 'Desativar' : 'Ativar'}</button>
        <button class="small-btn" data-action="regen" data-id="${c.id}" data-name="${escapeHtml(c.company_name)}">Gerar nova chave</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.onclick = async () => { await api('/admin/clients/' + btn.dataset.id + '/toggle', { method: 'POST' }); loadClients(); };
  });
  tbody.querySelectorAll('[data-action="regen"]').forEach((btn) => {
    btn.onclick = async () => {
      const result = await api('/admin/clients/' + btn.dataset.id + '/regenerate-key', { method: 'POST' });
      showKeyReveal(btn.dataset.name, result.api_key);
    };
  });
}

function showKeyReveal(companyName, apiKey) {
  const el = document.getElementById('new-key-reveal');
  el.innerHTML = `
    <div class="api-key-reveal">
      Chave de API pra <strong>${escapeHtml(companyName)}</strong> (copie agora — só aparece uma vez aqui, mas pode gerar outra depois se perder):<br />
      <code>${escapeHtml(apiKey)}</code>
    </div>
  `;
}

document.getElementById('btn-create-client').onclick = async () => {
  const company_name = document.getElementById('new-client-name').value.trim();
  const contact_email = document.getElementById('new-client-email').value.trim();
  const plan = document.getElementById('new-client-plan').value;
  if (!company_name) { alert('Digite o nome da empresa.'); return; }
  try {
    const result = await api('/admin/clients', { method: 'POST', body: JSON.stringify({ company_name, contact_email, plan }) });
    showKeyReveal(company_name, result.api_key);
    document.getElementById('new-client-name').value = '';
    document.getElementById('new-client-email').value = '';
    loadClients();
  } catch (err) {
    alert(err.message);
  }
};

// ---------- Paginação compartilhada ----------
const PAGE_SIZE = 50;

function updatePaginationControls(prefix, offset, total) {
  document.getElementById(`${prefix}-prev`).disabled = offset === 0;
  document.getElementById(`${prefix}-next`).disabled = offset + PAGE_SIZE >= total;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  document.getElementById(`${prefix}-page-info`).textContent = `${from}–${to} de ${total}`;
}

// ---------- Uso ----------
let usageOffset = 0;

async function loadUsage() {
  const clientId = document.getElementById('usage-filter-client').value;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: usageOffset });
  if (clientId) params.set('client_id', clientId);
  const { rows, total } = await api('/admin/usage?' + params.toString());
  const tbody = document.querySelector('#usage-table tbody');
  tbody.innerHTML = '';
  document.getElementById('usage-empty').classList.toggle('hidden', rows.length > 0);
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.company_name)}</td>
      <td class="mono">${escapeHtml(r.endpoint)}</td>
      <td>${r.flagged ? '<span class="tag tag-flagged">Sim</span>' : 'Não'}</td>
      <td>${r.duration_ms != null ? r.duration_ms + 'ms' : '—'}</td>
      <td>${new Date(r.created_at).toLocaleString('pt-BR')}</td>
    `;
    tbody.appendChild(tr);
  });
  updatePaginationControls('usage', usageOffset, total);
}

document.getElementById('usage-filter-client').onchange = () => { usageOffset = 0; loadUsage(); };
document.getElementById('usage-prev').onclick = () => { usageOffset = Math.max(0, usageOffset - PAGE_SIZE); loadUsage(); };
document.getElementById('usage-next').onclick = () => { usageOffset += PAGE_SIZE; loadUsage(); };

// ---------- Casos sinalizados ----------
let flaggedOffset = 0;

async function loadFlagged() {
  const clientId = document.getElementById('flagged-filter-client').value;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: flaggedOffset });
  if (clientId) params.set('client_id', clientId);
  const { rows, total } = await api('/admin/flagged?' + params.toString());
  const tbody = document.querySelector('#flagged-table tbody');
  tbody.innerHTML = '';
  document.getElementById('flagged-empty').classList.toggle('hidden', rows.length > 0);
  rows.forEach((r) => {
    let categories = [];
    try { categories = JSON.parse(r.categories || '[]'); } catch (_) {}
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.company_name)}</td>
      <td class="mono">${escapeHtml(r.endpoint)}</td>
      <td>${escapeHtml(categories.join(', '))}</td>
      <td>${escapeHtml(r.confidence || '—')}</td>
      <td>${escapeHtml(r.reason || '—')}</td>
      <td>${new Date(r.created_at).toLocaleString('pt-BR')}</td>
      <td>${r.reviewed ? '<span class="tag tag-active">Revisado</span>' : `<button class="small-btn" data-action="review" data-id="${r.id}">Marcar revisado</button>`}</td>
    `;
    tbody.appendChild(tr);
  });
  updatePaginationControls('flagged', flaggedOffset, total);
  tbody.querySelectorAll('[data-action="review"]').forEach((btn) => {
    btn.onclick = async () => { await api('/admin/flagged/' + btn.dataset.id + '/review', { method: 'POST' }); loadFlagged(); };
  });
}

document.getElementById('flagged-filter-client').onchange = () => { flaggedOffset = 0; loadFlagged(); };
document.getElementById('flagged-prev').onclick = () => { flaggedOffset = Math.max(0, flaggedOffset - PAGE_SIZE); loadFlagged(); };
document.getElementById('flagged-next').onclick = () => { flaggedOffset += PAGE_SIZE; loadFlagged(); };

// ---------- Segurança (trocar senha) ----------
document.getElementById('btn-change-password').onclick = async () => {
  const current_password = document.getElementById('change-pw-current').value;
  const new_password = document.getElementById('change-pw-new').value;
  const confirm = document.getElementById('change-pw-confirm').value;
  const errEl = document.getElementById('change-pw-error');
  const okEl = document.getElementById('change-pw-success');
  errEl.textContent = '';
  okEl.textContent = '';
  if (new_password !== confirm) {
    errEl.textContent = 'A nova senha e a confirmação não são iguais.';
    return;
  }
  try {
    await api('/admin/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) });
    document.getElementById('change-pw-current').value = '';
    document.getElementById('change-pw-new').value = '';
    document.getElementById('change-pw-confirm').value = '';
    okEl.textContent = 'Senha trocada com sucesso.';
  } catch (err) {
    errEl.textContent = err.message;
  }
};

checkSession();


// ---------- ABA VERIFICAÇÃO (status, teste do Shield, teste de moderação) ----------
(function () {
  const $ = (id) => document.getElementById(id);
  const badge = (ok, yes, no) => `<span style="color:${ok ? 'var(--ok)' : 'var(--danger)'};font-weight:700;">${ok ? '✔ ' + yes : '✖ ' + no}</span>`;

  async function loadVerify() {
    try {
      const d = await api('/admin/system-check');
      const sh = d.shield || {};
      const rows = [
        ['Servidor no ar', badge(true, 'online há ' + Math.floor(d.uptime_s / 60) + ' min', '')],
        ['Banco de dados', badge(d.db_ok, 'conectado', 'sem conexão')],
        ['BLUEX SHIELD', badge(sh.active, 'ativo' + (sh.underAttack ? ' (⚠ sob ataque)' : ''), 'DESLIGADO (BLUEX_SHIELD=off ou não instalado)')],
        ['IA de moderação (Groq)', badge(d.groq_configured, 'chave configurada', 'GROQ_API_KEY ausente')],
        ['Checagem dupla (2 modelos)', badge(d.dual_model_vision && d.dual_model_text, 'ligada', 'só 1 modelo (visão ' + (d.dual_model_vision ? 'ok' : 'não') + ' / texto ' + (d.dual_model_text ? 'ok' : 'não') + ')')],
        ['Modelos', escapeHtml(d.vision_model + ' · ' + d.text_model)],
        ['Admin protegido', badge(d.admin_configured, 'senha configurada', 'sem ADMIN_PASSWORD')],
        ['Empresas / usos / sinalizados', d.totals ? `${d.totals.clients} / ${d.totals.usage} / ${d.totals.flagged} (não verificados: ${d.totals.unverified})` : '—'],
        ['Node', escapeHtml(d.node)],
      ];
      $('vf-status').innerHTML = '<table><tbody>' + rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('') + '</tbody></table>';
      const banned = sh.banned || [];
      $('vf-banned').innerHTML = banned.length
        ? '<table><tbody>' + banned.map((b) => `<tr><td class="mono">${escapeHtml(b.ip)}</td><td>${b.minutesLeft} min restantes</td><td><button class="small-btn" data-unban="${escapeHtml(b.ip)}">Liberar</button></td></tr>`).join('') + '</tbody></table>'
        : 'Nenhum IP banido agora ✔';
      $('vf-banned').querySelectorAll('[data-unban]').forEach((b) => (b.onclick = async () => {
        await api('/admin/shield/unban', { method: 'POST', body: JSON.stringify({ ip: b.dataset.unban }) });
        loadVerify();
      }));
    } catch (e) {
      $('vf-status').textContent = 'Erro: ' + e.message;
    }
  }

  function modResult(r) {
    const color = r.unverified ? '#f0b232' : r.flagged ? 'var(--danger)' : 'var(--ok)';
    const title = r.unverified ? '⚠ NÃO VERIFICADO (IA indisponível — foi pra fila de revisão)' : r.flagged ? '🚩 SINALIZADO' : '✔ LIMPO';
    return `<div style="border:1px solid ${color};border-radius:8px;padding:10px 12px;">
      <strong style="color:${color};">${title}</strong> <span class="empty-hint">(${r.ms} ms)</span><br>
      Categorias: ${escapeHtml((r.categories || []).join(', ') || '—')} · Confiança: ${escapeHtml(r.confidence)}<br>
      Motivo: ${escapeHtml(r.reason || '—')}</div>`;
  }

  $('vf-refresh').onclick = loadVerify;
  $('vf-shield-test').onclick = async () => {
    const box = $('vf-shield-results');
    box.textContent = 'Rodando...';
    try {
      const d = await api('/admin/shield/self-test', { method: 'POST', body: '{}' });
      box.innerHTML = `<div style="font-weight:700;margin-bottom:6px;color:${d.ok ? 'var(--ok)' : 'var(--danger)'};">${d.ok ? '✔ Todos os testes passaram' : '✖ Algum teste falhou'}</div>` +
        '<table><tbody>' + d.results.map((x) => `<tr><td>${x.pass ? '✔' : '✖'}</td><td>${escapeHtml(x.name)}</td><td class="empty-hint">${escapeHtml(x.detail)}</td></tr>`).join('') + '</tbody></table>';
    } catch (e) { box.textContent = 'Erro: ' + e.message; }
  };
  $('vf-text-btn').onclick = async () => {
    const box = $('vf-text-result');
    box.textContent = 'Analisando...';
    try { box.innerHTML = modResult(await api('/admin/test-text', { method: 'POST', body: JSON.stringify({ text: $('vf-text').value }) })); }
    catch (e) { box.textContent = 'Erro: ' + e.message; }
  };
  $('vf-img-btn').onclick = async () => {
    const box = $('vf-img-result');
    const f = $('vf-img').files[0];
    if (!f) { box.textContent = 'Escolha uma imagem.'; return; }
    box.textContent = 'Analisando...';
    try {
      const image = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
      box.innerHTML = modResult(await api('/admin/test-image', { method: 'POST', body: JSON.stringify({ image }) }));
    } catch (e) { box.textContent = 'Erro: ' + e.message; }
  };
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab === 'verify') loadVerify(); }));
})();
