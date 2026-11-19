// Servidor da mesa: uma única função, sem dependências. Banco: Upstash Redis (REST).
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SENHA = process.env.MESTRE_SENHA;

async function pipe(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('banco indisponível');
  const j = await r.json();
  return j.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}
const cmd = async (...a) => (await pipe([a]))[0];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const igual = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(s);
const lerJson = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const erro = (c, m) => res.status(c).json({ erro: m });
  try {
    if (req.method !== 'POST') return erro(405, 'Método não permitido.');
    if (!URL_ || !TOK || !SENHA) return erro(500, 'Servidor sem configuração: falta o banco ou a MESTRE_SENHA.');
    const b = typeof req.body === 'string' ? lerJson(req.body) || {} : req.body || {};
    const h = req.headers;

    const ehMestre = !!h['x-mestre'] && igual(h['x-mestre'], SENHA);
    let jog = null;
    if (!ehMestre && idOk(h['x-jogador'])) {
      const o = lerJson(await cmd('GET', 'jog:' + h['x-jogador']));
      if (o && igual(sha(h['x-token'] || ''), o.th)) jog = { id: h['x-jogador'], nome: o.nome };
      else if (o && o.links && typeof o.links === 'object') {
        const tokenHash = sha(h['x-token'] || '');
        const entrada = Object.entries(o.links).find(([, link]) => link && igual(tokenHash, link.th));
        if (entrada) jog = { id: h['x-jogador'], nome: o.nome, fichaId: entrada[0] };
      }
    }

    switch (b.acao) {
      case 'entrar': {
        const c = await cmd('GET', 'mesa:convite');
        if (!c || !igual(b.codigo || '', c)) return erro(401, 'Convite inválido ou vencido. Peça um novo link ao mestre.');
        const nome = String(b.nome || '').trim().slice(0, 40);
        if (!nome) return erro(400, 'Escreva seu nome.');
        if ((await cmd('SCARD', 'jogadores')) >= 60) return erro(403, 'A mesa está cheia.');
        const id = rnd(9), token = rnd(24);
        await pipe([['SET', 'jog:' + id, JSON.stringify({ nome, th: sha(token) })], ['SADD', 'jogadores', id]]);
        return res.json({ id, token, nome });
      }
      case 'eu':
        if (ehMestre) return res.json({ papel: 'mestre' });
        if (jog) return res.json({ papel: 'jogador', id: jog.id, nome: jog.nome, fichaId: jog.fichaId || '' });
        return erro(401, 'Não autorizado.');
      case 'convite': {
        if (!ehMestre) return erro(401, 'Só o mestre pode convidar.');
        let c = await cmd('GET', 'mesa:convite');
        if (!c || b.novo) { c = rnd(12); await cmd('SET', 'mesa:convite', c); }
        return res.json({ codigo: c });
      }
      case 'minhas': {
        if (!jog) return erro(401, 'Não autorizado.');
        const f = lerJson(await cmd('GET', 'fichas:' + jog.id)) || { chars: {} };
        const chars = f.chars || {};
        return res.json({ nome: jog.nome, chars: jog.fichaId ? (chars[jog.fichaId] ? { [jog.fichaId]: chars[jog.fichaId] } : {}) : chars });
      }
      case 'listar': {
        if (!ehMestre) return erro(401, 'Só o mestre pode ver a mesa.');
        const ids = (await cmd('SMEMBERS', 'jogadores')) || [];
        if (!ids.length) return res.json({ jogadores: [] });
        const r = await pipe(ids.flatMap((i) => [['GET', 'jog:' + i], ['GET', 'fichas:' + i]]));
        const jogadores = ids.map((id, k) => {
          const o = lerJson(r[2 * k]); const f = lerJson(r[2 * k + 1]);
          return o ? { id, nome: o.nome, chars: (f && f.chars) || {} } : null;
        }).filter(Boolean);
        return res.json({ jogadores });
      }
      case 'salvar': {
        if (!ehMestre && !jog) return erro(401, 'Não autorizado.');
        const alvo = ehMestre ? b.alvo : jog.id;
        if (!idOk(alvo)) return erro(400, 'Jogador inválido.');
        if (ehMestre && !(await cmd('SISMEMBER', 'jogadores', alvo))) return erro(404, 'Jogador não encontrado.');
        let chars = b.chars;
        if (!chars || typeof chars !== 'object' || Array.isArray(chars)) return erro(400, 'Dados inválidos.');
        const ks = Object.keys(chars);
        if (jog && jog.fichaId) {
          if (ks.length !== 1 || ks[0] !== jog.fichaId) return erro(403, 'Este link so pode alterar a ficha vinculada.');
          const f = lerJson(await cmd('GET', 'fichas:' + alvo)) || { chars: {} };
          chars = Object.assign({}, f.chars || {}, { [jog.fichaId]: chars[jog.fichaId] });
        }
        const todos = Object.keys(chars);
        if (todos.length > 30) return erro(400, 'Fichas demais.');
        for (const k of todos) {
          if (!idOk(k) || typeof chars[k].s !== 'string' || typeof chars[k].nome !== 'string') return erro(400, 'Ficha inválida.');
        }
        const txt = JSON.stringify({ chars });
        if (txt.length > 300000) return erro(413, 'Ficha grande demais.');
        await cmd('SET', 'fichas:' + alvo, txt);
        return res.json({ ok: true });
      }
      case 'remover': {
        if (!ehMestre) return erro(401, 'Só o mestre pode remover.');
        if (!idOk(b.alvo)) return erro(400, 'Jogador inválido.');
        await pipe([['DEL', 'jog:' + b.alvo], ['DEL', 'fichas:' + b.alvo], ['SREM', 'jogadores', b.alvo]]);
        return res.json({ ok: true });
      }
      case 'excluir_ficha': {
        if (!ehMestre) return erro(401, 'Só o mestre pode excluir fichas.');
        if (!idOk(b.alvo) || !idOk(b.id)) return erro(400, 'Ficha inválida.');
        const f = lerJson(await cmd('GET', 'fichas:' + b.alvo)) || { chars: {} };
        const chars = Object.assign({}, f.chars);
        if (!Object.prototype.hasOwnProperty.call(chars, b.id)) return erro(404, 'Ficha não encontrada.');
        delete chars[b.id];
        const user = lerJson(await cmd('GET', 'jog:' + b.alvo));
        if (user && user.links && user.links[b.id]) { delete user.links[b.id]; await cmd('SET', 'jog:' + b.alvo, JSON.stringify(user)); }
        await cmd('SET', 'fichas:' + b.alvo, JSON.stringify({ chars }));
        return res.json({ ok: true });
      }
      case 'link_ficha': {
        if (!ehMestre) return erro(401, 'Só o mestre pode gerar links de ficha.');
        if (!idOk(b.alvo) || !idOk(b.id)) return erro(400, 'Ficha inválida.');
        const [userRaw, fichaRaw] = await Promise.all([cmd('GET', 'jog:' + b.alvo), cmd('GET', 'fichas:' + b.alvo)]);
        const user = lerJson(userRaw), ficha = lerJson(fichaRaw);
        if (!user || !ficha || !ficha.chars || !Object.prototype.hasOwnProperty.call(ficha.chars, b.id)) return erro(404, 'Ficha não encontrada.');
        user.links = user.links && typeof user.links === 'object' ? user.links : {};
        let link = user.links[b.id];
        if (!link || typeof link.token !== 'string' || typeof link.th !== 'string') {
          const token = rnd(24);
          link = { token, th: sha(token) };
          user.links[b.id] = link;
          await cmd('SET', 'jog:' + b.alvo, JSON.stringify(user));
        }
        return res.json({ token: link.token });
      }
      case 'canalha_novo': {
        if (!ehMestre) return erro(401, 'Só o mestre pode criar canalhas.');
        if (typeof b.s !== 'string' || b.s.length > 30000) return erro(400, 'Dados inválidos.');
        if ((await cmd('SCARD', 'canalhas')) >= 200) return erro(403, 'Canalhas demais.');
        const id = rnd(9), chave = rnd(16);
        await pipe([['SET', 'canalha:' + id, JSON.stringify({ chave, s: b.s })], ['SADD', 'canalhas', id]]);
        return res.json({ id, chave });
      }
      case 'canalha_listar': {
        if (!ehMestre) return erro(401, 'Só o mestre pode ver os canalhas.');
        const ids = (await cmd('SMEMBERS', 'canalhas')) || [];
        if (!ids.length) return res.json({ canalhas: [] });
        const r = await pipe(ids.map((i) => ['GET', 'canalha:' + i]));
        const canalhas = ids.map((id, k) => { const o = lerJson(r[k]); return o ? { id, chave: o.chave, s: o.s, jogadorNome: o.jogadorNome || '' } : null; }).filter(Boolean);
        return res.json({ canalhas });
      }
      case 'canalha_ver': {
        if (!idOk(b.id)) return erro(400, 'Link inválido.');
        const o = lerJson(await cmd('GET', 'canalha:' + b.id));
        if (!o || !(ehMestre || igual(b.chave || '', o.chave))) return erro(401, 'Link inválido ou vencido. Peça um novo ao mestre.');
        return res.json({ id: b.id, s: o.s, jogadorNome: o.jogadorNome || '' });
      }
      case 'canalha_entrar': {
        if (!idOk(b.id) || typeof b.chave !== 'string') return erro(400, 'Dados inválidos.');
        const nome = String(b.nome || '').trim().slice(0, 40);
        if (!nome) return erro(400, 'Informe seu nome.');
        const o = lerJson(await cmd('GET', 'canalha:' + b.id));
        if (!o || !igual(b.chave, o.chave)) return erro(401, 'Link inválido ou vencido. Peça um novo ao mestre.');
        await cmd('SET', 'canalha:' + b.id, JSON.stringify({ chave: o.chave, s: o.s, jogadorNome: nome }));
        return res.json({ id: b.id, s: o.s, jogadorNome: nome });
      }
      case 'canalha_salvar': {
        if (!idOk(b.id) || typeof b.s !== 'string' || b.s.length > 30000) return erro(400, 'Dados inválidos.');
        const o = lerJson(await cmd('GET', 'canalha:' + b.id));
        if (!o || !(ehMestre || igual(b.chave || '', o.chave))) return erro(401, 'Não autorizado.');
        await cmd('SET', 'canalha:' + b.id, JSON.stringify({ chave: o.chave, s: b.s, jogadorNome: o.jogadorNome || '' }));
        return res.json({ ok: true });
      }
      case 'canalha_chave_nova': {
        if (!ehMestre) return erro(401, 'Só o mestre pode gerar novo link.');
        if (!idOk(b.id)) return erro(400, 'Canalha inválido.');
        const o = lerJson(await cmd('GET', 'canalha:' + b.id));
        if (!o) return erro(404, 'Canalha não encontrado.');
        const chave = rnd(16);
        await cmd('SET', 'canalha:' + b.id, JSON.stringify({ chave, s: o.s, jogadorNome: o.jogadorNome || '' }));
        return res.json({ chave });
      }
      case 'canalha_excluir': {
        if (!ehMestre) return erro(401, 'Só o mestre pode excluir canalhas.');
        if (!idOk(b.id)) return erro(400, 'Canalha inválido.');
        await pipe([['DEL', 'canalha:' + b.id], ['SREM', 'canalhas', b.id]]);
        return res.json({ ok: true });
      }
      default:
        return erro(400, 'Ação desconhecida.');
    }
  } catch (e) {
    return erro(500, 'Erro no servidor.');
  }
};
