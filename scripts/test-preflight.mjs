// test-preflight.mjs — teste negativo do pré-voo de lote (preflight.mjs).
//
// O pré-voo é a conferência que um executor roda ANTES de tocar em qualquer
// arquivo de um lote: branch certa, árvore limpa, main no SHA combinado,
// manifesto de pistas sem arquivo em duas pistas, fim de linha LF e o hash dos
// arquivos que a pista vai tocar. Ele nasceu do lote da noite de 2026-10-16,
// o primeiro com duas pistas em paralelo, cada uma num worktree.
//
// O teste monta um repositório git descartável em os.tmpdir() com
// core.autocrlf=false (o fim de linha fica sob controle do teste, e não da
// configuração da máquina) e roda o preflight.mjs real contra ele. Cada caso
// estraga uma coisa só e confere que a saída é 1 e que a linha certa diz
// FALHA; o controle confere que, com tudo certo, a saída é 0. Nada fora da
// pasta temporária é tocado.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PREFLIGHT = path.join(AQUI, "preflight.mjs");

let falhas = 0;
let total = 0;
const ok = (cond, msg) => {
  total++;
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

const criadas = [];

function repo({ manifesto, arquivos = {}, ramo = "lote-x" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-test-"));
  criadas.push(tmp);
  const git = (...a) => {
    const r = spawnSync("git", a, { cwd: tmp, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "teste");
  git("config", "user.email", "teste@local");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  const escrever = (rel, texto) => {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, texto);
  };
  escrever(".gitattributes", "* text=auto eol=lf\n");
  escrever("governance/pistas.txt", manifesto ?? MANIFESTO_BOM);
  escrever("scripts/doctor.mjs", "// doctor de mentira\n");
  escrever("projects/x/ledger/events.jsonl", "{}\n");
  escrever("CONTEXTO-GERAL.md", "# contexto\n");
  for (const [rel, texto] of Object.entries(arquivos)) escrever(rel, texto);
  git("add", "-A");
  git("commit", "-q", "-m", "base do teste");
  const sha = git("rev-parse", "HEAD");
  git("switch", "-q", "-c", ramo);
  return { tmp, sha, git, escrever };
}

function rodar(tmp, args) {
  const r = spawnSync(process.execPath, [PREFLIGHT, "--raiz", tmp, ...args], { encoding: "utf8" });
  return { code: r.status, saida: (r.stdout || "") + (r.stderr || "") };
}

const MANIFESTO_BOM = [
  "# pistas do lote de teste",
  "[A] código",
  "scripts/doctor.mjs",
  "scripts/preflight.mjs",
  "",
  "[B] texto",
  "CONTEXTO-GERAL.md",
  "projects/x/ledger/",
  "projects/x/piloto-*.md",
  "",
].join("\n");

const sha256 = (texto) => crypto.createHash("sha256").update(texto).digest("hex");

try {
  console.log("\n[controle] tudo certo: saída 0\n");
  let R = repo();
  let r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha.slice(0, 7)]);
  ok(r.code === 0, "saiu com código 0");
  ok(/Resultado: OK/.test(r.saida), "a linha final diz OK");
  ok(/scripts\/doctor\.mjs\s+[0-9a-f]{64}/.test(r.saida), "imprime o sha256 de cada arquivo da pista que já existe");
  ok(/scripts\/preflight\.mjs\s+AUSENTE/.test(r.saida), "arquivo que a pista vai criar aparece como AUSENTE");
  ok(R.git("status", "--porcelain=v1") === "", "o pré-voo não escreveu nada na árvore");

  console.log("\n[negativo] duas pistas com o mesmo arquivo\n");
  R = repo({ manifesto: MANIFESTO_BOM + "[C] intrusa\nscripts/doctor.mjs\n" });
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1, "saiu com código 1");
  ok(/FALHA\s+manifesto/.test(r.saida) && /scripts\/doctor\.mjs/.test(r.saida) && /A e C|C e A/.test(r.saida), "nomeia o arquivo e as duas pistas");

  console.log("\n[negativo] um curinga de uma pista cobre o arquivo de outra\n");
  R = repo({ manifesto: MANIFESTO_BOM + "[C] intrusa\nprojects/x/*.md\n" });
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /projects\/x\/\*\.md/.test(r.saida) && /projects\/x\/piloto-\*\.md/.test(r.saida), "curinga contra curinga: reprova e nomeia os dois");

  console.log("\n[negativo] uma pasta de uma pista contém o arquivo de outra\n");
  R = repo({ manifesto: MANIFESTO_BOM + "[C] intrusa\nprojects/x/ledger/events.jsonl\n" });
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /projects\/x\/ledger\//.test(r.saida), "pasta contra arquivo: reprova");

  console.log("\n[negativo] árvore suja\n");
  R = repo();
  R.escrever("solto.txt", "arquivo fora do git\n");
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /FALHA\s+árvore limpa/.test(r.saida) && /solto\.txt/.test(r.saida), "arquivo não rastreado reprova e é nomeado");

  console.log("\n[negativo] branch errada\n");
  R = repo({ ramo: "outra-coisa" });
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /FALHA\s+branch/.test(r.saida) && /outra-coisa/.test(r.saida), "reprova e diz em que branch está");

  console.log("\n[negativo] main em outro SHA\n");
  R = repo();
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", "0000000"]);
  ok(r.code === 1 && /FALHA\s+main/.test(r.saida) && r.saida.includes(R.sha.slice(0, 7)), "reprova e mostra o SHA real");

  console.log("\n[negativo] arquivo da pista com CRLF na cópia de trabalho\n");
  R = repo();
  // A árvore também fica suja com a troca; o caso confere só a linha do LF.
  fs.writeFileSync(path.join(R.tmp, "scripts", "doctor.mjs"), "// doctor de mentira\r\n");
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /FALHA\s+fim de linha/.test(r.saida) && /scripts\/doctor\.mjs/.test(r.saida), "CRLF reprova e nomeia o arquivo");

  console.log("\n[negativo] arquivo da pista sem eol=lf declarado\n");
  R = repo({ arquivos: { ".gitattributes": "* text=auto\n" } });
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /FALHA\s+fim de linha/.test(r.saida) && /eol/.test(r.saida), "sem eol=lf no .gitattributes, reprova");

  console.log("\n[hashes] a guarda: o hash esperado confere ou reprova\n");
  R = repo();
  const esperadoBom = `${sha256("// doctor de mentira\n")}  scripts/doctor.mjs\nAUSENTE  scripts/preflight.mjs\n`;
  fs.writeFileSync(path.join(os.tmpdir(), path.basename(R.tmp) + "-esperado.txt"), esperadoBom);
  const arqEsperado = path.join(os.tmpdir(), path.basename(R.tmp) + "-esperado.txt");
  criadas.push(arqEsperado);
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha, "--esperado", arqEsperado]);
  ok(r.code === 0 && /ok\s+hashes/.test(r.saida), "hash e ausência conferem: passa");

  fs.writeFileSync(arqEsperado, `${sha256("outro conteúdo\n")}  scripts/doctor.mjs\nAUSENTE  scripts/preflight.mjs\n`);
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha, "--esperado", arqEsperado]);
  ok(r.code === 1 && /FALHA\s+hashes/.test(r.saida) && /MUDOU\s+scripts\/doctor\.mjs/.test(r.saida), "hash diferente reprova com MUDOU");

  fs.writeFileSync(arqEsperado, `AUSENTE  scripts/doctor.mjs\n`);
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha, "--esperado", arqEsperado]);
  ok(r.code === 1 && /EXISTE\s+scripts\/doctor\.mjs/.test(r.saida), "arquivo esperado ausente que existe reprova com EXISTE");

  fs.writeFileSync(arqEsperado, `${sha256("x\n")}  CONTEXTO-GERAL.md\n`);
  r = rodar(R.tmp, ["--pista", "A", "--branch", "lote-x", "--main", R.sha, "--esperado", arqEsperado]);
  ok(r.code === 1 && /fora da pista A/.test(r.saida), "hash esperado de arquivo de outra pista reprova");

  console.log("\n[uso] pista que o manifesto não declara\n");
  R = repo();
  r = rodar(R.tmp, ["--pista", "Z", "--branch", "lote-x", "--main", R.sha]);
  ok(r.code === 1 && /pista "Z" não está/.test(r.saida), "reprova e diz que a pista não existe");
  r = rodar(R.tmp, ["--pista", "A"]);
  ok(r.code === 2 && /uso:/i.test(r.saida), "sem --branch e --main, sai com 2 e mostra o uso");
} finally {
  for (const d of criadas) fs.rmSync(d, { recursive: true, force: true });
}

console.log(
  falhas === 0
    ? `\ntest-preflight: tudo passou (${total} asserções).`
    : `\ntest-preflight: ${falhas} de ${total} verificação(ões) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
