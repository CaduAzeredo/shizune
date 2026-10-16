// test-ficha-release.mjs — teste negativo do ficha-release.mjs.
//
// A ficha da release (shizune-release.json) é o que os sites leem. Ela é um
// arquivo anexado à release, e quem tem escrita no repositório pode trocá-lo.
// Este teste monta fichas com defeito de propósito e exige que a conferência
// recuse cada uma: campo fora do esquema, degraus a menos, a mais ou repetidos,
// sha que não é o da tag e commit da tag sem assinatura G. E exige o contrário
// num caso: uma afirmação medida em outro SHA sai marcada como desatualizada,
// sem reprovar a ficha.
//
// Roda sozinho, sem rede e sem tocar o repositório real: cria uma árvore git
// descartável em os.tmpdir(), com uma chave SSH gerada ali, e apaga no fim.
// Sem ssh-keygen ou sem git com assinatura SSH, o teste se declara n/a.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SCRIPT = path.join(AQUI, "ficha-release.mjs");

// Os seis degraus, escritos aqui à mão de propósito: o teste não lê a lista do
// script que ele confere.
const DEGRAUS = [
  "agent-signs-for-owner",
  "poisoned-index-or-memory",
  "forged-attestation",
  "tampered-generated-rules",
  "approval-on-autopilot",
  "long-lived-leaked-key",
];

let falhas = 0;
const ok = (cond, msg) => {
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ficha-test-"));
const repo = path.join(tmp, "repo");
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
const gitSai = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const escrever = (rel, conteudo) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), conteudo, "utf8");
};

function rodar(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, `--arvore=${repo}`], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", saida: (r.stdout || "") + (r.stderr || "") };
}

function conferir(ficha, tag) {
  const f = path.join(tmp, "ficha.json");
  fs.writeFileSync(f, typeof ficha === "string" ? ficha : JSON.stringify(ficha, null, 2), "utf8");
  const r = rodar("--check", f, "--tag", tag, "--json");
  let json = null;
  try {
    json = JSON.parse(r.out);
  } catch {
    /* json fica null e as asserções abaixo acusam */
  }
  return { ...r, json, problemas: json ? json.problemas : [], desatualizadas: json ? json.desatualizadas : [] };
}

const so = (r, tipo, caminho) =>
  r.code === 1 && r.problemas.length === 1 && r.problemas[0].tipo === tipo && (caminho === undefined || r.problemas[0].caminho === caminho);

