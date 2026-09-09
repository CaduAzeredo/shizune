---
id: registro-decisoes-semente
tipo: decisao
projeto: global
status: vigente
data: 2026-09-03
autor: shizune
---

# Decision record — DEC-NNN

**This is the seed Shizune ships.** It is renamed to the decision record path on export, and it
starts empty on purpose: the decisions in it must be yours. Once you add your first one, rename
the `id` in the frontmatter above to `registro-decisoes` — the `-semente` suffix exists only so
the framework's own copy and yours can coexist in the repository this package was extracted from.

An ADR describes a decision in prose and lives forever. A **DEC** is the short identifier a commit
carries in its trailer, so that CI can answer by command the question *"which decision covers this
change, and who signed it?"*:

```
Decision: DEC-007
```

## What "signed" means here, exactly

A signature in this record is **a commit that exists in this tree and in which the operator
approved the decision**. The validator checks that the declared SHA really resolves, with
`git cat-file -e`.

**Declared limit, and it matters:** this proves the row points at a real commit. It does **not**
prove cryptographically that a human wrote it. That proof requires a key-signed commit, which is
the optional layer described below. Until you turn that layer on, do not describe this record as
"verified cryptographic signature" in anything you publish. Saying more than the check performs
is the exact defect this framework exists to catch.

## Rules

1. A number, once assigned, is **never** reassigned — not even when the decision is superseded.
   A superseded decision changes `status`, not number.
2. A commit that changes product behaviour should carry `Decision: DEC-NNN` in its trailer.
3. A `DEC-NNN` cited by a commit and absent from the table below **fails CI**.
4. A `DEC-NNN` present, **outside the draft state**, but with no signer or no resolvable SHA,
   **fails CI**.

## The draft state — `rascunho, assinatura pendente`

The machine drafts, the human signs, the SHA activates. A decision is born in the table already,
marked as a draft, and it does not yet count for anything:

| Situation | Result |
| :--- | :--- |
| Draft with **no** commit citing it | **warning** — a legitimate state: the decision waiting for the operator |
| Draft **cited** by a `Decision:` trailer | **fails** — no commit may lean on what nobody signed |
| Row with no signer and **without** the draft state | **fails** — the new state is not a back door for an unattributed row |

The draft state is written in the `Status` column, not in the frontmatter, because the frontmatter
`status` describes the document and this describes one row of it.

## Optional: require verified key signatures

Two files switch this on. Both are optional, and both must live **inside your repository** — a
trust list that only exists on the signer's machine tells a third party's CI nothing.

```
governance/fronteira-de-autoria.txt
.github/allowed_signers
```

The first holds a single commit SHA: the **authorship frontier**. Every commit after it is
required to carry a signature from a trusted key. Lines starting with `#` are comments, and the
first non-comment line wins. Declaring a frontier is how you say "from here on, a human signs" —
before it, history stays as it was, which is honest about a repository that changed practice
partway through.

The second is the trust list in `ssh-keygen` allowed-signers format, pointed at by:

```
git config gpg.ssh.allowedSignersFile .github/allowed_signers
```

Only `G` counts — a good signature **from a key on that list**. A `U` means "somebody signed",
not "the repository owner signed", and the frontier is about authorship. Accepting `U` would
empty the rule out.

**If neither file exists, nothing fails.** The validator emits a warning saying the frontier is
not configured, and the record still checks numbering, drafts, signers and SHAs. Turn the layer on
when you have a key; do not claim it before then.

A third optional file makes the record itself demand the key, frontier or no frontier:

```
governance/exigencia-de-chave.txt
```

Its first non-comment line must read `decisao-assinada-exige-G`. With it present, a row marked
`vigente` whose signing commit has no `G` signature **fails**, whether or not a commit cites it —
and so does a `Decision:` trailer pointing at such a row. The file is a statement each instance
makes about itself: *"this instance requires G on the signature of a decision."* It is not
shipped, it is not assumed, and without it an unsigned signing commit stays a warning, exactly as
above. The frontier is about history; this is about the decision. Declare it the day your own
signing commits carry a trusted key, and not before — a declared requirement your own rows do
not meet fails your build, which is the point.

One CI detail that costs an afternoon if missed: the frontier check needs history deep enough to
reach the frontier commit. A shallow clone cannot, and the validator says so rather than passing
in silence. In GitHub Actions the fix is `fetch-depth: 0` on the checkout step.

## The record

| ID | Date | Decision | Status | Signer | Signature (commit) |
| :--- | :--- | :--- | :--- | :--- | :--- |

Empty, and that is the correct starting state. A row looks like this:

```
| DEC-001 | 2026-01-15 | One sentence saying what was decided. | vigente | operador | a1b2c3d |
```

Run the validator any time with:

```
node scripts/validate-decisions.mjs
```
