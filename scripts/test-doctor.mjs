// test-doctor.mjs — teste negativo da linha-resumo do doctor.mjs.
//
// O doctor marca cada etapa como OK, n/a ou FALHA, e a linha final precisa dizer
// o mesmo que as marcas: n/a não é aprovação. Até a 0.4.1, num clone do pacote em
// que duas etapas responderam n/a, a linha dizia "os 9 verificadores passaram"
// (item 47 da fila). Medido em 2026-10-14 num clone de v0.4.1: 7 OK, 2 n/a e
// a mesma frase.
//
// O teste monta uma árvore descartável em os.tmpdir() com uma cópia do doctor.mjs
// real e verificadores de mentira, que só saem com o código pedido. Confere a
// linha final em três situações: com n/a, sem n/a e com uma falha. Não roda
// nenhum verificador de verdade e não toca o repositório.
//
// O bloco [inventário] confere a etapa do export na origem: com o
// export-public.mjs de verdade numa árvore descartável, um arquivo novo em
// scripts/ sem entrada no inventário reprova, e com a entrada passa. É a mesma
// conferência que o CI da instância faz, trazida para o doctor em 2026-10-15.
//
// As etapas são lidas do próprio doctor.mjs (script, caminho e soNaOrigem), para
// que uma etapa nova entre no teste sem edição manual. Se a leitura não achar
// nada, o teste falha alto em vez de passar calado.
//
// Nota: new URL(".", import.meta.url) JÁ é o diretório deste arquivo — aplicar
// path.dirname() aqui subiria um nível a mais.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const DOCTOR = path.join(AQUI, "doctor.mjs");

let falhas = 0;
const ok = (cond, msg) => {
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

const fonte = fs.readFileSync(DOCTOR, "utf8");
const pegar = (chave) => [...fonte.matchAll(new RegExp(`${chave}:\\s*"([^"]+)"`, "g"))].map((m) => m[1]);
const SCRIPTS = pegar("script");
const CAMINHOS = pegar("caminho");
const MARCADORES = pegar("soNaOrigem");
const TOTAL = SCRIPTS.length + CAMINHOS.length;
const NA = MARCADORES.length;

console.log(`\n[leitura] ${TOTAL} etapa(s) no doctor.mjs, ${NA} só na origem do export\n`);
ok(SCRIPTS.length > 0, "achou etapas por script no doctor.mjs");
ok(NA > 0, "achou etapas que respondem n/a fora da origem (soNaOrigem)");

const criadas = [];

function arvore({ origem, falhar = [] }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));
  criadas.push(tmp);
  const escrever = (rel, texto) => {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, texto, "utf8");
  };
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.copyFileSync(DOCTOR, path.join(tmp, "scripts", "doctor.mjs"));
  const mentira = (nome) => `process.exit(${falhar.includes(nome) ? 1 : 0});\n`;
  for (const s of SCRIPTS) escrever(path.join("scripts", s), mentira(s));
  if (origem) {
    for (const c of CAMINHOS) escrever(c, mentira(c));
    for (const m of MARCADORES) escrever(m, "marcador da origem do export\n");
  }
  return tmp;
}

function rodar(tmp) {
  const r = spawnSync(process.execPath, [path.join(tmp, "scripts", "doctor.mjs")], { encoding: "utf8" });
  const saida = (r.stdout || "") + (r.stderr || "");
  const resultado = (saida.match(/^Resultado:.*$/m) || [""])[0];
  // Conta só as marcas do bloco RESUMO: cada etapa n/a também imprime, antes, uma
  // linha própria começando por "n/a —", que não é marca do resumo.
  const resumo = saida.split(/^RESUMO$/m)[1] || "";
  const marcasNa = (resumo.match(/^\s+n\/a\s{2,}/gm) || []).length;
  return { code: r.status, saida, resultado, marcasNa };
}

