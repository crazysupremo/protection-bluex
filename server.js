// ---------- PROTECTION BLUEX (BLUE SPORTS GAMES) ----------
// Serviço standalone (não faz parte do NEXT GAME) de verificação de idade,
// moderação de conteúdo e análise de texto suspeito — pensado pra ser
// vendido/licenciado como API pra outras empresas integrarem nos próprios
// produtos.
//
// A análise de câmera de segurança comercial (furto/roubo) NÃO mora aqui —
// é o BLUEX SECURITY, um app totalmente separado (outro repositório, outro
// deploy, outro painel admin), porque é outro público-alvo (comércio/
// varejo, não plataformas online).
//
// IMPORTANTE — limitações reais que qualquer empresa cliente precisa saber
// (documentadas também no README): isso usa um modelo de visão de propósito
// geral (Groq) pra dar uma camada de sinalização automática. NÃO é, e não
// deve ser vendido como, um substituto de: (1) serviços especializados de
// detecção de CSAM que comparam contra bancos de hashes conhecidos
// (PhotoDNA/Thorn Safer) — esta API nunca tenta identificar exploração
// infantil especificamente, só quando pedido explicitamente marca
// "revisar_urgente" pra qualquer suspeita envolvendo menor em contexto de
// risco, pra revisão humana; (2) verificação de idade legalmente vinculante
// — é uma estimativa por IA, não documento oficial.
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4900;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'bluex-dev-secret-troque-em-producao';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '6mb' })); // imagens em base64 pedem mais espaço que texto
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  cookieSession({
    name: 'bluex_admin_session',
    keys: [SESSION_SECRET],
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
  })
);

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/v1/', apiLimiter);
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- AUTENTICAÇÃO POR CHAVE DE API (empresas clientes) ----------
async function requireApiKey(req, res, next) {
  const key = req.header('X-API-Key') || (req.query && req.query.api_key);
  if (!key) return res.status(401).json({ error: 'Chave de API ausente (header X-API-Key).' });
  const client = await db.get('SELECT * FROM clients WHERE api_key = ?', [key]);
  if (!client || !client.is_active) return res.status(401).json({ error: 'Chave de API inválida ou inativa.' });
  req.client = client;
  next();
}

// ---------- AUTENTICAÇÃO DO PAINEL ADMIN (você, não os clientes) ----------
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ error: 'Não autenticado.' });
  next();
}

app.post(
  '/admin/login',
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD não configurada no servidor. Veja o README.' });
    }
    const { password } = req.body || {};
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });
    req.session.isAdmin = true;
    res.json({ ok: true });
  })
);

app.post('/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/admin/me', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- GESTÃO DE EMPRESAS CLIENTES (painel admin) ----------
app.get(
  '/admin/clients',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await db.all('SELECT id, company_name, contact_email, plan, is_active, created_at FROM clients ORDER BY created_at DESC'));
  })
);

app.post(
  '/admin/clients',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { company_name, contact_email, plan } = req.body || {};
    if (!company_name || !String(company_name).trim()) {
      return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
    }
    const id = uuidv4();
    const apiKey = 'bluex_' + crypto.randomBytes(24).toString('hex');
    await db.run(
      'INSERT INTO clients (id, company_name, contact_email, api_key, plan) VALUES (?, ?, ?, ?, ?)',
      [id, String(company_name).trim().slice(0, 120), (contact_email || '').slice(0, 160) || null, apiKey, plan || 'trial']
    );
    res.json({ id, company_name, api_key: apiKey });
  })
);

app.post(
  '/admin/clients/:id/toggle',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const client = await db.get('SELECT is_active FROM clients WHERE id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
    await db.run('UPDATE clients SET is_active = ? WHERE id = ?', [client.is_active ? 0 : 1, req.params.id]);
    res.json({ ok: true });
  })
);

app.post(
  '/admin/clients/:id/regenerate-key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const apiKey = 'bluex_' + crypto.randomBytes(24).toString('hex');
    await db.run('UPDATE clients SET api_key = ? WHERE id = ?', [apiKey, req.params.id]);
    res.json({ api_key: apiKey });
  })
);

app.get(
  '/admin/usage',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await db.all(
        `SELECT u.id, u.endpoint, u.flagged, u.duration_ms, u.created_at, c.company_name
         FROM usage_logs u JOIN clients c ON c.id = u.client_id
         ORDER BY u.created_at DESC LIMIT 200`
      )
    );
  })
);

