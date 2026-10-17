---
id: referencia-threat-model
tipo: referencia
projeto: global
status: vigente
data: 2026-10-16
autor: executor
---

# Threat model

What Shizune checks, what it does not, and what you have to trust for the checks to mean anything. Each item says how to reproduce it. If an item here is wrong, that is a security report: see SECURITY.md in the repository root.

## 1. What the checks are for

- **The link between a change and a decision.** A commit that cites `Decision: DEC-NNN` relies on a row in the decision record; the check says whether that row exists, is signed, by which key, and whether it still reads as it did when it was sealed.
- **The order and integrity of the ledger.** Each event is chained to the one before it; an edit to an old line breaks the chain.
- **What leaves the repository.** The public export copies an allowlist and refuses the redaction patterns you declare.

## 2. What they prove, each with its command

| Claim | Command | Holds when |
| --- | --- | --- |
| A cited decision exists and is not a draft | `node scripts/validate-decisions.mjs` | always |
| No decision number appears on two rows | the same | always |
| A sealed row reads as it did when it was sealed | the same | the row carries a seal |
| The signing commit has a good signature from a trusted key | the same | your repository declares `governance/exigencia-de-chave.txt` and keeps its trusted keys in `.github/allowed_signers` |
| The decision was not signed by a key you marked as a machine's | the same | your repository declares `governance/chaves-de-assinatura.txt` |
| The ledger was not edited after the fact | `node scripts/livro.mjs check <ledger>` | always |

Each claim has negative tests that run in `doctor.mjs`: `node scripts/test-validate-decisions.mjs` and `node scripts/test-livro.mjs`.

## 3. What they do not prove

### T1. Human authorship

A signature shows which key signed. It does not show that a person decided, or who wrote the content. A passphrase on the key adds the presence of whoever holds it, and nothing more.

- Status: by design.
- Reproduce: a commit signed by a key without a passphrase verifies the same as one with it.

### T2. A wrong decision, signed with the right key

The check knows a decision was signed; it cannot know the decision was good, or that the person who signed it read it.

- Status: by design. The defence is review, not the check.

### T3. A compromised key, CI runner or machine

Whoever holds a trusted key, or controls the runner that verifies, passes what they sign. The trust list lives in the repository, so whoever can change `.github/allowed_signers` in a commit that passes review can change who is trusted.

- Status: open.

### T4. A signed row changed together with its seal, or a row with no seal

The seal is the seventh cell of a signed row: a hash of its id, decision, status, signer and signature. It catches a change to the row that did not recompute the seal. It does not catch a change made together with a new seal, because the seal lives in the same file, and a row signed before seals existed has none to compare against.

- Status: open. Closing it means binding the seal to the signer's key.
- Reproduce: change the decision text of a sealed row and run `node scripts/validate-decisions.mjs`: it fails. Recompute the seal with `--selo=DEC-NNN`, paste it, and run again: it passes.

### T5. What is signed is a commit, not the row

The authorship frontier requires a good signature on every commit after it, and a machine key gives a good signature too. A commit signed by a machine key can add a signed row that points to a commit signed by a person, and the check passes it. A decision fails for a machine key when its own SHA points to a machine-signed commit, not when a machine wrote the row.

- Status: open.
- Reproduce: from a commit signed by a machine key, add a signed row pointing to an existing human-signed commit, cite it, and run the check.

### T6. A ledger line that was false when it was written

The chain catches an edit after a line was written. It does not catch a line that was false from the start, written through the normal channel and brought in by a signed commit: the hash seals what it is given.

- Status: by design.
- Reproduce: append a transition with a false note and run `node scripts/livro.mjs check`; it passes.

### T7. Provenance that proves where, not who

A signed release or a build attestation shows where an artifact was built. It does not show that anyone authorised the publication.

- Status: by design, outside this tool.

## 4. What you have to trust

- git's verification of SSH signatures, and the `gpg.ssh.allowedSignersFile` the check runs with.
- The runtime (Node or Bun) and the runner that executes the check in CI.
- The trust list at the commit being checked.
- The person who reviews each change to the decision record.

## 5. Out of scope

- Memory or index poisoning through a legitimate write channel. A hash per entry is for edits after the write; poisoning through the normal channel is a write the hash seals as it is.
- Anything an agent does before it commits. Shizune checks the history, not the session.
