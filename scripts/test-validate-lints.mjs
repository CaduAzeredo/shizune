// test-validate-lints.mjs — teste negativo dos lints do validate-lints.mjs.
//
// Cada lint nasceu de um erro que já aconteceu, e cada um tem aqui o erro de
// volta, numa árvore descartável em os.tmpdir(), com o validate-lints.mjs real
// copiado para dentro dela:
//
//   [tabelas]  a barra vertical dentro de crase que dividiu a célula da linha
//              da DEC-038 e tirou a linha da leitura do validador (16/10);
//   [export]   o texto que dizia que o `--write` grava na pasta do
//              repositório do pacote, quando o código grava em dist/public
//              (achado de 16/10);
//   [eol]      a cópia em CRLF que muda o sha256 de um arquivo que deveria
//              ser cópia byte a byte (achado do site pessoal, 16/10).
//
// Para cada um: o caso que reprova, o controle que passa. O bloco [prova]
// não testa o lint: mede, com um clone de verdade e core.autocrlf=true, que
// a regra que ele cobra (eol=lf declarado) é a que mantém o hash estável
// depois de um checkout, e que sem ela o hash muda.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const LINTS = path.join(AQUI, "validate-lints.mjs");

let falhas = 0;
let total = 0;
const ok = (cond, msg) => {
  total++;
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

const criadas = [];
const EXPORT_REAL = 'const destRoot = path.join(RAIZ, "dist", "public");\n';
const REGISTRO_BOM = [
  "# Registro",
  "",
  "| ID | Decisão | Status | Assinante | Assinatura | Data |",
  "|---|---|---|---|---|---|",
  "| DEC-001 | uma decisão | vigente | operador | abc1234 | 2026-10-01 |",
  "| DEC-002 | outra, com `a \\| b` escapado | rascunho, assinatura pendente | — | — | 2026-10-02 |",
  "",
].join("\n");

function arvore({ origem = true, comGit = false, gitattributes = "* text=auto eol=lf\n", arquivos = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lints-test-"));
  criadas.push(tmp);
  const escrever = (rel, texto) => {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, texto);
  };
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.copyFileSync(LINTS, path.join(tmp, "scripts", "validate-lints.mjs"));
  escrever("scripts/export-public.mjs", EXPORT_REAL);
  escrever("governance/registro-decisoes.md", REGISTRO_BOM);
  escrever("docs/guia.md", "# Guia\n\n`node scripts/export-public.mjs --write` grava em `dist/public`.\n");
  if (origem) escrever("README-PUBLICO.md", "# marcador da origem do export\n");
  if (gitattributes !== null) escrever(".gitattributes", gitattributes);
  for (const [rel, texto] of Object.entries(arquivos)) escrever(rel, texto);
  const git = (...a) => {
    const r = spawnSync("git", a, { cwd: tmp, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  if (comGit) {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "teste");
    git("config", "user.email", "teste@local");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    git("add", "-A");
    git("commit", "-q", "-m", "base do teste");
  }
  return { tmp, escrever, git };
}

function rodar(tmp, ...args) {
  const r = spawnSync(process.execPath, [path.join(tmp, "scripts", "validate-lints.mjs"), ...args], { encoding: "utf8" });
  return { code: r.status, saida: (r.stdout || "") + (r.stderr || "") };
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

try {
  console.log("\n[controle] árvore certa: saída 0\n");
  let A = arvore({ comGit: true });
  let r = rodar(A.tmp);
  ok(r.code === 0, "saiu com código 0");
  ok(/Resultado: OK/.test(r.saida), "a linha final diz OK");

  console.log("\n[tabelas] a barra dentro de crase divide a célula do registro\n");
  A = arvore({ comGit: true });
  A.escrever("governance/registro-decisoes.md", REGISTRO_BOM.replace("`a \\| b`", "`a | b`"));
  r = rodar(A.tmp);
  ok(r.code === 1, "registro com barra sem escape reprova (código 1)");
  ok(/governance\/registro-decisoes\.md:6/.test(r.saida) && /7 célula\(s\), a tabela tem 6/.test(r.saida), "nomeia arquivo, linha e a contagem");
  ok(/crase/.test(r.saida) && /\\\|/.test(r.saida), "diz que a barra está dentro de crase e mostra o escape");

  A = arvore({ comGit: true });
  A.escrever("governance/registro-decisoes.md", REGISTRO_BOM.replace("| abc1234 | 2026-10-01 |", "| abc1234 |"));
  r = rodar(A.tmp);
  ok(r.code === 1 && /5 célula\(s\), a tabela tem 6/.test(r.saida), "linha com célula a menos no registro também reprova");

  A = arvore({ comGit: true, arquivos: { "docs/notas.md": "| a | b |\n|---|---|\n| `x|y` | z |\n" } });
  r = rodar(A.tmp);
  ok(r.code === 0 && /\[AVISO\].*docs\/notas\.md:3/.test(r.saida), "fora das tabelas que uma ferramenta lê, a mesma linha só avisa");

  A = arvore({
    comGit: true,
    arquivos: {
      "governance/registro-projetos.yaml": "projetos:\n  - slug: cliente-x\n    status: bloqueado\n",
      "projects/cliente-x/mapa.md": "| a | b |\n|---|---|\n| x | y | z |\n",
    },
  });
  r = rodar(A.tmp);
  ok(r.code === 0 && !/cliente-x/.test(r.saida) && /1 linha\(s\) em 1 arquivo\(s\) de projeto em quarentena/.test(r.saida), "projeto bloqueado (quarentena): conta as linhas, sem nomear o projeto nem o arquivo");

  A = arvore({ comGit: true, arquivos: { "docs/cerca.md": "```\n| a | b |\n|---|---|\n| x | y | z |\n```\n" } });
  r = rodar(A.tmp);
  ok(r.code === 0 && !/docs\/cerca\.md/.test(r.saida), "tabela dentro de bloco cercado não conta");

  console.log("\n[export] o texto diz onde o --write grava, e o código decide\n");
  A = arvore({ comGit: true, arquivos: { "CONTEXTO-GERAL.md": "- `node scripts/export-public.mjs` faz o dry-run, e com `--write` grava em `X:\\outro\\pacote`;\n" } });
  r = rodar(A.tmp);
  ok(r.code === 1, "texto que manda o --write para X:\\outro\\pacote reprova (código 1)");
  ok(/CONTEXTO-GERAL\.md:1/.test(r.saida) && /dist\/public/.test(r.saida), "nomeia arquivo e linha e diz o destino do código");

  A = arvore({ comGit: true, arquivos: { "CONTEXTO-GERAL.md": "- com `--write`, `export-public.mjs` grava em `dist/public`; levar para `X:\\outro\\pacote` é outro passo.\n" } });
  r = rodar(A.tmp);
  ok(r.code === 0, "a frase corrigida, que cita o dist/public e o passo seguinte, passa");

  A = arvore({ comGit: true });
  A.escrever("scripts/export-public.mjs", 'const destRoot = path.join(RAIZ, "dist", "pacote");\n');
  r = rodar(A.tmp);
  ok(r.code === 1 && /docs\/guia\.md:3/.test(r.saida) && /dist\/pacote/.test(r.saida), "se o código passa a gravar em outro lugar, o texto antigo reprova");

  A = arvore({ comGit: true });
  A.escrever("scripts/export-public.mjs", "// o destino sumiu do código\n");
  r = rodar(A.tmp);
  ok(r.code === 1 && /destino/.test(r.saida), "sem destino legível no export-public.mjs, reprova em vez de passar calado");

  console.log("\n[eol] o .gitattributes declara LF, e o índice não carrega CRLF\n");
  A = arvore({ comGit: true, gitattributes: "* text=auto\n" });
  r = rodar(A.tmp);
  ok(r.code === 1 && /eol=lf/.test(r.saida), "na origem do export, sem eol=lf declarado, reprova");

  A = arvore({ comGit: true, origem: false, gitattributes: "* text=auto\n" });
  r = rodar(A.tmp);
  ok(r.code === 0 && /\[NOTA\].*eol/.test(r.saida), "fora da origem (pacote), sem eol=lf, só deixa nota");

  // CRLF no índice: o arquivo entra antes da regra, e a regra chega depois.
  A = arvore({ comGit: true, gitattributes: null, arquivos: { "docs/velho.md": "# velho\r\nlinha\r\n" } });
  A.escrever(".gitattributes", "* text=auto eol=lf\n");
  A.git("add", ".gitattributes");
  A.git("commit", "-q", "-m", "a regra chega depois");
  r = rodar(A.tmp);
  ok(r.code === 1 && /docs\/velho\.md/.test(r.saida) && /i\/crlf/.test(r.saida), "blob com CRLF no índice reprova e é nomeado");

  A = arvore({ comGit: false });
  r = rodar(A.tmp);
  ok(r.code === 0 && /n\/a/.test(r.saida), "sem repositório git, o lint de eol é n/a e não reprova");

  console.log("\n[prova] com eol=lf declarado, o hash sobrevive a um checkout com core.autocrlf=true\n");
  const ficha = '{\n  "versao": "9.0.0",\n  "sha": "abc1234"\n}\n';
  for (const [rotulo, attrs, deveBater] of [
    ["com eol=lf", "* text=auto eol=lf\n", true],
    ["só text=auto", "* text=auto\n", false],
  ]) {
    const O = arvore({ comGit: true, gitattributes: attrs, arquivos: { "src/ficha.json": ficha } });
    const destino = fs.mkdtempSync(path.join(os.tmpdir(), "lints-clone-"));
    criadas.push(destino);
    const c = spawnSync("git", ["-c", "core.autocrlf=true", "clone", "-q", O.tmp, path.join(destino, "c")], { encoding: "utf8" });
    const copia = fs.readFileSync(path.join(destino, "c", "src", "ficha.json"));
    const bate = c.status === 0 && sha256(copia) === sha256(Buffer.from(ficha));
    ok(bate === deveBater, `${rotulo}: o sha256 da cópia ${deveBater ? "bate" : "não bate"} com o do arquivo (${bate ? "bateu" : "não bateu"})`);
  }
} finally {
  for (const d of criadas) fs.rmSync(d, { recursive: true, force: true });
}

console.log(
  falhas === 0
    ? `\ntest-validate-lints: tudo passou (${total} asserções).`
    : `\ntest-validate-lints: ${falhas} de ${total} verificação(ões) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
