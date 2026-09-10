// test-validate-decisions.mjs — teste negativo do validate-decisions.mjs.
//
// Um validador que nunca reprovou nada é indistinguível de um validador quebrado:
// "0 problemas" tem exatamente a mesma cara de "tudo certo". Este teste monta um
// registro de decisões com defeito de propósito e exige que o validador acuse.
//
// Roda sozinho, sem rede e sem tocar o repositório real: cria uma árvore git
// descartável em os.tmpdir() e apaga no fim.
//
// Nota: new URL(".", import.meta.url) JÁ é o diretório deste arquivo — aplicar
// path.dirname() aqui subiria um nível a mais e apontaria para um script que não
// existe. Esse erro já foi cometido nesta base uma vez.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const VALIDADOR = path.join(AQUI, "validate-decisions.mjs");

let falhas = 0;
const ok = (cond, msg) => {
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dec-test-"));
const git = (...args) => execFileSync("git", ["-C", tmp, ...args], { stdio: "ignore" });

function rodar(registro, texto) {
  const fReg = path.join(tmp, "reg.md");
  const fTxt = path.join(tmp, "msg.txt");
  fs.writeFileSync(fReg, registro, "utf8");
  fs.writeFileSync(fTxt, texto, "utf8");
  const r = spawnSync(process.execPath, [VALIDADOR, `--registro=${fReg}`, `--texto=${fTxt}`, `--arvore=${tmp}`], {
    encoding: "utf8",
  });
  return { code: r.status, saida: (r.stdout || "") + (r.stderr || "") };
}

try {
  git("init", "-q");
  git("config", "user.email", "teste@local");
  git("config", "user.name", "teste");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(tmp, "a.txt"), "conteudo\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "commit base do teste");
  const SHA = execFileSync("git", ["-C", tmp, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();

  const CABECALHO = "| ID | Data | Decisão | Status | Assinante | Assinatura |\n| :-- | :-- | :-- | :-- | :-- | :-- |\n";
  const bom = `${CABECALHO}| DEC-001 | 2026-09-01 | decisão válida | vigente | operador | ${SHA} |\n`;

  console.log("\n[negativo] três classes de defeito, uma por vez\n");

  let r = rodar(bom, "muda coisa\n\nDecision: DEC-999\n");
  ok(r.code === 1, "reprovou commit que cita DEC inexistente (código 1)");
  ok(/DEC-999.*não existe/s.test(r.saida), "explicou que o DEC-999 não existe");

  r = rodar(`${CABECALHO}| DEC-002 | 2026-09-01 | sem assinante | vigente |  | ${SHA} |\n`, "x\n\nDecision: DEC-002\n");
  ok(r.code === 1, "reprovou DEC sem assinante");
  ok(/sem assinante/.test(r.saida), "explicou que falta assinante");

  r = rodar(
    `${CABECALHO}| DEC-003 | 2026-09-01 | sha falso | vigente | operador | deadbeef |\n`,
    "x\n\nDecision: DEC-003\n",
  );
  ok(r.code === 1, "reprovou DEC cuja assinatura não resolve na árvore");
  ok(/não resolve/.test(r.saida), "explicou que o SHA não resolve");

  console.log("\n[positivo] registro e citação corretos\n");

  r = rodar(bom, "muda coisa\n\nDecision: DEC-001\n");
  ok(r.code === 0, "aprovou citação legítima (código 0)");
  ok(/ok\s+msg\.txt cita DEC-001/.test(r.saida), "reconheceu a citação como válida");

  console.log("\n[rascunho] maquina rascunha, humano assina, SHA ativa\n");

  // A linha existe, o estado e "rascunho", nao ha assinante nem SHA. Essa e a
  // forma que uma decisao tem entre ser escrita pela maquina e ser assinada.
  const rascunho = `${CABECALHO}| DEC-007 | 2026-09-02 | decisão rascunhada pela máquina | rascunho, assinatura pendente |  |  |\n`;

  r = rodar(rascunho, "sem citar nada\n");
  ok(r.code === 0, "rascunho SEM referência não reprova (código 0)");
  ok(/1 em rascunho/.test(r.saida), "contou a decisão como rascunho");
  ok(/aguardam assinatura/.test(r.saida), "emitiu o aviso de assinatura pendente");

  r = rodar(rascunho, "muda coisa\n\nDecision: DEC-007\n");
  ok(r.code === 1, "rascunho REFERENCIADA por commit reprova (código 1)");
  ok(/RASCUNHO, ainda não assinada/.test(r.saida), "explicou que a decisão citada não está assinada");

  // Regressao: sem assinante E sem estado rascunho continua sendo falha de
  // integridade. O estado novo nao pode virar porta dos fundos para linha solta.
  r = rodar(`${CABECALHO}| DEC-008 | 2026-09-02 | sem estado nenhum | vigente |  |  |\n`, "sem citar\n");
  ok(r.code === 1, "linha sem assinante e sem estado rascunho ainda reprova");

  console.log("\n[documentação] exemplo dentro de bloco cercado não é decisão\n");

  // Achado real, em 2026-09-03, na semente que o pacote público publica: o
  // registro documentava o formato com uma linha de exemplo dentro de ```, o
  // parser a leu como decisão de verdade e o build reprovou por "assinatura não
  // resolve" — apontando para a própria documentação. Documentação não é dado.
  const comExemplo =
    `${CABECALHO}| DEC-001 | 2026-09-01 | decisão de verdade | vigente | operador | ${SHA} |\n` +
    "\nUma linha se parece com isto:\n\n```\n" +
    "| DEC-042 | 2026-01-15 | só um exemplo | vigente | operador | a1b2c3d |\n" +
    "```\n";
  r = rodar(comExemplo, "sem citar nada\n");
  ok(r.code === 0, "exemplo cercado com SHA inventado não reprova");
  ok(/1 decisão/.test(r.saida), "contou 1 decisão, não 2 — o exemplo ficou de fora");
  ok(!/a1b2c3d/.test(r.saida), "não mencionou o SHA do exemplo em lugar nenhum");

  // E a cerca não pode virar esconderijo: fechada, o que vem depois volta a valer.
  r = rodar(`${comExemplo}| DEC-009 | 2026-09-03 | depois da cerca | vigente |  |  |\n`, "sem citar\n");
  ok(r.code === 1, "linha defeituosa DEPOIS da cerca fechada continua reprovando");

  console.log("\n[guarda] o extrator de trailer realmente extraiu\n");

  r = rodar(bom, "sem trailer nenhum aqui\n");
  ok(r.code === 0, "texto sem trailer não reprova");
  ok(/0 citação/.test(r.saida), "contou zero citações num texto sem trailer");

  r = rodar(bom, "titulo\n\ndecision:   DEC-001   \n");
  ok(r.code === 0 && /1 citação/.test(r.saida), "aceitou trailer em caixa baixa e com espaços");

  console.log("\n[fronteira] commit posterior sem assinatura por chave reprova (DEC-007)\n");

  // Segundo commit, deliberadamente SEM assinatura (o repo do teste tem
  // commit.gpgsign=false). Tratando o primeiro como fronteira, o gate tem de
  // reprovar o segundo. A prova do caminho positivo — 5 de 5 com a lista de
  // confiança do repositório — é manual e está registrada no log de 02/09,
  // porque exigiria chave privada dentro do teste.
  fs.writeFileSync(path.join(tmp, "b.txt"), "depois da fronteira\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "commit posterior a fronteira, sem assinar");

  const fReg = path.join(tmp, "reg-front.md");
  fs.writeFileSync(fReg, bom, "utf8");
  const rf = spawnSync(
    process.execPath,
    [VALIDADOR, `--registro=${fReg}`, `--arvore=${tmp}`, `--fronteira=${SHA}`],
    { encoding: "utf8" },
  );
  const saidaF = (rf.stdout || "") + (rf.stderr || "");
  ok(rf.status === 1, "reprovou commit posterior à fronteira sem assinatura");
  // A mensagem NÃO deve citar o número de decisão desta instância: o script é
  // publicado como parte do framework, e um DEC-NNN daqui não significa nada
  // no repositório de outra pessoa. A asserção cobra o conceito, não o número.
  ok(/fronteira de autoria/.test(saidaF), "explicou a falha pelo conceito de fronteira de autoria");
  ok(/assinatura confiável/.test(saidaF), "disse que falta assinatura confiável");
  ok(/0 de 1 commit/.test(saidaF), "contou 0 de 1 assinado");
  ok(/FALHA\s+fronteira/.test(saidaF), "o rótulo da linha-resumo acompanha o resultado, não diz ok");
  ok(/ambiente\s+gpg\./.test(saidaF), "imprimiu o ambiente de verificação junto da falha");

  console.log("\n[guarda] o aviso de chave é aviso, não reprovação\n");
  ok(/NÃO reprova hoje/.test(rodar(bom, "x\n\nDecision: DEC-001\n").saida), "avisou sobre commit sem chave sem reprovar");

  console.log("\n[exigência] a instância declara que assinar decisão exige chave — e só então reprova\n");

  // Reproduzido em 2026-09-05: no pacote exportado para um diretório limpo, sem
  // configuração global, exigir G dentro do script deixava o clone de terceiro
  // vermelho na primeira decisão. Por isso a exigência é declarada pela
  // instância, e este bloco cobra as duas metades: sem declaração, aviso (o
  // caso acima); com declaração, reprovação — com ou sem fronteira.
  const rodarSemFixture = (registro, ...extras) => {
    const f = path.join(tmp, "reg-exig.md");
    fs.writeFileSync(f, registro, "utf8");
    const rr = spawnSync(process.execPath, [VALIDADOR, `--registro=${f}`, `--arvore=${tmp}`, ...extras], {
      encoding: "utf8",
    });
    return { code: rr.status, saida: (rr.stdout || "") + (rr.stderr || "") };
  };

  // (a) pela flag, citação de DEC vigente cujo commit não tem chave: reprova
  r = rodar(bom, "x\n\nDecision: DEC-001\n");
  const rFlag = spawnSync(
    process.execPath,
    [VALIDADOR, `--registro=${path.join(tmp, "reg.md")}`, `--texto=${path.join(tmp, "msg.txt")}`, `--arvore=${tmp}`, "--exigir-chave"],
    { encoding: "utf8" },
  );
  const saidaFlag = (rFlag.stdout || "") + (rFlag.stderr || "");
  ok(r.code === 0 && rFlag.status === 1, "a mesma citação passa sem exigência e reprova com --exigir-chave");
  ok(/não tem chave confiável/.test(saidaFlag), "explicou que falta chave confiável");
  ok(/esta instância exige G/.test(saidaFlag), "atribuiu a exigência à instância, não ao framework");
  ok(/%G\? = "N"/.test(saidaFlag), "imprimiu o código %G? do commit reprovado");

  // (b) pelo arquivo, linha vigente sem chave reprova MESMO SEM citação — e sem fronteira
  const dirGov = path.join(tmp, "governance");
  fs.mkdirSync(dirGov, { recursive: true });
  const fExig = path.join(dirGov, "exigencia-de-chave.txt");
  fs.writeFileSync(fExig, "# comentário\n\ndecisao-assinada-exige-G\n", "utf8");
  r = rodarSemFixture(bom);
  ok(r.code === 1, "linha vigente sem chave reprova com o arquivo declarado, sem citação e sem fronteira");
  ok(/exigência\s+esta instância exige G/.test(r.saida), "anunciou a exigência declarada pelo arquivo");
  ok(/DEC-001 no registro — a assinatura/.test(r.saida), "apontou a linha do registro, não uma citação");

  // (c) arquivo presente com conteúdo errado não passa por "não declarado"
  fs.writeFileSync(fExig, "exige-chave-por-favor\n", "utf8");
  r = rodarSemFixture(bom);
  ok(r.code === 1, "arquivo com token desconhecido reprova");
  ok(/não reconhecida/.test(r.saida), "explicou que a exigência declarada não foi reconhecida");

  // (d) sem o arquivo, volta ao aviso — a ausência não reprova
  fs.rmSync(fExig);
  r = rodarSemFixture(bom);
  ok(r.code === 0, "sem o arquivo, a mesma linha volta a passar");
  ok(!/exigência\s+esta instância/.test(r.saida), "não anunciou exigência que não existe");

  console.log("\n[chaves] o assinante escrito na linha é conferido contra a chave que assinou (ADR-046)\n");

  // Ao contrário do bloco da fronteira acima — cuja prova positiva era manual
  // "porque exigiria chave privada dentro do teste" — aqui as chaves são
  // geradas dentro da árvore descartável. São duas: uma fazendo o papel do
  // humano, outra o da máquina. É o único jeito de provar por comando que o
  // validador distingue QUAL chave assinou, que é o item 2 do ADR-046.
  //
  // Se o ambiente não tiver ssh-keygen, ou o git for anterior ao suporte a
  // assinatura SSH (2.34), o bloco se declara n/a e não reprova: reportar
  // checagem que não rodou é o defeito que este repositório reporta aos outros.
  const chavesOk = (() => {
    try {
      for (const nome of ["humana", "maquina"]) {
        execFileSync("ssh-keygen", ["-t", "ed25519", "-f", path.join(tmp, nome), "-N", "", "-C", `${nome}@teste`, "-q"], {
          stdio: "ignore",
        });
      }
      const pub = (n) => fs.readFileSync(path.join(tmp, `${n}.pub`), "utf8").trim();
      fs.writeFileSync(
        path.join(tmp, "signers"),
        `humana@teste ${pub("humana")}\nmaquina@teste ${pub("maquina")}\n`,
        "utf8",
      );
      const p = (x) => path.join(tmp, x).replace(/\\/g, "/");
      git("config", "gpg.format", "ssh");
      git("config", "gpg.ssh.allowedSignersFile", p("signers"));
      git("config", "commit.gpgsign", "true");
      return true;
    } catch {
      return false;
    }
  })();

  if (!chavesOk) {
    console.log("  n/a   ssh-keygen ausente ou git sem suporte a assinatura SSH — bloco não executado");
  } else {
    const commitAssinadoCom = (chave, msg) => {
      git("config", "user.signingkey", path.join(tmp, `${chave}.pub`).replace(/\\/g, "/"));
      fs.writeFileSync(path.join(tmp, `${chave}-${Date.now()}.txt`), "x\n", "utf8");
      git("add", "-A");
      git("commit", "-q", "-m", msg);
      return execFileSync("git", ["-C", tmp, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    };

    const shaHumano = commitAssinadoCom("humana", "decisão assinada pelo humano");
    const shaMaquina = commitAssinadoCom("maquina", "rascunho assinado pela máquina");

    // Guarda: se o git não estiver de fato verificando, nada abaixo prova nada.
    const gHumano = execFileSync("git", ["-C", tmp, "log", "-1", "--format=%G?%x00%GS", shaHumano], {
      encoding: "utf8",
    }).trim();
    ok(gHumano.startsWith("G\0humana@teste"), `o commit humano verifica como G por humana@teste (git disse "${gHumano.replace("\0", " / ")}")`);

    const fChaves = path.join(dirGov, "chaves-de-assinatura.txt");
    const declararChaves = (conteudo) => fs.writeFileSync(fChaves, conteudo, "utf8");
    const MAPA = "assinante operador humana@teste\nmaquina maquina@teste\n";

    // (a) assinante que bate com a chave: passa, e sem aviso
    declararChaves(MAPA);
    r = rodarSemFixture(`${CABECALHO}| DEC-001 | 2026-09-01 | ok | vigente | operador | ${shaHumano} |\n`);
    ok(r.code === 0, "assinante que corresponde à chave passa");
    ok(/chaves\s+esta instância confere o assinante/.test(r.saida), "anunciou que a conferência de chave está ligada");

    // (b) decisão assinada pela chave de máquina: REPROVA — é o defeito de 04/09
    r = rodarSemFixture(`${CABECALHO}| DEC-002 | 2026-09-01 | assinada pela máquina | vigente | operador | ${shaMaquina} |\n`);
    ok(r.code === 1, "decisão assinada pela chave de máquina reprova");
    ok(/CHAVE DE MÁQUINA/.test(r.saida), "explicou que quem assinou foi a chave de máquina");

    // (c) rascunho assinado pela chave de máquina: NÃO reprova. A chave de
    // máquina existe justamente para assinar rascunho de trabalho.
    r = rodarSemFixture(
      `${CABECALHO}| DEC-003 | 2026-09-01 | rascunho da máquina | rascunho, assinatura pendente |  |  |\n`,
    );
    ok(r.code === 0, "rascunho não é alcançado pela regra da chave de máquina");

    // (d) assinante declarado que NÃO bate com a chave que assinou: reprova
    declararChaves("assinante operador maquina@teste\nmaquina outra@teste\n");
    r = rodarSemFixture(`${CABECALHO}| DEC-004 | 2026-09-01 | nome não bate | vigente | operador | ${shaHumano} |\n`);
    ok(r.code === 1, "assinante declarado que não corresponde à chave reprova");
    ok(/declara assinante "operador"/.test(r.saida), "disse qual nome a linha declarava");
    ok(/assinado por "humana@teste"/.test(r.saida), "disse qual chave de fato assinou");

    // (e) assinante fora do mapa: AVISA e não reprova — nome livre continua valendo
    declararChaves(MAPA);
    r = rodarSemFixture(`${CABECALHO}| DEC-005 | 2026-09-01 | nome livre | vigente | fulano | ${shaHumano} |\n`);
    ok(r.code === 0, "assinante fora do mapa não reprova");
    ok(/não está em governance\/chaves-de-assinatura\.txt/.test(r.saida), "avisou que aquela linha não foi conferida");

    // (e2) o nome do assinante pode ter espaços. "Cadu Azeredo" é um assinante,
    // não dois campos — e a primeira versão do parser exigia exatamente três
    // campos, o que reprovava todo nome composto como declaração mal formada.
    // O principal é sempre o último campo.
    declararChaves("assinante Nome Composto Do Assinante humana@teste\nmaquina maquina@teste\n");
    r = rodarSemFixture(
      `${CABECALHO}| DEC-005 | 2026-09-01 | nome com espaços | vigente | Nome Composto Do Assinante | ${shaHumano} |\n`,
    );
    ok(r.code === 0, "assinante com nome composto é lido, não reprova como linha mal formada");
    ok(!/não está em governance/.test(r.saida), "e foi de fato conferido contra a chave, não apenas ignorado");

    // O mesmo nome composto, apontado para a chave ERRADA, ainda tem de reprovar:
    // ler o nome direito não pode virar desculpa para não conferir.
    declararChaves("assinante Nome Composto Do Assinante maquina@teste\nmaquina outra@teste\n");
    r = rodarSemFixture(
      `${CABECALHO}| DEC-006 | 2026-09-01 | nome composto, chave errada | vigente | Nome Composto Do Assinante | ${shaHumano} |\n`,
    );
    ok(r.code === 1, "nome composto apontado para a chave errada continua reprovando");

    // (f) declaração mal formada não passa por "não declarada"
    declararChaves("confere aí as chaves\n");
    r = rodarSemFixture(`${CABECALHO}| DEC-006 | 2026-09-01 | ok | vigente | operador | ${shaHumano} |\n`);
    ok(r.code === 1, "linha ininteligível no arquivo de chaves reprova");
    ok(/não é "assinante/.test(r.saida), "explicou qual é o formato esperado");

    // (g) sem o arquivo, tudo volta ao comportamento anterior — é o que impede
    // um clone de terceiro de nascer vermelho por uma regra que não é dele.
    fs.rmSync(fChaves);
    r = rodarSemFixture(`${CABECALHO}| DEC-007 | 2026-09-01 | ok | vigente | quem quiser | ${shaHumano} |\n`);
    ok(r.code === 0, "sem o arquivo, assinante nenhum é conferido e nada reprova");
    ok(!/chaves\s+esta instância/.test(r.saida), "não anunciou conferência que não existe");
  }
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows às vezes segura o handle; a pasta é temporária de qualquer jeito */
  }
}

console.log(falhas ? `\ntest-validate-decisions: ${falhas} falha(s).` : "\ntest-validate-decisions: tudo passou.");
process.exit(falhas ? 1 : 0);
