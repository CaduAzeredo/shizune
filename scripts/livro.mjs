#!/usr/bin/env node
// @ts-check
// livro.mjs — o livro razão do Shizune, formato v0 (docs/spec/livro-v0.md).
//
// uso: node scripts/livro.mjs append <pasta> --actor <principal> --type <item|transicao|comentario|aceite> --item <id> [...]
//      node scripts/livro.mjs rebuild <pasta> [--stdout] [--sem-git] [--repo <dir>]
//      node scripts/livro.mjs check <pasta> [--git] [--sem-git] [--repo <dir>]
//      node scripts/livro.mjs check --todos [--raiz <dir>] [--git] [--sem-git]
//
// O livro é só de acréscimo: um arquivo por ator (events.<principal>.jsonl),
// uma linha por evento, cada linha um CloudEvents 1.0 em JSON canônico (RFC
// 8785), encadeado pelo sha256 da linha anterior. Nada se edita: o estado é
// sempre recalculado dos eventos. "assinado" nunca é evento, é derivado do
// commit com a chave humana sobre o mesmo SHA revisado.
//
// O append confere antes de escrever: monta o arquivo como ficaria, roda a
// mesma conferência do check e, se a linha nova trouxer qualquer problema, sai
// sem tocar no disco. O check aplica as regras L1 a L8 da spec, e a L9 (quem
// trouxe cada linha para o git) com --git. As assinaturas que derivam
// "assinado" vêm do git (%G? e %GS); --sem-git desliga essa leitura.
//
// Sem dependência: JSON canônico escrito à mão, sha256 do node:crypto, git e
// nada mais por processo filho. Tipos por JSDoc, conferidos com `tsc --checkJs`
// de fora do pacote (DEC-032, rascunho).

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORMATO = "shizune.livro/v0";
export const SITUACOES = ["a_fazer", "em_andamento", "aguardando_revisao", "revisado", "devolvido", "assinado", "entregue", "herdado"];
const TIPOS = {
  item: "dev.shizune.livro.item",
  transicao: "dev.shizune.livro.transicao",
  comentario: "dev.shizune.livro.comentario",
  aceite: "dev.shizune.livro.aceite",
};
const PAPEIS = ["executor", "revisor", "humano", "cliente"];
const ZERO = "0".repeat(64);
const ATRIBUTOS = [
  "specversion", "id", "source", "type", "subject", "time", "datacontenttype", "data",
  "shzactor", "shzseq", "shzprev", "shzbase", "shznonce",
];
const RE_PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/;
const RE_ITEM = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RE_TEMPO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const RE_SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const RE_HEX64 = /^[0-9a-f]{64}$/;
const RE_NONCE = /^[0-9a-f]{32}$/;
const RE_ARQUIVO = /^events\.(.+)\.jsonl$/;

/** Quem pode cada transição. `assinado` não está aqui de propósito: é derivado. */
/** @type {Record<string, string[]>} */
const TRANSICOES = {
  "a_fazer>em_andamento": ["executor", "humano"],
  "herdado>a_fazer": ["executor", "humano"],
  "herdado>em_andamento": ["executor", "humano"],
  "em_andamento>aguardando_revisao": ["executor"],
  "aguardando_revisao>revisado": ["revisor", "humano"],
  "aguardando_revisao>devolvido": ["revisor", "humano"],
  "devolvido>em_andamento": ["executor"],
  "assinado>entregue": ["humano"],
};

/**
 * @typedef {{regra: string, arquivo: string, linha: number, msg: string}} Problema
 * @typedef {{letra: string, principal: string}} Assinatura
 * @typedef {Record<string, Assinatura> | ((sha: string) => Assinatura | null)} Assinaturas
 * @typedef {{
 *   item: string, titulo: string, grupo?: string, criterio?: string,
 *   legado?: Record<string, string>, situacao: string, comentarios: number, aceites: number,
 *   sha_revisado?: string, levou_a_revisao?: string, revisado_por?: string, assinado_por?: string
 * }} EstadoItem
 * @typedef {{obj: Record<string, any>, arquivo: string, linha: number}} Evento
 * @typedef {{
 *   atores: string, arquivos: Record<string, Buffer>, assinaturas?: Assinaturas,
 *   projecaoCommitada?: Buffer
 * }} Entrada
 * @typedef {{erros: Problema[], avisos: Problema[], projecao: Record<string, any>, texto: string, eventos: number}} Resultado
 */

// ── JSON canônico (RFC 8785) ────────────────────────────────────────────────

const SURROGATE_SOLTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * Serializa no JSON canônico da RFC 8785. Chaves em ordem de unidade UTF-16 (a
 * ordem do sort padrão do JavaScript), números e strings como o ECMAScript os
 * serializa. Recusa o que a RFC recusa: NaN, Infinity, undefined, surrogate solto.
 * @param {unknown} v
 * @returns {string}
 */
