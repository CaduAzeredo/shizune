// ---------------------------------------------------------------------------
// validate-lints.mjs — Três lints, cada um nascido de um erro que já aconteceu.
//
//   [tabelas] Linha de tabela markdown com número de células diferente do da
//             linha de traços. Em 2026-10-16 a linha da DEC-038 levava a
//             fórmula do selo entre crases, com barras verticais; no GFM a
//             barra divide a célula mesmo dentro de crase, a linha deixou de
//             casar com a gramática do registro e saiu da leitura sem aviso.
//             É ERRO nas tabelas que uma ferramenta lê (o registro de
//             decisões, a semente dele, as exceções da varredura de segredos
//             e a tabela de ADRs); no resto, AVISO: ali a linha só fica feia.
//
//   [export]  Texto que diz para onde o `export-public.mjs --write` grava tem
//             de dizer o destino que o código usa. Em 2026-10-16 o
//             CONTEXTO-GERAL.md dizia a pasta do repositório do pacote, numa
//             unidade da máquina; o código grava em
//             dist/public da árvore onde roda. O destino é lido do próprio
//             export-public.mjs (a linha do destRoot), e não escrito aqui: se
//             o código mudar, o texto antigo passa a reprovar.
//
//   [eol]     O .gitattributes declara eol=lf e o índice não carrega CRLF.
//             Sem eol=lf, um checkout com core.autocrlf=true (o padrão do Git
//             para Windows) grava CRLF, e o sha256 de um arquivo que deveria
//             ser cópia byte a byte deixa de bater (achado do site pessoal em
//             2026-10-16; o teste mede isso com um clone de verdade). Na
//             origem do export é ERRO não declarar; num pacote exportado, NOTA:
//             a regra é da instância que publica, não de quem clona.
//
// Uso (a raiz é a pasta pai de scripts/):
//   bun scripts/validate-lints.mjs            # modo padrão
//   bun scripts/validate-lints.mjs --strict   # inclui logs/ e pastas legadas
//   (compatível com node >= 20)
//
// Saída: 0 se nenhum erro; 1 se houver erro.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function raizDoShizune() {
  let p = decodeURIComponent(new URL(".", import.meta.url).pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return path.resolve(p, "..");
}

const RAIZ = raizDoShizune();
const ESTRITO = process.argv.includes("--strict");
const ORIGEM = fs.existsSync(path.join(RAIZ, "README-PUBLICO.md"));
const rel = (abs) => path.relative(RAIZ, abs).replace(/\\/g, "/");

const saida = { tabelas: [], export: [], eol: [] };
const erro = (lint, m) => saida[lint].push(`  [ERRO] ${m}`);
const aviso = (lint, m) => saida[lint].push(`  [AVISO] ${m}`);
const nota = (lint, m) => saida[lint].push(`  [NOTA] ${m}`);
let erros = 0;

// Ver a nota em validate-structure.mjs: a árvore legada é de cada instância.
const PASTAS_LEGADAS = (() => {
  const arq = path.join(RAIZ, "governance", "legacy-tree.json");
  if (!fs.existsSync(arq)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(arq, "utf8"));
    return Array.isArray(j.folders) ? j.folders : [];
  } catch { return []; }
})();

// Projetos em quarentena (status bloqueado no registro, ADR-021): o aviso
// conta as linhas deles, mas não nomeia projeto nem arquivo. A saída do doctor
// vai para o log do CI, e a quarentena vale para ela também.
const BLOQUEADOS = (() => {
  const arq = path.join(RAIZ, "governance", "registro-projetos.yaml");
  if (!fs.existsSync(arq)) return new Set();
  const res = new Set();
  let atual = null;
  for (const l of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
    const s = /^\s*-\s+slug:\s*["']?([^"'\s]+)/.exec(l);
    if (s) { atual = s[1]; continue; }
    const st = /^\s+status:\s*["']?([^"'\s]+)/.exec(l);
    if (st && atual && st[1] === "bloqueado") res.add(atual);
  }
  return res;
})();
const emQuarentena = (r) => r.startsWith("projects/") && BLOQUEADOS.has(r.split("/")[1]);

function coletarMd() {
  const ignorar = new Set([".git", "node_modules", "dist", "archive", ".claude"]);
  if (!ESTRITO) {
    ignorar.add("logs");
    for (const p of PASTAS_LEGADAS) ignorar.add(p);
  }
  const res = [];
  (function andar(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (dir === RAIZ && ignorar.has(e.name)) continue;
        andar(abs);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) res.push(abs);
    }
  })(RAIZ);
  return res;
}

