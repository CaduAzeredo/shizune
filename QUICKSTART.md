# Quickstart — Shizune

From zero to a governed project in five steps: install, scaffold, fill in the context, run the pipeline, validate.

## 1. Prerequisites

- **Bun** (recommended) or **Node.js 20+** — the scripts are `.mjs` and run on either.
- **git** — Shizune is versioned from the first commit.

## 2. Get the framework

Clone the framework repository into the folder that will become your Shizune:

```bash
git clone https://github.com/CaduAzeredo/shizune.git shizune
cd shizune
```

If you would rather start without history, copy the files and run `git init` in the folder.

## 2b. Adopting Shizune in a repository that already exists

The step above assumes an empty folder. Most repositories are not empty. Two layouts work,
and they differ in one thing only: **which history `git log` reads.**

**Inside the code repository, as a subfolder.** Copy the framework into `shizune/` at the
root of your project and commit it there. Every script resolves its own root as the parent
of `scripts/`, so they operate on `shizune/` and leave the rest of your tree alone — and
because that folder sits inside your repository, `validate-decisions.mjs` reads the history
of the code itself. The `Decision:` trailer in your commits and the record that answers for
it live in the same history. This is the layout to prefer, and it behaves the same whether
you run the script from the repository root or from inside `shizune/`:

```bash
node shizune/scripts/validate-decisions.mjs   # from the repository root
cd shizune && node scripts/validate-decisions.mjs
```

**Beside it, as a separate repository.** Keep governance in its own repository. This leaves
the code tree untouched, and it costs the thing the layer exists for: the validator now
reads the governance repository's history, where your code commits are not. A trailer
written in a code commit is invisible to a validator running next door. If you choose this,
run the decision check in the code repository's CI instead, with `--arvore` pointing at the
code checkout.

Either way, `validate-structure.mjs` enforces an allowlist at the Shizune root. Files of
yours that are not part of the framework belong outside that folder, or the check will
report them.

## 3. Scaffold a project

```bash
bun scripts/new-project.mjs <slug>
```

Use a short kebab-case slug (for example `my-app`). The script creates `projects/<slug>/` with `CONTEXT.md` and `DOMAIN.md` (from the templates), plus `specs/`, `tickets/` and `handoffs/`.

## 4. Fill in the context with the pipeline

A project's `CONTEXT.md` is not written in one sitting — it is the output of the skill pipeline:

1. **`grill-with-docs`** — the agent interviews you (and reads whatever documentation exists) until it has extracted what the project is, what it is not, and which facts are verified. Always start here.
2. **`domain-modeling`** — models the entities, invariants and vocabulary of the domain.
3. **`to-spec`** — turns the model into specifications an agent can execute against.
4. **`implement`** — the executing agent implements against the spec, in the code repository, outside Shizune.
5. **`handoff`** — records state, decisions and next steps under `projects/<slug>/handoffs/`, so the next session starts without losing context.

The **`writing-for-agents`** meta-skill governs how every document is written: precise, verifiable, no filler. A complete worked example — context, domain, spec, tickets and a handoff pair — lives in `examples/course-platform-demo/`.

> Note: the skill files themselves are currently written in Brazilian Portuguese; English translation lands in the next minor release. Their `name` and `description` fields are in English, so agent discovery works either way.

## 5. Validate the structure

```bash
bun scripts/doctor.mjs
```

One command runs every check: structure (folder tree and the frontmatter of every `.md`, with the six required fields `id`, `tipo`, `projeto`, `status`, `data`, `autor`, plus a secret scan), broken relative links, prose references to files that do not exist, governance state, the decision record, the public export in dry-run, and the negative tests that prove the decision validator and the index generator actually fail when they should. Run it before every commit; invalid structure is a bug, not a detail.

Two of the steps report `n/a` here and that is correct: the export dry-run and the pointer-lint test only apply in the private instance a package is exported from.

If you prefer running them one at a time, each remains available on its own: `validate-structure.mjs`, `validate-links.mjs`, `validate-prose-refs.mjs`, `validate-state.mjs`, `validate-decisions.mjs` and `export-public.mjs`.

## 6. Record decisions, and decide whether to require signatures

`governance/registro-decisoes.md` ships empty on purpose. It is the thin layer that lets CI answer *"which decision covers this change, and who signed it?"* — a commit carries `Decision: DEC-001` in its trailer, and the validator fails the build when a commit cites a decision that does not exist, or one nobody has signed yet.

```bash
bun scripts/validate-decisions.mjs
```

