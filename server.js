// ---------- PROTECTION BLUEX (BLUE SPORTS GAMES) ----------
// Serviço standalone (não faz parte do NEXT GAME) de verificação de idade,
// moderação de conteúdo (imagem, vídeo e áudio) e análise de texto suspeito
// — pensado pra ser vendido/licenciado como API pra outras empresas
// integrarem nos próprios produtos.
//
// MODO "BEM RIGOROSO" — pensado pra pecar pelo excesso de cautela:
//   • Toda checagem de imagem/texto passa por DOIS modelos quando
//     GROQ_VISION_MODEL_2 / GROQ_TEXT_MODEL_2 estão configurados — se
//     QUALQUER um dos dois sinalizar, o resultado final é flagged=true (OR,
//     não AND). Sem a segunda variável configurada, funciona normal com só
//     um modelo.
//   • Os prompts pedem "confidence" e instruem os modelos a sinalizar
//     indícios AMBÍGUOS com confidence "baixa" pra revisão humana, em vez
//     de descartar silenciosamente — a fila de revisão fica maior, mas
//     menos coisa passa despercebida. É uma troca deliberada: mais falsos
//     positivos pra revisar, em troca de menos falsos negativos.
//   • Categorias novas: drogas ilícitas, armas em contexto de ameaça,
//     discurso/símbolos de ódio, automutilação/incentivo a suicídio,
//     doxxing (exposição de dados de terceiros) e golpe/fraude — além do
//     que já existia (nudez, violência grave, maus-tratos a animais, risco
//     a menor).
//   • Dois tipos de conteúdo novos: /v1/moderate-audio (transcreve e
//     analisa o texto falado) e /v1/moderate-video (analisa frames
//     amostrados do vídeo, enviados pelo cliente).
//
// A análise de câmera de segurança comercial (furto/roubo) NÃO mora aqui —
// é o BLUEX SECURITY, um app totalmente separado (outro repositório, outro
// deploy, outro painel admin), porque é outro público-alvo (comércio/
// varejo, não plataformas online).
//
// IMPORTANTE — limitações reais que qualquer empresa cliente precisa saber
// (documentadas também no README): isso usa modelos de propósito geral
// (Groq) pra dar uma camada de sinalização automática, mesmo no modo mais
// rigoroso. NÃO é, e não deve ser vendido como, um substituto de: (1)
// serviços especializados de detecção de CSAM que comparam contra bancos de
// hashes conhecidos (PhotoDNA/Thorn Safer) — esta API nunca tenta
// identificar exploração infantil especificamente, só quando pedido
// explicitamente marca "revisar_urgente" pra qualquer suspeita envolvendo
// menor em contexto de risco, pra revisão humana; (2) verificação de idade
// legalmente vinculante — é uma estimativa por IA, não documento oficial.
// Ser "mais rigoroso" aumenta a chance de sinalizar coisa inofensiva
// (falsos positivos) — por isso toda sinalização vai pra fila de revisão
// humana, nunca deve disparar punição automática sozinha.
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

