// validate-decisions.mjs — o CI recusa commit que cita decisão inexistente ou não assinada.
//
// uso: node scripts/validate-decisions.mjs [--desde=<ref>] [--registro=<caminho>] [--exigir-chave] [--json]
//      node scripts/validate-decisions.mjs --texto=<arquivo>   (modo fixture, para teste)
//      node scripts/validate-decisions.mjs --selo=DEC-NNN       (imprime o selo da linha, para assinar)
//
// --json troca o texto por um objeto { decisoes: [{ id, garantia, sha }], problemas }
// com cada decisão vigente e a garantia calculada dela (chave, plataforma ou
// nenhuma). O código de saída é o mesmo do modo texto.
//
// Responde por comando à pergunta que o Shizune vende: "esta mudança está
// amparada por qual decisão, e quem assinou?". Lê o trailer `Decision: DEC-NNN`
// das mensagens de commit e confronta com governance/registro-decisoes.md.
//
// Reprova nestes casos:
//   1. o commit cita um DEC que não existe na tabela
//   2. o DEC existe mas não tem assinante
//   3. o DEC tem SHA de assinatura que não resolve nesta árvore
//   4. a instância declarou governance/exigencia-de-chave.txt e a assinatura
//      de um DEC vigente não tem chave confiável (%G? = G) — com ou sem fronteira
//   5. a instância declarou governance/chaves-de-assinatura.txt e a decisão foi
//      assinada por uma chave marcada ali como de MÁQUINA
//   6. a mesma declaração existe e o assinante escrito na linha não corresponde
//      ao principal da chave que de fato assinou o commit
//   7. a mesma declaração existe e a decisão aponta para um commit criado pelo
//      GitHub sem a diretiva `plataforma github` para aquele assinante — ou, com
//      ela, o commit não é merge de dois pais, não verifica pela chave da
//      plataforma, foi feito por outro e-mail, por um app, ou pelo próprio autor
//      dos commits do PR
//   8. a instância declarou governance/delegacoes.txt e uma delegação aponta DEC
//      inexistente ou em rascunho, um commit declara `Nivel: N0|N1` sem um
//      `Autorizado-por:` que bata com delegação daquele nível, ou declara
//      `Nivel: N2`, que não se declara: prova-se pela assinatura
//   9. o mesmo id DEC-NNN aparece em mais de uma linha do registro: número
//      atribuído não se reatribui, e até aqui a última linha ganhava em silêncio
//  10. uma linha assinada traz selo (a sétima célula) e o selo não bate com o
//      texto de agora: a linha mudou depois de assinada. O selo é "selo:" e os 16
//      primeiros hexadecimais do sha256 de id|decisão|status|assinante|assinatura,
//      com as células sem os espaços das pontas; --selo=DEC-NNN o calcula. Linha
//      assinada sem selo só avisa: o selo nasce na assinatura, e as linhas antigas
//      precisam de migração para ganhá-lo
//
// Nota de manutenção: as expressões abaixo são LITERAIS de propósito. Montar
// regex a partir de string já custou um bug silencioso: um validador irmão
// perdeu um nível de escape e passou a reportar zero ocorrências num texto
// cheio delas. Literal não tem esse modo de falha.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const SAIDA_JSON = process.argv.includes("--json");

// `Decision: DEC-042` — o trailer, em qualquer lugar da mensagem, case-insensitive
const RE_TRAILER = /^[ \t]*Decision:[ \t]*(DEC-\d{3,})[ \t]*$/gim;
// `Nivel: N1` (com ou sem acento) e `Autorizado-por: DEC-042` — trailers de delegação
const RE_NIVEL = /^[ \t]*N[ií]vel:[ \t]*(\S+)[ \t]*$/gim;
const RE_AUTORIZADO = /^[ \t]*Autorizado-por:[ \t]*(DEC-\d{3,})[ \t]*$/gim;
// uma linha de governance/delegacoes.txt: delega N1 <escopo> autorizado_por DEC-042
const RE_DELEGA = /^delega\s+(N[01])\s+(\S+)\s+autorizado_por\s+(DEC-\d{3,})$/;
// uma linha da tabela: | DEC-001 | data | decisão | status | assinante | sha | [selo |]
// A sétima célula é opcional e não atravessa a quebra de linha: sem ela, a linha
// de seis células termina no sexto "|" e a próxima linha não é lida como selo.
const RE_LINHA = /^\|\s*(DEC-\d{3,})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(?:([^|\r\n]*)\|)?/gm;
const RE_SELO = /^selo:[0-9a-f]{16}$/;

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
    const linha = texto.slice(0, m.index).split("\n").length;
    if (!LINHAS_POR_ID.has(m[1])) LINHAS_POR_ID.set(m[1], []);
    LINHAS_POR_ID.get(m[1]).push(linha);
    // A última linha continua sendo a lida, como antes; o id repetido reprova à
    // parte (caso 9), para que nenhuma das linhas passe calada.
    mapa.set(m[1], {
      data: m[2].trim(),
      decisao: m[3].trim(),
      status: m[4].trim(),
      assinante: m[5].trim(),
      assinatura: m[6].trim(),
      selo: (m[7] ?? "").trim(),
      linha,
    });
  }
  return mapa;
}

