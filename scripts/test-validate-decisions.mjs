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
import { createHash } from "node:crypto";
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

  console.log("\n[id repetido] número não se reatribui: o mesmo id em duas linhas reprova\n");

  // Até a 0.5.1, a última linha de um id repetido ganhava em silêncio: uma linha
  // vigente acrescentada embaixo de um rascunho de mesmo número tornava o
  // rascunho citável sem ninguém editar o rascunho (a pergunta Q1 da spec do
  // registro, e o caso b da prova de lacunas de 16/10).
  r = rodar(
    `${CABECALHO}| DEC-001 | 2026-09-01 | decisão válida | vigente | operador | ${SHA} |\n| DEC-001 | 2026-09-02 | outra com o mesmo número | vigente | operador | ${SHA} |\n`,
    "sem citar nada\n",
  );
  ok(r.code === 1, "duas linhas DEC-001 reprovam, mesmo sem citação");
  ok(/DEC-001 aparece em 2 linhas do registro \(linhas 3 e 4\)/.test(r.saida), "disse quantas linhas têm o id e quais são");
  r = rodar(
    `${CABECALHO}| DEC-002 | 2026-09-01 | ligar o merge | rascunho, assinatura pendente |  |  |\n| DEC-002 | 2026-09-01 | ligar o merge | vigente | operador | ${SHA} |\n`,
    "x\n\nDecision: DEC-002\n",
  );
  ok(r.code === 1, "um rascunho com uma linha vigente de mesmo id embaixo não vira citável");

  console.log("\n[selo] o hash da linha, guardado na assinatura, reprova a linha que mudou depois\n");

  // O selo é a sétima célula de uma linha assinada: "selo:" e os 16 primeiros
  // dígitos hexadecimais do sha256 de id|decisão|status|assinante|assinatura, com
  // as células sem os espaços das pontas. A conta é feita aqui, à parte do
  // validador, para que o teste confira o formato e não só a ferramenta.
  const selo = (/** @type {string[]} */ ...celulas) =>
    `selo:${createHash("sha256").update(celulas.join("|"), "utf8").digest("hex").slice(0, 16)}`;
  const s1 = selo("DEC-001", "decisão selada", "vigente", "operador", SHA);

  r = rodar(`${CABECALHO}| DEC-001 | 2026-09-01 | decisão selada | vigente | operador | ${SHA} | ${s1} |\n`, "x\n\nDecision: DEC-001\n");
  ok(r.code === 0, "linha assinada com o selo certo passa");
  ok(!/sem selo/.test(r.saida), "e não entra no aviso das linhas sem selo");

  r = rodar(`${CABECALHO}| DEC-001 | 2026-09-01 | decisão trocada | vigente | operador | ${SHA} | ${s1} |\n`, "x\n\nDecision: DEC-001\n");
  ok(r.code === 1, "o texto da decisão mudou depois do selo: reprova");
  ok(/DEC-001 no registro — a linha mudou depois de assinada/.test(r.saida), "explicou que a linha mudou depois de assinada");

  r = rodar(`${CABECALHO}| DEC-001 | 2026-09-01 | decisão selada | vigente | outra pessoa | ${SHA} | ${s1} |\n`, "sem citar nada\n");
  ok(r.code === 1, "o assinante mudou depois do selo: reprova, mesmo sem citação");

  r = rodar(`${CABECALHO}| DEC-001 | 2026-09-30 | decisão selada | vigente | operador | ${SHA} | ${s1} |\n`, "sem citar nada\n");
  ok(r.code === 0, "a data não entra no selo");

  r = rodar(`${CABECALHO}| DEC-001 | 2026-09-01 | decisão selada | vigente | operador | ${SHA} | selo:xyz |\n`, "sem citar nada\n");
  ok(r.code === 1 && /selo ilegível/.test(r.saida), "selo fora do formato reprova");

  r = rodar(bom, "x\n\nDecision: DEC-001\n");
  ok(r.code === 0, "linha assinada sem selo continua passando");
  ok(/1 decisão\(ões\) assinada\(s\) sem selo/.test(r.saida), "mas entra no aviso das linhas sem selo");

  const rs = spawnSync(process.execPath, [VALIDADOR, `--registro=${path.join(tmp, "reg.md")}`, `--arvore=${tmp}`, "--selo=DEC-001"], { encoding: "utf8" });
  ok(rs.status === 0 && rs.stdout.trim() === selo("DEC-001", "decisão válida", "vigente", "operador", SHA), "--selo=DEC-001 imprime o selo da linha como ela está escrita");
  const rs2 = spawnSync(process.execPath, [VALIDADOR, `--registro=${path.join(tmp, "reg.md")}`, `--arvore=${tmp}`, "--selo=DEC-999"], { encoding: "utf8" });
  ok(rs2.status === 1 && /DEC-999 não existe/.test(`${rs2.stdout}${rs2.stderr}`), "--selo de um id que não existe sai com 1");

  r = rodar(`${CABECALHO}| DEC-007 | 2026-09-02 | rascunho | rascunho, assinatura pendente |  |  | selo:0000000000000000 |\n`, "sem citar nada\n");
  ok(r.code === 0, "rascunho com selo não é conferido: o selo nasce na assinatura");

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

  console.log("\n[garantia] a garantia de cada decisão é calculada do git, nunca escrita à mão\n");

  // Valores: `chave` (G pela chave humana declarada), `plataforma` (merge aceito
  // pela diretiva) ou `nenhuma`. A garantia não é coluna do registro: um campo
  // preenchido por pessoa pode mentir, e um derivado do git, não. `--json` dá a
  // lista por decisão vigente, para script (o livro razão vai ler daí).
  const json = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  r = rodarSemFixture(bom, "--json");
  let j = json(r.saida);
  ok(j !== null && Array.isArray(j.decisoes), "--json devolve um objeto com a lista de decisões");
  ok(j !== null && j.decisoes.length === 1 && j.decisoes[0].id === "DEC-001" && j.decisoes[0].sha === SHA, "cada decisão vigente traz id e sha");
  ok(j !== null && j.decisoes[0]?.garantia === "nenhuma", "commit sem chave confiável dá garantia nenhuma");
  r = rodarSemFixture(bom);
  ok(/garantia: 0 por chave, 0 por plataforma, 1 sem garantia/.test(r.saida), "o resumo conta a garantia por tipo");
  r = rodarSemFixture(rascunho, "--json");
  j = json(r.saida);
  ok(j !== null && j.decisoes.length === 0, "decisão em rascunho não entra na lista de garantias");

  console.log("\n[delegações] N0 e N1 só existem dentro de uma delegação, e a delegação é decisão assinada\n");

  // governance/delegacoes.txt é opcional e de instância, como o arquivo de chaves.
  // Cada linha libera uma classe de decisão miúda (N0) ou de máquina (N1) e aponta
  // a DEC que autorizou a delegação. O commit que usa a classe leva os trailers
  // `Nivel:` e `Autorizado-por:`. N2 não se declara: prova-se pela assinatura.
  const fDeleg = path.join(dirGov, "delegacoes.txt");
  const delegar = (conteudo) => fs.writeFileSync(fDeleg, conteudo, "utf8");
  const regDeleg =
    `${CABECALHO}| DEC-001 | 2026-09-01 | delega dependências aprovadas | vigente | operador | ${SHA} |\n` +
    `| DEC-007 | 2026-09-02 | ainda em rascunho | rascunho, assinatura pendente |  |  |\n`;

  // controle: sem o arquivo, nada muda
  if (fs.existsSync(fDeleg)) fs.rmSync(fDeleg);
  r = rodar(regDeleg, "x\n\nNivel: N1\n");
  ok(r.code === 0, "sem o arquivo de delegações, trailer de nível não reprova");
  ok(/delegações: nenhuma declarada/.test(r.saida), "anunciou que não há delegação declarada");

  // delegação apontando DEC inexistente
  delegar("delega N1 dependencias-aprovadas autorizado_por DEC-099\n");
  r = rodar(regDeleg, "sem trailer\n");
  ok(r.code === 1, "delegação que aponta DEC inexistente reprova");
  ok(/DEC-099/.test(r.saida) && /não existe/.test(r.saida), "disse qual DEC da delegação não existe");

  // delegação apontando DEC em rascunho
  delegar("delega N1 dependencias-aprovadas autorizado_por DEC-007\n");
  r = rodar(regDeleg, "sem trailer\n");
  ok(r.code === 1, "delegação que aponta DEC em rascunho reprova");
  ok(/aponta DEC-007, que está em rascunho/.test(r.saida), "disse que a DEC da delegação ainda não foi assinada");

  // positivo: commit N1 com Autorizado-por que bate com a delegação
  delegar("# comentário\n\ndelega N1 dependencias-aprovadas autorizado_por DEC-001\ndelega N0 formatacao autorizado_por DEC-001\n");
  r = rodar(regDeleg, "x\n\nNivel: N1\nAutorizado-por: DEC-001\n");
  ok(r.code === 0, "commit N1 com Autorizado-por que bate com uma delegação N1 passa");
  ok(/delegações: 2 declarada/.test(r.saida), "anunciou quantas delegações estão declaradas");

  // commit N1 sem Autorizado-por
  r = rodar(regDeleg, "x\n\nNivel: N1\n");
  ok(r.code === 1, "commit N1 sem Autorizado-por reprova");
  ok(/sem Autorizado-por/.test(r.saida), "disse que falta o Autorizado-por");

  // commit N1 citando DEC que só delega N0
  delegar("delega N0 formatacao autorizado_por DEC-001\n");
  r = rodar(regDeleg, "x\n\nNivel: N1\nAutorizado-por: DEC-001\n");
  ok(r.code === 1, "commit N1 citando DEC que não delega N1 reprova");
  ok(/nenhuma delegação N1/.test(r.saida), "disse que não há delegação daquele nível para aquela DEC");

  // trailer Nivel: N2
  r = rodar(regDeleg, "x\n\nNivel: N2\n");
  ok(r.code === 1, "trailer Nivel: N2 reprova");
  ok(/N2 não se declara/.test(r.saida), "explicou que N2 se prova pela assinatura, não por trailer");

  // linha mal formada no arquivo
  delegar("libera tudo\n");
  r = rodar(regDeleg, "sem trailer\n");
  ok(r.code === 1, "linha ininteligível no arquivo de delegações reprova");
  ok(/delega N0\|N1 <escopo> autorizado_por DEC-NNN/.test(r.saida), "explicou o formato esperado");

  fs.rmSync(fDeleg);

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
    ok(/garantia: 1 por chave, 0 por plataforma/.test(r.saida), "o resumo conta a decisão como garantida por chave");
    r = rodarSemFixture(`${CABECALHO}| DEC-001 | 2026-09-01 | ok | vigente | operador | ${shaHumano} |\n`, "--json");
    ok(json(r.saida)?.decisoes?.[0]?.garantia === "chave", "--json dá garantia chave para a decisão assinada pela chave humana declarada");
    r = rodarSemFixture(`${CABECALHO}| DEC-002 | 2026-09-01 | máquina | vigente | operador | ${shaMaquina} |\n`, "--json");
    ok(json(r.saida)?.decisoes?.[0]?.garantia === "nenhuma", "decisão assinada pela chave de máquina não ganha garantia");

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

  console.log("\n[plataforma] merge do GitHub como assinatura: só com a diretiva, e só pelo que ele prova\n");

  // A diretiva `plataforma github <assinante> <e-mail>` vem DESLIGADA: sem ela, um
  // commit criado pela plataforma não assina decisão. Com ela, o merge só vale se
  // for merge de verdade (dois pais), verificado pela chave da plataforma (G),
  // feito pelo e-mail declarado, por gente e não por app, e por alguém que não
  // escreveu os commits do PR. A chave da plataforma é simulada por uma chave gpg
  // gerada aqui com a identidade da plataforma: nome GitHub e o endereço de
  // noreply dela. O endereço é montado por partes, como no validador, porque a
  // redação do export barra todo e-mail escrito por extenso num arquivo publicado.
  //
  // Medido numa sonda em 2026-10-14, antes deste teste: sem a chave pública da
  // plataforma no gpg do ambiente, o git dá %G? = E; importada sem confiança, U;
  // importada e confiável, G. É por isso que um merge do GitHub dá E por padrão.
  //
  // O gpg do Git para Windows lê "C:\..." como caminho relativo; o teste tenta o
  // caminho nativo e depois a forma "/c/...". Sem gpg que funcione, o bloco se
  // declara n/a e não reprova.
  const tmpP = fs.mkdtempSync(path.join(os.tmpdir(), "dec-plataforma-"));
  const homesGpg = [];
  const NOREPLY = ["noreply", "github.com"].join("@");
  try {
    const gpg = (home, args, input) =>
      execFileSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", "", ...args], {
        env: { ...process.env, GNUPGHOME: home },
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    const casaGpg = (nome) => {
      const dir = path.join(tmpP, nome);
      fs.mkdirSync(dir, { recursive: true });
      for (const h of [dir, dir.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)]) {
        try {
          gpg(h, ["--list-keys"]);
          homesGpg.push(h);
          return h;
        } catch {
          /* tenta a outra forma do caminho */
        }
      }
      return null;
    };
    const chavePlataforma = (home) => {
      gpg(home, ["--quick-generate-key", `GitHub <${NOREPLY}>`, "ed25519", "sign", "never"]);
      return gpg(home, ["--list-keys", "--with-colons"]).split("\n").find((l) => l.startsWith("fpr:")).split(":")[9];
    };

    let H1 = null;
    let H2 = null;
    let H3 = null;
    let K1 = null;
    let K2 = null;
    try {
      H1 = casaGpg("gpg-ambiente");
      H2 = casaGpg("gpg-outra");
      H3 = casaGpg("gpg-vazio");
      K1 = chavePlataforma(H1);
      K2 = chavePlataforma(H2);
      gpg(H1, ["--import-ownertrust"], `${K1}:6:\n`);
    } catch {
      K1 = null;
    }

    if (!H1 || !H2 || !H3 || !K1 || !K2) {
      console.log("  n/a   gpg ausente ou sem gerar chave neste ambiente — bloco não executado");
    } else {
      const repoP = path.join(tmpP, "repo");
      fs.mkdirSync(repoP);
      const gitP = (args, env = {}) =>
        execFileSync("git", ["-C", repoP, ...args], {
          env: { ...process.env, ...env },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      const PLATAFORMA = { GIT_COMMITTER_NAME: "GitHub", GIT_COMMITTER_EMAIL: NOREPLY };
      const autor = (nome, email) => ({ GIT_AUTHOR_NAME: nome, GIT_AUTHOR_EMAIL: email });
      const assinadoPor = (fpr, home) => [["-c", "gpg.format=openpgp", "-c", `user.signingkey=${fpr}`], { GNUPGHOME: home }];

      gitP(["init", "-q", "-b", "main"]);
      gitP(["config", "user.name", "base"]);
      gitP(["config", "user.email", "base@teste"]);
      gitP(["config", "commit.gpgsign", "false"]);
      fs.writeFileSync(path.join(repoP, "a.txt"), "a\n", "utf8");
      gitP(["add", "-A"]);
      gitP(["commit", "-q", "-m", "base"]);
      const BASE = gitP(["rev-parse", "--short", "HEAD"]);

      // Um PR por caso: um commit no ramo, depois o merge criado "pela plataforma".
      const pr = (ramo, autorDoPr, quemFazMerge, fpr, home) => {
        gitP(["checkout", "-q", "-b", ramo, "main"]);
        fs.writeFileSync(path.join(repoP, `${ramo.replace("/", "-")}.txt`), `${ramo}\n`, "utf8");
        gitP(["add", "-A"]);
        gitP(["commit", "-q", "-m", `trabalho em ${ramo}`], autorDoPr);
        gitP(["checkout", "-q", "main"]);
        const [cfg, env] = assinadoPor(fpr, home);
        gitP([...cfg, "merge", "-q", "--no-ff", "-S", "-m", `Merge pull request from ${ramo}`, ramo], {
          ...PLATAFORMA,
          ...quemFazMerge,
          ...env,
        });
        return gitP(["rev-parse", "--short", "HEAD"]);
      };

      const SHIZUNE = autor("Shizune", "shizune@teste");
      const PESSOA = autor("Pessoa", "pessoa@teste");
      const BOT = autor("app[bot]", "1+app[bot]@users.noreply.github.com");

      const M_BOM = pr("preview/bom", SHIZUNE, PESSOA, K1, H1);
      const M_MESMO_AUTOR = pr("preview/mesmo-autor", PESSOA, PESSOA, K1, H1);
      const M_CHAVE_FORA = pr("preview/chave-fora", SHIZUNE, PESSOA, K2, H2);
      const M_BOT = pr("preview/bot", SHIZUNE, BOT, K1, H1);
      // squash: commit da plataforma com um pai só
      {
        const [cfg, env] = assinadoPor(K1, H1);
        gitP([...cfg, "commit", "-q", "--allow-empty", "-S", "-m", "Squash do PR (#5)"], { ...PLATAFORMA, ...PESSOA, ...env });
      }
      const S_SQUASH = gitP(["rev-parse", "--short", "HEAD"]);

      // Guarda: se o git não estiver de fato verificando a assinatura da
      // plataforma, nada abaixo prova nada.
      const gBom = execFileSync("git", ["-C", repoP, "log", "-1", "--format=%G?%x00%GS", M_BOM], {
        env: { ...process.env, GNUPGHOME: H1 },
        encoding: "utf8",
      }).trim();
      ok(gBom.startsWith(`G\0GitHub <${NOREPLY}>`), `o merge simulado verifica como G pela chave da plataforma (git disse "${gBom.replace("\0", " / ")}")`);

      const rodarP = (sha, { chaves, texto, extras = [], home = H1 } = {}) => {
        const dirGovP = path.join(repoP, "governance");
        fs.mkdirSync(dirGovP, { recursive: true });
        const fC = path.join(dirGovP, "chaves-de-assinatura.txt");
        if (chaves === undefined) {
          if (fs.existsSync(fC)) fs.rmSync(fC);
        } else {
          fs.writeFileSync(fC, chaves, "utf8");
        }
        const fR = path.join(tmpP, "reg.md");
        fs.writeFileSync(fR, `${CABECALHO}| DEC-101 | 2026-10-14 | decisão pelo merge | vigente | Pessoa | ${sha} |\n`, "utf8");
        const args = [VALIDADOR, `--registro=${fR}`, `--arvore=${repoP}`, ...extras];
        if (texto) {
          const fT = path.join(tmpP, "msg.txt");
          fs.writeFileSync(fT, texto, "utf8");
          args.push(`--texto=${fT}`);
        }
        const rr = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, GNUPGHOME: home } });
        return { code: rr.status, saida: (rr.stdout || "") + (rr.stderr || "") };
      };

      const SEM_DIRETIVA = "assinante Pessoa humana@teste\n";
      const COM_DIRETIVA = "assinante Pessoa humana@teste\nplataforma github Pessoa pessoa@teste\n";
      const CITA = "muda coisa\n\nDecision: DEC-101\n";

      // (a) sem a diretiva, o merge da plataforma não assina — mesmo com G
      r = rodarP(M_BOM, { chaves: SEM_DIRETIVA });
      ok(r.code === 1, "sem a diretiva, merge do GitHub com G não assina decisão");
      ok(/plataforma github/.test(r.saida), "disse qual diretiva faltou");
      ok(/merge da plataforma como assinatura: desligado/.test(r.saida), "anunciou que a rota do merge está desligada");

      // (b) com a diretiva, o merge de verdade, feito por quem a diretiva declara, assina
      r = rodarP(M_BOM, { chaves: COM_DIRETIVA });
      ok(r.code === 0, "com a diretiva, o merge feito pelo e-mail declarado assina");
      ok(/merge da plataforma como assinatura: ligado para 1 assinante/.test(r.saida), "anunciou a rota ligada e para quantos");
      r = rodarP(M_BOM, { chaves: COM_DIRETIVA, extras: ["--json"] });
      ok(json(r.saida)?.decisoes?.[0]?.garantia === "plataforma", "o merge aceito pela diretiva dá garantia plataforma");
      r = rodarP(M_BOM, { chaves: COM_DIRETIVA, texto: CITA });
      ok(r.code === 0, "um commit pode citar a decisão assinada pelo merge");
      ok(/cita DEC-101 — assinado por Pessoa pelo merge do GitHub/.test(r.saida), "a citação diz que a assinatura veio do merge, não de chave");

      // (c) o merge foi feito por outro e-mail
      r = rodarP(M_BOM, { chaves: "assinante Pessoa humana@teste\nplataforma github Pessoa outro@teste\n" });
      ok(r.code === 1, "merge feito por e-mail diferente do declarado reprova");
      ok(/pessoa@teste/.test(r.saida) && /outro@teste/.test(r.saida), "disse quem fez o merge e quem a diretiva declara");

      // (d) squash ou rebase: commit da plataforma com um pai só
      r = rodarP(S_SQUASH, { chaves: COM_DIRETIVA });
      ok(r.code === 1, "commit da plataforma com um pai só (squash) reprova");
      ok(/dois pais/.test(r.saida), "explicou que só o merge commit, de dois pais, vale");

      // (e) quem fez o merge também escreveu o PR
      r = rodarP(M_MESMO_AUTOR, { chaves: COM_DIRETIVA });
      ok(r.code === 1, "merge feito pelo próprio autor do PR reprova");
      ok(/também é autor/.test(r.saida), "explicou que quem faz o merge precisa ser outra pessoa");

      // (f) merge assinado por chave que o gpg do ambiente não tem: E
      r = rodarP(M_CHAVE_FORA, { chaves: COM_DIRETIVA });
      ok(r.code === 1, "merge que o ambiente não consegue verificar (E) reprova mesmo com a diretiva");
      ok(/chave pública da plataforma/.test(r.saida), "explicou o E pela chave da plataforma ausente no gpg");
      ok(!/ssh-keygen/.test(r.saida), "não culpou o ssh-keygen pelo E de um merge do GitHub");

      // (g) sem diretiva e sem exigência de chave, o E não reprova — mas é explicado
      r = rodarP(M_CHAVE_FORA, { chaves: SEM_DIRETIVA, texto: CITA });
      ok(r.code === 0, "sem diretiva e sem exigência, a citação de merge com E fica no aviso");
      ok(/criado pelo GitHub/.test(r.saida) && !/ssh-keygen/.test(r.saida), "explicou por que o merge do GitHub dá E");

      // (h) merge feito por app, não por gente
      r = rodarP(M_BOT, { chaves: "assinante Pessoa humana@teste\nplataforma github Pessoa 1+app[bot]@users.noreply.github.com\n" });
      ok(r.code === 1, "merge feito por app reprova mesmo com a diretiva apontando para ele");
      ok(/feito por um app/.test(r.saida) && /não por gente/.test(r.saida), "disse que quem fez o merge é um app, não uma pessoa");

      // (i) plataforma que o validador não conhece não passa por "não declarada"
      r = rodarP(M_BOM, { chaves: "assinante Pessoa humana@teste\nplataforma gitlab Pessoa pessoa@teste\n" });
      ok(r.code === 1, "diretiva de plataforma desconhecida reprova");
      ok(/plataforma github <assinante> <e-mail>/.test(r.saida), "explicou o formato aceito");

      // (j) fronteira: commit da plataforma sem chave verificável é explicado pela plataforma
      r = rodarP(M_BOM, { chaves: COM_DIRETIVA, extras: [`--fronteira=${BASE}`], home: H3 });
      ok(r.code === 1, "com o gpg sem a chave da plataforma, a fronteira reprova os commits dela");
      ok(/criado pelo GitHub/.test(r.saida), "a falha da fronteira explica o E pelo commit da plataforma");
    }
  } finally {
    for (const h of homesGpg) {
      try {
        execFileSync("gpgconf", ["--kill", "gpg-agent"], { env: { ...process.env, GNUPGHOME: h }, stdio: "ignore" });
      } catch {
        /* sem agente para encerrar */
      }
    }
    try {
      fs.rmSync(tmpP, { recursive: true, force: true });
    } catch {
      /* Windows às vezes segura o handle; a pasta é temporária de qualquer jeito */
    }
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
