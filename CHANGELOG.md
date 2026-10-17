# Changelog

Version history of the Brain Framework. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **The decision record refuses a repeated number.** A `DEC-NNN` on more than one row fails, naming the rows, whether or not a commit cites it. Until now the last row won in silence, so a signed row appended under a draft's number made the draft citable without anyone editing the draft. Rule 1 of the record ("a number is never reassigned") is now enforced by the tool.
- **A signed row can carry a seal, and a sealed row that changed fails.** The seal is a seventh cell: `selo:` and 16 hex digits of the SHA-256 of the row's id, decision, status, signer and signature; the date is left out. `node scripts/validate-decisions.mjs --selo=DEC-NNN` prints it when you sign. A sealed row whose text no longer matches fails as changed after it was signed; a signed row without a seal warns. **What it does not do:** the seal lives in the same file as the row, so whoever rewrites both together passes. Binding the seal to the signer's key is open, and the threat model says so.
  - Negative tests: 15 new assertions in `scripts/test-validate-decisions.mjs`, which goes from 107 to 122 (`bun scripts/test-validate-decisions.mjs`). Ten of them were written before the change and fail against the previous validator.
- **A threat model, `docs/THREAT-MODEL.md`.** What each check proves, with its command, and what none of them proves: human authorship, a wrong decision signed with the right key, a compromised key or runner, a row rewritten together with its seal, and a commit signed by a machine key that adds a signed row.
- **A succession page, `docs/SUCCESSION.md`.** What happens if the maintainer goes quiet: one maintainer and no successor, where the signing key is published, what the licence already guarantees, and how a fork declares itself a continuation.

### Changed