try {
  fs.mkdirSync(repo);
  git("init", "-q");
  git("config", "user.email", "pessoa@teste");
  git("config", "user.name", "Pessoa");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");

  const chaveOk = (() => {
    try {
      execFileSync("ssh-keygen", ["-t", "ed25519", "-f", path.join(tmp, "pessoa"), "-N", "", "-C", "pessoa@teste", "-q"], {
        stdio: "ignore",
      });
      const pub = fs.readFileSync(path.join(tmp, "pessoa.pub"), "utf8").trim();
      fs.writeFileSync(path.join(tmp, "signers"), `pessoa@teste ${pub}\n`, "utf8");
      const p = (x) => path.join(tmp, x).replace(/\\/g, "/");
      git("config", "gpg.format", "ssh");
      git("config", "gpg.ssh.allowedSignersFile", p("signers"));
      git("config", "user.signingkey", p("pessoa.pub"));
      return true;
    } catch {
      return false;
    }
  })();

  if (!chaveOk) {
    console.log("  n/a   ssh-keygen ausente ou git sem suporte a assinatura SSH — teste não executado");
    process.exitCode = 0;
  } else {
    // Árvore de mentira: um teste negativo com 3 asserções, um doctor que
    // responde com n/a e um CHANGELOG com a seção de cada tag.
    escrever(
      "scripts/test-validate-decisions.mjs",
      [
        'const ok = (c, m) => console.log(c ? `  ok    ${m}` : `  FALHA ${m}`);',
        'ok(true, "primeira");',
        'ok(true, "segunda");',
        'ok(true, "terceira");',
        'console.log("\\ntest-validate-decisions: tudo passou.");',
        "",
      ].join("\n"),
    );
    escrever("scripts/doctor.mjs", 'console.log("  OK    etapa de mentira\\n\\nResultado: OK — 3 passaram, 1 n/a.");\n');
    escrever("CHANGELOG.md", "# Changelog\n\n## [9.9.8] - 2026-10-14\n\n- antes\n");
    git("add", "-A");
    git("commit", "-q", "-m", "commit sem assinatura");
    git("tag", "v9.9.8");
    const SHA_A = gitSai("rev-parse", "HEAD");

    escrever(
      "CHANGELOG.md",
      "# Changelog\n\n## [9.9.10] - ‹data da release›\n\n- depois\n\n## [9.9.9] - 2026-10-15\n\n- agora\n\n## [9.9.8] - 2026-10-14\n\n- antes\n",
    );
    git("add", "-A");
    git("commit", "-q", "-S", "-m", "commit assinado");
    git("tag", "v9.9.9");
    git("tag", "v9.9.10");
    const SHA_B = gitSai("rev-parse", "HEAD");
    const ARQUIVOS_B = gitSai("ls-tree", "-r", "--name-only", SHA_B).split("\n").length;

    // Guarda: se o git não estiver de fato verificando, nada abaixo prova nada.
    ok(gitSai("log", "-1", "--format=%G?", SHA_B) === "G", "o commit assinado verifica como G");
    ok(gitSai("log", "-1", "--format=%G?", SHA_A) === "N", "o commit sem assinatura verifica como N");

    const valida = () => ({
      schema: "shizune.release/v1",
      version: "9.9.9",
      tag: "v9.9.9",
      date: "2026-10-15",
      sha: SHA_B,
      changelog: "CHANGELOG.md#999---2026-10-15",
      package: { files: ARQUIVOS_B, command: "git ls-files | wc -l" },
      evidence: [
        { id: "package-files", value: ARQUIVOS_B, command: "git ls-files | wc -l", sha: SHA_B, measured_at: "2026-10-15", runs_against: "clone" },
        { id: "doctor-summary", value: "3 passaram, 1 n/a", command: "bun scripts/doctor.mjs", sha: SHA_B, measured_at: "2026-10-15" },
      ],
      steps: DEGRAUS.map((id, i) => ({ id, state: i === 0 ? "done" : i === 1 ? "now" : "todo" })),
      chain: { state: "todo" },
    });

    console.log("\n[controle] uma ficha válida passa\n");

    let r = conferir(valida(), "v9.9.9");
    ok(r.code === 0 && r.json && r.json.ok === true, "a ficha válida passa (código 0, ok: true)");
    ok(
      r.json !== null && Array.isArray(r.json.problemas) && r.problemas.length === 0 && r.desatualizadas.length === 0,
      "a ficha válida não tem problema nem afirmação desatualizada",
    );
    const rTexto = rodar("--check", path.join(tmp, "ficha.json"), "--tag", "v9.9.9");
    ok(rTexto.code === 0 && /Resultado: OK/.test(rTexto.out), "no modo texto, a ficha válida termina em \"Resultado: OK\"");
    // Editor de Windows grava a marca de ordem de bytes no começo do arquivo. O
    // caractere entra por código, nunca escrito, para não sumir num editor.
    r = conferir(String.fromCharCode(0xfeff) + JSON.stringify(valida(), null, 2), "v9.9.9");
    ok(r.code === 0 && r.problemas.length === 0, "a ficha gravada com BOM passa (código 0)");

    console.log("\n[esquema] campo extra, um lugar por vez\n");

    let f = valida();
    f.extra = 1;
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "extra"), "recusou campo extra no topo, e só isso");

    f = valida();
    f.package.extra = 1;
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "package.extra"), "recusou campo extra em package, e só isso");

    f = valida();
    f.chain.extra = 1;
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "chain.extra"), "recusou campo extra em chain, e só isso");

    f = valida();
    f.evidence[0].extra = 1;
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "evidence[0].extra"), "recusou campo extra numa afirmação, e só isso");

    console.log("\n[esquema] os seis degraus\n");

    f = valida();
    f.steps = f.steps.slice(0, 5);
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "steps"), "recusou steps com 5 itens, e só isso");
    ok(/5 itens/.test(r.problemas[0]?.mensagem || ""), "disse quantos itens vieram");

    f = valida();
    f.steps.push({ id: DEGRAUS[5], state: "todo" });
    r = conferir(f, "v9.9.9");
    ok(r.code === 1 && r.problemas.some((p) => p.caminho === "steps" && /7 itens/.test(p.mensagem)), "recusou steps com 7 itens");

    f = valida();
    f.steps[5] = { id: DEGRAUS[4], state: "todo" };
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "steps"), "recusou degrau repetido com 6 itens, e só isso");
    ok(new RegExp(DEGRAUS[4]).test(r.problemas[0]?.mensagem || ""), "nomeou o degrau repetido");

    f = valida();
    f.steps[2].state = "talvez";
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "steps[2].state"), "recusou estado fora da lista");

    console.log("\n[esquema] formatos\n");

    f = valida();
    f.date = "2026-02-30";
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "date"), "recusou data que não existe no calendário");

    f = valida();
    f.evidence[1].id = "package-files";
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "evidence"), "recusou duas afirmações com o mesmo id");

    f = valida();
    delete f.chain;
    r = conferir(f, "v9.9.9");
    ok(so(r, "esquema", "chain"), "recusou ficha sem chain");

    r = conferir("{ isto não é json", "v9.9.9");
    ok(so(r, "leitura"), "recusou arquivo que não é JSON");

    console.log("\n[tag] a ficha tem de ser a da tag conferida\n");

    f = valida();
    f.sha = SHA_A;
    r = conferir(f, "v9.9.9");
    ok(so(r, "sha", "sha"), "recusou sha que não é o commit da tag, e só isso");

    f = valida();
    r = conferir(f, "v9.9.8");
    ok(r.code === 1 && r.problemas.some((p) => p.tipo === "tag" && p.caminho === "tag"), "recusou ficha de uma tag conferida contra outra");

    f = valida();
    f.version = "9.9.7";
    r = conferir(f, "v9.9.9");
    ok(so(r, "tag", "version"), "recusou version que não corresponde à tag");

    f = { ...valida(), tag: "v9.9.6", version: "9.9.6" };
    r = conferir(f, "v9.9.6");
    ok(so(r, "tag"), "recusou tag que não existe na árvore");

    console.log("\n[assinatura] o commit da tag tem de dar G\n");

    f = { ...valida(), tag: "v9.9.8", version: "9.9.8", sha: SHA_A };
    f.evidence = f.evidence.map((e) => ({ ...e, sha: SHA_A }));
    r = conferir(f, "v9.9.8");
    ok(so(r, "assinatura"), "recusou ficha cujo commit da tag não tem assinatura, e só isso");
    ok(/= N/.test(r.problemas[0]?.mensagem || ""), "disse a letra que o git deu (N)");

    console.log("\n[desatualizada] afirmação medida em outro SHA marca, não reprova\n");

    f = valida();
    f.evidence[0].sha = SHA_A;
    r = conferir(f, "v9.9.9");
    ok(r.code === 0 && r.problemas.length === 0, "a ficha com afirmação antiga passa (código 0)");
    ok(r.desatualizadas.length === 1 && r.desatualizadas[0] === "package-files", "marcou só a afirmação medida em outro SHA");
    fs.writeFileSync(path.join(tmp, "ficha.json"), JSON.stringify(f), "utf8");
    const rVelha = rodar("--check", path.join(tmp, "ficha.json"), "--tag", "v9.9.9");
    ok(/desatualizada/.test(rVelha.out) && /package-files/.test(rVelha.out), "no modo texto, a linha diz desatualizada e nomeia a afirmação");

    console.log("\n[ambiente] sem o programa que confere SSH, a culpa é do ambiente, e não da assinatura\n");

    // Sem o ssh-keygen, o git responde B ("assinatura ruim") e escreve "cannot
    // spawn" na saída de erro. Medido em 2026-10-15: a verificação daquele dia
    // levou um B falso por isso. Aqui o programa some por configuração do
    // repositório de teste, apontada para um caminho que não existe.
    git("config", "gpg.ssh.program", path.join(tmp, "nao-existe", "ssh-keygen").replace(/\\/g, "/"));
    r = conferir(valida(), "v9.9.9");
    ok(so(r, "ambiente"), "sem ssh-keygen, o único problema apontado é do ambiente");
    ok(/ambiente sem ssh-keygen/.test(r.problemas[0]?.mensagem || ""), 'a mensagem diz "ambiente sem ssh-keygen"');
    ok(!/não confere/.test(r.saida), "não diz que a assinatura não confere");
    git("config", "--unset", "gpg.ssh.program");
    r = conferir(valida(), "v9.9.9");
    ok(r.code === 0 && r.problemas.length === 0, "com o programa de volta, a mesma ficha passa");

    console.log("\n[esquema publicado] --schema imprime o esquema fechado\n");

    const rS = spawnSync(process.execPath, [SCRIPT, "--schema"], { encoding: "utf8" });
    let esquema = null;
    try {
      esquema = JSON.parse(rS.stdout);
    } catch {
      /* acusado abaixo */
    }
    ok(esquema && esquema.$id === "shizune.release/v1", "--schema imprime JSON com $id shizune.release/v1");
    ok(
      esquema &&
        esquema.additionalProperties === false &&
        esquema.properties.package.additionalProperties === false &&
        esquema.properties.chain.additionalProperties === false &&
        esquema.properties.evidence.items.additionalProperties === false &&
        esquema.properties.steps.items.additionalProperties === false,
      "additionalProperties: false no topo, em package, em chain, nas afirmações e nos degraus",
    );

    console.log("\n[geração] mede no commit da tag e só sai se passar na conferência\n");

    r = rodar("--tag", "v9.9.9", "--now", "forged-attestation", "--date", "2026-10-15");
    let gerada = null;
    try {
      gerada = JSON.parse(r.out);
    } catch {
      /* acusado abaixo */
    }
    ok(r.code === 0 && gerada !== null, "gerou a ficha da v9.9.9 (código 0, JSON na saída padrão)");
    if (gerada) {
      ok(gerada.sha === SHA_B && gerada.version === "9.9.9" && gerada.date === "2026-10-15", "sha do commit da tag, version e date");
      ok(gerada.changelog === "CHANGELOG.md#999---2026-10-15", "âncora do CHANGELOG no formato do GitHub");
      ok(gerada.package.files === ARQUIVOS_B, `package.files conta os arquivos do commit da tag (${ARQUIVOS_B})`);
      const ev = Object.fromEntries(gerada.evidence.map((e) => [e.id, e]));
      ok(ev["negative-test-assertions"]?.value === 3, "contou as 3 asserções do teste negativo");
      ok(ev["doctor-summary"]?.value === "3 passaram, 1 n/a", "copiou o resumo do doctor sem o ponto final");
      ok(ev["negative-test-output"]?.value === "ok" && /tudo passou/.test(ev["negative-test-output"]?.capture || ""), "capturou a saída do teste negativo");
      ok(gerada.evidence.every((e) => e.sha === SHA_B), "toda afirmação gerada leva o sha da release");
      ok(gerada.steps.map((s) => s.state).join(",") === "done,done,now,todo,todo,todo", "degraus antes do --now ficam done, o --now fica now, os seguintes todo");
      ok(gerada.chain.state === "todo", "chain fica todo por padrão");
      r = conferir(gerada, "v9.9.9");
      ok(r.code === 0 && r.problemas.length === 0, "a ficha gerada passa no --check");
    }

    r = rodar("--tag", "v9.9.8", "--now", "forged-attestation", "--date", "2026-10-15");
    ok(r.code === 1 && r.out === "" && /HEAD/.test(r.err), "recusou gerar quando o HEAD não é o commit da tag");

    r = rodar("--tag", "v9.9.10", "--now", "forged-attestation", "--date", "2026-10-15");
    ok(r.code === 1 && r.out === "" && /‹/.test(r.err), "recusou gerar com a data da seção do CHANGELOG ainda em aberto");

    escrever("CHANGELOG.md", "mexido\n");
    r = rodar("--tag", "v9.9.9", "--now", "forged-attestation", "--date", "2026-10-15");
    ok(r.code === 1 && r.out === "" && /limpa/.test(r.err), "recusou gerar com arquivo versionado modificado");
    git("checkout", "--", "CHANGELOG.md");

    r = rodar("--tag", "v9.9.9", "--now", "degrau-inventado", "--date", "2026-10-15");
    ok(r.code === 1 && r.out === "" && /--now tem de ser um dos seis degraus/.test(r.err), "recusou --now que não é um dos seis degraus");

    // A captura que vai para a ficha não pode ter bloco pulado. Medido em
    // 2026-10-15: a ficha da v0.5.0 foi gerada num ambiente em que o gpg não
    // gerava chave, o bloco [plataforma] virou n/a, e a captura publicada mostrou
    // 81 asserções numa ficha que afirma 107. O teste passou, e a ficha saiu.
    escrever(
      "scripts/test-validate-decisions.mjs",
      [
        'const ok = (c, m) => console.log(c ? `  ok    ${m}` : `  FALHA ${m}`);',
        'ok(true, "primeira");',
        'console.log("  n/a   gpg ausente ou sem gerar chave neste ambiente — bloco não executado");',
        'console.log("\\ntest-validate-decisions: tudo passou.");',
        "",
      ].join("\n"),
    );
    escrever("CHANGELOG.md", "# Changelog\n\n## [9.9.11] - 2026-10-16\n\n- com bloco pulado\n");
    git("add", "-A");
    git("commit", "-q", "-S", "-m", "commit com teste que pula um bloco");
    git("tag", "v9.9.11");
    r = rodar("--tag", "v9.9.11", "--now", "forged-attestation", "--date", "2026-10-16");
    ok(r.code === 1 && r.out === "", "recusou gerar quando o teste negativo pulou um bloco");
    ok(/n\/a/.test(r.err) && /bloco não executado/.test(r.err), "nomeou o bloco que não rodou");
  }
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows às vezes segura o handle; a pasta é temporária de qualquer jeito */
  }
}

console.log(falhas ? `\ntest-ficha-release: ${falhas} falha(s).` : "\ntest-ficha-release: tudo passou.");
process.exit(falhas ? 1 : 0);
