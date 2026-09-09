#!/bin/bash
# checar-nome.sh — disponibilidade de nome em npm e domínios.
#
# uso: bash scripts/checar-nome.sh <nome> [nome...]
#
# O que ele NÃO faz, de propósito:
#   - GitHub: fora da bateria. O repositório mora sob o namespace do autor
#     (<usuario>/<nome>), então o handle da organização não trava a escolha.
#   - USPTO: a busca é aplicação de página única servida de armazenamento
#     estático, sem API pública. É ato humano, com navegador.
#
# Três defeitos reais que este script existe para não repetir, os três pegos
# por execução e nenhum por leitura:
#
#   1. rdap.org devolve 404 para QUALQUER domínio .io — ele não cobre esse
#      TLD, e 404 no protocolo RDAP significa "não existe". O resultado era
#      "livre" para .io ocupado: `stripe.io` aparecia livre. Por isso .io vai
#      ao RDAP da Identity Digital, que é o registro dele.
#   2. api.github.com responde 403 por limite de taxa, não "ocupado". Ler 403
#      como ocupado transformava esgotamento de cota em resposta de negócio.
#   3. rdap.org é INSTÁVEL sob consultas seguidas. Três execuções do mesmo
#      alvo devolveram `?302` (redirecionamento não seguido), `?000` (conexão
#      falhou) e a resposta correta. Uma execução isolada não decide nada:
#      cada consulta é repetida até obter um código terminal.
#
#   4. .co NÃO TEM servidor RDAP em lugar nenhum (medido em 2026-09-05: zero
#      ocorrências de "co" no bootstrap da IANA, data.iana.org/rdap/dns.json;
#      rdap.nic.co não resolve; rdap.org devolve 404 para stripe.co). É o
#      defeito 1 de novo, e desta vez sem registro para onde desviar: por RDAP,
#      todo .co ocupado sairia LIVRE. Foi assim que a bateria de 2026-09-02
#      não pegou shizune.co, que estava no ar. Por isso .co é consultado por
#      DNS (registro NS via nslookup): NS presente prova ocupado; NS ausente
#      NÃO prova livre — domínio registrado e sem zona também não responde —
#      e sai como "?ns". Sinal de um lado só, declarado como tal.
#
# Daí a regra desta saída: só 404 vira LIVRE e só 200 vira reg. Qualquer outro
# código aparece como "?<codigo>" — desconhecido é desconhecido, nunca "livre".
# `?` numa coluna significa "refazer a consulta", nunca "pode usar". Na coluna
# .co não existe LIVRE: o máximo que ela afirma é "reg" ou "?ns".
#
# TESTE NEGATIVO OBRIGATÓRIO, antes de confiar em qualquer resultado:
#   bash scripts/checar-nome.sh stripe
# tem de dar "reg" em .com, .io, .dev, .app e .co. LIVRE ou "?" em qualquer
# coluna significa checador quebrado ou instável, e nenhum resultado dele pode
# ser usado enquanto não sair limpo.

TENTATIVAS=4

# Consulta uma URL e devolve o código HTTP. Repete enquanto a resposta não for
# terminal (404 = não existe, 200 = existe); qualquer outra coisa é ruído de
# transporte ou de limite de taxa, não resposta sobre o domínio.
consultar() {
  local url="$1" c i
  for ((i = 1; i <= TENTATIVAS; i++)); do
    c=$(curl -sL -m 25 -o /dev/null -w "%{http_code}" "$url")
    case "$c" in 404 | 200) break ;; esac
  done
  echo "$c"
}

rotular() {
  case "$1" in 404) echo LIVRE ;; 200) echo reg ;; *) echo "?$1" ;; esac
}

# .co por DNS (defeito 4): "reg" se o domínio tem registro NS, "?ns" se não tem
# ou se a consulta falhou. Nunca LIVRE. nslookup existe no Windows e na maioria
# dos Linux; sem ele, a coluna diz "?tool" em vez de fingir que consultou.
consultar_ns() {
  local dom="$1" saida
  command -v nslookup >/dev/null 2>&1 || { echo "?tool"; return; }
  saida=$(nslookup -type=NS "$dom" 2>&1)
  if printf '%s' "$saida" | grep -qi "nameserver = "; then echo reg; else echo "?ns"; fi
}

printf "%-9s %-8s %-6s %-6s %-6s %-6s %-6s\n" nome npm .com .io .dev .app .co
for n in "$@"; do
  npm_c=$(consultar "https://registry.npmjs.org/$n")
  case "$npm_c" in 404) npm=LIVRE ;; 200) npm=ocup ;; *) npm="?$npm_c" ;; esac

  for tld in com dev app; do
    eval "d_$tld=$(rotular "$(consultar "https://rdap.org/domain/$n.$tld")")"
  done
  d_io=$(rotular "$(consultar "https://rdap.identitydigital.services/rdap/domain/$n.io")")
  d_co=$(consultar_ns "$n.co")

  printf "%-9s %-8s %-6s %-6s %-6s %-6s %-6s\n" "$n" "$npm" "$d_com" "$d_io" "$d_dev" "$d_app" "$d_co"
done