app.get(
  '/admin/flagged',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await db.all(
        `SELECT f.id, f.endpoint, f.categories, f.reason, f.reviewed, f.created_at, c.company_name
         FROM flagged_cases f JOIN clients c ON c.id = f.client_id
         ORDER BY f.created_at DESC LIMIT 200`
      )
    );
  })
);

app.post(
  '/admin/flagged/:id/review',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await db.run('UPDATE flagged_cases SET reviewed = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---------- NÚCLEO: chamada de visão/texto via Groq ----------
async function callGroqVision(imageDataUrlOrUrl, promptText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { flagged: false, skipped: true, error: 'GROQ_API_KEY não configurada' };
  try {
    const visionModel = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: visionModel,
        max_tokens: 250,
        messages: [
          { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: imageDataUrlOrUrl } }] },
        ],
      }),
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Erro na Groq Vision:', apiRes.status, errText);
      return { flagged: false, error: true };
    }
    const data = await apiRes.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch (err) {
    console.error('Erro na Groq Vision:', err.message);
    return { flagged: false, error: true };
  }
}

async function callGroqText(promptText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { flagged: false, skipped: true, error: 'GROQ_API_KEY não configurada' };
  try {
    const textModel = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: textModel,
        max_tokens: 250,
        messages: [{ role: 'user', content: promptText }],
      }),
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Erro na Groq (texto):', apiRes.status, errText);
      return { flagged: false, error: true };
    }
    const data = await apiRes.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch (err) {
    console.error('Erro na Groq (texto):', err.message);
    return { flagged: false, error: true };
  }
}

async function logUsage(clientId, endpoint, flagged, durationMs) {
  try {
    await db.run('INSERT INTO usage_logs (id, client_id, endpoint, flagged, duration_ms) VALUES (?, ?, ?, ?, ?)', [
      uuidv4(),
      clientId,
      endpoint,
      flagged ? 1 : 0,
      durationMs,
    ]);
  } catch (err) {
    console.error('Erro ao registrar uso:', err);
  }
}

async function logFlagged(clientId, endpoint, categories, reason) {
  try {
    await db.run('INSERT INTO flagged_cases (id, client_id, endpoint, categories, reason) VALUES (?, ?, ?, ?, ?)', [
      uuidv4(),
      clientId,
      endpoint,
      JSON.stringify(categories || []),
      reason || null,
    ]);
  } catch (err) {
    console.error('Erro ao registrar caso sinalizado:', err);
  }
}

function extractImage(body) {
  if (!body) return null;
  if (body.image && typeof body.image === 'string') return body.image;
  if (body.image_url && typeof body.image_url === 'string') return body.image_url;
  return null;
}

// ---------- V1: VERIFICAÇÃO DE IDADE ----------
const AGE_VERIFY_PROMPT =
  'Esta é uma foto de rosto enviada pra estimar a idade aproximada da pessoa (verificação de idade, não identificação — ' +
  'não tente reconhecer quem é a pessoa). Responda APENAS um JSON, sem texto extra, no formato ' +
  '{"estimated_age": número, "confidence": "baixa"|"média"|"alta", "flagged_as_minor": true ou false, "reason": "..."}. ' +
  'Marque flagged_as_minor=true se a pessoa aparentar ter menos de 18 anos. Se não conseguir identificar um rosto claro na ' +
  'imagem, responda {"estimated_age": null, "confidence": "baixa", "flagged_as_minor": false, "reason": "rosto não identificado"}.';

app.post(
  '/v1/age-verify',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const image = extractImage(req.body);
    if (!image) return res.status(400).json({ error: 'Envie "image" (data URL) ou "image_url".' });
    const result = await callGroqVision(image, AGE_VERIFY_PROMPT);
    const flagged = !!result.flagged_as_minor;
    await logUsage(req.client.id, 'age-verify', flagged, Date.now() - start);
    if (flagged) await logFlagged(req.client.id, 'age-verify', ['possivel_menor'], result.reason);
    res.json({
      estimated_age: result.estimated_age ?? null,
      confidence: result.confidence || 'baixa',
      flagged_as_minor: flagged,
      reason: result.reason || null,
    });
  })
);