export function jcs(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`jcs: número não finito (${v})`);
    return JSON.stringify(v);
  }
  if (typeof v === "string") {
    if (SURROGATE_SOLTO.test(v)) throw new Error("jcs: string com surrogate solto");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  if (typeof v === "object") {
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o)
      .sort()
      .map((k) => {
        if (o[k] === undefined) throw new Error(`jcs: valor undefined em "${k}"`);
        return `${jcs(k)}:${jcs(o[k])}`;
      })
      .join(",")}}`;
  }
  throw new Error(`jcs: tipo não serializável (${typeof v})`);
}

/** @param {string} s */
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** @param {unknown} v */
const textoCheio = (v) => typeof v === "string" && v.length > 0;

// ── atores ──────────────────────────────────────────────────────────────────

/**
 * Lê atores.txt: uma linha por ator, "<papel> <principal>", com # de comentário.
 * @param {string} texto
 * @returns {{papeis: Map<string, string>, problemas: Problema[]}}
 */
export function lerAtores(texto) {
  /** @type {Map<string, string>} */
  const papeis = new Map();
  /** @type {Problema[]} */
  const problemas = [];
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const l = bruta.replace(/#.*/, "").trim();
    if (!l) return;
    const [papel, principal, ...resto] = l.split(/\s+/);
    if (!PAPEIS.includes(papel) || !principal || resto.length || !RE_PRINCIPAL.test(principal)) {
      problemas.push({ regra: "L5", arquivo: "atores.txt", linha: i + 1, msg: `linha inválida: "${l}" (esperado "<${PAPEIS.join("|")}> <principal>")` });
    } else if (papeis.has(principal)) {
      problemas.push({ regra: "L5", arquivo: "atores.txt", linha: i + 1, msg: `${principal} declarado duas vezes` });
    } else papeis.set(principal, papel);
  });
  return { papeis, problemas };
}

// ── envelope e dados (L3) ───────────────────────────────────────────────────

/**
 * Confere um objeto contra um conjunto fechado de campos.
 * @param {Record<string, any>} o
 * @param {string[]} obrigatorios
 * @param {string[]} opcionais
 * @returns {string | null}
 */
function camposFechados(o, obrigatorios, opcionais) {
  for (const c of obrigatorios) if (!(c in o)) return `falta "${c}"`;
  for (const c of Object.keys(o)) if (!obrigatorios.includes(c) && !opcionais.includes(c)) return `campo "${c}" fora do formato`;
  return null;
}

/**
 * Devolve o motivo de o envelope ou os dados estarem fora do formato, ou null.
 * @param {Record<string, any>} o
 * @returns {string | null}
 */
function problemaDeEnvelope(o) {
  const f = camposFechados(o, ATRIBUTOS, []);
  if (f) return `envelope: ${f}`;
  if (o.specversion !== "1.0") return 'specversion tem de ser "1.0"';
  if (!textoCheio(o.id)) return "id vazio";
  if (!textoCheio(o.source) || /\s/.test(o.source)) return "source vazio ou com espaço";
  if (!Object.values(TIPOS).includes(o.type)) return `type desconhecido: ${o.type}`;
  if (typeof o.time !== "string" || !RE_TEMPO.test(o.time)) return `time fora do formato UTC: ${o.time}`;
  if (o.datacontenttype !== "application/json") return 'datacontenttype tem de ser "application/json"';
  if (typeof o.shzactor !== "string" || !RE_PRINCIPAL.test(o.shzactor)) return "shzactor inválido";
  if (!Number.isInteger(o.shzseq) || o.shzseq < 1) return "shzseq tem de ser inteiro a partir de 1";
  if (typeof o.shzprev !== "string" || !RE_HEX64.test(o.shzprev)) return "shzprev tem de ter 64 hex minúsculos";
  if (typeof o.shzbase !== "string" || !RE_SHA.test(o.shzbase)) return "shzbase tem de ser um SHA de 40 ou 64 hex";
  if (typeof o.shznonce !== "string" || !RE_NONCE.test(o.shznonce)) return "shznonce tem de ter 32 hex minúsculos";
  if (!ehObjeto(o.data)) return "data tem de ser objeto";
  const d = o.data;
  if (typeof d.item !== "string" || !RE_ITEM.test(d.item)) return "data.item inválido";
  if (o.subject !== d.item) return "subject diferente de data.item";
  /** @param {unknown} v */
  const opcTexto = (v) => v === undefined || typeof v === "string";
  switch (o.type) {
    case TIPOS.item: {
      const g = camposFechados(d, ["item", "titulo"], ["grupo", "criterio", "legado"]);
      if (g) return `data: ${g}`;
      if (!textoCheio(d.titulo) || !opcTexto(d.grupo) || !opcTexto(d.criterio)) return "data: titulo, grupo ou criterio inválido";
      if (d.legado !== undefined) {
        if (!ehObjeto(d.legado)) return "data.legado tem de ser objeto";
        const l = camposFechados(d.legado, ["situacao", "fonte"], ["nota"]);
        if (l) return `data.legado: ${l}`;
        if (!["feito", "agora", "afazer", "bloqueado"].includes(d.legado.situacao)) return `data.legado.situacao desconhecida: ${d.legado.situacao}`;
        if (!textoCheio(d.legado.fonte) || !opcTexto(d.legado.nota)) return "data.legado: fonte ou nota inválida";
      }
      return null;
    }
    case TIPOS.transicao: {
      const g = camposFechados(d, ["item", "de", "para"], ["evidencia", "nota"]);
      if (g) return `data: ${g}`;
      if (!SITUACOES.includes(d.de) || !SITUACOES.includes(d.para)) return `data: situação desconhecida (${d.de} → ${d.para})`;
      if (!opcTexto(d.nota)) return "data.nota inválida";
      if (d.evidencia !== undefined) {
        if (!ehObjeto(d.evidencia)) return "data.evidencia tem de ser objeto";
        const e = camposFechados(d.evidencia, ["sha"], ["cmd", "repo", "saida_sha256"]);
        if (e) return `data.evidencia: ${e}`;
        if (typeof d.evidencia.sha !== "string" || !RE_SHA.test(d.evidencia.sha)) return "data.evidencia.sha inválido";
        if (!opcTexto(d.evidencia.cmd) || !opcTexto(d.evidencia.repo)) return "data.evidencia: cmd ou repo inválido";
        if (d.evidencia.saida_sha256 !== undefined && !RE_HEX64.test(d.evidencia.saida_sha256)) return "data.evidencia.saida_sha256 inválido";
      }
      return null;
    }
    case TIPOS.comentario: {
      const g = camposFechados(d, ["item", "texto"], []);
      if (g) return `data: ${g}`;
      return textoCheio(d.texto) ? null : "data.texto vazio";
    }
    default: {
      const g = camposFechados(d, ["item"], ["texto"]);
      if (g) return `data: ${g}`;
      return opcTexto(d.texto) ? null : "data.texto inválido";
    }
  }
}

// ── a conferência (L1 a L8) e a projeção ────────────────────────────────────

/**
 * @param {Assinaturas | undefined} a
 * @returns {(sha: string) => Assinatura | null}
 */
function oraculo(a) {
  if (!a) return () => null;
  if (typeof a === "function") return a;
  return (sha) => a[sha] ?? null;
}

/**
 * Confere um livro dado como dados e calcula a projeção. É a função que os
 * vetores de conformidade exercitam; o CLI só lê o disco e chama esta.
 * @param {Entrada} entrada
 * @returns {Resultado}
 */
export function conferir({ atores, arquivos, assinaturas, projecaoCommitada }) {
  /** @type {Problema[]} */
  const erros = [];
  /** @type {Problema[]} */
  const avisos = [];
  const { papeis, problemas } = lerAtores(atores);
  erros.push(...problemas);
  if (![...papeis.values()].includes("humano")) {
    avisos.push({ regra: "L5", arquivo: "atores.txt", linha: 0, msg: "nenhum humano declarado: nenhum item vira assinado, e nenhum humano escreve eventos" });
  }
  const assinatura = oraculo(assinaturas);
  /** @param {string} regra @param {string} arquivo @param {number} linha @param {string} msg */
  const erro = (regra, arquivo, linha, msg) => erros.push({ regra, arquivo, linha, msg });

  /** @type {Evento[]} */
  const aplicaveis = [];
  /** @type {Map<string, string>} */
  const ids = new Map();
  /** @type {Map<string, string>} */
  const nonces = new Map();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;

  for (const nome of Object.keys(arquivos).sort()) {
    const m = RE_ARQUIVO.exec(nome);
    if (!m) continue;
    const principal = m[1];
    const bytes = arquivos[nome];
    let declarado = true;
    if (!RE_PRINCIPAL.test(principal) || !papeis.has(principal)) {
      erro("L5", nome, 0, `o principal ${principal} não está declarado em atores.txt`);
      declarado = false;
    }

    // L1: bytes e linhas. Arquivo que falha aqui não é lido adiante.
    let texto = "";
    try {
      texto = decoder.decode(bytes);
    } catch {
      erro("L1", nome, 0, "não é UTF-8 válido");
      continue;
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      erro("L1", nome, 1, "começa com marca de ordem de bytes (BOM)");
      continue;
    }
    if (bytes.includes(0x0d)) {
      const linhaCr = texto.slice(0, texto.indexOf("\r")).split("\n").length;
      erro("L1", nome, linhaCr, "tem CR: o livro é só LF");
      continue;
    }
    if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
      erro("L1", nome, texto.split("\n").length, bytes.length === 0 ? "arquivo vazio" : "a última linha não termina com LF");
      continue;
    }
    const linhas = texto.slice(0, -1).split("\n");
    const vazia = linhas.findIndex((l) => l === "");
    if (vazia >= 0) {
      erro("L1", nome, vazia + 1, "linha vazia");
      continue;
    }

    let prev = ZERO;
    let tempoAnterior = "";
    linhas.forEach((linha, i) => {
      const n = i + 1;
      total++;
      let aplicavel = declarado;
      /** @type {any} */
      let o;
      try {
        o = JSON.parse(linha);
      } catch {
        erro("L2", nome, n, "não é JSON");
        aplicavel = false;
      }
      if (o !== undefined) {
        let canonica = "";
        try {
          canonica = jcs(o);
        } catch (e) {
          canonica = `(${/** @type {Error} */ (e).message})`;
        }
        if (canonica !== linha) {
          erro("L2", nome, n, "a linha não é igual à própria forma canônica (RFC 8785)");
          aplicavel = false;
        }
      }
      if (ehObjeto(o)) {
        if (o.shzseq !== n) erro("L4", nome, n, `shzseq é ${o.shzseq}, esperado ${n}`);
        if (o.shzprev !== prev) erro("L4", nome, n, `shzprev não é o sha256 da linha ${n - 1}${n === 1 ? " (na primeira, 64 zeros)" : ""}`);
        if (typeof o.time === "string" && RE_TEMPO.test(o.time)) {
          if (tempoAnterior && Date.parse(o.time) < Date.parse(tempoAnterior)) erro("L4", nome, n, `time volta no tempo (${o.time} depois de ${tempoAnterior})`);
          tempoAnterior = o.time;
        }
        const p = problemaDeEnvelope(o);
        if (p) {
          erro("L3", nome, n, p);
          aplicavel = false;
        }
        if (o.shzactor !== principal) {
          erro("L5", nome, n, `shzactor é ${o.shzactor}, e o arquivo é de ${principal}`);
          aplicavel = false;
        }
        for (const [campo, vistos] of /** @type {[string, Map<string, string>][]} */ ([["id", ids], ["shznonce", nonces]])) {
          const v = o[campo];
          if (typeof v !== "string") continue;
          if (vistos.has(v)) erro("L6", nome, n, `${campo} repetido (já em ${vistos.get(v)})`);
          else vistos.set(v, `${nome}:${n}`);
        }
      } else if (o !== undefined) {
        erro("L3", nome, n, "a linha não é um objeto");
        aplicavel = false;
      }
      prev = sha256(linha);
      if (aplicavel) aplicaveis.push({ obj: o, arquivo: nome, linha: n });
    });
  }

  // A ordem global: time, depois shzactor (unidade UTF-16), depois shzseq.
  aplicaveis.sort((a, b) => {
    const ta = Date.parse(a.obj.time);
    const tb = Date.parse(b.obj.time);
    if (ta !== tb) return ta - tb;
    if (a.obj.shzactor !== b.obj.shzactor) return a.obj.shzactor < b.obj.shzactor ? -1 : 1;
    return a.obj.shzseq - b.obj.shzseq;
  });

  /** @type {Map<string, EstadoItem>} */
  const itens = new Map();
  /** @param {string} sha */
  const humanoAssinou = (sha) => {
    const a = assinatura(sha);
    return a && a.letra === "G" && papeis.get(a.principal) === "humano" ? a.principal : null;
  };
  /** @param {EstadoItem} it */
  const situacaoAtual = (it) => (it.situacao === "revisado" && it.sha_revisado && humanoAssinou(it.sha_revisado) ? "assinado" : it.situacao);

  for (const { obj: o, arquivo, linha } of aplicaveis) {
    const papel = papeis.get(o.shzactor) ?? "";
    const d = o.data;
    const it = itens.get(d.item);
    /** @param {string} msg */
    const l7 = (msg) => erro("L7", arquivo, linha, msg);
    if (o.type === TIPOS.item) {
      if (!["executor", "humano"].includes(papel)) l7(`${papel || "ator"} não cria item`);
      else if (it) l7(`o item ${d.item} já existe`);
      else {
        /** @type {EstadoItem} */
        const novo = { item: d.item, titulo: d.titulo, situacao: d.legado ? "herdado" : "a_fazer", comentarios: 0, aceites: 0 };
        if (d.grupo !== undefined) novo.grupo = d.grupo;
        if (d.criterio !== undefined) novo.criterio = d.criterio;
        if (d.legado !== undefined) novo.legado = d.legado;
        itens.set(d.item, novo);
      }
      continue;
    }
    if (!it) {
      l7(`o item ${d.item} não foi criado antes`);
      continue;
    }
    if (o.type === TIPOS.comentario) {
      it.comentarios++;
      continue;
    }
    if (o.type === TIPOS.aceite) {
      if (!["cliente", "humano"].includes(papel)) l7(`${papel} não registra aceite`);
      else it.aceites++;
      continue;
    }
    // transição
    const atual = situacaoAtual(it);
    if (papel === "cliente") l7("o cliente não muda a situação de um item");
    else if (d.para === "assinado") l7("assinado nunca é escrito: é derivado do commit com a chave humana");
    else if (d.de !== atual) l7(`a transição diz de ${d.de}, e o item está em ${atual}`);
    else if (!(TRANSICOES[`${d.de}>${d.para}`] ?? []).includes(papel)) l7(`${papel} não faz ${d.de} → ${d.para}`);
    else if (d.para === "aguardando_revisao" && !d.evidencia?.sha) l7("ir para revisão exige evidencia.sha, o SHA revisado");
    else if (d.de === "aguardando_revisao" && o.shzactor === it.levou_a_revisao) l7("quem revisa não pode ser quem levou o item à revisão");
    else {
      if (d.para === "aguardando_revisao") {
        it.sha_revisado = d.evidencia.sha;
        it.levou_a_revisao = o.shzactor;
      }
      if (d.para === "revisado") it.revisado_por = o.shzactor;
      if (d.de === "assinado") it.assinado_por = humanoAssinou(it.sha_revisado ?? "") ?? undefined;
      it.situacao = d.para;
    }
  }

  /** @type {Record<string, number>} */
  const contagem = Object.fromEntries(SITUACOES.map((s) => [s, 0]));
  const lista = [...itens.values()].map((it) => {
    const situacao = situacaoAtual(it);
    contagem[situacao]++;
    /** @type {Record<string, unknown>} */
    const saida = { item: it.item, titulo: it.titulo, situacao, comentarios: it.comentarios, aceites: it.aceites };
    for (const c of /** @type {const} */ (["grupo", "criterio", "legado", "sha_revisado", "revisado_por"])) if (it[c] !== undefined) saida[c] = it[c];
    const assinou = situacao === "assinado" ? humanoAssinou(it.sha_revisado ?? "") : it.assinado_por;
    if (assinou) saida.assinado_por = assinou;
    return saida;
  });
  const projecao = { formato: FORMATO, contagem, itens: lista };
  const textoProjecao = `${jcs(projecao)}\n`;

  if (projecaoCommitada !== undefined && !projecaoCommitada.equals(Buffer.from(textoProjecao, "utf8"))) {
    erro("L8", "ledger.json", 0, "a projeção gravada difere da recalculada a partir dos eventos");
  }
  return { erros, avisos, projecao, texto: textoProjecao, eventos: total };
}

// ── o disco e o git ─────────────────────────────────────────────────────────

/**
 * @param {string} dir
 * @param {...string} args
 */
function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trimEnd() };
}

/** @param {string} dir @returns {string | null} */
function raizGit(dir) {
  const r = git(dir, "rev-parse", "--show-toplevel");
  return r.ok ? r.out : null;
}

/**
 * As assinaturas lidas do git, com cache.
 * @param {string | null} repo
 * @returns {(sha: string) => Assinatura | null}
 */
function assinaturasDoGit(repo) {
  /** @type {Map<string, Assinatura | null>} */
  const cache = new Map();
  return (sha) => {
    if (!repo) return null;
    if (!cache.has(sha)) {
      const r = git(repo, "log", "-1", "--format=%G?%x09%GS", sha);
      if (!r.ok) cache.set(sha, null);
      else {
        const [letra, principal] = r.out.split("\t");
        cache.set(sha, { letra, principal: principal ?? "" });
      }
    }
    return cache.get(sha) ?? null;
  };
}

/**
 * Lê a pasta de um livro.
 * @param {string} dir
 * @returns {{atores: string, arquivos: Record<string, Buffer>, projecao: Buffer | undefined}}
 */
function lerPasta(dir) {
  const pAtores = path.join(dir, "atores.txt");
  if (!fs.existsSync(pAtores)) throw new Error(`${dir} não tem atores.txt`);
  /** @type {Record<string, Buffer>} */
  const arquivos = {};
  for (const n of fs.readdirSync(dir)) if (RE_ARQUIVO.test(n)) arquivos[n] = fs.readFileSync(path.join(dir, n));
  const pProj = path.join(dir, "ledger.json");
  return { atores: fs.readFileSync(pAtores, "utf8"), arquivos, projecao: fs.existsSync(pProj) ? fs.readFileSync(pProj) : undefined };
}

/**
 * A regra L9: quem trouxe cada linha para o git.
 * @param {string} dir
 * @param {Map<string, string>} papeis
 * @param {Record<string, Buffer>} arquivos
 * @returns {{erros: Problema[], avisos: Problema[]}}
 */
function atribuicao(dir, papeis, arquivos) {
  /** @type {Problema[]} */
  const erros = [];
  /** @type {Problema[]} */
  const avisos = [];
  const raiz = raizGit(dir);
  if (!raiz) {
    avisos.push({ regra: "L9", arquivo: "", linha: 0, msg: "a pasta não está num repositório git: atribuição não conferida" });
    return { erros, avisos };
  }
  const sig = assinaturasDoGit(raiz);
  /** @type {Map<string, string[]>} */
  const tocados = new Map();
  /** @param {string} c */
  const caminhosDo = (c) => {
    if (!tocados.has(c)) tocados.set(c, git(raiz, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", c).out.split("\n").filter(Boolean));
    return tocados.get(c) ?? [];
  };
  const vistosCommit = new Set();
  for (const nome of Object.keys(arquivos).sort()) {
    const ator = /** @type {RegExpExecArray} */ (RE_ARQUIVO.exec(nome))[1];
    const rel = path.relative(raiz, path.join(dir, nome)).split(path.sep).join("/");
    const b = git(raiz, "blame", "--porcelain", "--", rel);
    /** @type {Map<number, string>} */
    const porLinha = new Map();
    if (b.ok) {
      for (const l of b.out.split("\n")) {
        const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
        if (m) porLinha.set(Number(m[2]), m[1]);
      }
    }
    const n = arquivos[nome].toString("utf8").split("\n").filter(Boolean).length;
    let fora = 0;
    for (let linha = 1; linha <= n; linha++) {
      const c = porLinha.get(linha);
      if (!c || /^0+$/.test(c)) {
        fora++;
        continue;
      }
      const s = sig(c);
      const curto = c.slice(0, 7);
      if (!s || s.letra !== "G") erros.push({ regra: "L9", arquivo: nome, linha, msg: `trazida por ${curto}, sem assinatura G (%G? = ${s?.letra ?? "?"})` });
      else if (s.principal === ator) {
        /* atribuída ao próprio ator */
      } else if (papeis.get(s.principal) === "humano") avisos.push({ regra: "L9", arquivo: nome, linha, msg: `trazida pelo humano ${s.principal} (${curto}), e não pelo ator` });
      else erros.push({ regra: "L9", arquivo: nome, linha, msg: `a chave de ${s.principal || "?"} trouxe a linha de ${ator} (${curto})` });

      if (s && s.letra === "G" && papeis.get(s.principal) !== "humano" && !vistosCommit.has(c)) {
        vistosCommit.add(c);
        const proprio = path.relative(raiz, path.join(dir, `events.${s.principal}.jsonl`)).split(path.sep).join("/");
        const outros = caminhosDo(c).filter((p) => p !== proprio);
        if (outros.length) erros.push({ regra: "L9", arquivo: nome, linha, msg: `o commit ${curto}, de chave de máquina, toca outros caminhos: ${outros.join(", ")}` });
      }
    }
    if (fora) avisos.push({ regra: "L9", arquivo: nome, linha: 0, msg: `${fora} linha(s) ainda fora do git: não atribuída(s)` });
  }
  return { erros, avisos };
}

// ── o CLI ───────────────────────────────────────────────────────────────────

/**
 * @param {string[]} argv
 * @returns {{pos: string[], o: Record<string, string | true>}}
 */
function lerArgs(argv) {
  /** @type {string[]} */
  const pos = [];
  /** @type {Record<string, string | true>} */
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const prox = argv[i + 1];
    if (prox !== undefined && !prox.startsWith("--")) {
      o[a.slice(2)] = prox;
      i++;
    } else o[a.slice(2)] = true;
  }
  return { pos, o };
}

/** @param {string} msg @returns {never} */
function recusar(msg) {
  console.error(`livro: ${msg}`);
  process.exit(1);
}

/** @param {Problema} p */
const mostrar = (p) => `[${p.regra}] ${p.arquivo}${p.linha ? `:${p.linha}` : ""} — ${p.msg}`;

/**
 * As assinaturas para um livro: do git do repositório da pasta, ou nenhuma.
 * @param {string} dir
 * @param {Record<string, string | true>} o
 */
function assinaturasPara(dir, o) {
  if (o["sem-git"]) return undefined;
  const repo = typeof o.repo === "string" ? o.repo : raizGit(dir);
  return assinaturasDoGit(repo);
}

/** @param {string} dir @param {Record<string, string | true>} o */
function cmdAppend(dir, o) {
  /** @param {string} k */
  const s = (k) => (typeof o[k] === "string" ? /** @type {string} */ (o[k]) : undefined);
  const ator = s("actor") ?? recusar("diga --actor <principal>");
  const tipo = s("type") ?? recusar(`diga --type <${Object.keys(TIPOS).join("|")}>`);
  if (!(tipo in TIPOS)) recusar(`--type desconhecido: ${tipo}`);
  const item = s("item") ?? recusar("diga --item <id>");
  if (!RE_PRINCIPAL.test(ator)) recusar(`principal inválido: ${ator}`);
  const pasta = lerPasta(dir);

  /** @type {Record<string, unknown>} */
  const data = { item };
  if (tipo === "item") {
    data.titulo = s("titulo");
    for (const k of ["grupo", "criterio"]) if (s(k) !== undefined) data[k] = s(k);
    if (s("legado-situacao") !== undefined) {
      /** @type {Record<string, string | undefined>} */
      const legado = { situacao: s("legado-situacao"), fonte: s("legado-fonte") };
      if (s("legado-nota") !== undefined) legado.nota = s("legado-nota");
      data.legado = legado;
    }
  } else if (tipo === "transicao") {
    data.de = s("de");
    data.para = s("para");
    if (s("sha") !== undefined) {
      /** @type {Record<string, string | undefined>} */
      const ev = { sha: s("sha") };
      for (const [k, campo] of [["cmd", "cmd"], ["repo", "repo"], ["saida-sha256", "saida_sha256"]]) if (s(k) !== undefined) ev[campo] = s(k);
      data.evidencia = ev;
    }
    if (s("nota") !== undefined) data.nota = s("nota");
  } else if (tipo === "comentario") data.texto = s("texto");
  else if (s("texto") !== undefined) data.texto = s("texto");
  for (const [k, v] of Object.entries(data)) if (v === undefined) recusar(`falta --${k} para --type ${tipo}`);

  const nome = `events.${ator}.jsonl`;
  const atual = pasta.arquivos[nome] ?? Buffer.alloc(0);
  const linhas = atual.length ? atual.toString("utf8").replace(/\n$/, "").split("\n") : [];
  const base = s("base") ?? (raizGit(dir) ? git(dir, "rev-parse", "HEAD").out : undefined) ?? recusar("a pasta não está num repositório git: diga --base <sha>");
  const evento = {
    specversion: "1.0",
    id: s("id") ?? randomUUID(),
    source: s("source") ?? `shz://livro/${path.basename(path.resolve(dir, ".."))}`,
    type: TIPOS[/** @type {keyof typeof TIPOS} */ (tipo)],
    subject: item,
    time: s("time") ?? new Date().toISOString(),
    datacontenttype: "application/json",
    data,
    shzactor: ator,
    shzseq: linhas.length + 1,
    shzprev: linhas.length ? sha256(linhas[linhas.length - 1]) : ZERO,
    shzbase: base,
    shznonce: randomBytes(16).toString("hex"),
  };
  const linha = jcs(evento);
  const novo = Buffer.concat([atual, Buffer.from(`${linha}\n`, "utf8")]);

  // Confere antes de escrever: só entra se a linha nova não trouxer problema.
  const assinaturas = assinaturasPara(dir, o);
  /** @param {Problema} p */
  const chave = (p) => `${p.regra}|${p.arquivo}|${p.linha}|${p.msg}`;
  const antes = new Set(conferir({ atores: pasta.atores, arquivos: pasta.arquivos, assinaturas }).erros.map(chave));
  const depois = conferir({ atores: pasta.atores, arquivos: { ...pasta.arquivos, [nome]: novo }, assinaturas });
  const novos = depois.erros.filter((p) => !antes.has(chave(p)));
  if (novos.length) {
    for (const p of novos) console.error(`  ${mostrar(p)}`);
    recusar(`o evento não entrou: ${novos.length} problema(s). Nada foi escrito.`);
  }
  fs.appendFileSync(path.join(dir, nome), `${linha}\n`, "utf8");
  console.log(`livro: ${tipo} de ${item} anotado em ${nome}, linha ${evento.shzseq}. Resultado: OK`);
}

