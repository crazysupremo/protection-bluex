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
    `;
  } catch (_) {}
}

// ---------- Clientes ----------
async function loadClients() {
  const clients = await api('/admin/clients');
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

// ---------- Uso ----------
async function loadUsage() {
  const rows = await api('/admin/usage');
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
}

// ---------- Casos sinalizados ----------
async function loadFlagged() {
  const rows = await api('/admin/flagged');
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
      <td>${escapeHtml(r.reason || '—')}</td>
      <td>${new Date(r.created_at).toLocaleString('pt-BR')}</td>
      <td>${r.reviewed ? '<span class="tag tag-active">Revisado</span>' : `<button class="small-btn" data-action="review" data-id="${r.id}">Marcar revisado</button>`}</td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-action="review"]').forEach((btn) => {
    btn.onclick = async () => { await api('/admin/flagged/' + btn.dataset.id + '/review', { method: 'POST' }); loadFlagged(); };
  });
}

checkSession();
