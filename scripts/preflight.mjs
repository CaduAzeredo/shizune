// ---------------------------------------------------------------------------
// preflight.mjs — Pré-voo de um lote: o que um executor confere ANTES de tocar
// em qualquer arquivo.
//
// Nasceu do lote da noite de 2026-10-16, o primeiro com duas pistas em
// paralelo, cada uma num worktree do Brain. Duas sessões escrevendo ao mesmo
// tempo só são seguras se ninguém toca o arquivo do outro e se as duas partem
// do mesmo commit; até aqui isso era combinado em prosa no comando do lote.
// Este script transforma o combinado em conferência:
//
//   manifesto    governance/pistas.txt lê, a pista existe, e nenhum arquivo
//                cabe em duas pistas (arquivo, pasta ou curinga);
//   branch       a branch atual é a combinada;
//   main         o main local está no SHA combinado;
//   árvore limpa nada modificado nem solto antes de começar;
//   fim de linha os arquivos da pista têm eol=lf declarado e estão em LF;
//   hashes       o sha256 de cada arquivo da pista, ou AUSENTE; com
//                --esperado, a comparação com a guarda do lote.
//
// SÓ LEITURA. Os comandos de git rodam com GIT_OPTIONAL_LOCKS=0, para que nem
// o refresh do índice que o `git status` faz grave alguma coisa. Nenhum
// arquivo é criado, alterado ou apagado.
//
// Formato do manifesto: uma seção por pista, aberta por "[X]" e uma descrição
// opcional; uma entrada por linha; "#" abre comentário. Entrada que termina
// em "/" é pasta (tudo dentro dela); "*" casa dentro de um nível e "**" casa
// qualquer coisa. A sobreposição entre dois curingas é conferida por amostra
// (cada curinga gera um nome e o outro é testado contra ele) e também pelos
// arquivos que existem na árvore: é aproximação, e o comentário diz isso.
//
// Uso:
//   node scripts/preflight.mjs --pista A --branch <nome> --main <sha>
//        [--raiz <pasta>] [--manifesto <arquivo>] [--esperado <arquivo>]
//
// --esperado: linhas "<sha256>  <caminho>" ou "AUSENTE  <caminho>", o mesmo
// formato que este script imprime. Caminho fora da pista reprova.
//
// Saída: 0 se tudo confere; 1 se qualquer conferência falhou; 2 se faltou
// argumento.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function raizPadrao() {
  let p = decodeURIComponent(new URL(".", import.meta.url).pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return path.resolve(p, "..");
}

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const PISTA = arg("--pista");
const BRANCH = arg("--branch");
const MAIN = arg("--main");
const RAIZ = path.resolve(arg("--raiz") || raizPadrao());
const MANIFESTO = path.resolve(RAIZ, arg("--manifesto") || path.join("governance", "pistas.txt"));
const ESPERADO = arg("--esperado");

if (!PISTA || !BRANCH || !MAIN) {
  console.error("uso: node scripts/preflight.mjs --pista <X> --branch <nome> --main <sha> [--raiz <pasta>] [--manifesto <arquivo>] [--esperado <arquivo>]");
  process.exit(2);
}

const barra = (p) => p.replace(/\\/g, "/");