/** @param {string} dir @param {Record<string, string | true>} o */
function cmdRebuild(dir, o) {
  const pasta = lerPasta(dir);
  const r = conferir({ atores: pasta.atores, arquivos: pasta.arquivos, assinaturas: assinaturasPara(dir, o) });
  if (r.erros.length) {
    for (const p of r.erros) console.error(`  ${mostrar(p)}`);
    recusar(`o livro tem ${r.erros.length} problema(s); a projeção não foi gravada.`);
  }
  if (o.stdout) {
    process.stdout.write(r.texto);
    return;
  }
  fs.writeFileSync(path.join(dir, "ledger.json"), r.texto, "utf8");
  console.log(`livro: ledger.json gravado (${r.projecao.itens.length} itens, ${r.eventos} eventos). Resultado: OK`);
}

/**
 * O resultado do check de uma pasta, como dado: o que o `--json` imprime e o
 * que um leitor (o painel do projeto companheiro) consome sem reconferir.
 * Pasta que não se lê vira `ok: false` com o motivo em `falha`, nunca estado.
 * @param {string} dir
 * @param {Record<string, string | true>} o
 */
function resultadoDaPasta(dir, o) {
  /** @type {{atores: string, arquivos: Record<string, Buffer>, projecao: Buffer | undefined}} */
  let pasta;
  try {
    pasta = lerPasta(dir);
  } catch (e) {
    return { formato: FORMATO, pasta: dir, ok: false, falha: /** @type {Error} */ (e).message };
  }
  const raiz = o["sem-git"] ? null : raizGit(dir);
  const versionada = raiz ? git(dir, "ls-files", "--error-unmatch", "ledger.json").ok : true;
  const r = conferir({
    atores: pasta.atores,
    arquivos: pasta.arquivos,
    assinaturas: assinaturasPara(dir, o),
    projecaoCommitada: versionada ? pasta.projecao : undefined,
  });
  const regras = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
  if (pasta.projecao && !versionada) {
    r.avisos.push({ regra: "L8", arquivo: "ledger.json", linha: 0, msg: "a projeção gravada está fora do git: não conferida (L8 vale para a projeção commitada)" });
  }
  if (o.git && !o["sem-git"]) {
    const a = atribuicao(dir, lerAtores(pasta.atores).papeis, pasta.arquivos);
    r.erros.push(...a.erros);
    r.avisos.push(...a.avisos);
    regras.push("L9");
  }
  return {
    formato: FORMATO,
    pasta: dir,
    ok: r.erros.length === 0,
    eventos: r.eventos,
    arquivos: Object.keys(pasta.arquivos).length,
    contagem: r.projecao.contagem,
    itens: r.projecao.itens,
    regras: Object.fromEntries(regras.map((g) => [g, r.erros.some((p) => p.regra === g) ? "falha" : "ok"])),
    erros: r.erros,
    avisos: r.avisos,
    projecaoForaDoGit: Boolean(pasta.projecao && !versionada),
  };
}

