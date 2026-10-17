// test-rodada-noturna.mjs — teste negativo da rodada noturna.
//
// A rodada roda sozinha, de madrugada, sem ninguém olhando. Ela só vale se for
// impossível ela fazer mais do que ler e escrever um recap. Este teste monta,
// em os.tmpdir(), um Brain de mentira (um repositório git com registro de
// projetos, um livro e um doctor falso), dois repositórios de projeto e um
// repositório de projeto BLOQUEADO, e exige:
//
//   1. com uma variável de credencial no ambiente, recusa, nomeia a variável,
//      nunca o valor, e não escreve nada;
//   2. com chave carregada no ssh-agent, recusa e diz como desligar;
//   3. o projeto bloqueado não aparece no recap, e o repositório dele (cujo
//      `.git` aponta para lugar nenhum, para qualquer git lá falhar alto) fica
//      intocado;
//   4. o doctor roda numa cópia temporária, e não na árvore, e a cópia some;
//   5. nenhum arquivo muda além do recap: o hash de todos os arquivos, `.git`
//      incluído, antes e depois;
//   6. cada número do recap vem com o comando que o gerou;
//   7. rodar de novo no mesmo minuto não sobrescreve o recap;
//   8. o fonte não tem caminho de rede, de escrita no git nem de modelo.
//
// Sem git, o teste se declara n/a.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SCRIPT = path.join(AQUI, "rodada-noturna.mjs");
const LIVRO = path.join(AQUI, "livro.mjs");

let falhas = 0;
let total = 0;
const ok = (cond, msg) => {
  total++;
  console.log(cond ? `  ok    ${msg}` : `  FALHA ${msg}`);
  if (!cond) falhas++;
};

if (spawnSync("git", ["--version"]).error) {
  console.log("test-rodada-noturna: n/a — sem git nesta máquina.");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rodada-test-"));
const barra = (p) => p.replace(/\\/g, "/");
const git = (dir, ...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const novoRepo = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "--quiet", "-b", "main");
  for (const [c, v] of [["user.name", "teste"], ["user.email", "teste@invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) git(dir, "config", c, v);
};
const commitar = (dir, msg) => {
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "--no-gpg-sign", "-m", msg);
};

/** sha256 de cada arquivo sob as pastas, .git incluído. */
function retrato(...raizes) {
  const m = new Map();
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.isFile()) m.set(p, createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
    }
  };
  for (const r of raizes) andar(r);
  return m;
}

// sem token nenhum no ambiente do filho: o teste controla o que ele herda
const AMBIENTE_LIMPO = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/TOKEN|API_?KEY|SECRET|PASSWORD|PASSWD|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL/i.test(k)),
);

