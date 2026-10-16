// ficha-release.mjs — gera e confere a ficha da release (esquema shizune.release/v1).
//
// uso: node scripts/ficha-release.mjs --tag vX.Y.Z --now <degrau> [--date AAAA-MM-DD] [--chain <estado>]
//      node scripts/ficha-release.mjs --check <arquivo> --tag vX.Y.Z [--json]
//      node scripts/ficha-release.mjs --schema
//      (todos aceitam --arvore=<dir>; o padrão é o diretório atual)
//
// A release é a fonte, os sites são cópias. Cada release leva anexado um
// shizune-release.json, e a cadeia que atualiza os sites lê só esse arquivo.
// Como o anexo pode ser trocado por quem tem escrita no repositório, a ficha é
// conferida antes de qualquer site confiar nela:
//   1. passa no esquema, que é fechado em todos os níveis (campo fora da lista
//      reprova no topo, em package, em chain, nas afirmações e nos degraus) e
//      pede exatamente os seis degraus, cada um uma vez;
//   2. o sha da ficha é o commit para o qual a tag aponta;
//   3. esse commit tem assinatura G no ambiente que confere.
// Uma afirmação medida em outro SHA não reprova a ficha: sai marcada como
// desatualizada, e cada página mostra isso por afirmação.
//
// Gerar mede no próprio clone e só no commit da tag: o HEAD tem de ser esse
// commit, e nenhum arquivo versionado pode estar modificado. A ficha só vai
// para a saída padrão se passar na mesma conferência. O andamento vai para a
// saída de erro, para que `> shizune-release.json` grave só o JSON.
//
// O esquema é conferido por código escrito à mão, sem biblioteca: o pacote não
// tem dependências. `--schema` imprime o mesmo esquema em JSON Schema, para
// quem quiser conferir com outra ferramenta.
//
// Nada aqui acessa a rede. Uma afirmação que roda contra o GitHub
// (runs_against: github) passa na conferência, mas este script não a mede.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Os seis degraus, na ordem. Os nomes em inglês e em português vivem nos sites;
// aqui só o id, que muda apenas por decisão assinada.
const DEGRAUS = [
  "agent-signs-for-owner",
  "poisoned-index-or-memory",
  "forged-attestation",
  "tampered-generated-rules",
  "approval-on-autopilot",
  "long-lived-leaked-key",
];
const ESTADOS = ["done", "now", "todo", "blocked"];
const SHA40 = "^[0-9a-f]{40}$";

const ESQUEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "shizune.release/v1",
  title: "Shizune release card",
  description: "Attached to each release as shizune-release.json. It is the only source the sites read.",
  type: "object",
  required: ["schema", "version", "tag", "date", "sha", "changelog", "package", "evidence", "steps", "chain"],
  additionalProperties: false,
  properties: {
    schema: { const: "shizune.release/v1" },
    version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
    tag: { type: "string", pattern: "^v\\d+\\.\\d+\\.\\d+$" },
    date: { type: "string", format: "date" },
    sha: { type: "string", pattern: SHA40, description: "The commit the tag points to." },
    changelog: { type: "string", description: "Anchor of the release section in CHANGELOG.md." },
    package: {
      type: "object",
      required: ["files", "command"],
      additionalProperties: false,
      properties: {
        files: { type: "integer" },
        command: { type: "string" },
      },
    },
    evidence: {
      type: "array",
      description: "Each id at most once. A claim whose sha differs from the release sha is outdated, not invalid.",
      items: {
        type: "object",
        required: ["id", "value", "command", "sha", "measured_at"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$" },
          value: { type: ["integer", "string"] },
          command: { type: "string" },
          sha: { type: "string", pattern: SHA40 },
          measured_at: { type: "string", format: "date" },
          capture: { type: "string", description: "Captured output, unedited, when a page shows the output." },
          runs_against: { enum: ["clone", "github"] },
        },
      },
    },
    steps: {
      type: "array",
      description: "Exactly the six steps, each id once.",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        required: ["id", "state"],
        additionalProperties: false,
        properties: {
          id: { enum: DEGRAUS },
          state: { enum: ESTADOS },
          proof: { type: "string", description: "Public link to the published proof, when there is one." },
        },
      },
    },
    chain: {
      type: "object",
      required: ["state"],
      additionalProperties: false,
      properties: {
        state: { enum: ESTADOS },
      },
    },
  },
};