// --- [tabelas] ---------------------------------------------------------------

// Tabelas que uma ferramenta deste repositório lê linha a linha. Uma linha
// que sai da gramática delas some da leitura, e é por isso que aqui é erro.
function tabelasLidasPorFerramenta() {
  const fixas = [
    "governance/registro-decisoes.md",
    "governance/registro-decisoes.seed.md",
    "governance/seguranca/excecoes-varredura-de-segredos.md",
  ];
  const adr = ["governance/adr", ...PASTAS_LEGADAS].map((p) => `${p}/DECISOES.md`);
  return new Set([...fixas, ...adr].filter((p) => fs.existsSync(path.join(RAIZ, p))));
}

// Células de uma linha de tabela no GFM: a barra divide, inclusive dentro de
// crase; só a barra escapada (\|) não divide.
function contarCelulas(linha) {
  let s = linha.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).length;
}
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const barraEmCrase = (linha) => [...linha.matchAll(/`[^`]*`/g)].some((m) => /(?<!\\)\|/.test(m[0]));

function lintTabelas(mds) {
  const lidas = tabelasLidasPorFerramenta();
  const arquivos = new Set(mds.map(rel));
  for (const p of lidas) arquivos.add(p);
  let tabelas = 0, ruins = 0;
  const quarentena = { linhas: 0, arquivos: new Set() };
  for (const r of [...arquivos].sort()) {
    const L = fs.readFileSync(path.join(RAIZ, r), "utf8").split(/\r?\n/);
    let cerca = null;
    for (let i = 0; i < L.length; i++) {
      const mc = /^\s*(`{3,}|~{3,})/.exec(L[i]);
      if (mc) {
        if (!cerca) cerca = mc[1][0];
        else if (mc[1][0] === cerca) cerca = null;
        continue;
      }
      if (cerca) continue;
      if (!(i + 1 < L.length && L[i].includes("|") && DELIM.test(L[i + 1]) && L[i + 1].includes("-"))) continue;
      tabelas++;
      const esperado = contarCelulas(L[i + 1]);
      let j = i;
      for (; j < L.length && L[j].includes("|") && L[j].trim() !== ""; j++) {
        if (j === i + 1) continue;
        const n = contarCelulas(L[j]);
        if (n === esperado) continue;
        ruins++;
        if (!lidas.has(r) && emQuarentena(r)) {
          quarentena.linhas++;
          quarentena.arquivos.add(r);
          continue;
        }
        const msg =
          `${r}:${j + 1} — linha de tabela com ${n} célula(s), a tabela tem ${esperado}` +
          (barraEmCrase(L[j]) ? "; há barra vertical dentro de crase, e no GFM ela divide a célula: escreva \\| ou troque por palavras" : "");
        if (lidas.has(r)) erro("tabelas", `${msg} (tabela lida por ferramenta: a linha sai da leitura)`);
        else aviso("tabelas", msg);
      }
      i = j - 1;
    }
  }
  if (quarentena.linhas) {
    aviso("tabelas", `${quarentena.linhas} linha(s) em ${quarentena.arquivos.size} arquivo(s) de projeto em quarentena, com contagem de células diferente (sem nome, ADR-021)`);
  }
  saida.tabelas.unshift(`  ${tabelas} tabela(s) em ${arquivos.size} arquivo(s); ${lidas.size} lida(s) por ferramenta; ${ruins} linha(s) com contagem diferente`);
}

// --- [export] ----------------------------------------------------------------

function destinoDoExport() {
  const arq = path.join(RAIZ, "scripts", "export-public.mjs");
  if (!fs.existsSync(arq)) return { na: true };
  const m = /destRoot\s*=\s*path\.join\(\s*RAIZ\s*,([^)]*)\)/.exec(fs.readFileSync(arq, "utf8"));
  const partes = m ? [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] ?? x[2]) : [];
  return partes.length ? { destino: partes.join("/") } : { destino: null };
}

