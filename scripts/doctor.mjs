// ---------------------------------------------------------------------------
// doctor.mjs — Checagem completa do Shizune em um comando só.
//
// Roda, nesta ordem, os verificadores que já existem, cada um como processo
// filho (a lógica não é reimplementada aqui — o formato de saída e os códigos
// de erro de cada um continuam sendo a fonte de verdade):
//
//   1. validate-structure.mjs   — árvore, frontmatter v2 e varredura de segredos
//   2. validate-links.mjs       — links relativos quebrados
//   3. validate-prose-refs.mjs  — arquivo citado entre crases que não existe
//   4. validate-state.mjs       — documento vigente dependendo de não aceito
//   5. export-public.mjs        — export em DRY-RUN (allowlist + redação), e a
//                                 lista do pacote contra o inventário que a
//                                 instância declarar (ver conferirInventario)
//
// O passo 3 é sempre dry-run: este script NUNCA passa --write, portanto nunca
// grava nem apaga dist/public/. Gerar o snapshot de verdade é ação separada,
// com aprovação humana (PARADA D).
//
// Saída: 0 se todos passaram; 1 se qualquer um falhou. Um verificador que falha
// não interrompe os seguintes — o objetivo é ver todos os problemas de uma vez.
// Etapa n/a não reprova e também não conta como passou: a linha final a mostra
// à parte.
//
// Uso (funciona a partir de qualquer diretório; a raiz do Shizune é resolvida
// como a pasta pai de scripts/):
//   bun scripts/doctor.mjs
//   bun scripts/doctor.mjs --strict    # repassa --strict ao validate-structure
//   (compatível com node >= 20: node scripts/doctor.mjs)
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
const SCRIPTS = path.join(RAIZ, "scripts");
const STRICT = process.argv.includes("--strict");

