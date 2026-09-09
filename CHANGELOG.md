# Changelog

Version history of the Brain Framework. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-09-09

**Why 0.4.0 and not 0.3.2.** The rule this project wrote for itself in DEC-015, the day 0.3.0 shipped, was "new capability, not a fix". This release does not rest on that rule. The operator does not count the optional key requirement below as new capability for versioning purposes — it is declared by the instance and ships off by default — and the other entries are corrections. What this version marks is the first line of the README. The operator's decision is that **a change in the public category of the project counts as a milestone**: a package whose first claim changed is not the same package with a patch. Written here so the next release has a criterion to read: a fix is a patch; a new capability, or a change in what the project says it is, is a minor.

### Changed

- **The opening line of the README now names the category this project actually belongs to: auditable decision governance.** It used to say "a governance operating system for AI agents", which put the agent in the subject position — as if the agent were the thing being governed. What is governed here is the decision: who took it, under which record, and whether the command can verify it. The agent is the context that makes the question urgent, not its object. The wording was fixed by a signed decision in the private instance this package is exported from, and the change ships as a release rather than a silent edit, because the first line of a README is a claim and claims get a changelog entry.
- **The decision record can now demand a trusted-key signature — and the demand is yours to declare, not ours to ship.** `scripts/validate-decisions.mjs` reads an optional `governance/exigencia-de-chave.txt`; with it present, a `vigente` row whose signing commit has no `G` signature fails, frontier or no frontier, cited or not. Without it, nothing changes: an unsigned signing commit stays a warning. The file is deliberately not part of this package. We reproduced the alternative before rejecting it: exported this package to a clean directory with no global git configuration, signed a first test decision the way any new instance would, and the hardened validator went red on that first decision (`exit 1`). A rule nobody in that repository decided is exactly the defect this validator exists to catch, so the rule lives in the instance, next to the frontier. Negative tests cover both halves.
- **A good signature from a key outside the trust list (`U`) no longer counts as "signed by key" anywhere in the validator.** It said "somebody signed", not "the repository owner signed"; the frontier check already refused it, the row check did not.

### Fixed

- **`scripts/checar-nome.sh` no longer reports a registered `.co` domain as free.** `.co` has no RDAP server anywhere — zero entries in the IANA bootstrap, measured 2026-09-05 — so by RDAP every registered `.co` came back FREE, which is how the name battery of 2026-09-02 missed `shizune.co`, which was live. For TLDs without RDAP the script now asks DNS for an `NS` record: `NS` present proves the name is taken; `NS` absent does **not** prove it is free (a registered domain with no zone answers nothing either), and the script prints `?ns` instead of a verdict. A one-sided signal, declared as one-sided.

## [0.3.1] - 2026-09-03

**Four findings from auditing this package with the checks we run on other people's repositories.** Same method, same rubric, applied to ourselves the day 0.3.0 shipped: five divergences, none high, none security, nothing leaked. Four are closed here. The fifth is a TLS certificate on the project's apex domain — not code, and still open; `https://www.shizune.dev` works while the bare apex does not.

Every item below carries the command that reproduces it, because a fix you cannot re-check is a claim.

### Fixed

- **The language note promised a translation the next release did not deliver.** It was stamped "Language, v0.2" inside a 0.3.0 package and called the translation of `skills/` and `templates/` "the headline item of the next release". That release came and went. The note now carries the current version, points at the translation issue with **no date**, and says plainly that the earlier promise was not met. Publishing in Brazilian Portuguese is a declared decision; repeating a deadline we had already missed was not.
- **The commit guide never mentioned the trailer that fails the build.** `CONTRIBUTING.md` defines the commit convention, and 0.3.0 made `Decision: DEC-001` a mechanism that fails CI — but a contributor reading the one document that governs commits had no way to learn it existed. Section 2 now states when the trailer is required, the four cases that fail, the case that needs no trailer, and the command to check before pushing.
- **A fresh clone opened with a warning about being fresh.** `scripts/validate-structure.mjs` reported an empty project registry the same way it reports a broken one, so the first command the quickstart tells a new user to run greeted them with an alert about the correct state. The validator gained a third output channel — a note, which counts toward neither the summary nor the exit code — and now separates three cases: an intact seed (`projetos: []`) is a note naming the next step; a missing `projetos:` key is now an **error**, where it used to be a warning; a key present with no readable entry stays a warning and says to check indentation. A new install reports zero errors and zero warnings.
- **A validator shipped one machine's folder convention as a general rule.** `scripts/validate-links.mjs` warned about the capitalisation of a specific directory name from the instance this framework was extracted from. The absolute-link warning one line above is the real defect; which folder it points at is not the reader's problem. The extra warning is gone.

