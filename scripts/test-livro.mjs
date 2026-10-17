// test-livro.mjs — teste negativo do livro.mjs (o livro razão, formato v0).
//
// O livro razão só de acréscimo vale o que vale a conferência: uma linha antiga
// reescrita, um CRLF, uma revisão feita pelo próprio executor ou um "assinado"
// escrito à mão têm de reprovar. Este teste roda, em ordem:
//
//   1. os vetores de conformidade de docs/spec/livro-v0-vetores.json, que são
//      dados e valem para qualquer implementação. Cada caso exige o conjunto
//      EXATO de regras que falham, e não só "falhou";
//   2. o JSON canônico (RFC 8785) escrito à mão, contra casos conhecidos;
//   3. a linha de comando (append, rebuild, check) num livro descartável em
//      os.tmpdir(): o append recusa o que a conferência recusaria e não toca
//      no arquivo quando recusa;
//   4. a atribuição pelo git (regra L9), numa árvore git descartável com duas
//      chaves SSH geradas ali. Sem ssh-keygen ou sem git com assinatura SSH,
//      esta parte se declara n/a.
//
// Os vetores vivem com a spec, fora do pacote, até a decisão de publicá-los.
// Num clone do pacote, a parte 1 se declara n/a e o resto roda.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAIZ = path.dirname(AQUI);
const SCRIPT = path.join(AQUI, "livro.mjs");
const VETORES = path.join(RAIZ, "docs/spec/livro-v0-vetores.json");

let falhas = 0;
let total = 0;
const ok = (cond, msg) => {
  total++;
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

/** @type {any} */
let L = null;
try {
  L = await import(new URL("./livro.mjs", import.meta.url).href);
} catch (e) {
  console.log(`  (livro.mjs não carregou: ${e.message.split("\n")[0]})`);
}
const tentar = (fn) => {
  try {
    return fn();
  } catch (e) {
    return { erroDoTeste: e.message };
  }
};

// ── 1. vetores ───────────────────────────────────────────────────────────────

console.log("[vetores] docs/spec/livro-v0-vetores.json\n");
if (!fs.existsSync(VETORES)) {
  console.log("  n/a — os vetores não estão nesta árvore (num pacote exportado, ficam com a spec)\n");
} else {
  const { vetores } = JSON.parse(fs.readFileSync(VETORES, "utf8"));
  for (const v of vetores) {
    const r = tentar(() =>
      L.conferir({
        atores: v.atores,
        arquivos: Object.fromEntries(Object.entries(v.arquivos).map(([n, t]) => [n, Buffer.from(t, "utf8")])),
        assinaturas: v.assinaturas ?? {},
        projecaoCommitada: v.projecao_commitada === undefined ? undefined : Buffer.from(v.projecao_commitada, "utf8"),
      }),
    );
    const regras = r?.erros ? [...new Set(r.erros.map((e) => e.regra))].sort() : null;
    const esperadas = [...v.espera.erros].sort();
    ok(
      regras !== null && JSON.stringify(regras) === JSON.stringify(esperadas),
      `${v.id}: falham exatamente [${esperadas.join(", ")}]${regras && JSON.stringify(regras) !== JSON.stringify(esperadas) ? ` (saiu [${regras.join(", ")}])` : ""}`,
    );
    for (const [item, situacao] of Object.entries(v.espera.situacoes ?? {})) {
      const achado = r?.projecao?.itens?.find((i) => i.item === item)?.situacao;
      ok(achado === situacao, `${v.id}: ${item} projetado como ${situacao}${achado !== situacao ? ` (saiu ${achado})` : ""}`);
    }
  }
  console.log("");
}

// ── 2. JSON canônico ─────────────────────────────────────────────────────────

console.log("[jcs] RFC 8785, escrito à mão\n");
{
  const j = (v) => tentar(() => L.jcs(v));
  ok(j({ b: 1, a: 2 }) === '{"a":2,"b":1}', "chaves em ordem");
  ok(j({ "€": 1, "😀": 2, "\r": 3, a: 4 }) === '{"\\r":3,"a":4,"€":1,"😀":2}', "ordem por unidade UTF-16 (o exemplo da RFC: controle, ASCII, €, emoji)");
  ok(j(1.0) === "1" && j(-0) === "0" && j(1e21) === "1e+21" && j(0.000001) === "0.000001" && j(1e-7) === "1e-7", "números como o ECMAScript serializa");
  ok(j("é\u000f\"\\") === '"é\\u000f\\"\\\\"', "string: é cru, controle em \\u00XX minúsculo, aspas e barra escapadas");
  ok(j([1, [true, null], { z: "x" }]) === '[1,[true,null],{"z":"x"}]', "listas e aninhamento");
  // A recusa só conta com o módulo carregado: sem ele, todo j() "lança", e a
  // asserção passaria à toa.
  const recusa = (v) => typeof L?.jcs === "function" && j(v)?.erroDoTeste !== undefined;
  ok(recusa("\ud800"), "recusa surrogate solto");
  ok(recusa(Number.NaN) && recusa(Infinity), "recusa NaN e Infinity");
  ok(recusa({ a: undefined }), "recusa undefined");
}
console.log("");

// ── 3. linha de comando ──────────────────────────────────────────────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "livro-test-"));
const EXE = "shizune-local@maquina";
const REV = "shizune-revisao@maquina";
const HUM = "humano-exemplo";
const BASE = "c".repeat(40);
const A = "a".repeat(40);
const cli = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: tmp });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