const ETAPAS = [
  {
    nome: "estrutura",
    descricao: "árvore, frontmatter v2 e varredura de segredos",
    script: "validate-structure.mjs",
    args: STRICT ? ["--strict"] : [],
  },
  {
    nome: "links",
    descricao: "links relativos quebrados",
    script: "validate-links.mjs",
    args: [],
  },
  {
    nome: "refs em prosa",
    descricao: "arquivo citado entre crases que não existe",
    script: "validate-prose-refs.mjs",
    args: STRICT ? ["--strict"] : [],
  },
  {
    nome: "estado da governança",
    descricao: "documento vigente que depende de documento não aceito",
    script: "validate-state.mjs",
    args: STRICT ? ["--strict"] : [],
  },
  {
    nome: "lints",
    descricao: "barra vertical em tabela, destino do export no texto e fim de linha LF",
    script: "validate-lints.mjs",
    args: STRICT ? ["--strict"] : [],
    // Cada lint nasceu de um erro de 2026-10-16; o que cada um cobra, e por
    // que é erro num lugar e aviso no outro, está no cabeçalho do script.
  },
  {
    nome: "lints (teste negativo)",
    descricao: "cada lint reprova o erro que o fez nascer — se passar na fixture, está quebrado",
    script: "test-validate-lints.mjs",
    args: [],
  },
  {
    nome: "export (dry-run)",
    descricao: "allowlist, padrões de redação e inventário do pacote — nunca grava",
    script: "export-public.mjs",
    args: [],
    // Só faz sentido na instância privada: o manifest referencia arquivos
    // (README-PUBLICO.md, AGENTS-PUBLICO.md, o seed do registro) que existem
    // apenas na origem do export, nunca no pacote exportado. Num clone do
    // pacote público esta etapa é n/a — e não falha, porque o QUICKSTART manda
    // todo usuário novo rodar este comando como primeiro contato.
    soNaOrigem: "README-PUBLICO.md",
    // Lista dos arquivos autorizados a sair. Um arquivo novo em skills/,
    // templates/, scripts/ ou no exemplo entra pelo glob da allowlist sem decisão
    // nenhuma; o inventário é onde essa decisão fica escrita. Opcional: a
    // instância declara, o doctor não impõe. Nunca vai no pacote.
    inventario: "governance/public-package/inventario-esperado.txt",
  },
  {
    nome: "issue-lint (teste negativo)",
    descricao: "o lint de ponteiros detecta ponteiro errado — se passar na fixture, está quebrado",
    caminho: "projects/diagnostico-publico/test-issue-lint.mjs",
    args: [],
    // PROTÓTIPO, e por isso mora em projects/ e não em scripts/. Ele NÃO valida
    // o conteúdo do Shizune — valida a própria ferramenta contra uma fixture que
    // o teste cria e destrói. A regra do operador: nenhuma checagem fatal entra
    // no doctor sem teste negativo antes. Este é o teste; a checagem em si só
    // vira gate quando o validate-prose-refs.mjs for estendido, e aí abre ADR.
    soNaOrigem: "projects/diagnostico-publico/issue-lint.prototipo.mjs",
  },
  {
    nome: "decisões (DEC-NNN)",
    descricao: "commit que cita decisão inexistente ou não assinada",
    script: "validate-decisions.mjs",
    args: [],
  },
  {
    nome: "decisões (teste negativo)",
    descricao: "o validador de DEC acusa registro defeituoso — se passar na fixture, está quebrado",
    script: "test-validate-decisions.mjs",
    args: [],
  },
  {
    nome: "índice (teste negativo)",
    descricao: "o índice cataloga o repositório, não o disco — arquivo fora do git fica fora do índice",
    script: "test-build-index.mjs",
    args: [],
  },
  {
    nome: "doctor (teste negativo)",
    descricao: "a linha final não conta n/a como passou, e o export confere o inventário — se passar na fixture, está quebrado",
    script: "test-doctor.mjs",
    args: [],
  },
  {
    nome: "livro (eventos)",
    descricao: "os livros razão declarados em governance/livros.txt: bytes, forma canônica, cadeia, atores, transições e projeção",
    script: "livro.mjs",
    args: ["check", "--todos"],
    // Os livros são da instância: o pacote traz a ferramenta, nunca os eventos
    // de ninguém. Num clone do pacote a etapa é n/a, pelo mesmo marcador do
    // export. Na origem sem governance/livros.txt, o check diz que não há livro
    // declarado e passa: é o estado entre a ferramenta chegar e o primeiro livro.
    soNaOrigem: "README-PUBLICO.md",
  },
  {
    nome: "livro (teste negativo)",
    descricao: "os vetores do formato v0, o JSON canônico e o CLI do livro — se passar na fixture, está quebrado",
    script: "test-livro.mjs",
    args: [],
  },
  {
    nome: "rodada noturna (teste negativo)",
    descricao: "a rodada recusa credencial à mão, ignora projeto bloqueado e só escreve o recap — se passar na fixture, está quebrada",
    script: "test-rodada-noturna.mjs",
    args: [],
    // O teste monta um Brain de mentira com um doctor falso: a rodada de
    // verdade nunca roda daqui, e o doctor não chama a si mesmo.
  },
  {
    nome: "pré-voo (teste negativo)",
    descricao: "o pré-voo de lote reprova pistas sobrepostas, árvore suja, branch e main errados, CRLF e hash divergente",
    script: "test-preflight.mjs",
    args: [],
    // O preflight.mjs em si não roda aqui: ele confere o começo de um lote,
    // com a branch e o SHA que só o comando do lote sabe.
  },
];