const POR_QUE = {
  N: "o commit não tem assinatura",
  B: "a assinatura não confere com o conteúdo do commit",
  U: "a assinatura é boa, mas a chave não está entre as confiáveis deste ambiente",
  E: "não deu para verificar neste ambiente: falta a chave pública ou a lista de assinantes (gpg.ssh.allowedSignersFile)",
  X: "a assinatura expirou",
  Y: "a chave que assinou expirou",
  R: "a chave que assinou foi revogada",
};

const NOME_TIPO = {
  object: "objeto",
  array: "lista",
  string: "texto",
  integer: "inteiro",
  number: "número fracionário",
  boolean: "booleano",
  null: "null",
};

const curto = (sha) => String(sha).slice(0, 7);
const junta = (caminho, k) => (caminho ? `${caminho}.${k}` : k);

function git(arvore, ...args) {
  return execFileSync("git", ["-C", arvore, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).replace(/\s+$/, "");
}

function resolverTag(tag, arvore) {
  try {
    return git(arvore, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  } catch {
    return null;
  }
}

// Sem o programa que confere assinatura SSH, o git responde B ("assinatura
// ruim") e escreve "cannot spawn" na saída de erro. Medido em 2026-10-15, num
// ambiente sem ssh-keygen: a conferência levou um B falso, e a mensagem culpava
// a assinatura. Aqui a saída de erro é lida, e, se ela não disser nada, o
// programa configurado é posto para rodar. O ambiente só é culpado quando a
// assinatura é SSH e o programa de fato não roda.
function verificarAssinatura(arvore, commit) {
  const r = spawnSync("git", ["-C", arvore, "log", "-1", "--format=%G?", commit], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const letra = (r.stdout || "").trim();
  if (letra === "G") return { letra, semPrograma: false, programa: "" };

  const ssh = git(arvore, "cat-file", "commit", commit).includes("-----BEGIN SSH SIGNATURE-----");
  let programa = "ssh-keygen";
  try {
    programa = git(arvore, "config", "--get", "gpg.ssh.program") || programa;
  } catch {
    /* sem configuração: o git usa o ssh-keygen do PATH */
  }
  let semPrograma = /cannot spawn/i.test(r.stderr || "");
  if (ssh && !semPrograma) {
    // `-?` só imprime o uso e sai: não gera chave nem toca arquivo nenhum.
    const t = spawnSync(programa, ["-?"], { stdio: "ignore" });
    semPrograma = Boolean(t.error && t.error.code === "ENOENT");
  }
  return { letra, semPrograma: ssh && semPrograma, programa };
}

function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function dataValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function dataDeHoje() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// Confere o subconjunto de JSON Schema que o ESQUEMA acima usa: const, enum,
// type, pattern, format date, minItems, maxItems, items, required, properties e
// additionalProperties: false. Uma palavra nova no ESQUEMA exige código novo aqui.
function checar(v, e, caminho, problemas) {
  const onde = caminho || "(raiz)";
  const p = (mensagem) => problemas.push({ tipo: "esquema", caminho: onde, mensagem: `${onde}: ${mensagem}` });
  if (Object.hasOwn(e, "const") && v !== e.const) return p(`tem de ser "${e.const}"`);
  if (e.enum && !e.enum.includes(v)) return p(`${JSON.stringify(v)} não está entre ${e.enum.join(", ")}`);
  if (e.type) {
    const aceitos = [].concat(e.type);
    const t = tipoDe(v);
    if (!aceitos.includes(t)) {
      return p(`esperava ${aceitos.map((x) => NOME_TIPO[x]).join(" ou ")}, veio ${NOME_TIPO[t] || t}`);
    }
  }
  if (typeof v === "string") {
    if (e.pattern && !new RegExp(e.pattern).test(v)) return p(`"${v}" não tem o formato ${e.pattern}`);
    if (e.format === "date" && !dataValida(v)) return p(`"${v}" não é uma data AAAA-MM-DD que exista`);
  }
  if (Array.isArray(v)) {
    if (e.minItems !== undefined && e.minItems === e.maxItems) {
      if (v.length !== e.minItems) p(`tem ${v.length} itens; o esquema pede exatamente ${e.minItems}`);
    } else {
      if (e.minItems !== undefined && v.length < e.minItems) p(`tem ${v.length} itens; o esquema pede no mínimo ${e.minItems}`);
      if (e.maxItems !== undefined && v.length > e.maxItems) p(`tem ${v.length} itens; o esquema pede no máximo ${e.maxItems}`);
    }
    if (e.items) v.forEach((item, i) => checar(item, e.items, `${caminho}[${i}]`, problemas));
  }
  if (tipoDe(v) === "object") {
    for (const k of e.required || []) {
      if (!Object.hasOwn(v, k)) {
        problemas.push({ tipo: "esquema", caminho: junta(caminho, k), mensagem: `${junta(caminho, k)}: campo obrigatório ausente` });
      }
    }
    for (const k of Object.keys(v)) {
      if (e.properties && Object.hasOwn(e.properties, k)) checar(v[k], e.properties[k], junta(caminho, k), problemas);
      else if (e.additionalProperties === false) {
        problemas.push({ tipo: "esquema", caminho: junta(caminho, k), mensagem: `${junta(caminho, k)}: campo fora do esquema` });
      }
    }
  }
}

// O que o JSON Schema não diz sozinho: cada degrau uma vez, cada afirmação uma vez.
function repetidos(lista, caminho, nome, problemas) {
  if (!Array.isArray(lista)) return;
  const conta = new Map();
  for (const item of lista) {
    const id = item && item.id;
    if (typeof id === "string") conta.set(id, (conta.get(id) || 0) + 1);
  }
  for (const [id, n] of conta) {
    if (n > 1) problemas.push({ tipo: "esquema", caminho, mensagem: `${caminho}: ${nome} "${id}" aparece ${n} vezes` });
  }
}

function conferirFicha(f, tag, arvore) {
  const problemas = [];
  checar(f, ESQUEMA, "", problemas);
  const obj = tipoDe(f) === "object" ? f : {};
  repetidos(obj.steps, "steps", "o degrau", problemas);
  repetidos(obj.evidence, "evidence", "a afirmação", problemas);

  if (typeof obj.tag === "string" && obj.tag !== tag) {
    problemas.push({ tipo: "tag", caminho: "tag", mensagem: `tag: a ficha diz "${obj.tag}", a conferência pediu "${tag}"` });
  }
  if (typeof obj.version === "string" && typeof obj.tag === "string" && `v${obj.version}` !== obj.tag) {
    problemas.push({ tipo: "tag", caminho: "version", mensagem: `version: "${obj.version}" não corresponde à tag "${obj.tag}"` });
  }

  let commit = resolverTag(tag, arvore);
  let letra = null;
  if (!commit) {
    problemas.push({ tipo: "tag", caminho: "tag", mensagem: `a tag ${tag} não existe nesta árvore` });
  } else {
    if (typeof obj.sha === "string" && obj.sha !== commit) {
      problemas.push({ tipo: "sha", caminho: "sha", mensagem: `sha: a ficha diz ${curto(obj.sha)}, a tag ${tag} aponta para ${curto(commit)}` });
    }
    const v = verificarAssinatura(arvore, commit);
    letra = v.letra;
    if (letra !== "G" && v.semPrograma) {
      problemas.push({
        tipo: "ambiente",
        caminho: "sha",
        mensagem:
          `ambiente sem ssh-keygen: o commit da tag (${curto(commit)}) tem assinatura SSH, e o programa ` +
          `que a confere não roda neste ambiente (${v.programa}). O git responde ${letra}, mas isso não diz ` +
          "nada sobre a assinatura. Instale o OpenSSH, ou aponte gpg.ssh.program, e confira de novo.",
      });
    } else if (letra !== "G") {
      problemas.push({
        tipo: "assinatura",
        caminho: "sha",
        mensagem: `o commit da tag (${curto(commit)}) dá %G? = ${letra}: ${POR_QUE[letra] || "assinatura não confiável"}`,
      });
    }
  }

  const desatualizadas = Array.isArray(obj.evidence)
    ? obj.evidence
        .filter((e) => e && typeof e.sha === "string" && typeof obj.sha === "string" && e.sha !== obj.sha)
        .map((e) => ({ id: e.id, sha: e.sha }))
    : [];
  return { problemas, desatualizadas, commit, letra, afirmacoes: Array.isArray(obj.evidence) ? obj.evidence.length : 0, sha: obj.sha };
}

function modoCheck(arquivo, tag, arvore, comoJson) {
  let ficha;
  let r;
  try {
    const texto = fs.readFileSync(arquivo, "utf8");
    // Um BOM no começo não é conteúdo: sai antes da leitura, comparado pelo código.
    ficha = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);
  } catch (e) {
    r = {
      problemas: [{ tipo: "leitura", caminho: "(arquivo)", mensagem: `não deu para ler a ficha como JSON: ${e.message}` }],
      desatualizadas: [],
    };
  }
  if (!r) r = conferirFicha(ficha, tag, arvore);
  const aprovada = r.problemas.length === 0;

  if (comoJson) {
    const saida = { ok: aprovada, tag, problemas: r.problemas, desatualizadas: r.desatualizadas.map((d) => d.id) };
    process.stdout.write(`${JSON.stringify(saida, null, 2)}\n`);
    process.exit(aprovada ? 0 : 1);
  }

  const tem = (...tipos) => r.problemas.some((p) => tipos.includes(p.tipo));
  console.log(`ficha-release — conferência contra a tag ${tag}\n`);
  if (!tem("leitura")) {
    if (!tem("esquema")) console.log("  ok    esquema shizune.release/v1");
    if (!tem("tag", "sha") && r.commit) console.log(`  ok    o sha da ficha é o commit da tag (${curto(r.commit)})`);
    if (!tem("assinatura") && r.commit) console.log("  ok    o commit da tag tem assinatura G");
  }
  for (const p of r.problemas) console.log(`  FALHA ${p.mensagem}`);
  for (const d of r.desatualizadas) {
    console.log(`  desatualizada  ${d.id}: medida em ${curto(d.sha)}; a release é ${curto(r.sha)}`);
  }
  if (aprovada) {
    const n = r.desatualizadas.length;
    const velhas = n === 0 ? "nenhuma desatualizada" : n === 1 ? "1 desatualizada" : `${n} desatualizadas`;
    console.log(`\nResultado: OK — a ficha confere com a tag ${tag}; ${r.afirmacoes} afirmações, ${velhas}.`);
  } else {
    console.log(`\nResultado: FALHA — ${r.problemas.length} problema(s) na ficha da tag ${tag}.`);
  }
  process.exit(aprovada ? 0 : 1);
}

// Âncora que o GitHub gera para o título da seção: minúsculas, sem pontuação,
// cada espaço vira hífen. "[0.5.0] - 2026-10-16" vira "050---2026-10-16".
function ancoraDoChangelog(texto, version, recusar) {
  const linha = texto.split(/\r?\n/).find((l) => l.startsWith(`## [${version}]`));
  if (!linha) recusar(`o CHANGELOG.md do commit da tag não tem a seção "## [${version}]"`);
  if (/[‹›]/.test(linha)) recusar(`a seção do CHANGELOG ainda está em aberto: "${linha}". Ponha a data antes de gerar a ficha.`);
  const slug = linha
    .replace(/^##\s+/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
  return `CHANGELOG.md#${slug}`;
}

function contarAssercoes(fonte) {
  return fonte.split(/\r?\n/).filter((l) => /^\s*ok\(/.test(l)).length;
}

function rodarNoClone(arvore, script) {
  const r = spawnSync(process.execPath, [path.join(arvore, "scripts", script)], { cwd: arvore, encoding: "utf8" });
  return { code: r.status, saida: `${r.stdout || ""}${r.stderr || ""}`.replace(/\r\n/g, "\n").replace(/\s+$/, "") };
}

function modoGerar(o, arvore) {
  const recusar = (msg) => {
    console.error(`ficha-release: ${msg}`);
    process.exit(1);
  };
  if (!DEGRAUS.includes(o.now)) recusar(`--now tem de ser um dos seis degraus: ${DEGRAUS.join(", ")}`);
  if (!ESTADOS.includes(o.chain)) recusar(`--chain tem de ser um destes estados: ${ESTADOS.join(", ")}`);
  if (!dataValida(o.date)) recusar(`--date "${o.date}" não é uma data AAAA-MM-DD que exista`);

  const commit = resolverTag(o.tag, arvore);
  if (!commit) recusar(`a tag ${o.tag} não existe nesta árvore`);
  const head = git(arvore, "rev-parse", "HEAD");
  if (head !== commit) {
    recusar(`o HEAD (${curto(head)}) não é o commit da tag ${o.tag} (${curto(commit)}). Faça checkout da tag antes de gerar.`);
  }
  const modificados = git(arvore, "status", "--porcelain", "--untracked-files=no");
  if (modificados) recusar(`a árvore não está limpa: há arquivo versionado modificado, e a ficha mede o commit da tag.\n${modificados}`);

  const version = o.tag.slice(1);
  const changelog = ancoraDoChangelog(git(arvore, "show", `${commit}:CHANGELOG.md`), version, recusar);
  const arquivos = git(arvore, "ls-tree", "-r", "--name-only", commit).split("\n").filter(Boolean).length;
  const assercoes = contarAssercoes(git(arvore, "show", `${commit}:scripts/test-validate-decisions.mjs`));

  console.error(`ficha-release: medindo ${o.tag} em ${curto(commit)} (teste negativo e doctor)…`);
  const teste = rodarNoClone(arvore, "test-validate-decisions.mjs");
  if (teste.code !== 0) recusar(`o teste negativo falhou neste commit; release com teste vermelho não ganha ficha.\n${teste.saida}`);
  // Um bloco que respondeu n/a passou sem rodar. Medido em 2026-10-15: a ficha
  // da v0.5.0 saiu de um ambiente em que o gpg não gerava chave, e a captura
  // publicada mostrou 81 asserções numa ficha que afirma 107.
  const pulados = teste.saida.split("\n").filter((l) => /^\s*n\/a\s/.test(l));
  if (pulados.length) {
    recusar(
      `o teste negativo pulou ${pulados.length} bloco(s) neste ambiente, e uma captura com bloco pulado ` +
        `não sustenta a contagem de asserções da ficha:\n${pulados.join("\n")}\n` +
        "Gere a ficha num ambiente em que o gpg e o ssh-keygen funcionem (no Windows, o Git Bash).",
    );
  }
  const doctor = rodarNoClone(arvore, "doctor.mjs");
  if (doctor.code !== 0) recusar(`o doctor falhou neste commit; release com doctor vermelho não ganha ficha.\n${doctor.saida}`);
  const resumo = [...doctor.saida.matchAll(/^Resultado: OK — (.+?)\.?[ \t]*$/gm)].pop();
  if (!resumo) recusar('o doctor terminou sem a linha "Resultado: OK — …"');

  const hoje = dataDeHoje();
  const afirmacao = (id, value, command, capture) => ({
    id,
    value,
    command,
    sha: commit,
    measured_at: hoje,
    ...(capture === undefined ? {} : { capture }),
    runs_against: "clone",
  });
  const iNow = DEGRAUS.indexOf(o.now);
  const ficha = {
    schema: "shizune.release/v1",
    version,
    tag: o.tag,
    date: o.date,
    sha: commit,
    changelog,
    package: { files: arquivos, command: "git ls-files | wc -l" },
    evidence: [
      afirmacao("negative-test-assertions", assercoes, "grep -cE '^\\s*ok\\(' scripts/test-validate-decisions.mjs"),
      afirmacao("doctor-summary", resumo[1], "bun scripts/doctor.mjs"),
      afirmacao("package-files", arquivos, "git ls-files | wc -l"),
      afirmacao("negative-test-output", "ok", "bun scripts/test-validate-decisions.mjs", teste.saida),
    ],
    steps: DEGRAUS.map((id, i) => ({ id, state: i < iNow ? "done" : i === iNow ? "now" : "todo" })),
    chain: { state: o.chain },
  };

  const r = conferirFicha(ficha, o.tag, arvore);
  if (r.problemas.length) recusar(`a ficha gerada não passa na conferência:\n${r.problemas.map((p) => `  ${p.mensagem}`).join("\n")}`);
  process.stdout.write(`${JSON.stringify(ficha, null, 2)}\n`);
  console.error(`ficha-release: ok — ${o.tag} em ${curto(commit)}, ${arquivos} arquivos, ${assercoes} asserções, doctor "${resumo[1]}".`);
}

function lerArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const igual = a.indexOf("=");
    if (igual > 0) {
      o[a.slice(2, igual)] = a.slice(igual + 1);
      continue;
    }
    const prox = argv[i + 1];
    if (prox !== undefined && !prox.startsWith("--")) {
      o[a.slice(2)] = prox;
      i++;
    } else o[a.slice(2)] = true;
  }
  return o;
}

function uso(msg) {
  console.error(`ficha-release: ${msg}\n`);
  console.error("uso: node scripts/ficha-release.mjs --tag vX.Y.Z --now <degrau> [--date AAAA-MM-DD] [--chain <estado>]");
  console.error("     node scripts/ficha-release.mjs --check <arquivo> --tag vX.Y.Z [--json]");
  console.error("     node scripts/ficha-release.mjs --schema");
  process.exit(2);
}

const args = lerArgs(process.argv.slice(2));
const arvore = path.resolve(typeof args.arvore === "string" ? args.arvore : process.cwd());

if (args.schema) {
  process.stdout.write(`${JSON.stringify(ESQUEMA, null, 2)}\n`);
  process.exit(0);
}
if (typeof args.tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(args.tag)) uso("--tag vX.Y.Z é obrigatório");
if (args.check !== undefined) {
  if (typeof args.check !== "string") uso("--check pede o caminho da ficha");
  modoCheck(args.check, args.tag, arvore, args.json === true);
} else {
  if (typeof args.now !== "string") uso(`--now pede o degrau em andamento: ${DEGRAUS.join(", ")}`);
  modoGerar(
    {
      tag: args.tag,
      now: args.now,
      date: typeof args.date === "string" ? args.date : dataDeHoje(),
      chain: typeof args.chain === "string" ? args.chain : "todo",
    },
    arvore,
  );
}
