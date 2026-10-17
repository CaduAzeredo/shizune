# CONTRIBUTING — How to contribute to Shizune

This guide defines the conventions any contribution must follow — from humans or agents — in a Shizune instance: commits, ADRs, frontmatter, archiving, security and licence.

---

## 1. Language and naming

- **The public framework is written in English**; an instance keeps its own content in whatever language its team works in. The boundary is the export allowlist, file by file: whatever `scripts/export-manifest.json` exports is product and is written in English.
- **In this release**, `skills/` and `templates/` are still in Brazilian Portuguese while their translation lands; new files added to the allowlist are written in English from the start.
- Structural names — folders, files, frontmatter fields, slugs — are **English** on both sides. Two exceptions still ship and are part of the same translation pass: the frontmatter field names (`tipo`, `projeto`, `data`, `autor`) and the `templates/projeto/` folder. New structural names are English from the start, without exception.
- Links between documents are always **relative** — never absolute machine paths.
- Project slugs are canonical and live in `governance/registro-projetos.yaml`; never invent variations.

## 2. Commits — Conventional Commits

Format: `type(scope): description`.

- **Type and scope in English** (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`); the description follows the content language of the repository you are committing to — English in this public framework repository.
- One commit per logical change; messages in the imperative.
- **A commit that changes product behaviour carries a decision trailer**, on its own line, naming a row of `governance/registro-decisoes.md`:

  ```
  Decision: DEC-001
  ```

  The build fails when a commit cites a decision that is not in the record, one with no signer, one whose commit SHA does not resolve in the tree, or one still marked `rascunho, assinatura pendente` — nothing may lean on a decision nobody has signed. A commit that changes no product behaviour needs no trailer, and an unsigned draft sitting in the record without being cited is a legitimate state that only warns. Check yours before pushing with `bun scripts/validate-decisions.mjs`; the record and the optional key-signature layer are explained in `QUICKSTART.md`, section 6.

Examples:

```
docs(governance): record ADR on the tree reorganisation
feat(skills): add the handoff skill to the core pipeline
fix(scripts): correct frontmatter validation for SKILL.md files
```

## 3. ADR flow (Architecture Decision Records)

- **Nygard** format: Context → Decision → Consequences, with Status and Date in the header.
- **Numbering**: highest existing number plus one. **Never renumber** an ADR, even a rejected one.
- **Supersede by status mark**: an ADR is never deleted, and never edited to "fix" the decision — a new ADR supersedes it and the old one receives the status mark (for example, `Superseded by ADR-021`).
- **Cross-project prefixes**: ADRs local to a project use a slug prefix (for example `ProjectA/ADR-001`) so they do not collide with Shizune's global numbering.
- Your instance's ADRs live under `governance/adr/`, numbered sequentially and never renumbered.
- **The framework ships no ADRs of its own.** Skills, templates and script comments cite ADR numbers (ADR-007, ADR-015, ADR-018 and others): those are decision records of the instance this framework was extracted from, and they are not published — they carry that instance's private context. What ships is the mechanism: `templates/adr.md` and the `shizune-adr` skill. Read a cited number as "there is a recorded reason for this rule", not as a document you are expected to open. Your instance starts its own numbering at 001.

## 4. Frontmatter v2 is mandatory

Every new `.md` is born with the v2 YAML block — exactly these six fields, in this order:

```yaml
---
id: <type>-<descriptive-slug>   # globally unique, kebab-case
tipo: <decisao|mapa|ficha|memoria-agente|handoff|status|relatorio|processo|skill|template|referencia|indice|exemplo|guia>
projeto: <canonical slug, or global>
status: vigente
data: <YYYY-MM-DD>
autor: <author>
---
```

The field names and enum values are part of the data contract and stay as written, in Portuguese, so that documents remain machine-readable across instances regardless of prose language.

Exception: `SKILL.md` opens with `name` and `description` (the Anthropic skills spec), followed by the six v2 fields **in the same block**.

**Validation**: before submitting, run

```
bun scripts/doctor.mjs
```

It runs every checker at once. The structure checker verifies frontmatter, field order, slugs and `id` uniqueness; the others check broken relative links, prose references, governance state and the public export in dry-run.

## 5. Nothing is deleted

- A superseded document is **not deleted**: it moves to `archive/` with a **supersession banner** at the top (what superseded it, when and why).
- Dated records (status files, reports, evidence under `logs/`) are **immutable**: a correction is a new record, never an edit of the old one.

## 6. Security — zero secrets

- **No secret** in any file: no `.env`, tokens, keys, credentials or URLs with embedded credentials.
- Publishable framework files must also carry no personal data — email addresses, machine names, user profile paths.
- The validator (`bun scripts/validate-structure.mjs`) **fails** on any detected secret pattern; that failure blocks the contribution.

## 7. How to propose a new skill

1. Start from the template in `templates/skill/`.
2. The skill is born as `skills/<category>/<name>/SKILL.md`, with `name` and `description` followed by the v2 frontmatter (section 4).
3. Describe: purpose in one or two sentences, usage trigger, output artifact and its relation to the existing pipeline.
4. Run the validation and open the proposal with a `feat(skills): ...` commit.

## 8. Licence

Shizune is distributed under the **Apache License 2.0** ("Shizune © 2026 Cadu Azeredo" — see `LICENSE` and `NOTICE` at the root). Every contribution is accepted under the same licence (**inbound = outbound**): by contributing, you agree to license your contribution under Apache 2.0, with no additional terms.

### Sign-off on every commit (DCO)

Every commit in a contribution from outside the project carries a `Signed-off-by:` line with your name and email, the same ones the commit is authored with:

```
Signed-off-by: Your Name <your email>
```

`git commit -s` adds it for you; `git rebase --signoff <base>` adds it to commits you already made.

**What it means.** The line says you agree to the [Developer Certificate of Origin 1.1](https://developercertificate.org/): in short, that you wrote the change or otherwise have the right to submit it under the project's licence, and that you understand the contribution and your sign-off are public and kept for good. There is no separate contributor agreement to sign; the sign-off is the whole of it.

**Why we ask.** "Inbound = outbound" only holds if each change comes with a statement, from a named person, that it can be licensed that way. The DCO makes that statement per commit, inside the history, where it travels with the change. It is the same idea this project applies to decisions: the record says who stood behind each one.

**What it is not.** A sign-off is a statement, not a cryptographic signature. Anyone can type the line, and the CI can only check that it is there and that it names the commit's author; it cannot prove who typed it. Signing commits with a key (`git commit -S`) is a separate thing, and it is welcome but not required for outside contributions.

**Work written with an AI agent.** The sign-off is a person's statement, and an agent cannot make it. If an agent wrote part of your change, you sign off, which means you have read it and answer for it as if you had written it.

**How it will be checked.** The CI does **not** check sign-offs yet. When the check is switched on, it will be a pull-request job that reads every commit between the base and the head of the pull request and fails when one of them has no `Signed-off-by:` line whose name and email match that commit's author. It will read only the trailers, with git alone, and will need no app, token or write permission. Until then, a pull request without sign-offs gets a request to add them, not a failed build.