/**
 * Confere um livro e imprime. Devolve o número de erros.
 * @param {string} dir
 * @param {Record<string, string | true>} o
 * @param {string} rotulo
 */
function conferirPasta(dir, o, rotulo) {
  const pasta = lerPasta(dir);
  // L8 vale para a projeção commitada. Fora do git (ou com --sem-git), vale
  // para a que está no disco; dentro do git, só se o ledger.json for versionado.
  const raiz = o["sem-git"] ? null : raizGit(dir);
  const versionada = raiz ? git(dir, "ls-files", "--error-unmatch", "ledger.json").ok : true;
  const r = conferir({
    atores: pasta.atores,
    arquivos: pasta.arquivos,
    assinaturas: assinaturasPara(dir, o),
    projecaoCommitada: versionada ? pasta.projecao : undefined,
  });
  if (o.git && !o["sem-git"]) {
    const a = atribuicao(dir, lerAtores(pasta.atores).papeis, pasta.arquivos);
    r.erros.push(...a.erros);
    r.avisos.push(...a.avisos);
  }
  const c = r.projecao.contagem;
  const resumo = SITUACOES.filter((s) => c[s]).map((s) => `${c[s]} ${s}`).join(", ") || "nenhum item";
  console.log(`  ${rotulo}: ${r.eventos} evento(s) em ${Object.keys(pasta.arquivos).length} arquivo(s); ${r.projecao.itens.length} item(ns): ${resumo}`);
  if (pasta.projecao && !versionada) console.log("    ledger.json fora do git: não conferido (L8 vale para a projeção commitada)");
  for (const p of r.erros) console.log(`    ERRO  ${mostrar(p)}`);
  for (const p of r.avisos) console.log(`    aviso ${mostrar(p)}`);
  return r.erros.length;
}