## [0.3.0] - 2026-09-03

**The project is now called Shizune.** Versions up to 0.2.1 above shipped as the Brain Framework, and those entries are left exactly as they were: they describe what the project was called on the day they were written, and rewriting changelog history is precisely the defect this framework helps you find in other repositories. The repository, the site and the package name change here; the entries above do not.

This release also adds the layer the name was chosen for. A watermark says what a machine wrote and a key says who pushed. Neither records **what a human decided** — and that is what this version makes checkable.

### Added

- **A decision record with authority over the build.** `governance/registro-decisoes.md` holds one numbered row per decision; a commit cites one in its trailer as `Decision: DEC-001`; and `scripts/validate-decisions.mjs` fails the build when a commit cites a decision that does not exist, or one that has no signer, or one whose commit SHA does not resolve in the tree. The record ships **empty**, because the decisions in it have to be yours.
- **A draft state, so a decision can exist before anyone has signed it.** A row marked `rascunho, assinatura pendente` is a legitimate resting state — it warns, it does not fail — but any commit that cites it fails immediately. Nothing may lean on what nobody has signed.
- **Optional enforcement of verified key signatures.** Declare an authorship frontier and a trust list, both inside the repository, and every commit after the frontier must carry a signature from a key on that list:

  ```
  governance/fronteira-de-autoria.txt
  .github/allowed_signers
  ```

  Only a good signature from a listed key counts; "somebody signed" is not "the owner signed". Absent both files, nothing fails and the validator says the layer is off — it never reports a check it did not perform. The quickstart has the setup.
- **Negative tests for the two checks that could rot silently.** `scripts/test-validate-decisions.mjs` (28 assertions) and `scripts/test-build-index.mjs` (7) build throwaway fixtures and assert that each tool **fails** when it should. A validator that only ever passes is indistinguishable from one that does nothing; these run in `doctor` and in CI.
- **`scripts/checar-nome.sh`** — availability check for a candidate project name across npm and the common TLDs, with the limits of each source documented in the script rather than assumed.

### Fixed

- **A worked example inside a fenced block was being read as a real decision.** The record documents its own format with a sample row; the parser did not skip fenced code, so the sample — which carries an invented SHA, as samples do — failed the build with "signature does not resolve", pointing at the documentation. Documentation is not data. Found in the seed this release publishes, before publishing it.

### Changed

- **CI runs every check, not two of them.** The workflow used to invoke `validate-structure.mjs` and `validate-links.mjs` directly and skip `doctor` — the reason being that two of doctor's steps only apply in the private instance a package is exported from. Those steps now detect that for themselves and report `n/a`, so the exclusion had outlived its cause, and keeping it meant shipping validators with nothing to execute them. The workflow now runs `doctor` and checks out with full history, which the frontier check needs.
- **`doctor` runs nine checks**, up from eight.
- **The index generator catalogues the repository, not the disk.** `scripts/build-index.mjs` now reads what git tracks, and names on stdout every `.md` it left out for being uncommitted. Reading the working tree meant an uncommitted file could be indexed and then linked from a commit that did not contain it. Without git — a downloaded zip — it indexes everything and says so.
- **`BRAIN_AUTOR` is now `SHIZUNE_AUTOR`.** The old variable still works and prints a deprecation notice.

### Note on names

Files already generated with `autor: brain-framework` are left alone. The default changed without acting retroactively, and a tree carrying both values is real history rather than an inconsistency to paper over.