// A mesma conferência do passo "inventario do pacote publico" do CI: as linhas
// "  - caminho" do dry-run contra o inventário, ignorando linha em branco e linha
// começada por "#". Linha com "-" está no inventário e sumiu do export; linha com
// "+" apareceu no export e ninguém autorizou. Se o dry-run não listar nada, o
// formato de saída do export mudou, e isso reprova em vez de passar calado.
function conferirInventario(saida, inventarioRel) {
  const abs = path.join(RAIZ, inventarioRel);
  if (!fs.existsSync(abs)) {
    console.log(`  inventário: ${inventarioRel} não existe nesta árvore; a comparação não roda`);
    return 0;
  }
  const atual = saida
    .split(/\r?\n/)
    .filter((l) => l.startsWith("  - "))
    .map((l) => l.slice(4));
  if (atual.length === 0) {
    console.log("  [ERRO] inventário: nenhum arquivo extraído da saída do dry-run — o formato de saída do export mudou?");
    return 1;
  }
  const esperado = fs
    .readFileSync(abs, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#|$)/.test(l));
  const noExport = new Set(atual);
  const noInventario = new Set(esperado);
  const sumiram = esperado.filter((x) => !noExport.has(x)).sort();
  const apareceram = atual.filter((x) => !noInventario.has(x)).sort();
  if (sumiram.length === 0 && apareceram.length === 0) {
    console.log(`  inventário confere: ${atual.length} arquivo(s) (${inventarioRel})`);
    return 0;
  }
  console.log(`  [ERRO] o pacote público divergiu do inventário esperado (${inventarioRel}):`);
  for (const x of sumiram) console.log(`    - ${x}   (está no inventário e sumiu do export)`);
  for (const x of apareceram) console.log(`    + ${x}   (apareceu no export e ninguém autorizou)`);
  console.log("  Se o arquivo DEVE ser publicado, revise o conteúdo e acrescente a linha ao inventário no mesmo commit.");
  console.log("  Se NÃO deve, tire-o da pasta ou ajuste scripts/export-manifest.json. Nunca as duas coisas.");
  return 1;
}

console.log(`doctor — raiz: ${RAIZ}`);
console.log(`Modo: ${STRICT ? "strict (inclui pastas legadas)" : "padrão"}\n`);

const resultados = [];

for (const etapa of ETAPAS) {
  console.log("=".repeat(72));
  console.log(`[${etapa.nome}] ${etapa.descricao}`);
  console.log("=".repeat(72));

  if (etapa.soNaOrigem && !fs.existsSync(path.join(RAIZ, etapa.soNaOrigem))) {
    console.log(`  n/a — esta árvore é um pacote exportado, não a origem do export`);
    console.log(`  (${etapa.soNaOrigem} não existe aqui; nada a verificar)
`);
    resultados.push({ ...etapa, codigo: 0, na: true });
    continue;
  }

  const alvo = etapa.caminho
    ? path.join(RAIZ, etapa.caminho)
    : path.join(SCRIPTS, etapa.script);

  // A etapa com inventário precisa ler a lista que o export imprime: a saída
  // padrão é capturada e repassada inteira, antes da comparação.
  const r = spawnSync(process.execPath, [alvo, ...etapa.args], {
    cwd: RAIZ,
    stdio: etapa.inventario ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (etapa.inventario && r.stdout) process.stdout.write(r.stdout);

  // spawnSync devolve status null quando o processo morre por sinal; nesse caso
  // o resultado é indeterminado e conta como falha, não como sucesso.
  let codigo = r.error ? -1 : r.status === null ? -1 : r.status;
  if (codigo === 0 && etapa.inventario) codigo = conferirInventario(r.stdout || "", etapa.inventario);
  resultados.push({ ...etapa, codigo });

  if (r.error) console.error(`  [ERRO] não foi possível executar: ${r.error.message}`);
  console.log("");
}

console.log("=".repeat(72));
console.log("RESUMO");
console.log("=".repeat(72));

for (const r of resultados) {
  const marca = (r.na ? "n/a" : r.codigo === 0 ? "OK" : "FALHA").padEnd(5);
  const sufixo = r.na ? "(pacote exportado)" : `(exit ${r.codigo})`;
  console.log(`  ${marca}  ${r.nome.padEnd(22)} ${sufixo}`);
}

// n/a não é aprovação: a etapa não tinha o que verificar nesta árvore. As contas
// de "passaram" e de "falharam" são sobre as etapas que de fato rodaram, e os n/a
// aparecem à parte. Até a 0.4.1, num clone do pacote com 7 OK e 2 n/a, esta linha
// dizia "os 9 verificadores passaram" (item 47 da fila; teste em test-doctor.mjs).
const na = resultados.filter((r) => r.na).length;
const verificadas = resultados.length - na;
const falhas = resultados.filter((r) => r.codigo !== 0);

if (falhas.length === 0) {
  console.log(
    na > 0
      ? `\nResultado: OK — ${verificadas} passaram, ${na} n/a.`
      : `\nResultado: OK — os ${verificadas} verificadores passaram.`,
  );
  process.exit(0);
}

console.log(
  `\nResultado: FALHA em ${falhas.length} de ${verificadas} — ` +
    `${falhas.map((f) => f.nome).join(", ")}.` +
    (na > 0 ? ` ${na} n/a.` : ""),
);
console.log("Role a saída acima: cada verificador já aponta arquivo e linha.");
process.exit(1);
