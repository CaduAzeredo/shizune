#!/usr/bin/env node
// @ts-check
// rodada-noturna.mjs — a base determinística da rodada noturna: só leitura, sem
// modelo, sem rede, um arquivo escrito.
//
// uso: node scripts/rodada-noturna.mjs --recap <slug> [--raiz <brain>] [--agora AAAA-MM-DDTHH:MM:SS] [--ssh-add <programa>]
//
// O que ela faz, nesta ordem, e para na primeira trava:
//
//   0. as travas. Recusa (código 2) se o ambiente tiver variável com nome de
//      credencial (TOKEN, API_KEY, SECRET, PASSWORD...), olhando só o NOME, ou se
//      o ssh-agent tiver chave carregada (`ssh-add -l`). Uma rodada que roda
//      sozinha não roda com credencial à mão. A recusa diz como desligar;
//   1. lê o registro de projetos e, para cada projeto que NÃO está bloqueado,
//      lê o estado do repositório com GIT_OPTIONAL_LOCKS=0: o ramo, o último
//      commit (hash, letra da assinatura, data; a mensagem não), os arquivos
//      mudados e os fora do git (só a contagem, nenhum nome), e os versionados
//      por pasta. Projeto bloqueado nem tem a pasta aberta: o recap diz só
//      quantos foram ignorados, e nenhum caminho de cliente entra nele;
//   2. roda o doctor do Brain num clone temporário (o estado commitado, o que o
//      CI vê), e apaga o clone;
//   3. roda o `livro.mjs check --json` de cada livro de governance/livros.txt;
//   4. escreve UM arquivo: logs/<ano>/<slug>/<data>-<hh>-<mm>-rodada-noturna.md,
//      com cada número ao lado do comando que o gerou. Recap que já existe não
//      é sobrescrito.
//
// O que ela nunca faz: commit, push, fetch ou qualquer git que escreva; rede;
// chamar modelo; ler `.env` (nenhum arquivo de projeto é lido, só a saída do
// git); abrir pasta de projeto bloqueado. O teste negativo é
// scripts/test-rodada-noturna.mjs.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NOME_DE_CREDENCIAL = /TOKEN|API_?KEY|SECRET|PASSWORD|PASSWD|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL/i;

/** @param {string} msg @param {number} [codigo] @returns {never} */
function recusar(msg, codigo = 1) {
  console.error(`rodada-noturna: RECUSADA — ${msg}`);
  process.exit(codigo);
}

/** @param {string[]} argv */
function lerArgs(argv) {
  /** @type {Record<string, string>} */
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    o[argv[i].slice(2)] = argv[i + 1] ?? "";
    i++;
  }
  return o;
}

const barra = (/** @type {string} */ p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const chave = (/** @type {string} */ p) => barra(p).toLowerCase();

// ── 0. as travas ────────────────────────────────────────────────────────────

/** Os nomes das variáveis do ambiente que parecem credencial e têm valor. */
function credenciaisNoAmbiente() {
  return Object.keys(process.env)
    .filter((k) => NOME_DE_CREDENCIAL.test(k) && (process.env[k] ?? "") !== "")
    .sort();
}

/**
 * O ssh-agent: 0 = tem chave (recusa), 1 = agente sem chave, 2 = sem agente.
 * @param {string} programa o ssh-add, ou "<executável>|<argumento>" para os testes
 */
function agente(programa) {
  const [cmd, ...pre] = programa.split("|");
  const r = spawnSync(cmd, [...pre, "-l"], { encoding: "utf8" });
  if (r.error) return { recusa: false, texto: `ssh-add não encontrado (${cmd}): o agente não foi conferido`, codigo: null };
  if (r.status === 0) return { recusa: true, texto: "o ssh-agent tem chave carregada", codigo: 0 };
  if (r.status === 1) return { recusa: false, texto: "agente sem chave carregada", codigo: 1 };
  if (r.status === 2) return { recusa: false, texto: "nenhum agente rodando", codigo: 2 };
  return { recusa: true, texto: `não consegui conferir o agente (código ${r.status})`, codigo: r.status };
}

// ── 1. o registro e os repositórios ─────────────────────────────────────────

/**
 * Lê slug, status e repo do registro, linha a linha, sem parser de YAML.
 * @param {string} yaml
 */
function lerRegistro(yaml) {
  /** @type {{slug: string, status: string, repo: string | null}[]} */
  const saida = [];
  for (const linha of yaml.split(/\r?\n/)) {
    const tira = (/** @type {string} */ v) => v.trim().replace(/^['"]|['"]$/g, "");
    const slug = /^\s*-\s+slug:\s*(.+)$/.exec(linha);
    if (slug) {
      saida.push({ slug: tira(slug[1]), status: "", repo: null });
      continue;
    }
    const ultimo = saida[saida.length - 1];
    if (!ultimo) continue;
    const status = /^\s+status:\s*(.+)$/.exec(linha);
    if (status) ultimo.status = tira(status[1]);
    const repo = /^\s+repo:\s*(.+)$/.exec(linha);
    if (repo) ultimo.repo = tira(repo[1]) === "null" ? null : tira(repo[1]);
  }
  return saida;
}

const AMBIENTE_GIT = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };

/**
 * Um git de leitura, e o comando como ele foi rodado, para o recap.
 * @param {string} dir
 * @param {...string} args
 */
function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, "-c", "core.fsmonitor=false", ...args], { encoding: "utf8", env: AMBIENTE_GIT, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trimEnd(), cmd: `GIT_OPTIONAL_LOCKS=0 git -C ${barra(dir)} ${args.join(" ")}` };
}