## [0.2.1] - 2026-08-31

Follow-up to the adversarial pre-publication audit. Seven findings survived refutation and are closed here; none of them affect how the framework runs.

### Fixed

- **The worked example carried two illustrations that traced back to a real client engagement.** They described refuted hypotheses — findings that turned out not to be defects — but the wording was still a translation of someone else's audit. They are now genuinely Lumina's, inside the scope that example declares.
- **CONTRIBUTING claimed structural names are English on both sides.** The frontmatter field names (`tipo`, `projeto`, `data`, `autor`) and the `templates/projeto/` folder are not, and they ship. The rule was written as though it had already been met; it now says what is true and what is still pending.
- **The quickstart understated what the scaffolder creates**, omitting `DOMAIN.md` and `specs/` — the two artifacts the next step tells you to fill in.
- **Three validators hardcoded ten legacy folder names** from the private instance this framework was extracted from, so a fresh clone inherited someone else's migration archaeology and tolerated folders that do not exist in it. The list now comes from an optional instance file, `governance/legacy-tree.json`; absent means no legacy, which is the right state for a new repository — so the framework does not ship one.
<!-- ref-ausente-ok: legacy-tree.json — deliberate: this file describes an instance's own migration history, so a fresh package must not carry one. Its absence is the documented default. -->

## [0.2.0] - 2026-08-31

**First public release.** Version 0.1.0 above was a pre-publication milestone, cut before this repository existed in the open; this is the first version anyone outside the project can download.

### Added

- **Community package.** `SECURITY.md` with a coordinated-disclosure policy routed through GitHub's private vulnerability reporting (no email address anywhere in the package — the export's redaction scan uses a generic email pattern and any address would fail the build), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), issue forms for bug reports, skill proposals and translation work, a pull-request checklist, `.gitignore`, `.gitattributes`, and a checks workflow running the validators on Node 20, Node 22 and Bun.
- **A pipeline diagram** in `docs/assets/pipeline.svg`, shown at the top of the README. SVG rather than a raster image on purpose: the export's redaction scan skips any file with a null byte, so every binary is an unscanned channel. SVG is text — it is scanned, and it is reviewable in a diff.
- **Declared exceptions in the secret scan.** The structure validator now reads a registry of verified placeholder occurrences, each pinned to an exact path and line. The registry lives *outside* the file it exempts, unlike the two escapes the framework already had, because the case that motivated it sits inside an immutable dated record: writing the declaration into the file would have meant editing a log. A declaration that no longer matches anything is reported as stale, so the registry cannot rot into a silent hole.
- **Trademark and naming policy** in the README: Apache 2.0 section 6 grants no trademark rights, so the terms of use for the name are stated explicitly rather than assumed.

### Changed

- **README rebuilt for a first-time reader.** What it is, a working command, and the pipeline diagram now sit above the fold; the prose that used to open the file comes after. Functional badges replace none.
- **Frontmatter is stripped from the showcase files on export** (README, QUICKSTART, AGENTS, CONTRIBUTING, CHANGELOG). GitHub renders YAML frontmatter in a `.md` file as a table, which put a metadata table above the README's title. `skills/`, `templates/` and the worked example keep theirs — there, the frontmatter is the product.
- **Raw external material no longer fails the build.** A suspected secret inside the unversioned inbox folder is reported as a warning: it is gitignored by construction and cannot reach version control, and triage needs the signal without untriaged input breaking the checks.
- The public surface is now written in English: this changelog, the README, the quickstart, the agent contract, the contributing guide and the worked example. `skills/` and `templates/` remain in Brazilian Portuguese for this release, along with the frontmatter field names, and are the headline item of the next one — a phasing decided deliberately and declared in the README rather than hidden.
- The document type for agent memory was renamed to `memoria-agente`. Its previous name carried a third-party product name, and it had reached the validator's type enum — which meant anyone cloning the framework inherited a data model named after a tool they may not use. Roles are now described by function throughout, and the old name is a redaction pattern that fails the export.
- The T1–T4 risk matrix in the multi-agent contract now declares itself **self-sufficient**: the external source it used to cite is not present in this repository and is not auditable from it, so the contract's own table is the normative definition of the levels.
- The ecosystem context map reconciled with the dated records: task graph reorganised into independent parallel tracks, state of variables re-measured with the date of each measurement, and blockers updated.