A decision is born as a draft — the row exists and marks itself `rascunho, assinatura pendente`, and any commit that leans on it fails. It starts counting when a human puts their name and a commit SHA on the row. The machine drafts, the human signs, the SHA activates.

**Requiring verified key signatures is optional and off by default.** Two files switch it on, and both must live inside your repository, because a trust list that exists only on the signer's machine tells a third party's CI nothing:

- `governance/fronteira-de-autoria.txt` — one commit SHA, the **authorship frontier**. Every commit after it must carry a signature from a trusted key. Lines starting with `#` are comments; the first non-comment line wins.
- `.github/allowed_signers` — the trust list, in `ssh-keygen` allowed-signers format, pointed at by `git config gpg.ssh.allowedSignersFile .github/allowed_signers`.

Only a good signature **from a key on that list** counts. "Somebody signed" is not "the owner signed", and the frontier is about authorship.

If neither file exists nothing fails: the validator warns that no frontier is configured and still checks numbering, drafts, signers and SHAs. Turn the layer on when you have a key — and do not describe your record as cryptographically verified before then. Claiming more than the check performs is the defect this framework exists to catch.

In CI, check out with full history (`fetch-depth: 0`); a shallow clone cannot reach the frontier commit, and the check is skipped with a warning rather than enforced.

### More than one person

`.github/allowed_signers` takes as many principals as your team has. Every key on the list
counts as trusted, and the authorship frontier is a single shared SHA: it says "from this
commit on, everybody signs", not "this person signs".

**The limit, stated plainly:** by default the `Signer` column is free text, and the
validator does not check it against the key that actually signed. A row saying `ana` whose
commit was signed with `bruno`'s key passes. What the check proves is that *a trusted key*
signed the commit the row points at — not which of them.

If you need that, a third optional file closes it:

```
governance/chaves-de-assinatura.txt
```

Each line is either `assinante <name in the Signer column> <principal in allowed_signers>`
or `maquina <principal>`. With it declared, a row whose signer does not match the principal
that signed its commit **fails**, and so does any decision signed by a key marked `maquina`
— the key an automated agent uses for draft work, which must never sign a decision. A
signer name absent from the file **warns** and does not fail, so free-text names keep
working. Absent the file, nothing changes.

### Squash, rebase, and the two things that break

This layer rests on two facts git keeps: a trailer in a commit message, and a SHA that
resolves. Both are rewritable, and rewriting them is routine on most teams.

**Squash merge drops the trailer.** A squash builds a new message; whatever survives from
the branch commits lands in the body rather than as a trailer, and is editable by whoever
presses the button. A `Decision:` line written in a branch commit may simply not exist in
the merged history. If your team squashes, put the trailer in the squash message itself —
that is the commit the record will have to answer for. Merge commits and rebase-and-merge
preserve the original messages, and are the safer default here.

**Rebase rewrites the SHA you already signed.** The signature column holds the SHA of the
commit where a human approved the decision. Rebasing that commit — or anything before it —
produces a new SHA, and the old one survives only in your local object store. Somebody
cloning the repository gets a row pointing at a commit that does not exist for them, and
the validator fails, correctly.

The practice that avoids it: **sign a decision on a commit that is already on the main
branch, and never rewrite that branch.** Approve first, cite afterwards.

What to do when it happens anyway is not settled here, and we would rather say so than ship
a rule we have not decided. The row is signed, and signed rows are not edited; but the SHA
it carries no longer resolves. Both cannot stay true. Until that is decided, the honest
move is a new row that supersedes the broken one, with the reason written down.

## Setup prompt

Paste this prompt into your agent (Claude Code, or equivalent) at the root of Shizune to start a new project:

```text
You are at the root of a Shizune repository. Before doing anything:

1. Read AGENTS.md in full — it is the operating contract that governs how you
   write and what you may touch in this repository.
2. Read skills/README.md to learn the available skill pipeline
   (grill-with-docs -> domain-modeling -> to-spec -> implement -> handoff).

Then walk me through the pipeline for project <slug>:
- Start with the grill-with-docs skill: interview me until you have enough
  facts, and fill in projects/<slug>/CONTEXT.md, marking as HYPOTHESIS
  anything I do not confirm with evidence.
- Advance one skill at a time, asking for my approval before moving on.
- Every .md file you create is born with the v2 frontmatter defined in
  AGENTS.md. When you finish, run bun scripts/doctor.mjs and fix every
  error before stopping.
```

## Next steps

- The framework `README.md` — the overview.
- `AGENTS.md` — the full agent contract.
- `templates/` — ADR, spec, handoff and status templates for the remaining artifacts.