try {
  console.log("[cli] append, rebuild e check num livro descartável\n");
  const dir = path.join(tmp, "ledger");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "atores.txt"), `executor ${EXE}\nrevisor ${REV}\nhumano ${HUM}\n`);
  const arqExe = path.join(dir, `events.${EXE}.jsonl`);
  const ler = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0));

  let r = cli("append", dir, "--actor", EXE, "--type", "item", "--item", "p1", "--titulo", "Página de preços", "--base", BASE);
  ok(r.code === 0 && fs.existsSync(arqExe), "append cria o arquivo do ator com o item");
  r = cli("append", dir, "--actor", EXE, "--type", "transicao", "--item", "p1", "--de", "a_fazer", "--para", "em_andamento", "--base", BASE);
  ok(r.code === 0, "append aceita a_fazer → em_andamento do executor");
  r = cli("check", dir);
  ok(r.code === 0 && /Resultado: OK/.test(r.out), "check passa no livro que o append escreveu");

  const antes = ler(arqExe);
  r = cli("append", dir, "--actor", EXE, "--type", "transicao", "--item", "p1", "--de", "em_andamento", "--para", "assinado", "--base", BASE);
  ok(r.code !== 0 && /L7/.test(r.out), "append recusa escrever assinado (L7)");
  ok(antes.length > 0 && ler(arqExe).equals(antes), "e o arquivo fica byte a byte como estava");
  r = cli("append", dir, "--actor", EXE, "--type", "transicao", "--item", "p1", "--de", "em_andamento", "--para", "aguardando_revisao", "--base", BASE);
  ok(r.code !== 0 && /L7/.test(r.out) && ler(arqExe).equals(antes), "append recusa ir para revisão sem --sha, e não escreve");
  r = cli("append", dir, "--actor", "estranho", "--type", "comentario", "--item", "p1", "--texto", "oi", "--base", BASE);
  ok(r.code !== 0 && /L5/.test(r.out) && !fs.existsSync(path.join(dir, "events.estranho.jsonl")), "append recusa ator não declarado (L5) e não cria o arquivo");

  r = cli("append", dir, "--actor", EXE, "--type", "transicao", "--item", "p1", "--de", "em_andamento", "--para", "aguardando_revisao", "--sha", A, "--cmd", "bun test", "--base", BASE);
  ok(r.code === 0, "append aceita a revisão com o SHA revisado");
  r = cli("append", dir, "--actor", REV, "--type", "transicao", "--item", "p1", "--de", "aguardando_revisao", "--para", "revisado", "--base", BASE);
  ok(r.code === 0, "o revisor revisa");

  r = cli("rebuild", dir, "--sem-git");
  const projecao = path.join(dir, "ledger.json");
  ok(r.code === 0 && fs.existsSync(projecao), "rebuild grava ledger.json");
  const textoProjecao = fs.existsSync(projecao) ? fs.readFileSync(projecao, "utf8") : "";
  const p = tentar(() => JSON.parse(textoProjecao));
  ok(p?.itens?.[0]?.situacao === "revisado" && p?.itens?.[0]?.sha_revisado === A && p?.contagem?.revisado === 1, "a projeção diz revisado, com o SHA revisado");
  ok(textoProjecao !== "" && textoProjecao === `${tentar(() => L.jcs(p))}\n`, "ledger.json está em JSON canônico, com LF no fim");
  r = cli("check", dir, "--sem-git");
  ok(r.code === 0 && textoProjecao !== "", "check passa com o ledger.json igual ao rebuild");
  fs.writeFileSync(projecao, textoProjecao.replace('"revisado","titulo"', '"assinado","titulo"'));
  r = cli("check", dir, "--sem-git");
  ok(r.code === 1 && /L8/.test(r.out), "check reprova ledger.json adulterado (L8)");
  fs.rmSync(projecao, { force: true });

  const linhas = (fs.existsSync(arqExe) ? fs.readFileSync(arqExe, "utf8") : "").split("\n");
  fs.writeFileSync(arqExe, [linhas[0].replace("Página de preços", "Página de preços nova"), ...linhas.slice(1)].join("\n"));
  r = cli("check", dir, "--sem-git");
  ok(r.code === 1 && /L4/.test(r.out), "check reprova a linha antiga reescrita (L4)");
  fs.writeFileSync(arqExe, linhas.join("\n"));
  fs.writeFileSync(arqExe, linhas.join("\r\n"));
  r = cli("check", dir, "--sem-git");
  ok(r.code === 1 && /L1/.test(r.out), "check reprova CRLF (L1)");
  fs.writeFileSync(arqExe, linhas.join("\n"));

  // --todos lê a lista que a instância declara
  const raiz = path.join(tmp, "raiz");
  fs.mkdirSync(path.join(raiz, "governance"), { recursive: true });
  fs.cpSync(dir, path.join(raiz, "projects/x/ledger"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "governance/livros.txt"), "# um livro por linha\nprojects/x/ledger\n");
  r = cli("check", "--todos", "--raiz", raiz, "--sem-git");
  ok(r.code === 0 && /projects\/x\/ledger/.test(r.out) && /Resultado: OK/.test(r.out), "check --todos confere os livros de governance/livros.txt");
  fs.appendFileSync(path.join(raiz, "governance/livros.txt"), "projects/sumiu/ledger\n");
  r = cli("check", "--todos", "--raiz", raiz, "--sem-git");
  ok(r.code === 1 && /sumiu/.test(r.out), "livro declarado que não existe reprova, em vez de passar calado");
  console.log("");

  // ── 3b. check --json: o que um leitor (o painel) consome ───────────────────

  console.log("[json] check --json, para quem lê o livro sem reconferir\n");
  /** @param {string[]} a */
  const json = (...a) => {
    const x = spawnSync(process.execPath, [SCRIPT, "check", ...a, "--json", "--sem-git"], { encoding: "utf8", cwd: tmp });
    return { code: x.status, j: tentar(() => JSON.parse(x.stdout)), err: x.stderr ?? "" };
  };
  let j = json(dir);
  ok(j.code === 0 && j.j?.ok === true && j.j?.formato === "shizune.livro/v0", "livro bom: código 0, ok true, formato v0");
  // 4 eventos: os 7 append acima, menos os 3 recusados
  ok(j.j?.eventos === 4 && j.j?.contagem?.revisado === 1 && j.j?.itens?.[0]?.item === "p1", "livro bom: eventos, contagem e itens da projeção");
  ok(Array.isArray(j.j?.erros) && j.j.erros.length === 0 && Array.isArray(j.j?.avisos), "livro bom: erros vazio e avisos presente");
  ok(j.j?.regras?.L4 === "ok" && j.j?.regras?.L5 === "ok" && Object.keys(j.j?.regras ?? {}).length === 8, "livro bom: as regras L1 a L8, uma por uma");

  const vazio = path.join(tmp, "vazio");
  fs.mkdirSync(vazio);
  fs.writeFileSync(path.join(vazio, "atores.txt"), `executor ${EXE}\n`);
  j = json(vazio);
  ok(j.code === 0 && j.j?.ok === true && j.j?.eventos === 0 && j.j?.itens?.length === 0, "livro sem eventos: ok, zero eventos, zero itens");
  ok(j.j?.avisos?.some((a) => /nenhum humano declarado/.test(a.msg)), "atores.txt sem humano: aviso, sem reprovar");
  ok(!json(dir).j?.avisos?.some((a) => /nenhum humano declarado/.test(a.msg)), "atores.txt com humano: sem esse aviso");

  const adulterado = path.join(tmp, "adulterado");
  fs.cpSync(dir, adulterado, { recursive: true });
  const ls = fs.readFileSync(path.join(adulterado, `events.${EXE}.jsonl`), "utf8").split("\n");
  fs.writeFileSync(path.join(adulterado, `events.${EXE}.jsonl`), [ls[0].replace("Página de preços", "Página de preços editada"), ...ls.slice(1)].join("\n"));
  j = json(adulterado);
  ok(j.code === 1 && j.j?.ok === false && j.j?.regras?.L4 === "falha", "livro adulterado: código 1, ok false, L4 em falha");
  ok(j.j?.erros?.some((e) => e.regra === "L4" && e.linha === 2), "livro adulterado: o erro aponta a linha seguinte à editada");

  j = json(path.join(tmp, "nao-existe"));
  ok(j.code === 1 && j.j?.ok === false && /atores\.txt|não existe/.test(j.j?.falha ?? ""), "pasta que não existe: código 1, ok false e o motivo em falha");
  console.log("");

  // ── 4. atribuição pelo git (L9) ────────────────────────────────────────────

  console.log("[git] atribuição de cada linha pelo commit que a trouxe (L9)\n");
  const temKeygen = spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).error === undefined;
  if (!temKeygen) {
    console.log("  n/a — sem ssh-keygen nesta máquina\n");
  } else {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    const git = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    git("init", "--quiet", "-b", "main");
    const chave = (nome) => {
      const k = path.join(tmp, `chave-${nome}`);
      spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", nome, "-f", k]);
      return { priv: k.replace(/\\/g, "/"), pub: fs.readFileSync(`${k}.pub`, "utf8").trim() };
    };
    const kExe = chave("exe");
    const kHum = chave("hum");
    const assinantes = path.join(tmp, "allowed_signers");
    fs.writeFileSync(assinantes, `${EXE} ${kExe.pub}\n${HUM} ${kHum.pub}\n`);
    for (const [c, v] of [["user.name", "teste"], ["user.email", "teste@invalid"], ["gpg.format", "ssh"], ["gpg.ssh.allowedSignersFile", assinantes.replace(/\\/g, "/")], ["commit.gpgsign", "false"]]) git("config", c, v);
    const commit = (k, msg) => git("-c", `user.signingkey=${k.priv}`, "commit", "--quiet", "-S", "-m", msg);

    const lr = path.join(repo, "ledger");
    fs.mkdirSync(lr);
    fs.writeFileSync(path.join(lr, "atores.txt"), `executor ${EXE}\nhumano ${HUM}\n`);
    fs.writeFileSync(path.join(lr, ".gitattributes"), "*.jsonl text eol=lf\n");
    cli("append", lr, "--actor", EXE, "--type", "item", "--item", "g1", "--titulo", "Item no git", "--base", BASE);
    git("add", "ledger/atores.txt", "ledger/.gitattributes");
    commit(kHum, "atores");
    git("add", `ledger/events.${EXE}.jsonl`);
    const c1 = commit(kExe, "a chave de máquina traz a própria linha");
    ok(c1.status === 0, "montou o commit assinado pela chave de máquina");
    cli("append", lr, "--actor", EXE, "--type", "comentario", "--item", "g1", "--texto", "ainda fora do git", "--base", BASE);

    r = cli("check", lr, "--git");
    ok(r.code === 0 && /não atribuída/.test(r.out), "linha da chave do próprio ator passa; linha fora do git sai como não atribuída, sem reprovar");

    git("add", `ledger/events.${EXE}.jsonl`);
    commit(kHum, "o humano traz a linha do executor");
    r = cli("check", lr, "--git");
    ok(r.code === 0 && /trazida pelo humano/.test(r.out), "linha do executor trazida pelo humano é aviso, não erro");

    cli("append", lr, "--actor", HUM, "--type", "comentario", "--item", "g1", "--texto", "linha do humano", "--base", BASE);
    git("add", `ledger/events.${HUM}.jsonl`);
    commit(kExe, "a chave de máquina traz a linha do humano");
    r = cli("check", lr, "--git");
    ok(r.code === 1 && /L9/.test(r.out), "chave de máquina trazendo a linha de outro ator reprova (L9)");
    git("reset", "--quiet", "--hard", "HEAD~1");
    fs.rmSync(path.join(lr, `events.${HUM}.jsonl`), { force: true });

    cli("append", lr, "--actor", EXE, "--type", "comentario", "--item", "g1", "--texto", "junto com outro arquivo", "--base", BASE);
    fs.writeFileSync(path.join(repo, "outro.txt"), "x\n");
    git("add", `ledger/events.${EXE}.jsonl`, "outro.txt");
    commit(kExe, "a chave de máquina toca outro caminho");
    r = cli("check", lr, "--git");
    ok(r.code === 1 && /L9/.test(r.out) && /outro\.txt/.test(r.out), "commit da chave de máquina que toca outro caminho reprova (L9), e o caminho é nomeado");
    git("reset", "--quiet", "--hard", "HEAD~1");

    cli("append", lr, "--actor", EXE, "--type", "comentario", "--item", "g1", "--texto", "sem assinatura", "--base", BASE);
    git("add", `ledger/events.${EXE}.jsonl`);
    git("commit", "--quiet", "--no-gpg-sign", "-m", "sem assinatura");
    r = cli("check", lr, "--git");
    ok(r.code === 1 && /L9/.test(r.out), "linha trazida por commit sem assinatura G reprova (L9)");

    // a projeção deriva assinado do git, sobre o mesmo SHA revisado
    const lr2 = path.join(repo, "ledger2");
    fs.mkdirSync(lr2);
    fs.writeFileSync(path.join(lr2, "atores.txt"), `executor ${EXE}\nrevisor ${REV}\nhumano ${HUM}\n`);
    fs.writeFileSync(path.join(repo, "codigo.txt"), "trabalho\n");
    git("add", "codigo.txt");
    commit(kHum, "o humano assina o trabalho");
    const shaHum = git("rev-parse", "HEAD").stdout.trim();
    fs.writeFileSync(path.join(repo, "codigo.txt"), "trabalho 2\n");
    git("add", "codigo.txt");
    commit(kExe, "a máquina assina outro trabalho");
    const shaExe = git("rev-parse", "HEAD").stdout.trim();
    for (const [item, sha] of [["s1", shaHum], ["s2", shaExe]]) {
      cli("append", lr2, "--actor", EXE, "--type", "item", "--item", item, "--titulo", item, "--base", BASE);
      cli("append", lr2, "--actor", EXE, "--type", "transicao", "--item", item, "--de", "a_fazer", "--para", "em_andamento", "--base", BASE);
      cli("append", lr2, "--actor", EXE, "--type", "transicao", "--item", item, "--de", "em_andamento", "--para", "aguardando_revisao", "--sha", sha, "--base", BASE);
      cli("append", lr2, "--actor", REV, "--type", "transicao", "--item", item, "--de", "aguardando_revisao", "--para", "revisado", "--base", BASE);
    }
    r = cli("rebuild", lr2, "--stdout");
    const p2 = tentar(() => JSON.parse(r.out));
    const sit = (i) => p2?.itens?.find((x) => x.item === i)?.situacao;
    ok(sit("s1") === "assinado" && sit("s2") === "revisado", "rebuild com git: G do humano no SHA revisado dá assinado; G da máquina, não");
  }
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows às vezes segura o handle; a pasta é temporária de qualquer jeito */
  }
}

console.log(falhas ? `\ntest-livro: ${falhas} de ${total} falharam.` : `\ntest-livro: tudo passou (${total} asserções).`);
process.exit(falhas ? 1 : 0);