try {
  // ── a bancada ──────────────────────────────────────────────────────────────
  const brain = path.join(tmp, "brain");
  const repoA = path.join(tmp, "dev", "projeto-a");
  const repoB = path.join(tmp, "dev", "projeto-b");
  const repoX = path.join(tmp, "dev", "cliente-x");
  novoRepo(brain);
  fs.mkdirSync(path.join(brain, "scripts"), { recursive: true });
  fs.copyFileSync(LIVRO, path.join(brain, "scripts", "livro.mjs"));
  // o doctor falso diz onde rodou; o teste confere que não foi na árvore
  fs.writeFileSync(
    path.join(brain, "scripts", "doctor.mjs"),
    'console.log("doctor falso rodou em " + process.cwd().replace(/\\\\/g, "/"));\nconsole.log("\\nResultado: OK — os 2 verificadores passaram.");\n',
  );
  fs.mkdirSync(path.join(brain, "governance"), { recursive: true });
  fs.writeFileSync(
    path.join(brain, "governance", "registro-projetos.yaml"),
    [
      "atualizado: 2026-10-15",
      "",
      "projetos:",
      "  - slug: brain-teste",
      "    status: ativo",
      `    repo: '${barra(brain)}'`,
      "",
      "  - slug: projeto-a",
      "    status: ativo",
      `    repo: '${barra(repoA)}'`,
      "",
      "  - slug: projeto-b",
      "    status: planejado",
      `    repo: '${barra(repoB)}'`,
      "",
      "  - slug: cliente-x",
      "    status: bloqueado",
      `    repo: '${barra(repoX)}'`,
      "",
      "  - slug: sem-repo",
      "    status: planejado",
      "    repo: null",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(brain, "governance", "livros.txt"), "projects/brain-teste/ledger\n");
  const ledger = path.join(brain, "projects", "brain-teste", "ledger");
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, "atores.txt"), "executor shizune-local@maquina\n");
  spawnSync(process.execPath, [LIVRO, "append", ledger, "--actor", "shizune-local@maquina", "--type", "item", "--item", "t1", "--titulo", "Item de teste", "--base", "c".repeat(40), "--sem-git"]);
  fs.mkdirSync(path.join(brain, "logs", "2026", "operador"), { recursive: true });
  fs.writeFileSync(path.join(brain, "logs", "2026", "operador", ".gitkeep"), "");
  commitar(brain, "brain de teste");
  fs.writeFileSync(path.join(brain, "fora-do-git.txt"), "x\n");

  novoRepo(repoA);
  fs.mkdirSync(path.join(repoA, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoA, "src", "a.js"), "1\n");
  fs.writeFileSync(path.join(repoA, "src", "b.js"), "2\n");
  fs.writeFileSync(path.join(repoA, "README.md"), "a\n");
  commitar(repoA, "a");
  fs.writeFileSync(path.join(repoA, "src", "a.js"), "1 mudou\n");
  fs.writeFileSync(path.join(repoA, ".env"), "SEGREDO=nao-pode-aparecer\n");

  fs.mkdirSync(repoB, { recursive: true }); // existe e não é git

  // o bloqueado: um .git que aponta para lugar nenhum
  fs.mkdirSync(repoX, { recursive: true });
  fs.writeFileSync(path.join(repoX, ".git"), "gitdir: ./nao-existe\n");
  fs.writeFileSync(path.join(repoX, "dado-de-cliente.txt"), "nunca ler\n");

  // ssh-add falsos: um "com chave" (sai 0) e um "sem chave" (sai 1)
  const comChave = path.join(tmp, "ssh-add-com-chave.mjs");
  const semChave = path.join(tmp, "ssh-add-sem-chave.mjs");
  fs.writeFileSync(comChave, 'console.log("256 SHA256:falso chave (ED25519)"); process.exit(0);\n');
  fs.writeFileSync(semChave, 'console.log("The agent has no identities."); process.exit(1);\n');

  const AGORA = "2026-10-16T03:00:00";
  const rodada = (env, sshAdd, ...extra) => {
    const r = spawnSync(process.execPath, [SCRIPT, "--raiz", brain, "--recap", "operador", "--agora", AGORA, "--ssh-add", `${process.execPath}|${sshAdd}`, ...extra], {
      encoding: "utf8",
      env,
    });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const recap = path.join(brain, "logs", "2026", "operador", "2026-10-16-03-00-rodada-noturna.md");

  // ── 1. credencial no ambiente ──────────────────────────────────────────────
  console.log("[travas] credencial no ambiente e chave no agente\n");
  let r = rodada({ ...AMBIENTE_LIMPO, GH_TOKEN: "valor-secreto-123" }, semChave);
  ok(r.code === 2, "com GH_TOKEN no ambiente: recusa (código 2)");
  ok(/GH_TOKEN/.test(r.out) && !/valor-secreto-123/.test(r.out), "nomeia a variável e nunca mostra o valor");
  ok(/Remove-Item Env:GH_TOKEN|como desligar/i.test(r.out), "diz como desligar");
  ok(!fs.existsSync(recap), "não escreveu recap");

  // ── 2. chave no ssh-agent ──────────────────────────────────────────────────
  r = rodada(AMBIENTE_LIMPO, comChave);
  ok(r.code === 2 && /ssh-agent/.test(r.out) && /ssh-add -D/.test(r.out), "com chave no ssh-agent: recusa e diz como tirar (ssh-add -D)");
  ok(!/SHA256:falso/.test(r.out), "não repete a impressão digital da chave");
  ok(!fs.existsSync(recap), "não escreveu recap");
  console.log("");

  // ── 3 a 6. a rodada de verdade ─────────────────────────────────────────────
  console.log("[rodada] uma rodada inteira na bancada\n");
  const antes = retrato(brain, path.join(tmp, "dev"));
  r = rodada(AMBIENTE_LIMPO, semChave);
  ok(r.code === 0 && fs.existsSync(recap), "sem credencial: roda e escreve o recap");
  const depois = retrato(brain, path.join(tmp, "dev"));
  const mudaram = [...new Set([...antes.keys(), ...depois.keys()])].filter((p) => antes.get(p) !== depois.get(p));
  ok(mudaram.length === 1 && mudaram[0] === recap, `só o recap muda na árvore (.git incluído)${mudaram.length !== 1 ? `: ${mudaram.map((p) => path.relative(tmp, p)).join(", ")}` : ""}`);

  const texto = fs.existsSync(recap) ? fs.readFileSync(recap, "utf8") : "";
  ok(/^---\nid: log-operador-2026-10-16-03-00-rodada-noturna\ntipo: relatorio\nprojeto: operador\n/.test(texto), "o recap nasce com frontmatter v2");
  ok(!/cliente-x|dado-de-cliente/.test(texto) && !/cliente-x/.test(r.out), "o projeto bloqueado não aparece, nem no recap nem na saída");
  ok(/1 projeto\(s\) bloqueado\(s\) ignorado\(s\)/.test(texto), "o recap diz quantos bloqueados ignorou, sem nomear");
  ok(/projeto-a/.test(texto) && /\| main \|/.test(texto), "o projeto-a aparece, com o ramo");
  ok(/projeto-b[^\n]*não é repositório git/.test(texto), "pasta que não é git: dito, sem erro");
  ok(!/SEGREDO|nao-pode-aparecer/.test(texto) && !/\.env/.test(texto.replace(/nunca lê `\.env`/g, "")), "nada do .env aparece");
  ok(/git -C [^`]*status --porcelain/.test(texto) && /git -C [^`]*ls-files/.test(texto) && /git -C [^`]*log -1/.test(texto), "cada número com o comando que o gerou");
  ok(/Resultado: OK — os 2 verificadores passaram/.test(texto), "o resultado do doctor está no recap");
  const ondeRodou = /doctor falso rodou em (\S+)/.exec(r.out)?.[1] ?? "";
  ok(ondeRodou !== "" && !ondeRodou.startsWith(barra(brain)) && !fs.existsSync(ondeRodou), "o doctor rodou numa cópia fora da árvore, e a cópia sumiu");
  ok(/projects\/brain-teste\/ledger[^\n]*ok/.test(texto) && /livro\.mjs check/.test(texto), "o check do livro declarado está no recap, com o comando");
  ok(/### brain-teste[\s\S]*?Fora do git \(só a contagem\) \| 1 \|/.test(texto), "o Brain mostra 1 arquivo fora do git, só a contagem");
  ok(!/fora-do-git\.txt/.test(texto), "e não o nome dele");
  ok(/### projeto-a[\s\S]*?Mudados \(versionados\) \| 1 \|[\s\S]*?Por pasta \| src 2, \(raiz\) 1 \|/.test(texto), "o projeto-a: 1 mudado, e os versionados por pasta");

  // ── 7. não sobrescreve ─────────────────────────────────────────────────────
  const bytes = fs.existsSync(recap) ? fs.readFileSync(recap) : null;
  r = rodada(AMBIENTE_LIMPO, semChave);
  ok(bytes !== null && r.code !== 0 && fs.readFileSync(recap).equals(bytes), "rodar de novo no mesmo minuto recusa e não toca no recap");
  console.log("");

  // ── 8. o fonte ─────────────────────────────────────────────────────────────
  console.log("[fonte] o que o script não pode nem ter\n");
  const fonte = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, "utf8").replace(/^\s*\/\/.*$/gm, "") : null;
  ok(fonte !== null, "o script existe");
  if (fonte !== null) for (const [proibido, nome] of [
    [/\bfetch\s*\(/, "fetch("],
    [/https?:\/\//, "URL http(s)"],
    [/["'](push|fetch|pull|commit|merge|tag|reset|checkout|switch|add|rm|clean|stash|remote)["']/, "subcomando de git que escreve ou usa rede"],
    [/\bnode:(https?|net|dgram|tls)\b/, "módulo de rede"],
    [/anthropic|openai|groq|openrouter|ollama/i, "chamada de modelo"],
    [/readFileSync\([^)]*\.env/, "leitura de .env"],
  ]) ok(!proibido.test(fonte), `sem ${nome}`);
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows às vezes segura o handle; a pasta é temporária de qualquer jeito */
  }
}

console.log(falhas ? `\ntest-rodada-noturna: ${falhas} de ${total} falharam.` : `\ntest-rodada-noturna: tudo passou (${total} asserções).`);
process.exit(falhas ? 1 : 0);