const FALA_DO_WRITE = /--write|\bgrava|\bwrites?\b|\bgera\b/i;
const CAMINHO = /[A-Za-z]:[\\/][^\s`'")\]]*|~\/[^\s`'")\]]*|\bdist[\\/][\w.-]+/g;

function lintExport(mds) {
  const d = destinoDoExport();
  if (d.na) { nota("export", "n/a — scripts/export-public.mjs não existe nesta árvore"); return; }
  if (!d.destino) {
    erro("export", "scripts/export-public.mjs — não achei o destino do --write (a linha `destRoot = path.join(RAIZ, ...)`): o contrato não tem como ser conferido");
    return;
  }
  const destinos = [d.destino, d.destino.replace(/\//g, "\\")];
  let frases = 0;
  for (const abs of mds) {
    const L = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    L.forEach((linha, i) => {
      if (!/export-public/.test(linha) || !FALA_DO_WRITE.test(linha)) return;
      const caminhos = linha.match(CAMINHO);
      if (!caminhos) return;
      frases++;
      if (destinos.some((x) => linha.includes(x))) return;
      erro("export", `${rel(abs)}:${i + 1} — diz que o export grava em ${caminhos.join(", ")}, mas o código grava em ${d.destino} da árvore onde roda (scripts/export-public.mjs, destRoot)`);
    });
  }
  saida.export.unshift(`  destino no código: ${d.destino}; ${frases} frase(s) que dizem onde o export grava`);
}

// --- [eol] -------------------------------------------------------------------

function git(...a) {
  const r = spawnSync("git", ["-C", RAIZ, ...a], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  return { code: r.error ? -1 : r.status, out: r.stdout || "" };
}

function lintEol() {
  const top = git("rev-parse", "--show-toplevel");
  const mesmo = (a, b) => {
    try { return fs.realpathSync(a).toLowerCase() === fs.realpathSync(b).toLowerCase(); } catch { return false; }
  };
  if (top.code !== 0 || !mesmo(top.out.trim(), RAIZ)) {
    nota("eol", "n/a — esta pasta não é a raiz de um repositório git; não há checkout a conferir");
    return;
  }
  const attr = git("check-attr", "eol", "--", "sonda-de-atributo.md").out;
  const declarado = /: eol: lf\s*$/.test(attr.trim());
  if (!declarado) {
    const msg = ".gitattributes não declara eol=lf (`* text=auto eol=lf`): num checkout com core.autocrlf=true, o texto sai em CRLF e o sha256 de uma cópia byte a byte deixa de bater";
    if (ORIGEM) erro("eol", `${msg}. Esta árvore é a origem do export, e a regra vale aqui`);
    else nota("eol", `${msg}. Num pacote exportado a regra é da instância`);
    return;
  }
  const linhas = git("ls-files", "--eol", "-z").out.split("\0").filter(Boolean);
  let crlfNoIndice = 0, sobrescritos = 0, crlfNaCopia = 0;
  for (const l of linhas) {
    const m = /^i\/(\S*)\s+w\/(\S*)\s+attr\/(.*?)\s*\t(.*)$/.exec(l);
    if (!m) continue;
    const [, i, w, a, p] = m;
    const binario = i === "-text" || /(^|\s)-text\b/.test(a);
    if (binario) continue;
    if (i === "crlf" || i === "mixed") {
      crlfNoIndice++;
      erro("eol", `${p} — i/${i}: o blob no índice carrega CRLF; \`git add --renormalize ${p}\` o regrava em LF`);
    } else if (!/eol=lf/.test(a)) {
      sobrescritos++;
      erro("eol", `${p} — a regra eol=lf não chega a este arquivo (attr/${a || "nenhum"})`);
    }
    if (w === "crlf" || w === "mixed") crlfNaCopia++;
  }
  if (crlfNaCopia) {
    aviso("eol", `${crlfNaCopia} arquivo(s) em CRLF na cópia de trabalho, de um checkout anterior à regra; o índice está certo e o próximo checkout grava LF (\`git ls-files --eol\` mostra quais)`);
  }
  saida.eol.unshift(`  eol=lf declarado; ${linhas.length} arquivo(s) rastreado(s), ${crlfNoIndice} com CRLF no índice, ${sobrescritos} fora da regra`);
}

// --- execução ----------------------------------------------------------------

console.log(`validate-lints — raiz: ${RAIZ}`);
console.log(`Modo: ${ESTRITO ? "estrito (--strict)" : "padrão"}${ORIGEM ? ", origem do export" : ""}\n`);

const mds = coletarMd();
lintTabelas(mds);
lintExport(mds);
lintEol();

for (const [lint, titulo] of [
  ["tabelas", "barra vertical e contagem de células nas tabelas"],
  ["export", "o destino do export-public.mjs --write no texto"],
  ["eol", "fim de linha LF declarado e no índice"],
]) {
  console.log(`[${lint}] ${titulo}`);
  for (const l of saida[lint]) {
    console.log(l);
    if (l.startsWith("  [ERRO]")) erros++;
  }
  console.log("");
}

console.log(erros ? `Resultado: FALHA — ${erros} erro(s).` : "Resultado: OK");
process.exit(erros ? 1 : 0);
