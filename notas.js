import { put, list, del } from "@vercel/blob";

// Perfis aceitos. Para incluir alguem, acrescente o id aqui e no index.html.
const PERFIS = ["carol", "chay", "fernanda", "kalini", "ruth", "aline", "ana", "beatriz"];
const PASTA = "obs-cmv8";
const CHAVE_APP = "cmv8-2026-equipe";
const LIMITE = 120 * 1024;

const token = () => process.env.BLOB_READ_WRITE_TOKEN;
const pasta = (user) => `${PASTA}/${user}/`;

function limpar(obj) {
  const saida = {};
  if (!obj || typeof obj !== "object") return saida;
  for (const chave of Object.keys(obj)) {
    const v = obj[chave];
    if (chave.length > 60) continue;
    if (v && typeof v === "object" && typeof v.t === "string") saida[chave] = { t: v.t.slice(0, 8000), ts: Number(v.ts) || 0 };
    else if (typeof v === "string") saida[chave] = { t: v.slice(0, 8000), ts: 1 };
  }
  return saida;
}

function mesclar(a, b) {
  const saida = Object.assign({}, a);
  for (const chave of Object.keys(b)) {
    if (!saida[chave] || (b[chave].ts || 0) > (saida[chave].ts || 0)) saida[chave] = b[chave];
  }
  return saida;
}

// Cada gravacao cria um arquivo novo, porque a URL de um arquivo ja existente
// fica em cache e devolveria texto velho. A leitura junta todos os arquivos.
async function ler(user) {
  let blobs = [];
  try {
    const r = await list({ prefix: pasta(user), limit: 1000, token: token() });
    blobs = r.blobs || [];
  } catch (e) {
    return { notas: {}, blobs: [] };
  }
  blobs.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
  const partes = await Promise.all(
    blobs.map(async (b) => {
      try {
        const r = await fetch(b.url, { headers: { authorization: `Bearer ${token()}` } });
        if (!r.ok) return {};
        const d = await r.json();
        return limpar(d && d.notas);
      } catch (e) {
        return {};
      }
    })
  );
  let notas = {};
  for (const parte of partes) notas = mesclar(notas, parte);
  return { notas, blobs };
}

async function gravar(user, notas, antigos) {
  const nome = `${pasta(user)}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  await put(nome, JSON.stringify({ notas, atualizadoEm: Date.now() }), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
    token: token(),
  });
  if (antigos && antigos.length) {
    try { await del(antigos.map((b) => b.url), { token: token() }); } catch (e) {}
  }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.headers["x-app-key"] !== CHAVE_APP) return res.status(401).json({ erro: "sem permissao" });

  let corpo = req.body;
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo || "{}"); } catch (e) { corpo = {}; } }
  corpo = corpo || {};

  const user = String((req.query && req.query.user) || corpo.user || "").toLowerCase();
  if (!PERFIS.includes(user)) return res.status(400).json({ erro: "perfil invalido" });

  try {
    if (req.method === "GET") {
      const { notas } = await ler(user);
      return res.status(200).json({ notas });
    }
    if (req.method === "POST") {
      if (JSON.stringify(corpo.notas || {}).length > LIMITE) return res.status(413).json({ erro: "texto grande demais" });
      const { notas, blobs } = await ler(user);
      const juntas = mesclar(notas, limpar(corpo.notas));
      await gravar(user, juntas, blobs);
      return res.status(200).json({ notas: juntas });
    }
    return res.status(405).json({ erro: "metodo nao aceito" });
  } catch (e) {
    return res.status(500).json({ erro: "falha ao salvar" });
  }
}
