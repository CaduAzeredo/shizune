// validate-decisions.mjs — o CI recusa commit que cita decisão inexistente ou não assinada.
//
// uso: node scripts/validate-decisions.mjs [--desde=<ref>] [--registro=<caminho>] [--exigir-chave]
//      node scripts/validate-decisions.mjs --texto=<arquivo>   (modo fixture, para teste)
//
// Responde por comando à pergunta que o Shizune vende: "esta mudança está
// amparada por qual decisão, e quem assinou?". Lê o trailer `Decision: DEC-NNN`
// das mensagens de commit e confronta com governance/registro-decisoes.md.
//
// Reprova em quatro casos:
//   1. o commit cita um DEC que não existe na tabela
//   2. o DEC existe mas não tem assinante
//   3. o DEC tem SHA de assinatura que não resolve nesta árvore
//   4. a instância declarou governance/exigencia-de-chave.txt e a assinatura
//      de um DEC vigente não tem chave confiável (%G? = G) — com ou sem fronteira
//
// Nota de manutenção: as expressões abaixo são LITERAIS de propósito. Montar
// regex a partir de string já custou um bug silencioso: um validador irmão
// perdeu um nível de escape e passou a reportar zero ocorrências num texto
// cheio delas. Literal não tem esse modo de falha.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "..");

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.slice(nome.length + 3) : padrao;
};

const REGISTRO = path.resolve(RAIZ, arg("registro", "governance/registro-decisoes.md"));
const DESDE = arg("desde", null);
const TEXTO = arg("texto", null);
const ARVORE = arg("arvore", RAIZ);

// `Decision: DEC-042` — o trailer, em qualquer lugar da mensagem, case-insensitive
const RE_TRAILER = /^[ \t]*Decision:[ \t]*(DEC-\d{3,})[ \t]*$/gim;
// uma linha da tabela: | DEC-001 | data | decisão | status | assinante | sha |
const RE_LINHA = /^\|\s*(DEC-\d{3,})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm;