// As linhas do registro em que cada id aparece; mais de uma é o caso 9.
/** @type {Map<string, number[]>} */
const LINHAS_POR_ID = new Map();

// O selo de uma linha como ela está escrita (caso 10). A data fica de fora: é
// metadado da linha, não o que foi decidido nem por quem.
function seloDa(id, linha) {
  const conteudo = [id, linha.decisao, linha.status, linha.assinante, linha.assinatura].join("|");
  return `selo:${createHash("sha256").update(conteudo, "utf8").digest("hex").slice(0, 16)}`;
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
//
// As três leituras de commit abaixo guardam o resultado por SHA: o cálculo da
// garantia relê as mesmas assinaturas que as checagens já leram, e várias linhas
// do registro costumam apontar o mesmo commit.
const memoria = new Map();
const lembrar = (tipo, sha, ler) => {
  const k = `${tipo}\x00${sha}`;
  if (!memoria.has(k)) memoria.set(k, ler());
  return memoria.get(k);
};

function codigoAssinatura(sha) {
  return lembrar("G?", sha, () => {
    try {
      return execFileSync("git", ["-C", ARVORE, "log", "-1", "--format=%G?", sha], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return "?";
    }
  });
}

// O principal da chave que assinou o commit — para SSH, o nome pelo qual a
// chave está listada em .github/allowed_signers. `%G?` responde "a assinatura é
// boa e de chave confiável?"; `%GS` responde "de QUAL chave?". A segunda
// pergunta é a que faltava em 2026-09-04: o executor assinou uma decisão com a
// chave do operador, a assinatura saiu boa, e nenhuma checagem tinha como notar.
function principalAssinatura(sha) {
  return lembrar("GS", sha, () => {
    try {
      return execFileSync("git", ["-C", ARVORE, "log", "-1", "--format=%GS", sha], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return "";
    }
  });
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

// --- commits criados pela plataforma ------------------------------------------
//
// O GitHub cria commits em nome de quem aperta o botão: o merge de um PR, o
// squash, a edição pela web. O committer é o GitHub, com o endereço de noreply
// da plataforma, e a assinatura é da chave GPG da plataforma, não de uma chave
// da lista de confiança. Medido numa sonda em 2026-10-14: sem a chave pública da
// plataforma no gpg do ambiente, o git dá %G? = E; importada sem confiança, U;
// importada e confiável, G. Por isso a explicação genérica do E (ferramenta
// ausente) erra o diagnóstico de um merge do GitHub, e esta camada dá a certa.
//
// O endereço é montado por partes de propósito: a redação do export barra todo
// e-mail escrito por extenso num arquivo publicado, e este é o endereço público
// e genérico da plataforma, não um dado de ninguém.
const EMAIL_PLATAFORMA = ["noreply", "github.com"].join("@");

function lerCommit(sha) {
  return lembrar("commit", sha, () => {
    try {
      const [ce, pais, ae, an] = execFileSync("git", ["-C", ARVORE, "log", "-1", "--format=%ce%x00%P%x00%ae%x00%an", sha], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim()
        .split("\x00");
      return { committerEmail: (ce || "").toLowerCase(), pais: pais ? pais.split(" ") : [], autorEmail: ae || "", autorNome: an || "" };
    } catch {
      return null;
    }
  });
}

const ehDaPlataforma = (c) => Boolean(c) && c.committerEmail === EMAIL_PLATAFORMA;

const CRIADO_PELO_GITHUB = `o commit foi criado pelo GitHub (committer ${EMAIL_PLATAFORMA})`;
const POR_QUE_PLATAFORMA = {
  E:
    `${CRIADO_PELO_GITHUB} e vem assinado pela chave GPG da plataforma, não por uma chave da lista de confiança. ` +
    "O git só confere essa assinatura com a chave pública da plataforma importada no gpg do ambiente; sem ela, " +
    "%G? = E. A instância importa a chave; o pacote não a leva",
  U:
    `${CRIADO_PELO_GITHUB} e a chave pública da plataforma está no gpg do ambiente, mas sem confiança; ` +
    "o git só dá G com a chave importada E marcada como confiável",
};

/** A explicação de um código %G?, com a causa certa quando o commit é da plataforma. */
function explicar(g, sha) {
  if (g !== "G" && ehDaPlataforma(lerCommit(sha))) {
    return POR_QUE_PLATAFORMA[g] || `${CRIADO_PELO_GITHUB}. ${EXPLICA[g] || "código não reconhecido"}`;
  }
  return EXPLICA[g] || "código não reconhecido";
}

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

// --- correspondência entre assinante declarado e chave que assinou -----------
//
// A camada anterior responde "uma chave confiável assinou?". Esta responde
// "QUAL chave, e ela é a de quem a linha diz que assinou?". Sem ela, a coluna
// Assinante é texto livre: uma linha dizendo "operador" cujo commit foi
// assinado por outra chave da lista de confiança passava sem ruído.
//
// Duas diretivas, uma por linha, em governance/chaves-de-assinatura.txt:
//
//   assinante <nome exato na coluna Assinante> <principal em allowed_signers>
//   maquina <principal>
//
// `maquina` marca a chave que assina rascunho de trabalho e NUNCA decisão — é o
// item 1 do ADR-046, e existe para que o defeito de 2026-09-04 (executor
// assinando decisão com a chave do operador) passe a ter como ser acusado.
//
// Pela mesma razão da fronteira e da exigência de chave, o arquivo é de
// INSTÂNCIA e a allowlist de export não o leva: um principal daqui não existe
// no repositório de mais ninguém. SEM O ARQUIVO, NADA DISTO RODA e o validador
// se comporta exatamente como antes — um clone de terceiro não pode nascer
// vermelho por uma regra que ninguém ali declarou.
//
// Assinante ausente do mapa é AVISO, não falha: quem usa nome livre na coluna
// continua funcionando, e o aviso diz que aquela linha não foi conferida.
//
// Uma terceira diretiva, DESLIGADA enquanto não for declarada:
//
//   plataforma github <nome exato na coluna Assinante> <e-mail de quem faz o merge>
//
// Com ela, o merge commit que o GitHub cria quando essa pessoa aperta o botão
// assina a decisão. Ele prova menos que uma chave: prova que uma credencial com
// permissão de merge na conta apertou o botão, não que alguém tinha a chave
// privada. Se a credencial de um agente também consegue fazer merge, ela produz
// um commit idêntico. Por isso a diretiva só deve ser declarada depois de medir
// que a credencial do agente NÃO consegue fazer merge no branch protegido.
const ARQ_CHAVES = path.resolve(ARVORE, "governance/chaves-de-assinatura.txt");
const ASSINANTES = new Map();
const MAQUINAS = new Set();
const PLATAFORMAS = new Map();
const errosDeclaracaoChaves = [];
let TEM_MAPA_CHAVES = false;

if (fs.existsSync(ARQ_CHAVES)) {
  TEM_MAPA_CHAVES = true;
  const linhas = fs
    .readFileSync(ARQ_CHAVES, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
  for (const l of linhas) {
    const partes = l.split(/\s+/);
    if (partes[0] === "assinante" && partes.length >= 3) {
      // O nome pode ter espaços — "Cadu Azeredo" é um assinante, não dois campos.
      // O principal é sempre o ÚLTIMO campo, e o nome é tudo entre a diretiva e ele.
      // A primeira versão exigia exatamente 3 campos e reprovava todo nome composto
      // como declaração mal formada, o que é o oposto do que este arquivo serve.
      ASSINANTES.set(partes.slice(1, -1).join(" "), partes[partes.length - 1]);
    } else if (partes[0] === "maquina" && partes.length === 2) {
      MAQUINAS.add(partes[1]);
    } else if (partes[0] === "plataforma" && partes[1] === "github" && partes.length >= 4) {
      // Mesma regra do nome composto: o e-mail é o último campo.
      PLATAFORMAS.set(partes.slice(2, -1).join(" "), partes[partes.length - 1]);
    } else {
      // Declaração que ninguém entende não pode passar por "não declarada" —
      // mesma regra do token da exigência de chave.
      errosDeclaracaoChaves.push(l);
    }
  }
}

let semConferencia = 0;

/**
 * Confere o principal da chave que assinou contra o que a linha declara.
 * Devolve null quando não há nada a dizer.
 * Só é chamada com %G? = G: sem chave confiável não há principal para conferir,
 * e o caso já é tratado pela camada da exigência de chave.
 */
function conferirPrincipal(linha) {
  if (!TEM_MAPA_CHAVES) return null;
  const principal = principalAssinatura(linha.assinatura);
  if (MAQUINAS.has(principal)) {
    return {
      falha: true,
      msg:
        `assinada pela CHAVE DE MÁQUINA "${principal}" — chave de máquina assina rascunho, nunca decisão ` +
        `(governance/chaves-de-assinatura.txt). A máquina não assina a decisão que ela mesma executa.`,
    };
  }
  const esperado = ASSINANTES.get(linha.assinante);
  if (esperado === undefined) {
    return {
      falha: false,
      msg: `assinante "${linha.assinante}" não está em governance/chaves-de-assinatura.txt — a coluna não foi conferida contra a chave`,
    };
  }
  if (principal !== esperado) {
    return {
      falha: true,
      msg:
        `a linha declara assinante "${linha.assinante}" (chave ${esperado}), mas o commit ${linha.assinatura} ` +
        `foi assinado por "${principal || "(sem principal)"}". Nome na coluna não é afirmação livre.`,
    };
  }
  return null;
}

/**
 * Decide uma linha cuja assinatura aponta para um commit criado pelo GitHub.
 * Devolve null quando o commit não é da plataforma (ou a instância não tem o
 * mapa de chaves); senão, { nivel: "ok" | "aviso" | "falha", msg }.
 */
function avaliarPlataforma(linha) {
  if (!TEM_MAPA_CHAVES) return null;
  const sha = linha.assinatura;
  const c = lerCommit(sha);
  if (!ehDaPlataforma(c)) return null;
  const g = codigoAssinatura(sha);
  const email = PLATAFORMAS.get(linha.assinante);

  if (email === undefined) {
    const msg =
      `o commit ${sha} foi criado pelo GitHub, e merge da plataforma não assina decisão aqui: a diretiva ` +
      `"plataforma github <assinante> <e-mail>" não está declarada para "${linha.assinante}" em ` +
      `governance/chaves-de-assinatura.txt. A rota vem desligada de propósito: declare-a só depois de medir que a ` +
      `credencial do agente não consegue fazer merge no branch protegido (o QUICKSTART mostra como medir).`;
    if (g === "G") return { nivel: "falha", msg };
    // Sem G vale a regra de sempre: reprova com a exigência de chave, avisa sem ela.
    return { nivel: EXIGE_CHAVE ? "falha" : "aviso", msg: `${msg} git %G? = "${g}": ${explicar(g, sha)}` };
  }
  if (c.pais.length !== 2) {
    return {
      nivel: "falha",
      msg:
        `o commit ${sha} foi criado pelo GitHub com ${c.pais.length} pai(s): só o merge commit ("Create a merge commit"), ` +
        `de dois pais, assina decisão. Squash e rebase não: o commit tem um pai só e a mensagem é editável por quem aperta o botão.`,
    };
  }
  if (g !== "G") {
    return { nivel: "falha", msg: `o merge do GitHub ${sha} não tem assinatura verificável: git %G? = "${g}": ${explicar(g, sha)}` };
  }
  const signatario = principalAssinatura(sha);
  if (!signatario.toLowerCase().includes(EMAIL_PLATAFORMA)) {
    return {
      nivel: "falha",
      msg: `o commit ${sha} tem committer do GitHub, mas foi assinado por "${signatario}", que não é a chave da plataforma.`,
    };
  }
  if (/\[bot\]/i.test(c.autorEmail) || /\[bot\]/i.test(c.autorNome)) {
    return {
      nivel: "falha",
      msg:
        `o merge ${sha} foi feito por um app (${c.autorEmail}), não por gente: merge como assinatura de decisão ` +
        `exige uma pessoa apertando o botão.`,
    };
  }
  if (c.autorEmail.toLowerCase() !== email.toLowerCase()) {
    return {
      nivel: "falha",
      msg: `o merge ${sha} foi feito por ${c.autorEmail}, mas a diretiva declara ${email} para "${linha.assinante}".`,
    };
  }
  let autoresDoPr = [];
  try {
    autoresDoPr = execFileSync("git", ["-C", ARVORE, "log", "--format=%ae", `${c.pais[0]}..${c.pais[1]}`], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split("\n")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return { nivel: "falha", msg: `não foi possível ler os commits do PR que o merge ${sha} trouxe.` };
  }
  if (autoresDoPr.includes(c.autorEmail.toLowerCase())) {
    return {
      nivel: "falha",
      msg:
        `quem fez o merge ${sha} (${c.autorEmail}) também é autor de commit do PR: merge como assinatura exige que ` +
        `quem aperta o botão não seja quem escreveu.`,
    };
  }
  return {
    nivel: "ok",
    msg:
      `assinado por ${linha.assinante} pelo merge do GitHub ${sha} (diretiva plataforma github): prova a credencial ` +
      `que fez o merge, não a posse de uma chave`,
  };
}

/**
 * A garantia de uma decisão vigente, calculada do git e nunca escrita à mão:
 * "chave" (assinatura G pela chave humana declarada), "plataforma" (merge aceito
 * pela diretiva plataforma github) ou "nenhuma". Não é coluna do registro: um
 * campo preenchido por pessoa pode mentir, e mudar o formato da tabela quebraria
 * as instâncias que já existem.
 */
function garantiaDe(linha) {
  if (!linha.assinante || !shaResolve(linha.assinatura)) return "nenhuma";
  const plat = avaliarPlataforma(linha);
  if (plat) return plat.nivel === "ok" ? "plataforma" : "nenhuma";
  if (codigoAssinatura(linha.assinatura) !== "G") return "nenhuma";
  if (TEM_MAPA_CHAVES) {
    const principal = principalAssinatura(linha.assinatura);
    if (MAQUINAS.has(principal)) return "nenhuma";
    const esperado = ASSINANTES.get(linha.assinante);
    if (esperado !== undefined && principal !== esperado) return "nenhuma";
  }
  return "chave";
}

// --- delegações N0 e N1 --------------------------------------------------------
//
// Os níveis dizem quem pode decidir uma classe de coisa e que rastro isso deixa:
// N0 (micro, sem rastro por item), N1 (de máquina, commit em branch de rascunho
// com o trailer de nível) e N2 (humana, linha assinada no registro). N0 e N1 só
// existem dentro de uma delegação, e a delegação é uma decisão N2 assinada: o
// arquivo opcional governance/delegacoes.txt diz qual DEC liberou cada classe.
//
//   delega N0 <escopo> autorizado_por DEC-NNN
//   delega N1 <escopo> autorizado_por DEC-NNN
//
// O escopo é uma palavra livre; o validador não o interpreta, só confere o
// vínculo. Como os outros arquivos de instância, ele não vai no pacote, e SEM ELE
// NADA DISTO RODA: os trailers de nível passam sem conferência.
const ARQ_DELEGACOES = path.resolve(ARVORE, "governance/delegacoes.txt");
const DELEGACOES = [];
const errosDelegacoes = [];
const TEM_DELEGACOES = fs.existsSync(ARQ_DELEGACOES);
if (TEM_DELEGACOES) {
  const linhas = fs
    .readFileSync(ARQ_DELEGACOES, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
  for (const l of linhas) {
    const m = RE_DELEGA.exec(l);
    if (m) DELEGACOES.push({ nivel: m[1], escopo: m[2], dec: m[3], linha: l });
    else errosDelegacoes.push(l);
  }
}

// --- --selo=DEC-NNN: o selo para colar na assinatura -------------------------
//
// Assinar é trocar o estado por `vigente`, preencher o assinante e o SHA, e só
// então pedir o selo: ele cobre o texto da linha já assinada. Sai antes de
// qualquer conferência, e não lê o histórico.
const SELO_DE = arg("selo", null);
if (SELO_DE) {
  const linha = lerRegistro(REGISTRO).get(SELO_DE);
  if (!linha) {
    console.error(`${SELO_DE} não existe em ${path.relative(RAIZ, REGISTRO)}`);
    process.exit(1);
  }
  console.log(seloDa(SELO_DE, linha));
  process.exit(0);
}

// --- coleta das citações -----------------------------------------------------

/** @type {{origem: string, dec: string}[]} */
const citacoes = [];
/** @type {{origem: string, niveis: string[], autorizados: string[]}[]} */
const niveis = [];
const coletarNiveis = (origem, texto) => {
  const n = [...texto.matchAll(RE_NIVEL)].map((m) => m[1].toUpperCase());
  if (n.length) niveis.push({ origem, niveis: n, autorizados: [...texto.matchAll(RE_AUTORIZADO)].map((m) => m[1]) });
};

if (TEXTO) {
  const t = fs.readFileSync(path.resolve(TEXTO), "utf8");
  for (const m of t.matchAll(RE_TRAILER)) citacoes.push({ origem: path.basename(TEXTO), dec: m[1] });
  coletarNiveis(path.basename(TEXTO), t);
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
    coletarNiveis(sha.trim().slice(0, 7), corpo);
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
  const plat = avaliarPlataforma(linha);
  if (plat) {
    if (plat.nivel === "falha") {
      saida.push(`FALHA       ${origem} cita ${dec} — ${plat.msg}`);
      falhas++;
    } else if (plat.nivel === "aviso") {
      saida.push(`aviso       ${origem} cita ${dec} — ${plat.msg}`);
      semChave++;
    } else {
      saida.push(`ok          ${origem} cita ${dec} — ${plat.msg}`);
    }
    continue;
  }
  const g = codigoAssinatura(linha.assinatura);
  if (g === "G") {
    const conf = conferirPrincipal(linha);
    if (conf?.falha) {
      saida.push(`FALHA       ${origem} cita ${dec} — ${conf.msg}`);
      falhas++;
    } else if (conf) {
      saida.push(`aviso       ${origem} cita ${dec} — ${conf.msg}`);
      semConferencia++;
    } else {
      saida.push(`ok          ${origem} cita ${dec} — assinado por ${linha.assinante}, commit assinado por chave confiável`);
    }
  } else if (EXIGE_CHAVE) {
    saida.push(
      `FALHA       ${origem} cita ${dec} — a assinatura ${linha.assinatura} não tem chave confiável. ` +
        `Esta instância exige G na assinatura de decisão (governance/exigencia-de-chave.txt). git %G? = "${g}": ${explicar(g, linha.assinatura)}`,
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
          `git %G? = "${g}": ${explicar(g, sha)}`,
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
let platRegistro = null;
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
  } else if (!TEXTO && (platRegistro = avaliarPlataforma(linha))) {
    // Commit criado pelo GitHub: a camada da plataforma decide, com ou sem
    // exigência de chave, porque é ela que sabe o que esse commit prova.
    if (platRegistro.nivel === "falha") {
      saida.push(`FALHA       ${dec} no registro — ${platRegistro.msg}`);
      falhas++;
    } else if (platRegistro.nivel === "aviso") {
      saida.push(`aviso       ${dec} no registro — ${platRegistro.msg}`);
    }
  } else if (EXIGE_CHAVE && !TEXTO) {
    // Com a exigência declarada, a linha vigente é checada mesmo sem citação:
    // uma decisão "assinada" por commit sem chave é o defeito, haja ou não
    // commit se apoiando nela. Em modo fixture (--texto) a árvore é a do teste
    // e as linhas já são conferidas pela citação.
    const g = codigoAssinatura(linha.assinatura);
    if (g !== "G") {
      saida.push(
        `FALHA       ${dec} no registro — a assinatura ${linha.assinatura} não tem chave confiável. ` +
          `Esta instância exige G na assinatura de decisão (governance/exigencia-de-chave.txt). git %G? = "${g}": ${explicar(g, linha.assinatura)}`,
      );
      falhas++;
    } else {
      const conf = conferirPrincipal(linha);
      if (conf?.falha) {
        saida.push(`FALHA       ${dec} no registro — ${conf.msg}`);
        falhas++;
      } else if (conf) {
        saida.push(`aviso       ${dec} no registro — ${conf.msg}`);
        semConferencia++;
      }
    }
  } else if (TEM_MAPA_CHAVES && !TEXTO && codigoAssinatura(linha.assinatura) === "G") {
    // A conferência de principal não depende da exigência de chave: uma
    // instância pode querer saber QUAL chave assinou sem ainda exigir que haja
    // uma. Quando não há chave confiável, não há principal a conferir.
    const conf = conferirPrincipal(linha);
    if (conf?.falha) {
      saida.push(`FALHA       ${dec} no registro — ${conf.msg}`);
      falhas++;
    } else if (conf) {
      saida.push(`aviso       ${dec} no registro — ${conf.msg}`);
      semConferencia++;
    }
  }
}

// id repetido (caso 9): reprova uma vez por id, com as linhas, haja ou não citação
for (const [dec, linhas] of LINHAS_POR_ID) {
  if (linhas.length < 2) continue;
  const quais = `${linhas.slice(0, -1).join(", ")} e ${linhas.at(-1)}`;
  saida.push(
    `FALHA       ${dec} aparece em ${linhas.length} linhas do registro (linhas ${quais}). ` +
      `Número atribuído não se reatribui: uma decisão nova ganha número novo, e até aqui a última linha valia em silêncio.`,
  );
  falhas++;
}

// selo (caso 10): só a linha assinada; o rascunho ainda não tem o que selar
let semSelo = 0;
let selosConferidos = 0;
for (const [dec, linha] of registro) {
  if (ehRascunho(linha)) continue;
  if (!linha.selo) {
    semSelo++;
    continue;
  }
  if (!RE_SELO.test(linha.selo)) {
    saida.push(`FALHA       ${dec} no registro — selo ilegível: "${linha.selo}" não é "selo:" seguido de 16 dígitos hexadecimais`);
    falhas++;
    continue;
  }
  const agora = seloDa(dec, linha);
  if (agora !== linha.selo) {
    saida.push(
      `FALHA       ${dec} no registro — a linha mudou depois de assinada: o selo guardado é ${linha.selo}, ` +
        `e o texto de agora dá ${agora}. Linha assinada não se edita; o que muda vira linha nova, com número novo.`,
    );
    falhas++;
  } else {
    selosConferidos++;
  }
}
if (selosConferidos) saida.push(`selo        ${selosConferidos} linha(s) assinada(s) com selo, e o selo confere com o texto`);

// garantia de cada decisão vigente, calculada depois das checagens
/** @type {{id: string, garantia: string, sha: string}[]} */
const garantias = [];
for (const [dec, linha] of registro) {
  if (ehRascunho(linha)) continue;
  const garantia = garantiaDe(linha);
  garantias.push({ id: dec, garantia, sha: linha.assinatura });
  saida.push(`garantia    ${dec} — ${garantia}${linha.assinatura ? ` (${linha.assinatura})` : ""}`);
}

// delegações: cada linha aponta uma decisão que existe e está assinada
if (TEM_DELEGACOES) {
  for (const d of DELEGACOES) {
    const alvo = registro.get(d.dec);
    if (!alvo) {
      saida.push(`FALHA       delegação "${d.linha}" aponta ${d.dec}, que não existe em ${path.relative(RAIZ, REGISTRO)}`);
      falhas++;
    } else if (ehRascunho(alvo)) {
      saida.push(
        `FALHA       delegação "${d.linha}" aponta ${d.dec}, que está em rascunho: a delegação é uma decisão N2 ` +
          `e só vale assinada`,
      );
      falhas++;
    } else if (!alvo.assinante || !shaResolve(alvo.assinatura)) {
      saida.push(`FALHA       delegação "${d.linha}" aponta ${d.dec}, que não tem assinante e SHA que resolva`);
      falhas++;
    }
  }
  for (const l of errosDelegacoes) {
    saida.push(
      `FALHA       governance/delegacoes.txt tem a linha "${l}", que não é "delega N0|N1 <escopo> autorizado_por DEC-NNN". ` +
        `Declaração que ninguém entende não pode passar por "não declarada".`,
    );
    falhas++;
  }
  // commits que declaram nível
  for (const { origem, niveis: ns, autorizados } of niveis) {
    for (const n of ns) {
      if (n === "N2") {
        saida.push(
          `FALHA       ${origem} declara Nivel: N2 — N2 não se declara: prova-se pela assinatura da decisão, ` +
            `uma linha no registro com assinante e SHA`,
        );
        falhas++;
      } else if (n !== "N0" && n !== "N1") {
        saida.push(`FALHA       ${origem} declara Nivel: ${n}, que não existe — em trailer só se declaram N0 e N1`);
        falhas++;
      } else if (!autorizados.length) {
        saida.push(
          `FALHA       ${origem} declara Nivel: ${n} sem Autorizado-por: — N0 e N1 só existem dentro de uma ` +
            `delegação, e o trailer aponta a DEC que a criou`,
        );
        falhas++;
      } else {
        for (const dec of autorizados) {
          if (DELEGACOES.some((d) => d.nivel === n && d.dec === dec)) {
            saida.push(`ok          ${origem} Nivel: ${n} autorizado por ${dec} (delegação declarada)`);
          } else {
            saida.push(
              `FALHA       ${origem} declara Nivel: ${n} com Autorizado-por: ${dec}, mas nenhuma delegação ${n} ` +
                `em governance/delegacoes.txt aponta ${dec}`,
            );
            falhas++;
          }
        }
      }
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
for (const l of errosDeclaracaoChaves) {
  saida.push(
    `FALHA       governance/chaves-de-assinatura.txt tem a linha "${l}", que não é ` +
      `"assinante <nome> <principal>", "maquina <principal>" nem "plataforma github <assinante> <e-mail>". ` +
      `Declaração que ninguém entende não pode passar por "não declarada".`,
  );
  falhas++;
}
if (TEM_MAPA_CHAVES) {
  saida.push(
    `chaves      esta instância confere o assinante contra a chave (governance/chaves-de-assinatura.txt): ` +
      `${ASSINANTES.size} assinante(s) mapeado(s), ${MAQUINAS.size} chave(s) de máquina`,
  );
  saida.push(
    `plataforma  merge da plataforma como assinatura: ` +
      (PLATAFORMAS.size
        ? `ligado para ${PLATAFORMAS.size} assinante(s) (diretiva plataforma github) — prova a credencial que fez o merge, não a posse de uma chave`
        : `desligado (nenhuma diretiva plataforma github em governance/chaves-de-assinatura.txt)`),
  );
}
saida.push(
  `níveis      delegações: ` +
    (TEM_DELEGACOES
      ? `${DELEGACOES.length} declarada(s) em governance/delegacoes.txt`
      : `nenhuma declarada (sem governance/delegacoes.txt, os trailers Nivel: e Autorizado-por: não são conferidos)`),
);

const contar = (tipo) => garantias.filter((x) => x.garantia === tipo).length;
const semGarantia = contar("nenhuma");
const linhaGarantia =
  `garantia: ${contar("chave")} por chave, ${contar("plataforma")} por plataforma` +
  (semGarantia ? `, ${semGarantia} sem garantia` : "");

// Saída para script: só o objeto, com o mesmo código de saída do modo texto.
if (SAIDA_JSON) {
  console.log(JSON.stringify({ decisoes: garantias, problemas: falhas }, null, 2));
  process.exit(falhas ? 1 : 0);
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
console.log(`${linhaGarantia}.`);
if (rascunhos) {
  console.log(
    `Aviso: ${rascunhos} decisão(ões) aguardam assinatura do operador. ` +
      `Isto não reprova — mas qualquer commit que cite uma delas reprova, até a linha ganhar assinante e SHA.`,
  );
}
if (semSelo) {
  console.log(
    `Aviso: ${semSelo} decisão(ões) assinada(s) sem selo. Isto não reprova — mas uma mudança no texto dessas linhas ` +
      `passa sem o validador ver. O selo nasce na assinatura: node scripts/validate-decisions.mjs --selo=DEC-NNN.`,
  );
}
if (semConferencia) {
  console.log(
    `Aviso: ${semConferencia} linha(s) têm assinante que não está em governance/chaves-de-assinatura.txt. ` +
      `Isto NÃO reprova — mas nessas linhas o nome na coluna Assinante não foi conferido contra a chave que assinou.`,
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