// ---------- V1: MODERAÇÃO DE CONTEÚDO ----------
const MODERATE_IMAGE_PROMPT =
  'Esta imagem foi enviada por um usuário de uma plataforma. Responda APENAS um JSON, sem texto extra, no formato ' +
  '{"flagged": true ou false, "categories": [...], "reason": "..."}. ' +
  'Marque flagged=true SOMENTE se a imagem mostrar claramente: nudez ou conteúdo sexual explícito real (não desenho/arte), ' +
  'violência física grave/sangue real, maus-tratos ou crueldade real contra animais (agressão, ferimentos, negligência grave ' +
  '— não caça/pesca/pecuária legais retratadas de forma normal), armas de fogo reais anunciadas pra venda, ou qualquer imagem ' +
  'envolvendo uma criança/adolescente em contexto sexualizado ou de risco (se tiver a menor dúvida sobre isso, marque ' +
  'flagged=true e categoria "revisar_urgente"). Não marque memes, prints de jogos, fotos comuns do dia a dia, cenas de ' +
  'caça/pesca/criação de animais dentro da normalidade, ou arte/desenho fictício. Na dúvida fora dos casos acima, marque flagged=false.';

app.post(
  '/v1/moderate-image',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const image = extractImage(req.body);
    if (!image) return res.status(400).json({ error: 'Envie "image" (data URL) ou "image_url".' });
    const result = await callGroqVision(image, MODERATE_IMAGE_PROMPT);
    const flagged = !!result.flagged;
    await logUsage(req.client.id, 'moderate-image', flagged, Date.now() - start);
    if (flagged) await logFlagged(req.client.id, 'moderate-image', result.categories, result.reason);
    res.json({ flagged, categories: result.categories || [], reason: result.reason || null });
  })
);

// ---------- V1: ANÁLISE DE TEXTO (comportamento suspeito) ----------
const ANALYZE_TEXT_PROMPT_PREFIX =
  'Você é um classificador de segurança pra uma plataforma que recebe mensagens de texto entre usuários. Responda APENAS ' +
  'um JSON, sem texto extra, no formato {"flagged": true ou false, "categories": [...], "reason": "..."}. ' +
  'Marque flagged=true SOMENTE se o texto mostrar sinais claros de: um adulto tentando esconder a própria idade ou se ' +
  'passar por menor pra se aproximar de uma criança/adolescente, tentativa de aliciamento (grooming) — insistência pra sair ' +
  'do app público, pedido de fotos/vídeos, pedido de dados pessoais (endereço, escola, telefone) de quem parece ser menor, ' +
  'ou ameaças/coerção envolvendo menor. NÃO marque conversas comuns entre adultos, flerte comum entre adultos, ou ' +
  'linguagem de jogo (ex: "te mato" num contexto de partida). Na dúvida, marque flagged=false, exceto se envolver risco a ' +
  'menor — nesse caso marque flagged=true com categoria "revisar_urgente" mesmo com dúvida. ' +
  'Texto a analisar (delimitado por ---): ---';

app.post(
  '/v1/analyze-text',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Envie "text".' });
    }
    const prompt = ANALYZE_TEXT_PROMPT_PREFIX + text.slice(0, 3000) + '---';
    const result = await callGroqText(prompt);
    const flagged = !!result.flagged;
    await logUsage(req.client.id, 'analyze-text', flagged, Date.now() - start);
    if (flagged) await logFlagged(req.client.id, 'analyze-text', result.categories, result.reason);
    res.json({ flagged, categories: result.categories || [], reason: result.reason || null });
  })
);

// A análise de câmera de segurança (furto/roubo) NÃO mora mais aqui — virou
// um app próprio e separado: BLUEX SECURITY (outra pasta, outro
// repositório, outro deploy, outro painel admin, próprio sistema de chave de
// API). Público-alvo diferente do PROTECTION BLUEX (comércio/varejo com
// câmera de loja, não plataformas online), por isso é vendido como produto
// à parte, não como mais um endpoint aqui dentro.

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    groq_configured: !!process.env.GROQ_API_KEY,
    turso_configured: !!process.env.TURSO_DATABASE_URL,
    admin_configured: !!ADMIN_PASSWORD,
  });
});

app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

db.initDb()
  .then(() => {
    app.listen(PORT, () => console.log('PROTECTION BLUEX rodando em http://localhost:' + PORT));
  })
  .catch((err) => {
    console.error('Falha ao iniciar o banco de dados:', err);
    process.exit(1);
  });