/** @param {string[]} pos @param {Record<string, string | true>} o */
function cmdCheck(pos, o) {
  const AQUI = path.dirname(fileURLToPath(import.meta.url));
  if (o.json) {
    if (o.todos) recusar("--json confere uma pasta só; diga a pasta do livro");
    const r = resultadoDaPasta(pos[0] ?? recusar("diga a pasta do livro"), o);
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    if (!r.ok) process.exit(1);
    return;
  }
  console.log("livro — conferência do formato v0\n");
  let erros = 0;
  if (o.todos) {
    const raiz = typeof o.raiz === "string" ? o.raiz : path.dirname(AQUI);
    const lista = path.join(raiz, "governance/livros.txt");
    if (!fs.existsSync(lista)) {
      console.log("  nenhum livro declarado (governance/livros.txt não existe nesta árvore)");
      console.log("\nlivro: Resultado: OK");
      return;
    }
    const dirs = fs.readFileSync(lista, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
    for (const d of dirs) {
      const abs = path.join(raiz, d);
      if (!fs.existsSync(path.join(abs, "atores.txt"))) {
        console.log(`  ${d}: ERRO — declarado em governance/livros.txt e sem atores.txt (o livro sumiu?)`);
        erros++;
      } else erros += conferirPasta(abs, o, d);
    }
  } else {
    const dir = pos[0] ?? recusar("diga a pasta do livro, ou --todos");
    erros = conferirPasta(dir, o, dir);
  }
  console.log(erros ? `\nlivro: Resultado: FALHA — ${erros} problema(s).` : "\nlivro: Resultado: OK");
  if (erros) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...resto] = process.argv.slice(2);
  const { pos, o } = lerArgs(resto);
  try {
    if (cmd === "append") cmdAppend(pos[0] ?? recusar("diga a pasta do livro"), o);
    else if (cmd === "rebuild") cmdRebuild(pos[0] ?? recusar("diga a pasta do livro"), o);
    else if (cmd === "check") cmdCheck(pos, o);
    else recusar("comando desconhecido. Use append, rebuild ou check.");
  } catch (e) {
    recusar(/** @type {Error} */ (e).message);
  }
}