try {
  console.log("[negativo] árvore de pacote: as etapas da origem respondem n/a\n");
  let r = rodar(arvore({ origem: false }));
  console.log(`  linha: ${r.resultado}`);
  ok(r.code === 0, "n/a não reprova: saiu com código 0");
  ok(r.marcasNa === NA, `o RESUMO marcou ${NA} etapa(s) como n/a`);
  ok(!/os \d+ verificadores passaram/.test(r.resultado), "a linha final não diz que todos passaram");
  ok(r.resultado.includes(`OK — ${TOTAL - NA} passaram, ${NA} n/a`), `a linha final diz "${TOTAL - NA} passaram, ${NA} n/a"`);

  console.log("\n[negativo] árvore de pacote com uma falha\n");
  r = rodar(arvore({ origem: false, falhar: ["validate-links.mjs"] }));
  console.log(`  linha: ${r.resultado}`);
  ok(r.code === 1, "a falha reprova: saiu com código 1");
  ok(r.resultado.includes(`FALHA em 1 de ${TOTAL - NA}`), `a conta da falha é sobre as ${TOTAL - NA} etapas verificadas, sem os n/a`);
  ok(r.resultado.includes(`${NA} n/a`), "a linha de falha declara os n/a");

  console.log("\n[controle] árvore de origem: nenhuma etapa n/a\n");
  r = rodar(arvore({ origem: true }));
  console.log(`  linha: ${r.resultado}`);
  ok(r.code === 0, "saiu com código 0");
  ok(r.marcasNa === 0, "nenhuma etapa marcada como n/a");
  ok(r.resultado.includes(`OK — os ${TOTAL} verificadores passaram.`), `sem n/a, a linha continua "os ${TOTAL} verificadores passaram."`);

  // Na origem do export, a etapa do export confere a lista do pacote contra o
  // inventário que a instância declarou, a mesma conferência que o CI faz. A
  // árvore usa o export-public.mjs de verdade, com um manifest mínimo
  // (scripts/**) e um padrão de redação que não casa com nada: um arquivo novo
  // em scripts/ entra no pacote pelo glob, sem decisão nenhuma. É esse o caso
  // que o inventário existe para pegar.
  console.log("\n[inventário] na origem, o export confere o pacote contra o inventário declarado\n");
  const INVENTARIO = "governance/public-package/inventario-esperado.txt";
  const origemComExport = () => {
    const tmp = arvore({ origem: true });
    fs.copyFileSync(path.join(AQUI, "export-public.mjs"), path.join(tmp, "scripts", "export-public.mjs"));
    fs.writeFileSync(
      path.join(tmp, "scripts", "export-manifest.json"),
      JSON.stringify({ allowlist: ["scripts/**"], redaction_patterns_file: "governance/seguranca/redaction-patterns.json" }),
      "utf8",
    );
    fs.mkdirSync(path.join(tmp, "governance", "seguranca"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "governance", "seguranca", "redaction-patterns.json"),
      JSON.stringify({ patterns: ["padrao-que-nao-casa-com-nada-0x1"] }),
      "utf8",
    );
    return tmp;
  };
  // Inventário com comentário, linha em branco e CRLF, que o CI também ignora.
  const declararInventario = (tmp, extra = []) => {
    const lista = fs.readdirSync(path.join(tmp, "scripts")).map((n) => `scripts/${n}`);
    fs.mkdirSync(path.join(tmp, "governance", "public-package"), { recursive: true });
    fs.writeFileSync(path.join(tmp, INVENTARIO), `# autorizados a sair\r\n\r\n${[...lista, ...extra].sort().join("\r\n")}\r\n`, "utf8");
  };

  const tInv = origemComExport();
  r = rodar(tInv);
  ok(r.code === 0 && /a comparação não roda/.test(r.saida), "sem inventário declarado, a etapa passa e diz que a comparação não roda");

  declararInventario(tInv);
  r = rodar(tInv);
  ok(r.code === 0 && /inventário confere/.test(r.saida), "com o inventário completo, a etapa passa e diz que o inventário confere");

  fs.writeFileSync(path.join(tInv, "scripts", "novo.mjs"), "// arquivo novo\n", "utf8");
  r = rodar(tInv);
  console.log(`  linha: ${r.resultado}`);
  ok(r.code === 1, "arquivo novo em scripts/ sem entrada no inventário reprova (código 1)");
  ok(r.resultado.includes(`FALHA em 1 de ${TOTAL} — export (dry-run)`), "a falha é da etapa do export, e só dela");
  ok(/\+ scripts\/novo\.mjs/.test(r.saida), "nomeou o arquivo que apareceu sem autorização");

  declararInventario(tInv);
  r = rodar(tInv);
  ok(r.code === 0 && r.resultado.includes(`OK — os ${TOTAL} verificadores passaram.`), "com a entrada no inventário, volta a passar");

  declararInventario(tInv, ["scripts/sumiu.mjs"]);
  r = rodar(tInv);
  ok(r.code === 1 && /- scripts\/sumiu\.mjs/.test(r.saida), "arquivo no inventário que sumiu do export reprova e é nomeado");

  const tMudo = arvore({ origem: true });
  declararInventario(tMudo);
  r = rodar(tMudo);
  ok(r.code === 1 && /nenhum arquivo extraído/.test(r.saida), "export que não lista nada reprova em vez de passar calado");

  const tPacote = arvore({ origem: false });
  declararInventario(tPacote, ["scripts/qualquer-coisa.mjs"]);
  r = rodar(tPacote);
  ok(r.code === 0 && r.marcasNa === NA, "num pacote, a etapa do export continua n/a, com ou sem inventário");
} finally {
  for (const d of criadas) fs.rmSync(d, { recursive: true, force: true });
}

console.log(
  falhas === 0
    ? "\nResultado: OK — o resumo do doctor não conta n/a como passou, e o export confere o inventário."
    : `\nResultado: FALHA — ${falhas} verificação(ões) do teste falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