function git(...a) {
  const r = spawnSync("git", ["-C", RAIZ, ...a], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return { code: r.error ? -1 : r.status, out: (r.stdout || "").replace(/\r?\n$/, ""), err: r.stderr || "" };
}

const linhas = [];
let falhas = 0;
function marcar(passou, nome, detalhe, extras = []) {
  linhas.push(`  ${passou ? "ok   " : "FALHA"} ${nome.padEnd(13)} ${detalhe}`);
  for (const x of extras) linhas.push(`        ${x}`);
  if (!passou) falhas++;
}

// --- manifesto ---------------------------------------------------------------

function lerManifesto() {
  if (!fs.existsSync(MANIFESTO)) return { erro: `${barra(path.relative(RAIZ, MANIFESTO))} não existe` };
  const pistas = new Map();
  let atual = null;
  fs.readFileSync(MANIFESTO, "utf8").split(/\r?\n/).forEach((bruta, i) => {
    const l = bruta.replace(/#.*$/, "").trim();
    if (!l) return;
    const sec = /^\[([^\]]+)\]/.exec(l);
    if (sec) {
      atual = sec[1].trim();
      if (!pistas.has(atual)) pistas.set(atual, []);
      return;
    }
    if (!atual) return;
    pistas.get(atual).push({ texto: barra(l), linha: i + 1 });
  });
  return { pistas };
}

const tipo = (e) => (e.endsWith("/") ? "pasta" : /[*?]/.test(e) ? "curinga" : "arquivo");

function paraRegex(e) {
  let re = "";
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === "*" && e[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const amostra = (e) => e.replace(/\*\*/g, "x/x").replace(/\*/g, "x").replace(/\?/g, "x");

function casa(entrada, caminho) {
  const t = tipo(entrada);
  if (t === "arquivo") return entrada === caminho;
  if (t === "pasta") return caminho.startsWith(entrada);
  return paraRegex(entrada).test(caminho);
}

function sobrepoe(a, b) {
  const ta = tipo(a), tb = tipo(b);
  if (ta === "arquivo") return casa(b, a);
  if (tb === "arquivo") return casa(a, b);
  if (ta === "pasta" && tb === "pasta") return a.startsWith(b) || b.startsWith(a);
  if (ta === "pasta") return paraRegex(b).test(a + "x") || amostra(b).startsWith(a);
  if (tb === "pasta") return paraRegex(a).test(b + "x") || amostra(a).startsWith(b);
  return paraRegex(a).test(amostra(b)) || paraRegex(b).test(amostra(a));
}

// Todo caminho que a árvore conhece: rastreado ou solto (fora do .gitignore).
function caminhosDaArvore() {
  const r1 = git("ls-files", "-z");
  const r2 = git("ls-files", "-z", "--others", "--exclude-standard");
  const todos = new Set();
  for (const r of [r1, r2]) for (const p of r.out.split("\0")) if (p) todos.add(barra(p));
  return [...todos];
}

const man = lerManifesto();
const arvore = caminhosDaArvore();
let arquivosDaPista = [];

if (man.erro) {
  marcar(false, "manifesto", man.erro);
} else if (!man.pistas.has(PISTA)) {
  marcar(false, "manifesto", `a pista "${PISTA}" não está no manifesto (pistas: ${[...man.pistas.keys()].join(", ") || "nenhuma"})`);
} else {
  const conflitos = [];
  const nomes = [...man.pistas.keys()];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      for (const a of man.pistas.get(nomes[i])) {
        for (const b of man.pistas.get(nomes[j])) {
          const porArvore = arvore.find((p) => casa(a.texto, p) && casa(b.texto, p));
          if (a.texto === b.texto) {
            conflitos.push(`${a.texto} está nas pistas ${nomes[i]} e ${nomes[j]} (linhas ${a.linha} e ${b.linha})`);
          } else if (sobrepoe(a.texto, b.texto) || porArvore) {
            conflitos.push(
              `${a.texto} (${nomes[i]}, linha ${a.linha}) e ${b.texto} (${nomes[j]}, linha ${b.linha}) cobrem o mesmo arquivo` +
                (porArvore ? `: ${porArvore}` : ""),
            );
          }
        }
      }
    }
  }
  if (conflitos.length) marcar(false, "manifesto", `${conflitos.length} arquivo(s) em duas pistas`, conflitos);
  else marcar(true, "manifesto", `${nomes.length} pista(s), nenhum arquivo em duas`);

  // Arquivos da pista: os literais sempre (mesmo os que o lote vai criar),
  // e o que existe na árvore dentro das pastas e curingas.
  const set = new Set();
  for (const e of man.pistas.get(PISTA)) {
    if (tipo(e.texto) === "arquivo") set.add(e.texto);
    else for (const p of arvore) if (casa(e.texto, p)) set.add(p);
  }
  arquivosDaPista = [...set].sort();
}

// --- branch e main -----------------------------------------------------------

const atual = git("branch", "--show-current").out;
marcar(atual === BRANCH, "branch", atual === BRANCH ? atual : `esperada ${BRANCH}, atual ${atual || "(HEAD destacado)"}`);

const main = git("rev-parse", "--verify", "--quiet", "main^{commit}");
const shaMain = main.code === 0 ? main.out.trim() : "";
const mainOk = shaMain !== "" && shaMain.startsWith(MAIN.toLowerCase());
marcar(mainOk, "main", mainOk ? shaMain.slice(0, 12) : `esperado ${MAIN}, main está em ${shaMain ? shaMain.slice(0, 12) : "(sem main)"}`);

// --- árvore limpa ------------------------------------------------------------

const st = git("status", "--porcelain=v1", "--untracked-files=all");
const sujos = st.out ? st.out.split(/\r?\n/) : [];
if (st.code !== 0) marcar(false, "árvore limpa", `git status falhou: ${st.err.trim()}`);
else marcar(sujos.length === 0, "árvore limpa", sujos.length ? `${sujos.length} entrada(s) no git status` : "nada modificado nem solto", sujos.slice(0, 20));

// --- fim de linha ------------------------------------------------------------

const ehBinario = (buf) => buf.subarray(0, 8192).includes(0);
if (arquivosDaPista.length) {
  const problemas = [];
  const attr = git("check-attr", "text", "eol", "--", ...arquivosDaPista);
  const porArquivo = new Map();
  for (const l of attr.out.split(/\r?\n/)) {
    const m = /^(.*): (text|eol): (.*)$/.exec(l);
    if (!m) continue;
    const k = barra(m[1]);
    if (!porArquivo.has(k)) porArquivo.set(k, {});
    porArquivo.get(k)[m[2]] = m[3];
  }
  for (const p of arquivosDaPista) {
    const a = porArquivo.get(p) || {};
    if (a.text === "unset") continue; // binário declarado: fora da regra de fim de linha
    if (a.eol !== "lf") problemas.push(`${p}: eol=${a.eol ?? "?"} no .gitattributes (esperado eol=lf)`);
    const abs = path.join(RAIZ, p);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    if (!ehBinario(buf) && buf.includes("\r\n")) problemas.push(`${p}: CRLF na cópia de trabalho`);
  }
  marcar(problemas.length === 0, "fim de linha", problemas.length ? `${problemas.length} problema(s)` : `${arquivosDaPista.length} arquivo(s) com eol=lf`, problemas);
} else {
  marcar(true, "fim de linha", "a pista não tem arquivo para conferir");
}

// --- hashes ------------------------------------------------------------------

const hashes = new Map();
for (const p of arquivosDaPista) {
  const abs = path.join(RAIZ, p);
  hashes.set(p, fs.existsSync(abs) ? crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex") : "AUSENTE");
}

if (ESPERADO) {
  const difs = [];
  let conferidos = 0;
  const texto = fs.existsSync(ESPERADO) ? fs.readFileSync(ESPERADO, "utf8") : null;
  if (texto === null) difs.push(`${ESPERADO} não existe`);
  for (const bruta of (texto || "").split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{64}|AUSENTE)\s+(.+?)\s*$/.exec(bruta);
    if (!m) continue;
    const p = barra(m[2]);
    const quer = m[1].toLowerCase() === "ausente" ? "AUSENTE" : m[1].toLowerCase();
    if (!hashes.has(p)) { difs.push(`${p}: fora da pista ${PISTA}`); continue; }
    conferidos++;
    const tem = hashes.get(p);
    if (tem === quer) continue;
    if (quer === "AUSENTE") difs.push(`EXISTE   ${p}`);
    else if (tem === "AUSENTE") difs.push(`SUMIU    ${p}`);
    else difs.push(`MUDOU    ${p}`);
  }
  marcar(difs.length === 0, "hashes", difs.length ? `${difs.length} divergência(s) da guarda` : `${conferidos} arquivo(s) conferem com ${ESPERADO}`, difs);
} else {
  marcar(true, "hashes", `${hashes.size} arquivo(s) da pista; sem --esperado, nada a comparar`);
}

// --- saída -------------------------------------------------------------------

console.log(`preflight — raiz: ${RAIZ}`);
console.log(`pista ${PISTA}, manifesto ${barra(path.relative(RAIZ, MANIFESTO))}\n`);
for (const l of linhas) console.log(l);
if (hashes.size) {
  console.log("\nArquivos da pista (sha256 da cópia de trabalho):");
  for (const [p, h] of hashes) console.log(`    ${p}  ${h}`);
}
const total = 6;
console.log(falhas === 0 ? `\nResultado: OK — ${total} conferências passaram.` : `\nResultado: FALHA em ${falhas} de ${total}.`);
process.exit(falhas === 0 ? 0 : 1);