### Fixed

- **`doctor` no longer fails in an exported package.** Its export step reads a manifest that references files existing only in the private instance, so a fresh clone failed on step five — and the quickstart tells every new user to run exactly that command as their first contact with the framework. The step now reports `n/a` when it detects it is running inside an exported package, and the summary distinguishes `n/a` from `OK` instead of masking one as the other.
- **Audit aggregates derived from NDA engagements were removed from the README.** They carried no client name, no stack and no slug — only numbers — which is precisely why no redaction pattern could catch them. Aggregate findings from a private engagement are still client data, and publishing them would have broken the quarantine rule this framework exists to enforce.
- The launch-track project file claimed the public export had never been generated. A residual snapshot existed in the output directory, produced by an earlier version of the manifest and containing material outside the current allowlist — including a project template with its placeholders unfilled. The state was corrected in the project file and triaging the residue became an explicit task, ahead of the first valid dry-run.

### Added — earlier in this cycle

- A complete worked example under `examples/course-platform-demo/`: the pipeline now runs end to end on a fictional product — a specification with six verifiable acceptance criteria, an execution ticket carrying its diary and two recorded deviations, a second ticket deliberately left blocked on a human decision, and a handoff pair (`.md` + `.json`) with its stops and estimates. The blocked ticket is intentional: a healthy project record shows work that is waiting, not only work that is finished.

- The targeted-search convention, stated in the agent contract: answer a question about repository state by reading the smallest set of files that answers it, rather than sweeping whole folders. It names the three shortcuts the framework already offered without stating them — the generated index, the date as the filename prefix of dated records, and the state-of-variables section of a project file.
- A "search before sweeping" rule in the multi-agent contract, establishing that a broad sweep is a last resort and must be announced before it starts.
- ADR-025 — the framework approved for assisted use on real projects, under the non-negotiable condition of explicit, case-by-case human approval for every production action: never blanket, never by precedent. Includes seven operating rules and five automatic revocation conditions.
- ADR-026 — independent parallel tracks: a stop on one track does not dam the others, with a declared writing boundary between them.
- A variable AI-cost process — five rules, among them a per-call ceiling and the principle that no pricing decision is made without measured data.
- An external-material triage process — an unversioned inbox folder for material born outside the repository, distillation into a document or a memory, and deletion of the original only under explicit approval.
- A self-documentation guide — a decision table for where each artifact produced during work should be saved.

## [0.1.0] - 2026-08-27

### Added

- ADRs 016-021: structural reorganisation, git plus Apache 2.0 licensing with a public/private split, the v2 frontmatter contract, the canonical pipeline skills, the agent-architecture integrations (layered L0–L4 memory, the T1–T4 risk matrix, orchestrator–subagent topology) and the client-content quarantine policy.
- `templates/handoff.json` — the machine-readable counterpart of the handoff template (same `handoff_id` as the `.md`).
- Git repository initialised with tag `v0-pre-reorganizacao` preserving the state before the reorganisation.
- The v2 tree skeleton: the skill pipeline (`grill-with-docs` → `domain-modeling` → `to-spec` → `implement` → `handoff`, plus the `writing-for-agents` meta-skill), artifact `templates/` and scaffolding and validation `scripts/`.
- Project files merged into `projects/<slug>/CONTEXT.md` (legacy sources unified into a single canonical document per project).
- `AGENTS.md` and agent profiles under `agents/`.
- `examples/` with a synthetic project context example (`course-platform-demo/`).
- Go-to-market documentation under `docs/` and a metrics base under `metrics/`.
- `LICENSE` and `NOTICE` (Apache 2.0 — Brain Framework © 2026 Cadu Azeredo).