- **The README leads with the decision check.** What the check fails on; a picture of four steps (a draft, a signed and sealed row, the same row edited after signing, a row signed by the agent's key) and one of the ledger catching an edited line, both regenerated from real output; the file tree of the package, generated from the public inventory; and what a signature does not prove. The opening line does not change.
- **The empty decision record documents the seal**, and its table gains a `Seal` column.

## [0.5.1] - 2026-10-15

Two fixes to `ficha-release`, the script that writes and checks the release card. No new capability, so a patch.

### Fixed

- **`ficha-release --check` tells a missing `ssh-keygen` apart from a bad signature.** When the tagged commit carries an SSH signature and the program git calls to verify it cannot run, git answers `B`, the same letter as a signature that does not match, and the check used to refuse the card as if the signature were bad. It now looks at what git could not run and says so: "ambiente sem ssh-keygen", with the program it tried (`gpg.ssh.program`, `ssh-keygen` by default) and what to install or point to. A card checked in that environment is still refused, because nothing was verified; only the reason changes. Our own verification of 2026-10-15 got a false `B` this way.
- **`ficha-release` refuses to write a card from a capture with skipped blocks.** If the negative test prints an `n/a` line, a block did not run (on Windows, for example, outside Git Bash, where `gpg` or `ssh-keygen` is missing), and the captured output would publish an incomplete run as the release's evidence. Generation now stops and names the count of skipped blocks. The 0.5.0 card was generated that way, with one skipped block in the captured output; its numbers are unaffected.
  - Negative tests: `scripts/test-ficha-release.mjs` goes from 45 to 52 assertions (`bun scripts/test-ficha-release.mjs`). Five of the new ones were written before the fix and fail against the 0.5.0 script: with `gpg.ssh.program` pointed at a program that does not exist, the only problem reported must be the environment, the message must say "ambiente sem ssh-keygen", and it must not say the signature does not match; and a capture with an `n/a` line must be refused at generation, naming the block that did not run. The other two pass on both: the same card passes again once the program is back, and a card saved with a byte-order mark is accepted. 0.5.0 already stripped the mark; the test now pins it, and the code stops writing the invisible character inside a regular expression.

## [0.5.0] - 2026-10-15

**Why 0.5.0 and not 0.4.2.** By the criterion written into 0.4.0, a fix is a patch and a new capability is a minor. The validator gains three: a merged pull request can sign a decision where the instance says so, small decisions can be delegated by level, and every signed decision now reports what backs it. The `doctor` fix below would have been a patch on its own.

### Added

- **A merged pull request can sign a decision — if your instance says so, and only for what it actually proves.** Until now a decision had one valid signature: a commit signed by a key on the trust list. A merge commit created by the platform is signed by the platform's own key, so the validator read it as `E` (cannot check). A new directive in `governance/chaves-de-assinatura.txt`, `plataforma github <signer> <email>`, lets the instance accept it, and the route ships off: without the directive nothing changes. With it, a commit created by GitHub counts as the named signer's decision only if it has two parents, verifies as `G` against the platform key the instance imported and trusted, was made by the declared email, by a person and not an app, and by someone who wrote none of the pull request's commits.
  - **What this signature proves is weaker than a key, and the quickstart says so.** It proves that a credential with merge rights on that account pressed the button, not that someone held a private key. If an agent's credential can also merge, it produces an identical commit. The quickstart names the precondition we use ourselves: measure that the agent's credential cannot merge into the protected branch before declaring the directive. Our own measurement, on 2026-10-14, said it can, so the directive stays off in our instance.
  - Negative tests: 25 new assertions in `scripts/test-validate-decisions.mjs`, covering a platform merge with and without the directive, a different email, a single-parent commit, a merge by the pull request's author, a merge by an app, an unverifiable signature, an unknown platform, and the frontier.
- **Delegated levels: N0 and N1 exist only inside a signed delegation.** An optional file, `governance/delegacoes.txt`, declares which decision freed a class of small (N0) or machine (N1) decisions, one line each. A commit that uses the class carries `Nivel:` and `Autorizado-por:` trailers. With the file declared, the validator fails a delegation pointing at a decision that does not exist or is still a draft, an N0 or N1 commit without an `Autorizado-por:` matching a delegation of that level, and any `Nivel: N2` trailer, because N2 is proven by a signature, never declared. Without the file nothing changes.
- **What backs each decision, computed and never typed.** For every signed row the validator now reports a `garantia`: `chave` (a good signature from the signer's declared human key), `plataforma` (a merge accepted by the directive above) or `nenhuma`. The summary counts them, and `--json` prints `{ id, garantia, sha }` per signed decision for scripts. It is not a new column in the record: changing the table's format would break existing instances for no gain.
  - Negative tests: 25 more assertions in the same file, for delegations and for the computed backing. The file goes from 57 assertions to 107 (`bun scripts/test-validate-decisions.mjs`, in a clone of v0.4.1 and with this release's scripts).
- **Three guides in the quickstart.** Giving an agent a key of its own, one per environment, and checking that it can sign drafts and cannot sign decisions. What to do if a key leaks, in six steps. And a merged pull request as a signature: how to measure the agent's credential, why the route ships off, and how to turn it on.
- **A release card the sites can read, and a check that refuses a swapped one.** `scripts/ficha-release.mjs` writes `shizune-release.json`, the machine-readable card attached to each release (schema `shizune.release/v1`, printed by `--schema`). It measures in a clean checkout of the tag, and only there: the number of files in the package, the negative test's assertions and its output, and the `doctor` summary, each with the SHA it was measured on and the command that reproduces it. `--check <file> --tag <vX.Y.Z>` refuses a card that breaks the schema anywhere (it is closed at every level and asks for exactly the six roadmap steps, each once), whose `sha` is not the commit the tag points to, or whose tagged commit does not verify as `G`. A claim measured on another SHA is marked outdated and does not fail the card. The schema is checked by hand-written code, with no dependency, and the script does not touch the network.
  - Negative tests: 45 assertions in `scripts/test-ficha-release.mjs` (`bun scripts/test-ficha-release.mjs`), covering an extra field at the top, in `package`, in `chain` and in a claim; five, seven and repeated steps; a `sha` that is not the tag's; an unsigned tagged commit; an outdated claim that must pass; and the card generated from a throwaway repository. It is not a `doctor` step in this release, so the `doctor` lines below stay as measured.
- **A negative test for the `doctor`'s own summary.** `scripts/test-doctor.mjs` builds a throwaway tree with stub verifiers and checks the closing line with `n/a`, without it, and with a failure. It also checks the inventory comparison described under "Changed", with the real export script in a throwaway tree: a new file in `scripts/` without an entry fails, and with the entry it passes. It runs as the tenth `doctor` step.

<!-- ref-ausente-ok: shizune-release.json — deliberate: it is the asset attached to each release, written by scripts/ficha-release.mjs at release time and never committed, so no clone carries it. -->

### Fixed

- **`doctor`'s summary no longer counts `n/a` as passed.** Declared as known and not fixed in 0.4.1. In a clone of v0.4.1 the closing line read `os 9 verificadores passaram` with two steps answering `n/a`; with this release's scripts, the same clone reads `Resultado: OK — 8 passaram, 2 n/a.` (`bun scripts/doctor.mjs`). Without `n/a` the line still reads `os N verificadores passaram`. This changes the output of a published command: if your CI matches the old last line, it will need updating.
- **A platform merge that reads `E` is explained by its real cause.** The message used to blame a missing `ssh-keygen`. It now says the commit was created by the platform and that its public key is not in your environment's `gpg`, both for decisions and for the authorship frontier.

### Changed

- **The agent contract no longer lists "local commit" as an ordinary action for the executor.** It now says what we actually do: an agent commits only to draft branches, signed with its own machine key, and never to the main branch. Two hygiene rules that lived only in our private instance are now in the contract: files are written with the write or edit tool, never with a heredoc; and git reads on someone else's disk use `GIT_OPTIONAL_LOCKS=0`, so that reading never leaves a lock behind.
- **At the export origin, `doctor`'s export step also checks the package against an inventory, if the instance keeps one.** The list the dry-run would publish is compared with a file of authorized paths under governance/public-package/, the same comparison our private CI already made: a file that appears without an entry, or disappears while listed, fails the step and is named. A new file in `skills/`, `templates/` or `scripts/` enters the package through the allowlist glob with no decision at all, and the inventory is where that decision gets written. Without the file nothing changes, and in a clone of this package the step still answers `n/a`, so the closing line stays `8 passaram, 2 n/a`.
- **`doctor` runs ten steps, and the package ships 69 files instead of 66.** The new files are `scripts/test-doctor.mjs`, `scripts/ficha-release.mjs` and `scripts/test-ficha-release.mjs` (66: `git ls-files | wc -l` in a clone of v0.4.1; 69: the same command at v0.5.0, and `bun scripts/export-public.mjs` in dry-run at the source).
- **The README no longer prints a version.** The release badge is static and points to the latest release, the language note no longer cites past versions, a three-command check resolves the latest tag by itself, and the evidence section points to the latest release, whose notes carry the command for each number and whose card records the SHA and date of each claim. The version appears where it is the subject: the release page.

### Known and not fixed in this release

- **The validators' output does not respect locale.** Same as 0.4.1; still a product decision, not an implementation detail.
- **What to do when a signed SHA no longer resolves after a rebase** is still not decided, and the quickstart still says so.
- **Squash merges are not accepted as platform signatures:** the squash commit has one parent, and its message is editable by whoever presses the button. Not accepted; reopens on demand, if someone who uses the route asks for it.

## [0.4.1] - 2026-09-10

**Why 0.4.1 and not 0.5.0.** By the criterion written into 0.4.0: a fix is a patch; a new capability, or a change in what the project says it is, is a minor. Nothing here changes the opening line, and the one behavioural addition below is declared by the instance and ships off by default — the same reason the optional key requirement in 0.4.0 was not counted as new capability for versioning. Everything else answers questions the documentation left open. That is a patch.

### Added

- **The decision record can now check the signer against the key that actually signed.** A fourth optional file, `governance/chaves-de-assinatura.txt`, maps a name in the `Signer` column to a principal in `.github/allowed_signers`, and can mark a principal as `maquina` — the key an automated agent uses for draft work. With it declared, a `vigente` row whose signer does not match the principal that signed its commit fails, and so does any decision signed by a machine key; a signer absent from the file warns and does not fail. Without the file, nothing runs and the validator behaves exactly as before. This closes the gap between two claims that were being treated as one: "a trusted key signed" and "the person named on the row signed". Negative tests cover the machine key, the mismatched signer, the unmapped signer, a malformed declaration, and the absence of the file.
- **Answers to the questions the quickstart never addressed.** Adopting Shizune in a repository that already exists, and which of the two layouts lets the validator read your code history (measured, both invocation paths). What squash merge does to the trailer and what rebase does to a signed SHA — including a plain statement that the repair rule is *not* decided, rather than a rule invented for the occasion. How more than one person shares a frontier and a trust list.
- **README: does anything leave your machine, what it costs to leave, and what happens if this project stops.** No telemetry, no phone-home, with the `grep` that reproduces it and the one script that does use the network named. Getting out costs one delete. Getting big is honestly unmeasured on a large monorepo, and the number is therefore not published.

### Fixed

- **A signer name with a space in it was read as a malformed declaration.** The parser for `governance/chaves-de-assinatura.txt` required a line to have exactly three fields, so `assinante Cadu Azeredo <principal>` — a perfectly ordinary human name — failed as a declaration nobody could understand, which is the opposite of what that file is for. The principal is now taken as the last field and the name as everything between the directive and it. Found on the first real use of the feature, one commit after shipping it: the first person to write their own name into the column would have hit it. Negative tests cover both the composite name being read and the same name pointed at the wrong key still failing.

### Changed

- **The decision record now says how many states there are.** It described the draft state and the rule that a superseded decision changes status, without ever stating that the set has exactly two members — which left "superseded" looking like it might be a third. It is not: a superseded decision stays `vigente`, and what supersedes it is a new row with a new number.
- **The language note now covers the validators' output, not just the documents.** The checks print in Brazilian Portuguese, including in your CI log, and they do not consult `LC_ALL` or `LANG` — measured byte-identical under any locale on the public clone at `v0.4.0`. Whether that becomes translated output or a locale layer is open, and the note carries no date, for the same reason the translation note carries none.

### Known and not fixed in this release

Two defects were measured, written down, and deliberately left alone. Shipping a release that quietly carries a known defect is the thing this project exists to catch, so both are named here rather than in an issue nobody reads.

- **`doctor`'s summary line counts `n/a` as passed.** `scripts/doctor.mjs` marks each step `OK`, `n/a` or `FALHA` correctly, but the closing line reads `os N verificadores passaram` using the total, `n/a` included. In a clone of this package two steps have nothing to check and answer `n/a` correctly — the run is **7 `OK` and 2 `n/a`**, measured on `v0.4.0` and unchanged here — and the last line still says nine passed. The `n/a` is not the defect; the summary claiming more than the run did is. Fixing it changes the output of a published command, so it waits on a decision rather than being slipped into a patch. Until then: read the `RESUMO` block, not the last line, and do not quote "N checks passed" without saying where it was measured.
- **The validators' output does not respect locale.** Named under *Changed* above, and it stays open: the choice between real internationalisation and fixed English is a product decision, not an implementation detail, and either one changes every line a consumer's CI log already matches against.

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
