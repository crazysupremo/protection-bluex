# PROTECTION BLUEX — API de verificação de idade, moderação e análise de texto

Produto da **BLUE SPORTS GAMES**. Serviço próprio (separado do NEXT GAME) pra
vender/licenciar como API pra outras empresas integrarem nos próprios
produtos: apps, sites, plataformas de jogo, e-commerce, etc.

> A análise de câmera de segurança comercial (furto/roubo) NÃO está aqui —
> virou um app separado, **BLUEX SECURITY** (outro repositório, outro
> deploy), porque atende outro público (comércio/varejo, não plataformas
> online). Veja `bluex-security/README.md`.

## O que a API faz

Três capacidades, cada uma com seu próprio endpoint:

1. **Verificação de idade** (`/v1/age-verify`) — recebe uma foto de rosto, devolve uma estimativa de idade.
2. **Moderação de conteúdo** (`/v1/moderate-image`) — recebe uma imagem, sinaliza nudez, violência real, maus-tratos a animais, crime em andamento ou suspeita de risco a menor.
3. **Análise de texto** (`/v1/analyze-text`) — recebe uma mensagem/texto, sinaliza comportamento suspeito (ex: adulto se passando por menor, tentativa de aliciamento).

## Limitações importantes (leia antes de vender isso pra alguém)

- **Não é detecção de CSAM especializada.** Isso usa um modelo de visão de propósito geral (Groq), não um serviço como PhotoDNA/Thorn Safer que compara contra bancos de hashes conhecidos. Nunca prometa pra um cliente que isso identifica material de abuso infantil — só que sinaliza suspeita de risco pra revisão humana.
- **Não é verificação de idade legalmente vinculante.** É uma estimativa por IA. Não deve ser usada como único método de verificação onde a lei exige comprovação documental (ex: venda de álcool, conteúdo adulto).
- **Nenhuma imagem é guardada.** Só o resultado (sinalizado ou não, motivo, categorias) fica salvo, pra fila de revisão. Isso é bom pra privacidade, mas também significa que não tem como "ver de novo" o que gerou um alerta — só o texto do motivo.
- Todo cliente que usar essa API pra dados de usuários dele vai precisar da própria base legal (consentimento, aviso de privacidade, etc.) — isso é responsabilidade de cada empresa cliente, não da API.

## Como rodar localmente

```bash
npm install
GROQ_API_KEY=sua_chave ADMIN_PASSWORD=uma_senha_forte npm start
```

Abre em `http://localhost:4900`. O painel admin (pra criar clientes e ver
casos sinalizados) fica em `http://localhost:4900/` mesmo.

## Variáveis de ambiente

| Variável | Obrigatória | Pra quê |
|---|---|---|
| `GROQ_API_KEY` | Sim (senão a API sempre responde `flagged: false`) | Roda as análises de visão/texto |
| `ADMIN_PASSWORD` | Sim (senão o painel admin não abre) | Senha do painel admin — só você usa |
| `SESSION_SECRET` | Recomendado em produção | Assina o cookie de sessão do admin |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Recomendado em produção | Sem isso usa SQLite local, que some a cada redeploy no Render |
| `PORT` | Não | Porta do servidor (padrão 4900) |
| `GROQ_VISION_MODEL` / `GROQ_TEXT_MODEL` | Não | Trocar o modelo usado, se precisar |

## Como uma empresa cliente integra

1. Você cria a empresa no painel admin → gera uma chave de API (`bluex_...`).
2. A empresa manda a chave em todo request, no header `X-API-Key`.

### Verificação de idade

```bash
curl -X POST https://sua-api.onrender.com/v1/age-verify \
  -H "X-API-Key: bluex_xxx" \
  -H "Content-Type: application/json" \
  -d '{"image": "data:image/jpeg;base64,...."}'
```

Resposta:
```json
{ "estimated_age": 24, "confidence": "média", "flagged_as_minor": false, "reason": "..." }
```

### Moderação de imagem

```bash
curl -X POST https://sua-api.onrender.com/v1/moderate-image \
  -H "X-API-Key: bluex_xxx" -H "Content-Type: application/json" \
  -d '{"image_url": "https://exemplo.com/foto.jpg"}'
```

Resposta:
```json
{ "flagged": true, "categories": ["violencia_grave"], "reason": "..." }
```

### Análise de texto

```bash
curl -X POST https://sua-api.onrender.com/v1/analyze-text \
  -H "X-API-Key: bluex_xxx" -H "Content-Type: application/json" \
  -d '{"text": "mensagem do usuário aqui"}'
```

Todos os endpoints de imagem aceitam `"image"` (data URL base64) ou
`"image_url"` (link http/https direto) — não precisa dos dois.

## Limites

- 60 requisições por minuto por IP em todos os endpoints `/v1/*` (ajuste em `server.js` se precisar de mais, dependendo do plano do cliente).
- Corpo da requisição limitado a 6MB (imagens grandes em base64 passam disso — em produção real, prefira mandar `image_url` com a imagem já hospedada em algum storage, é mais leve).

## Deploy (Render, mesmo fluxo do NEXT GAME)

1. Sobe esse código num repositório Git.
2. No Render: New → Web Service → conecta o repositório.
3. Build command: `npm install`. Start command: `npm start`.
4. Configura as variáveis de ambiente da tabela acima.
5. Depois do primeiro deploy, entra no painel admin com a `ADMIN_PASSWORD` e cria seu primeiro cliente de teste.