// Blocos de código cercados não são dados: são a documentação do formato.
// Um registro que ensina "uma linha se parece com isto" dentro de ``` estava
// tendo o exemplo lido como decisão real — e o exemplo traz SHA inventado, então
// o build reprovava com "assinatura não resolve" apontando para a própria
// documentação. Achado na semente que este pacote publica, antes de publicá-la.
// A linha some, mas a numeração de linha não muda: cada linha de dentro da cerca
// vira vazia, para que qualquer mensagem futura com número de linha siga certa.
function foraDeCerca(texto) {
  let cerca = null;
  return texto
    .split("\n")
    .map((linha) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(linha);
      if (m) {
        const tipo = m[1][0];
        const tam = m[1].length;
        if (!cerca) {
          cerca = { tipo, tam };
          return "";
        }
        if (tipo === cerca.tipo && tam >= cerca.tam && /^\s*(`{3,}|~{3,})\s*$/.test(linha)) cerca = null;
        return "";
      }
      return cerca ? "" : linha;
    })
    .join("\n");
}

function lerRegistro(caminho) {
  if (!fs.existsSync(caminho)) {
    console.error(`registro não encontrado: ${caminho}`);
    process.exit(2);
  }
  const texto = foraDeCerca(fs.readFileSync(caminho, "utf8"));
  const mapa = new Map();
  for (const m of texto.matchAll(RE_LINHA)) {
    mapa.set(m[1], {
      data: m[2].trim(),
      status: m[4].trim(),
      assinante: m[5].trim(),
      assinatura: m[6].trim(),
    });
  }
  return mapa;
}

function shaResolve(sha) {
  if (!sha) return false;
  try {
    execFileSync("git", ["-C", ARVORE, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// O código de assinatura do git para um commit. Só `G` significa "assinatura
// boa POR CHAVE CONFIÁVEL". `U` é assinatura boa de chave fora da lista de
// confiança — "alguém assinou", não "o dono do repositório assinou" — e por
// isso não conta como chave em lugar nenhum deste validador. A primeira versão
// aceitava U aqui, o que esvaziava a regra na camada que mais importa.
function codigoAssinatura(sha) {
  try {
    return execFileSync("git", ["-C", ARVORE, "log", "-1", "--format=%G?", sha], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "?";
  }
}

const EXPLICA = {
  U: "assinatura boa, mas a chave não está na lista de confiança — falta gpg.ssh.allowedSignersFile apontando para .github/allowed_signers, ou a chave não está nele",
  N: "o git não enxergou assinatura nenhuma — o commit não foi assinado, ou o git do ambiente não reconhece este formato de assinatura",
  E: "a assinatura não pôde ser checada — ferramenta de verificação ausente no ambiente (ssh-keygen)",
  B: "assinatura RUIM — o conteúdo não confere com a assinatura",
  X: "assinatura boa, de chave expirada",
  Y: "assinatura boa, de chave que expirou depois",
  R: "assinatura boa, de chave revogada",
  "?": "o commit não pôde ser lido nesta árvore",
};

// --- exigência de chave na assinatura de decisão ----------------------------
//
// A instância pode declarar que assinar uma decisão exige chave: a linha do
// registro em estado vigente só vale se o commit que ela aponta tiver
// assinatura verificada por chave confiável (%G? = G) — com ou sem fronteira de
// autoria, porque a fronteira é sobre a história e isto é sobre a decisão.
//
// A exigência NÃO mora neste script, pela mesma razão da fronteira: o script é
// publicado, e um clone de terceiro que assina a sua primeira decisão sem chave
// nasceria vermelho por uma regra que ninguém ali decidiu. Reproduzido em
// 2026-09-05 — pacote exportado, diretório limpo, sem configuração global:
// exit 1 na primeira decisão. A instância declara a sua em
// governance/exigencia-de-chave.txt, que a allowlist de export não leva. Sem o
// arquivo e sem --exigir-chave, commit de assinatura sem G é AVISO, como sempre
// foi. Arquivo presente com conteúdo que não é o token reprova: uma exigência
// que ninguém entende não pode passar por "não declarada".
const TOKEN_EXIGENCIA = "decisao-assinada-exige-G";
const ARQ_EXIGENCIA = path.resolve(ARVORE, "governance/exigencia-de-chave.txt");
const exigenciaDoArquivo = () => {
  if (!fs.existsSync(ARQ_EXIGENCIA)) return null;
  const l = fs
    .readFileSync(ARQ_EXIGENCIA, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
  return l[0] || "";
};
const DECLARACAO = exigenciaDoArquivo();
const EXIGE_CHAVE = process.argv.includes("--exigir-chave") || DECLARACAO === TOKEN_EXIGENCIA;

// --- coleta das citações -----------------------------------------------------

/** @type {{origem: string, dec: string}[]} */
const citacoes = [];

if (TEXTO) {
  const t = fs.readFileSync(path.resolve(TEXTO), "utf8");
  for (const m of t.matchAll(RE_TRAILER)) citacoes.push({ origem: path.basename(TEXTO), dec: m[1] });
} else {
  const faixa = DESDE ? [`${DESDE}..HEAD`] : ["-20"];
  let bruto = "";
  try {
    bruto = execFileSync("git", ["-C", ARVORE, "log", ...faixa, "--format=%H%x00%B%x1e"], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 26,
    }).toString();
  } catch {
    console.error("não foi possível ler o histórico git");
    process.exit(2);
  }
  for (const bloco of bruto.split("\x1e")) {
    if (!bloco.trim()) continue;
    const [sha, corpo = ""] = bloco.split("\x00");
    for (const m of corpo.matchAll(RE_TRAILER)) {
      citacoes.push({ origem: sha.trim().slice(0, 7), dec: m[1] });
    }
  }
}

// --- verificação -------------------------------------------------------------

const registro = lerRegistro(REGISTRO);
const saida = [];
let falhas = 0;
let semChave = 0;

// "rascunho, assinatura pendente" (decisão de produto do operador):
// a máquina rascunha, o humano assina, o SHA ativa. Uma linha em rascunho pode
// existir sem assinante e sem assinatura — isso é AVISO. O que não pode é um
// commit se apoiar nela: citar decisão não assinada REPROVA.
const ehRascunho = (linha) => /^rascunho\b/i.test(linha.status);
let rascunhos = 0;

for (const { origem, dec } of citacoes) {
  const linha = registro.get(dec);
  if (!linha) {
    saida.push(`FALHA       ${origem} cita ${dec} — não existe em ${path.relative(RAIZ, REGISTRO)}`);
    falhas++;
    continue;
  }
  if (ehRascunho(linha)) {
    saida.push(
      `FALHA       ${origem} cita ${dec} — decisão em RASCUNHO, ainda não assinada. ` +
        `A máquina rascunha; o commit só pode se apoiar no que o humano assinou.`,
    );
    falhas++;
    continue;
  }
  if (!linha.assinante) {
    saida.push(`FALHA       ${origem} cita ${dec} — existe, mas sem assinante`);
    falhas++;
    continue;
  }
  if (!shaResolve(linha.assinatura)) {
    saida.push(
      `FALHA       ${origem} cita ${dec} — assinatura "${linha.assinatura || "(vazia)"}" não resolve nesta árvore`,
    );
    falhas++;
    continue;
  }
  const g = codigoAssinatura(linha.assinatura);
  if (g === "G") {
    saida.push(`ok          ${origem} cita ${dec} — assinado por ${linha.assinante}, commit assinado por chave confiável`);
  } else if (EXIGE_CHAVE) {
    saida.push(
      `FALHA       ${origem} cita ${dec} — a assinatura ${linha.assinatura} não tem chave confiável. ` +
        `Esta instância exige G na assinatura de decisão (governance/exigencia-de-chave.txt). git %G? = "${g}": ${EXPLICA[g] || "código não reconhecido"}`,
    );
    falhas++;
  } else {
    saida.push(`ok          ${origem} cita ${dec} — assinado por ${linha.assinante} (commit sem chave confiável: %G? = ${g})`);
    semChave++;
  }
}

// --- fronteira de autoria --------------------------------------------------
//
// Uma instância pode declarar a partir de que ponto da história todo commit
// precisa de assinatura verificada por chave confiável. Antes da fronteira, a
// história é o que é; depois dela, commit sem assinatura boa REPROVA.
//
// O SHA NÃO mora neste arquivo, de propósito. Este script é publicado como
// parte do framework, e um SHA daqui não existe em nenhum outro repositório —
// deixá-lo como padrão faria todo clone de terceiro herdar uma fronteira que
// não é dele. A instância declara a sua em governance/fronteira-de-autoria.txt,
// que a allowlist de export não leva. Sem arquivo e sem --fronteira, a checagem
// se declara não configurada e não reprova.
//
// A lista de chaves confiáveis segue a mesma regra e pela mesma razão: ela é
// parte da verificação, mora no repositório, e é de cada repositório. Publicar
// a lista de uma instância deixaria o CI de terceiro confiando numa chave que
// não é a de quem commita ali.
const ARQ_FRONTEIRA = path.resolve(ARVORE, "governance/fronteira-de-autoria.txt");
const fronteiraDoArquivo = () => {
  if (!fs.existsSync(ARQ_FRONTEIRA)) return "";
  const l = fs
    .readFileSync(ARQ_FRONTEIRA, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
  return l[0] || "";
};
const FRONTEIRA = arg("fronteira", fronteiraDoArquivo());

if (!TEXTO && !FRONTEIRA) {
  saida.push(
    "aviso       nenhuma fronteira de autoria configurada — declare o SHA em " +
      "governance/fronteira-de-autoria.txt (ou passe --fronteira=<sha>) para exigir " +
      "assinatura verificada nos commits posteriores a ele",
  );
} else if (!TEXTO) {
  if (!shaResolve(FRONTEIRA)) {
    // Clone raso não alcança a fronteira. Não reprova aqui: quem cobre esse caso
    // é a checagem de assinatura das DEC acima, e o conserto é fetch-depth: 0.
    saida.push(`aviso       fronteira de autoria ${FRONTEIRA} fora do alcance — histórico raso, checagem pulada`);
  } else {
    let bruto = "";
    try {
      bruto = execFileSync("git", ["-C", ARVORE, "log", `${FRONTEIRA}..HEAD`, "--format=%h%x00%G?%x00%an"], {
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 1 << 24,
      }).toString();
    } catch {
      /* sem histórico utilizável: a checagem acima já cobre */
    }
    // Só `G` conta — ver codigoAssinatura() e EXPLICA no topo. Isto só é
    // exigível porque a lista de confiança passou a viver NO REPOSITÓRIO
    // (.github/allowed_signers); antes dela, exigir G seria pedir ao CI algo
    // que ele não tinha como saber.
    const linhas = bruto.split("\n").filter((x) => x.trim());
    let assinados = 0;
    for (const l of linhas) {
      const [sha, g, autor] = l.split("\x00");
      if (g === "G") {
        assinados++;
        continue;
      }
      saida.push(
        `FALHA       commit ${sha} (${autor}) é posterior à fronteira de autoria ${FRONTEIRA} e não tem assinatura confiável. ` +
          `git %G? = "${g}": ${EXPLICA[g] || "código não reconhecido"}`,
      );
      falhas++;
    }
    // Quando algo falha, dizer em que ambiente a verificação rodou. Sem isto, a
    // saída do CI é uma letra solta e cada diagnóstico custa uma ida e volta —
    // já custou duas hipóteses erradas antes da certa, num caso real desta base —
    // certa. O ambiente é parte do achado.
    if (assinados !== linhas.length) {
      const cfg = (chave) => {
        try {
          return execFileSync("git", ["-C", ARVORE, "config", "--get", chave], {
            stdio: ["ignore", "pipe", "ignore"],
          })
            .toString()
            .trim();
        } catch {
          return "(não definido)";
        }
      };
      const lista = cfg("gpg.ssh.allowedSignersFile");
      saida.push(`ambiente    gpg.format = ${cfg("gpg.format") || "(padrão)"}`);
      saida.push(
        `ambiente    gpg.ssh.allowedSignersFile = ${lista}` +
          (lista !== "(não definido)" && !fs.existsSync(path.resolve(ARVORE, lista))
            ? "  — APONTA PARA CAMINHO QUE NÃO EXISTE"
            : ""),
      );
    }
    // Dizer quantos foram conferidos mesmo quando passa: checagem silenciosa no
    // sucesso é indistinguível de checagem que não rodou. E o rótulo tem de
    // seguir o resultado — a primeira versão imprimia "ok" numa linha que dizia
    // "0 de 5", que é exatamente a contradição entre afirmação e conteúdo que
    // este repositório reporta aos outros.
    const rotulo = assinados === linhas.length ? "ok         " : "FALHA      ";
    saida.push(
      `${rotulo} fronteira ${FRONTEIRA} — ${assinados} de ${linhas.length} commit(s) posteriores com assinatura verificada`,
    );
  }
}

// integridade do próprio registro, independente de haver citação
for (const [dec, linha] of registro) {
  if (ehRascunho(linha)) {
    // Rascunho sem citação é estado legítimo e esperado: é a decisão esperando
    // a assinatura do operador. Vira aviso no rodapé, nunca falha.
    rascunhos++;
    saida.push(`rascunho    ${dec} — assinatura pendente; nenhum commit pode citá-la ainda`);
    continue;
  }
  if (!linha.assinante) {
    saida.push(`FALHA       ${dec} no registro — sem assinante e sem estado "rascunho"`);
    falhas++;
  } else if (!shaResolve(linha.assinatura)) {
    saida.push(`FALHA       ${dec} no registro — assinatura "${linha.assinatura || "(vazia)"}" não resolve`);
    falhas++;
  } else if (EXIGE_CHAVE && !TEXTO) {
    // Com a exigência declarada, a linha vigente é checada mesmo sem citação:
    // uma decisão "assinada" por commit sem chave é o defeito, haja ou não
    // commit se apoiando nela. Em modo fixture (--texto) a árvore é a do teste
    // e as linhas já são conferidas pela citação.
    const g = codigoAssinatura(linha.assinatura);
    if (g !== "G") {
      saida.push(
        `FALHA       ${dec} no registro — a assinatura ${linha.assinatura} não tem chave confiável. ` +
          `Esta instância exige G na assinatura de decisão (governance/exigencia-de-chave.txt). git %G? = "${g}": ${EXPLICA[g] || "código não reconhecido"}`,
      );
      falhas++;
    }
  }
}

if (DECLARACAO !== null && DECLARACAO !== TOKEN_EXIGENCIA) {
  saida.push(
    `FALHA       governance/exigencia-de-chave.txt existe mas a primeira linha útil é "${DECLARACAO}", ` +
      `não "${TOKEN_EXIGENCIA}". Exigência declarada e não reconhecida não pode passar por "não declarada".`,
  );
  falhas++;
}
if (EXIGE_CHAVE) {
  saida.push(
    `exigência   esta instância exige G na assinatura de decisão` +
      (DECLARACAO === TOKEN_EXIGENCIA ? " (governance/exigencia-de-chave.txt)" : " (--exigir-chave)"),
  );
}

console.log(`validate-decisions — registro: ${path.relative(RAIZ, REGISTRO)}`);
// Cuidado com esta mensagem: `saida` só recebe linha de FALHA quando não há
// citação, então "vazio" aqui significa "nada a relatar", nunca "registro vazio".
// A primeira versão dizia "nenhuma linha no registro" com 4 linhas lidas — o
// exato defeito de documentação afirmando o que não é que este projeto reporta.
console.log(saida.length ? saida.sort().join("\n") : "(nada a relatar: nenhuma citação, e todas as linhas do registro estão íntegras)");
console.log(
  `\n${registro.size} decisão(ões) no registro, ${rascunhos} em rascunho, ` +
    `${citacoes.length} citação(ões) em commit, ${falhas} problema(s).`,
);
if (rascunhos) {
  console.log(
    `Aviso: ${rascunhos} decisão(ões) aguardam assinatura do operador. ` +
      `Isto não reprova — mas qualquer commit que cite uma delas reprova, até a linha ganhar assinante e SHA.`,
  );
}
if (semChave) {
  console.log(
    `Aviso: ${semChave} citação(ões) apontam para commit sem assinatura de chave confiável. ` +
      `Isto NÃO reprova hoje: esta instância não declarou a exigência em governance/exigencia-de-chave.txt. ` +
      `Até declarar, nenhum material público pode chamar esta camada de "assinatura criptográfica verificada".`,
  );
}
process.exit(falhas ? 1 : 0);