// BUG CORRIGIDO: sem isso, atrás do proxy do Render (que termina o HTTPS e
// encaminha por HTTP internamente), o Express não reconhece a conexão como
// seguro — e o cookie de sessão com secure:true (obrigatório em produção)
// não fica válido direito. Resultado: login parecia funcionar, mas a
// PRÓXIMA requisição já vinha "Não autenticado". Precisa vir antes de
// qualquer coisa que dependa de req.secure/cookies (helmet, cookie-session).
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
// 28mb: dá espaço pra um áudio de até MAX_AUDIO_BYTES (20MB) codificado em
// base64 (~+33%) ou até MAX_VIDEO_FRAMES imagens de vídeo no mesmo request.
app.use(express.json({ limit: '28mb' }));
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
// Áudio e vídeo custam bem mais (transcrição + múltiplos frames) — limite
// mais apertado que o geral do /v1/, além dele (os dois se somam).
const heavyLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// Máximo de frames de vídeo por requisição — cada frame é uma checagem de
// visão completa (x2 se o segundo modelo estiver configurado), então isso
// controla custo, tempo de resposta e o tamanho do corpo da requisição.
const MAX_VIDEO_FRAMES = 12;
// Áudio maior que isso é rejeitado antes de gastar chamada de API com ele.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

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
        `SELECT f.id, f.endpoint, f.categories, f.reason, f.confidence, f.reviewed, f.created_at, c.company_name
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
// Recebem o MODELO como parâmetro (em vez de ler a env direto) pra dar pra
// chamar o mesmo conteúdo em dois modelos diferentes e comparar — ver
// runVisionCheck/runTextCheck logo abaixo, que é o que os endpoints usam de
// fato.
async function callGroqVisionModel(model, imageDataUrlOrUrl, promptText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { flagged: false, skipped: true, error: 'GROQ_API_KEY não configurada' };
  try {
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        max_tokens: 250,
        messages: [
          { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: imageDataUrlOrUrl } }] },
        ],
      }),
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error(`Erro na Groq Vision (${model}):`, apiRes.status, errText);
      return { flagged: false, error: true };
    }
    const data = await apiRes.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch (err) {
    console.error(`Erro na Groq Vision (${model}):`, err.message);
    return { flagged: false, error: true };
  }
}

async function callGroqTextModel(model, promptText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { flagged: false, skipped: true, error: 'GROQ_API_KEY não configurada' };
  try {
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        max_tokens: 250,
        messages: [{ role: 'user', content: promptText }],
      }),
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error(`Erro na Groq (texto, ${model}):`, apiRes.status, errText);
      return { flagged: false, error: true };
    }
    const data = await apiRes.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch (err) {
    console.error(`Erro na Groq (texto, ${model}):`, err.message);
    return { flagged: false, error: true };
  }
}

const CONFIDENCE_RANK = { alta: 3, média: 2, media: 2, baixa: 1 };

// Junta os resultados de 1 ou 2 modelos num único veredito, favorecendo
// cautela (OR): se QUALQUER modelo sinalizar, o resultado final é
// flagged=true. Categorias são a união das duas respostas, e a confidence
// final é a mais alta entre as respostas (se um modelo teve certeza, isso
// pesa mais que o outro ter ficado em dúvida).
function mergeChecks(results) {
  const valid = results.filter(Boolean);
  const flagged = valid.some((r) => r.flagged);
  const categories = [...new Set(valid.flatMap((r) => r.categories || []))];
  const reasons = valid.map((r) => r.reason).filter(Boolean);
  let confidence = 'baixa';
  for (const r of valid) {
    if (r.confidence && (CONFIDENCE_RANK[r.confidence] || 0) >= (CONFIDENCE_RANK[confidence] || 0)) confidence = r.confidence;
  }
  return { flagged, categories, reason: reasons.length ? [...new Set(reasons)].join(' | ') : null, confidence };
}

// Checagem dupla de imagem: chama GROQ_VISION_MODEL_2 além do modelo
// principal se estiver configurada, e combina os dois com mergeChecks.
// Sem a segunda variável, funciona igual a antes (só um modelo).
async function runVisionCheck(imageDataUrlOrUrl, promptText) {
  const primary = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
  const secondary = process.env.GROQ_VISION_MODEL_2 || null;
  const calls = [callGroqVisionModel(primary, imageDataUrlOrUrl, promptText)];
  if (secondary) calls.push(callGroqVisionModel(secondary, imageDataUrlOrUrl, promptText));
  return mergeChecks(await Promise.all(calls));
}

async function runTextCheck(promptText) {
  const primary = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
  const secondary = process.env.GROQ_TEXT_MODEL_2 || null;
  const calls = [callGroqTextModel(primary, promptText)];
  if (secondary) calls.push(callGroqTextModel(secondary, promptText));
  return mergeChecks(await Promise.all(calls));
}

// Verificação de idade tem um formato de resposta diferente (estimated_age +
// flagged_as_minor em vez de flagged/categories), então junta os dois
// modelos com a própria lógica: flagged_as_minor=true se QUALQUER modelo
// achar que é menor, e usa a idade MAIS BAIXA entre as respostas (mais
// cauteloso — prefere errar pra proteção de menor do que pro lado oposto).
async function runAgeCheck(imageDataUrlOrUrl) {
  const primary = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
  const secondary = process.env.GROQ_VISION_MODEL_2 || null;
  const models = secondary ? [primary, secondary] : [primary];
  const results = (await Promise.all(models.map((m) => callGroqVisionModel(m, imageDataUrlOrUrl, AGE_VERIFY_PROMPT)))).filter(Boolean);
  const flagged_as_minor = results.some((r) => r.flagged_as_minor);
  const ages = results.map((r) => (typeof r.estimated_age === 'number' ? r.estimated_age : null)).filter((a) => a !== null);
  const estimated_age = ages.length ? Math.min(...ages) : null;
  let confidence = 'baixa';
  for (const r of results) {
    if (r.confidence && (CONFIDENCE_RANK[r.confidence] || 0) >= (CONFIDENCE_RANK[confidence] || 0)) confidence = r.confidence;
  }
  const reasons = results.map((r) => r.reason).filter(Boolean);
  return { flagged_as_minor, estimated_age, confidence, reason: reasons.length ? [...new Set(reasons)].join(' | ') : null };
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

async function logFlagged(clientId, endpoint, categories, reason, confidence) {
  try {
    await db.run(
      'INSERT INTO flagged_cases (id, client_id, endpoint, categories, reason, confidence) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), clientId, endpoint, JSON.stringify(categories || []), reason || null, confidence || null]
    );
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
    const result = await runAgeCheck(image);
    const flagged = !!result.flagged_as_minor;
    await logUsage(req.client.id, 'age-verify', flagged, Date.now() - start);
    if (flagged) await logFlagged(req.client.id, 'age-verify', ['possivel_menor'], result.reason, result.confidence);
    res.json({
      estimated_age: result.estimated_age ?? null,
      confidence: result.confidence || 'baixa',
      flagged_as_minor: flagged,
      reason: result.reason || null,
    });
  })
);

// ---------- V1: MODERAÇÃO DE CONTEÚDO (imagem) ----------
// Modo rigoroso: pede "confidence" além de flagged/categories, e instrui o
// modelo a sinalizar indícios ambíguos com confidence "baixa" em vez de
// descartar — combinado com runVisionCheck (2 modelos, ver acima), isso
// reduz bastante a chance de algo passar despercebido, ao custo de mais
// falsos positivos indo pra fila de revisão.
const MODERATE_IMAGE_PROMPT =
  'Esta imagem foi enviada por um usuário de uma plataforma e deve ser analisada com bastante cautela — na dúvida, ' +
  'prefira sinalizar pra revisão humana a deixar passar. Responda APENAS um JSON, sem texto extra, no formato ' +
  '{"flagged": true ou false, "categories": [...], "confidence": "baixa"|"média"|"alta", "reason": "..."}. ' +
  'Marque flagged=true se a imagem mostrar, ou tiver indício razoável de: nudez ou conteúdo sexual explícito real (não ' +
  'desenho/arte), violência física grave ou sangue real, maus-tratos ou crueldade real contra animais (agressão, ' +
  'ferimentos, negligência grave — não caça/pesca/pecuária legais retratadas de forma normal), armas de fogo ou brancas ' +
  'reais em contexto de ameaça/exibição/venda, uso ou posse de drogas ilícitas, símbolos ou discurso de ódio, conteúdo ' +
  'que incentive automutilação ou suicídio, ou qualquer imagem envolvendo uma criança/adolescente em contexto ' +
  'sexualizado ou de risco (nesse último caso, mesmo com a menor dúvida, marque flagged=true, categoria ' +
  '"revisar_urgente" e confidence "baixa" se não tiver certeza). Use confidence "baixa" pra indícios ambíguos que ainda ' +
  'assim valem revisão humana, e "alta" só quando for bem claro. Não marque memes, prints de jogos, fotos comuns do dia ' +
  'a dia, cenas de caça/pesca/criação de animais dentro da normalidade, ou arte/desenho fictício sem os elementos acima.';

app.post(
  '/v1/moderate-image',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const image = extractImage(req.body);
    if (!image) return res.status(400).json({ error: 'Envie "image" (data URL) ou "image_url".' });
    const result = await runVisionCheck(image, MODERATE_IMAGE_PROMPT);
    await logUsage(req.client.id, 'moderate-image', result.flagged, Date.now() - start);
    if (result.flagged) await logFlagged(req.client.id, 'moderate-image', result.categories, result.reason, result.confidence);
    res.json({ flagged: result.flagged, categories: result.categories, confidence: result.confidence, reason: result.reason });
  })
);

// ---------- V1: ANÁLISE DE TEXTO (comportamento suspeito) ----------
// Mesmo espírito "rigoroso" do prompt de imagem acima: pede confidence e
// prefere sinalizar indício ambíguo a descartar, e ganhou categorias novas
// (doxxing, ódio, drogas/armas, golpe, automutilação) além das que já
// existiam (aliciamento/grooming e risco a menor).
const ANALYZE_TEXT_PROMPT_PREFIX =
  'Você é um classificador de segurança pra uma plataforma que recebe mensagens de texto entre usuários, e deve pecar ' +
  'pelo excesso de cautela — na dúvida real sobre risco, prefira sinalizar pra revisão humana a deixar passar. Responda ' +
  'APENAS um JSON, sem texto extra, no formato {"flagged": true ou false, "categories": [...], "confidence": ' +
  '"baixa"|"média"|"alta", "reason": "..."}. Marque flagged=true se o texto mostrar sinais de: um adulto tentando ' +
  'esconder a própria idade ou se passar por menor pra se aproximar de uma criança/adolescente, tentativa de ' +
  'aliciamento (grooming) — insistência pra sair do app público, pedido de fotos/vídeos, pedido de dados pessoais ' +
  '(endereço, escola, telefone) de quem parece ser menor, ameaças/coerção envolvendo menor, exposição não consentida de ' +
  'dados pessoais de terceiros (doxxing), discurso ou incitação de ódio, oferta/venda de drogas ilícitas ou armas, ' +
  'tentativa de golpe ou fraude financeira, ou conteúdo que incentive automutilação/suicídio. Use confidence "baixa" ' +
  'pra indícios ambíguos que ainda assim valem revisão humana, "alta" só quando for bem claro. NÃO marque conversas ' +
  'comuns entre adultos, flerte comum entre adultos, ou linguagem de jogo (ex: "te mato" num contexto de partida). Em ' +
  'qualquer dúvida real envolvendo risco a menor, marque flagged=true com categoria "revisar_urgente" e confidence ' +
  '"baixa" mesmo com dúvida. Texto a analisar (delimitado por ---): ---';

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
    const result = await runTextCheck(prompt);
    await logUsage(req.client.id, 'analyze-text', result.flagged, Date.now() - start);
    if (result.flagged) await logFlagged(req.client.id, 'analyze-text', result.categories, result.reason, result.confidence);
    res.json({ flagged: result.flagged, categories: result.categories, confidence: result.confidence, reason: result.reason });
  })
);

// ---------- V1: MODERAÇÃO DE ÁUDIO (transcreve e analisa o texto falado) ----------
// Não guarda o áudio em nenhum momento — só passa pela memória do processo
// pra ir direto pra transcrição, mesma política de privacidade das imagens
// (só o resultado fica salvo, nunca o conteúdo original).
async function transcribeAudio(audioDataUrlOrUrl) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { text: null, error: 'GROQ_API_KEY não configurada' };
  try {
    let buffer;
    let contentType = 'audio/mpeg';
    if (/^https?:\/\//i.test(audioDataUrlOrUrl)) {
      const audioRes = await fetch(audioDataUrlOrUrl);
      if (!audioRes.ok) return { text: null, error: 'Não consegui baixar o áudio da URL informada.' };
      contentType = audioRes.headers.get('content-type') || contentType;
      buffer = Buffer.from(await audioRes.arrayBuffer());
    } else {
      const match = /^data:([^;]+);base64,(.+)$/.exec(audioDataUrlOrUrl);
      if (!match) return { text: null, error: 'Formato de áudio inválido — envie uma data URL base64 ou "audio_url".' };
      contentType = match[1] || contentType;
      buffer = Buffer.from(match[2], 'base64');
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      return { text: null, error: `Áudio maior que ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB — não suportado.` };
    }
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), 'audio');
    form.append('model', process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3');
    const apiRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Erro na Groq (transcrição de áudio):', apiRes.status, errText);
      return { text: null, error: 'Falha ao transcrever o áudio.' };
    }
    const data = await apiRes.json();
    return { text: data.text || '', error: null };
  } catch (err) {
    console.error('Erro na transcrição de áudio:', err.message);
    return { text: null, error: err.message };
  }
}

app.post(
  '/v1/moderate-audio',
  heavyLimiter,
  requireApiKey,
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const source = (req.body && (req.body.audio || req.body.audio_url)) || null;
    if (!source) return res.status(400).json({ error: 'Envie "audio" (data URL base64) ou "audio_url".' });
    const transcription = await transcribeAudio(source);
    if (transcription.error && !transcription.text) {
      await logUsage(req.client.id, 'moderate-audio', false, Date.now() - start);
      return res.status(502).json({ error: transcription.error });
    }
    const transcriptText = (transcription.text || '').trim();
    if (!transcriptText) {
      await logUsage(req.client.id, 'moderate-audio', false, Date.now() - start);
      return res.json({ flagged: false, categories: [], confidence: 'baixa', reason: 'Sem fala identificável no áudio.' });
    }
    const prompt = ANALYZE_TEXT_PROMPT_PREFIX + transcriptText.slice(0, 3000) + '---';
    const result = await runTextCheck(prompt);
    await logUsage(req.client.id, 'moderate-audio', result.flagged, Date.now() - start);
    if (result.flagged) await logFlagged(req.client.id, 'moderate-audio', result.categories, result.reason, result.confidence);
    res.json({ flagged: result.flagged, categories: result.categories, confidence: result.confidence, reason: result.reason });
  })
);

// ---------- V1: MODERAÇÃO DE VÍDEO (frames amostrados pelo cliente) ----------
// Não processa o arquivo de vídeo em si (isso pediria ffmpeg no servidor) —
// o cliente extrai alguns frames (ex: 1 por segundo, ou nos momentos-chave)
// e manda como imagens, cada uma passa pela mesma checagem rigorosa de
// /v1/moderate-image. flagged=true se QUALQUER frame for sinalizado.
app.post(
  '/v1/moderate-video',
  heavyLimiter,
  requireApiKey,
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const { frames } = req.body || {};
    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({
        error: 'Envie "frames": um array de imagens (data URL ou URL) amostradas do vídeo, ex: 1 frame por segundo.',
      });
    }
    if (frames.length > MAX_VIDEO_FRAMES) {
      return res.status(400).json({ error: `Máximo de ${MAX_VIDEO_FRAMES} frames por requisição.` });
    }
    const perFrame = await Promise.all(
      frames.map(async (frame, index) => {
        if (typeof frame !== 'string' || !frame) {
          return { index, flagged: false, categories: [], confidence: 'baixa', reason: 'frame inválido' };
        }
        const result = await runVisionCheck(frame, MODERATE_IMAGE_PROMPT);
        return { index, ...result };
      })
    );
    const flagged = perFrame.some((f) => f.flagged);
    const categories = [...new Set(perFrame.flatMap((f) => f.categories || []))];
    const flaggedFrames = perFrame.filter((f) => f.flagged);
    const reason = flaggedFrames.length
      ? flaggedFrames.map((f) => `frame ${f.index}: ${f.reason || (f.categories || []).join(', ')}`).join(' | ')
      : null;
    let confidence = 'baixa';
    for (const f of perFrame) {
      if (f.confidence && (CONFIDENCE_RANK[f.confidence] || 0) >= (CONFIDENCE_RANK[confidence] || 0)) confidence = f.confidence;
    }
    await logUsage(req.client.id, 'moderate-video', flagged, Date.now() - start);
    if (flagged) await logFlagged(req.client.id, 'moderate-video', categories, reason, confidence);
    res.json({ flagged, categories, confidence, reason, frames: perFrame });
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
    // Indicam se o modo "checagem dupla" está ativo pra imagem/texto (ver
    // runVisionCheck/runTextCheck) — útil pra confirmar no painel que o modo
    // rigoroso está mesmo configurado, não só presente no código.
    dual_model_vision: !!process.env.GROQ_VISION_MODEL_2,
    dual_model_text: !!process.env.GROQ_TEXT_MODEL_2,
    audio_moderation: true,
    video_moderation: true,
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