/**
 * O estado de um repositório, só pela saída do git.
 * @param {string} dir
 */
function estado(dir) {
  if (!fs.existsSync(dir)) return { situacao: "a pasta do repositório não existe" };
  const topo = git(dir, "rev-parse", "--show-toplevel");
  if (!topo.ok || chave(topo.out) !== chave(dir)) return { situacao: "não é repositório git" };
  const ramo = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
  const ultimo = git(dir, "log", "-1", "--format=%h%x09%G?%x09%cs");
  const [hash = "—", letra = "—", data = "—"] = ultimo.ok && ultimo.out ? ultimo.out.split("\t") : [];
  const status = git(dir, "status", "--porcelain=v1", "--untracked-files=all");
  const linhas = status.out.split("\n").filter(Boolean);
  const fora = linhas.filter((l) => l.startsWith("??")).length;
  const mudados = linhas.length - fora;
  const ls = git(dir, "ls-files");
  /** @type {Map<string, number>} */
  const porPasta = new Map();
  for (const f of ls.out.split("\n").filter(Boolean)) {
    const pasta = f.includes("/") ? f.slice(0, f.indexOf("/")) : "(raiz)";
    porPasta.set(pasta, (porPasta.get(pasta) ?? 0) + 1);
  }
  const versionados = [...porPasta.values()].reduce((s, n) => s + n, 0);
  return {
    situacao: "ok",
    ramo: ramo.ok ? ramo.out : "—",
    hash,
    letra,
    data,
    mudados,
    fora,
    versionados,
    porPasta: [...porPasta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    cmds: { ramo: ramo.cmd, ultimo: ultimo.cmd, status: status.cmd, ls: ls.cmd },
  };
}

// ── 2. o doctor numa cópia ──────────────────────────────────────────────────

/** @param {string} raiz */
function doctorNumaCopia(raiz) {
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), "rodada-doctor-"));
  const destino = path.join(copia, "brain");
  try {
    const c = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", raiz, destino], { encoding: "utf8", env: AMBIENTE_GIT });
    if (c.status !== 0) return { ok: false, linhas: [`não consegui clonar o Brain: ${(c.stderr ?? "").trim().split("\n")[0]}`], resultado: "" };
    const d = spawnSync(process.execPath, [path.join(destino, "scripts", "doctor.mjs")], { cwd: destino, encoding: "utf8", env: AMBIENTE_GIT, timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const saida = `${d.stdout ?? ""}${d.stderr ?? ""}`;
    process.stdout.write(saida);
    const resumo = saida.split("\n").filter((l) => /^\s{2}(OK|FALHA|n\/a)\s/.test(l)).map((l) => l.trim());
    const resultado = (saida.split("\n").filter((l) => /^Resultado:/.test(l)).pop() ?? "").trim();
    return { ok: d.status === 0, linhas: resumo, resultado: resultado || `o doctor saiu com o código ${d.status} sem linha de resultado` };
  } finally {
    fs.rmSync(copia, { recursive: true, force: true });
    console.log(`rodada-noturna: a cópia do doctor (${barra(destino)}) foi apagada: ${!fs.existsSync(copia)}`);
  }
}

// ── 3. os livros ────────────────────────────────────────────────────────────

/** @param {string} raiz */
function livros(raiz) {
  const lista = path.join(raiz, "governance", "livros.txt");
  if (!fs.existsSync(lista)) return [];
  const dirs = fs.readFileSync(lista, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  return dirs.map((d) => {
    const abs = path.join(raiz, d);
    const cmd = `node scripts/livro.mjs check ${d} --json`;
    const r = spawnSync(process.execPath, [path.join(raiz, "scripts", "livro.mjs"), "check", abs, "--json"], { cwd: raiz, encoding: "utf8", env: AMBIENTE_GIT });
    try {
      const j = JSON.parse(r.stdout);
      /** @type {Record<string, number>} */
      const c = j.contagem ?? {};
      return {
        dir: d,
        cmd,
        ok: j.ok === true,
        eventos: j.eventos ?? 0,
        itens: (j.itens ?? []).length,
        contagem: Object.entries(c).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${n}`).join(", ") || "—",
        erros: (j.erros ?? []).length,
        avisos: (j.avisos ?? []).length,
        falha: j.falha ?? "",
      };
    } catch {
      return { dir: d, cmd, ok: false, eventos: 0, itens: 0, contagem: "—", erros: 0, avisos: 0, falha: `o check não devolveu JSON (código ${r.status})` };
    }
  });
}

// ── 4. o recap ──────────────────────────────────────────────────────────────

const o = lerArgs(process.argv.slice(2));
const slug = o.recap ?? recusar("diga --recap <slug>: a pasta de logs/<ano>/ onde o recap entra");
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) recusar(`--recap inválido: ${slug}`);
const raiz = path.resolve(o.raiz ?? path.dirname(AQUI));

const credenciais = credenciaisNoAmbiente();
if (credenciais.length) {
  recusar(
    `há variável com nome de credencial no ambiente: ${credenciais.join(", ")}. ` +
      "A rodada roda sozinha e não roda com credencial à mão. Como desligar, no PowerShell: " +
      credenciais.map((k) => `Remove-Item Env:${k}`).join("; ") +
      " (só nesta janela). Se ela vier do ambiente do seu usuário do Windows, para tirar de vez: " +
      credenciais.map((k) => `[Environment]::SetEnvironmentVariable('${k}', $null, 'User')`).join("; ") +
      ". Nenhum valor foi lido nem mostrado.",
    2,
  );
}
const ag = agente(o["ssh-add"] || "ssh-add");
if (ag.recusa) {
  recusar(
    `${ag.texto}. A rodada não roda com chave à mão. Para tirar as chaves do ssh-agent: ssh-add -D. ` +
      "Para parar o agente do Windows: Stop-Service ssh-agent (como administrador). Depois, rode de novo.",
    2,
  );
}

const registroPath = path.join(raiz, "governance", "registro-projetos.yaml");
if (!fs.existsSync(registroPath)) recusar(`não achei ${barra(registroPath)}`);
const registro = lerRegistro(fs.readFileSync(registroPath, "utf8"));

const agora = o.agora ? new Date(o.agora) : new Date();
if (Number.isNaN(agora.getTime())) recusar(`--agora inválido: ${o.agora}`);
const p2 = (/** @type {number} */ n) => String(n).padStart(2, "0");
const data = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}`;
const hh = p2(agora.getHours());
const mm = p2(agora.getMinutes());
const pastaRecap = path.join(raiz, "logs", String(agora.getFullYear()), slug);
const arquivoRecap = path.join(pastaRecap, `${data}-${hh}-${mm}-rodada-noturna.md`);
if (fs.existsSync(arquivoRecap)) recusar(`o recap ${barra(path.relative(raiz, arquivoRecap))} já existe; um registro datado não se sobrescreve`);

// bloqueado: fora, e a pasta dele nem se abre; nem pasta dentro dela, nem pasta "clientes"
const bloqueados = registro.filter((p) => p.status === "bloqueado");
const pastasBloqueadas = bloqueados.filter((p) => p.repo).map((p) => chave(/** @type {string} */ (p.repo)));
const ehBloqueada = (/** @type {string} */ repo) =>
  pastasBloqueadas.some((b) => chave(repo) === b || chave(repo).startsWith(`${b}/`)) || /(^|\/)clientes(\/|$)/i.test(chave(repo));
const lidos = registro.filter((p) => p.status !== "bloqueado" && p.repo && !ehBloqueada(p.repo));
const ignorados = registro.length - lidos.length - registro.filter((p) => p.status !== "bloqueado" && !p.repo).length;
const semRepo = registro.filter((p) => p.status !== "bloqueado" && !p.repo).length;

console.log(`rodada-noturna: ${lidos.length} repositório(s) a ler; ${ignorados} bloqueado(s) ignorado(s)`);
const estados = lidos.map((p) => ({ p, e: estado(/** @type {string} */ (p.repo)) }));
const doctor = doctorNumaCopia(raiz);
const ls = livros(raiz);

const L = [];
L.push("---", `id: log-${slug}-${data}-${hh}-${mm}-rodada-noturna`, "tipo: relatorio", `projeto: ${slug}`, "status: vigente", `data: ${data}`, "autor: rodada-noturna", "---", "");
L.push(`# Rodada noturna de ${data}, ${hh}h${mm}: repositórios, doctor e livros`, "");
L.push("Registro datado e imutável, escrito pela rodada noturna (`scripts/rodada-noturna.mjs`), sem modelo e sem rede. É a base determinística: só números, cada um ao lado do comando que o gerou. Um resumo em texto, se houver, vem depois e de outra fonte.", "");
L.push("## 0. As travas", "");
L.push("- **Credencial no ambiente:** nenhuma variável com nome de credencial. A conferência é pelo nome; nenhum valor foi lido.");
L.push(`- **ssh-agent:** ${ag.texto} (\`ssh-add -l\`${ag.codigo !== null ? `, código ${ag.codigo}` : ""}).`);
L.push(`- **Projetos:** ${registro.length} no registro (\`governance/registro-projetos.yaml\`); ${lidos.length} lido(s); ${ignorados} projeto(s) bloqueado(s) ignorado(s), sem abrir a pasta; ${semRepo} sem repositório.`, "");
L.push("## 1. Repositórios", "");
for (const { p, e } of estados) {
  L.push(`### ${p.slug} — \`${barra(/** @type {string} */ (p.repo))}\``, "");
  if (e.situacao !== "ok") {
    L.push(`${p.slug}: ${e.situacao}.`, "");
    continue;
  }
  const s = /** @type {Required<typeof e>} */ (e);
  L.push("| Medida | Valor | Comando |", "|---|---|---|");
  L.push(`| Ramo | ${s.ramo} | \`${s.cmds.ramo}\` |`);
  L.push(`| Último commit | \`${s.hash}\`, assinatura \`${s.letra}\`, ${s.data} | \`${s.cmds.ultimo}\` |`);
  L.push(`| Mudados (versionados) | ${s.mudados} | \`${s.cmds.status}\` |`);
  L.push(`| Fora do git (só a contagem) | ${s.fora} | o mesmo |`);
  L.push(`| Versionados | ${s.versionados} | \`${s.cmds.ls}\` |`);
  const top = s.porPasta.slice(0, 6).map(([d, n]) => `${d} ${n}`).join(", ");
  const resto = s.porPasta.length > 6 ? `; mais ${s.porPasta.length - 6} pasta(s)` : "";
  L.push(`| Por pasta | ${top || "—"}${resto} | o mesmo |`, "");
}
L.push("## 2. O doctor do Brain, numa cópia", "");
L.push(`Num clone temporário do Brain (\`git clone --quiet --no-hardlinks ${barra(raiz)} <temporário>\`), que é o estado commitado, o que o CI vê, e não o disco. O clone foi apagado no fim. Comando: \`node scripts/doctor.mjs\`, na cópia.`, "");
if (doctor.linhas.length) L.push("```", ...doctor.linhas, "```", "");
L.push(`**${doctor.resultado}**`, "");
L.push("## 3. Os livros", "");
if (!ls.length) L.push("Nenhum livro declarado (`governance/livros.txt` não existe ou está vazio).", "");
else {
  L.push("| Livro | Check | Eventos | Itens | Por situação | Erros | Avisos | Comando |", "|---|---|---|---|---|---|---|---|");
  for (const x of ls) L.push(`| \`${x.dir}\` | ${x.ok ? "ok" : `**FALHA**${x.falha ? `: ${x.falha}` : ""}`} | ${x.eventos} | ${x.itens} | ${x.contagem} | ${x.erros} | ${x.avisos} | \`${x.cmd}\` |`);
  L.push("");
}
L.push("## 4. O que esta rodada não fez", "");
L.push("Não fez commit, push, fetch nem nada pela rede; não chamou modelo; nunca lê `.env` (nenhum arquivo de projeto é lido, só a saída do git); não abriu pasta de projeto bloqueado. O único arquivo escrito é este.", "");

fs.mkdirSync(pastaRecap, { recursive: true });
// "wx": falha se o arquivo aparecer entre a conferência acima e esta escrita
fs.writeFileSync(arquivoRecap, `${L.join("\n")}`, { encoding: "utf8", flag: "wx" });
console.log(`rodada-noturna: recap escrito em ${barra(path.relative(raiz, arquivoRecap))}. Resultado: OK`);
