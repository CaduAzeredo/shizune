---
id: referencia-succession
tipo: referencia
projeto: global
status: vigente
data: 2026-10-16
autor: executor
---

# Succession

What happens to Shizune if its maintainer stops maintaining it: someone leaves, falls ill, loses access or simply goes quiet. This page says what is true today and what you can do without anyone's permission. It promises nothing the project cannot keep.

## Who maintains it today

Shizune has **one maintainer**, Cadu Azeredo, and **no designated successor**. Nobody else holds the key that signs releases and decisions, and nobody else can merge into this repository. Read this page with that in mind: it is written for a project with a single point of failure, and it does not pretend otherwise.

There is no promised response time for issues, pull requests or security reports. To judge whether the project is still alive, look at what can be checked, not at what is claimed: the date of the latest signed tag and of the latest signed commit on the main branch.

## Where the signing key is

Releases, tags and decision rows are signed with the maintainer's SSH key. The public half is published as an **SSH signing key** on the maintainer's GitHub account, and anyone can read it without signing in:

```
https://api.github.com/users/CaduAzeredo/ssh_signing_keys
```

At the time of writing (2026-10-16) that endpoint lists one signing key, with fingerprint `SHA256:Nx6y4NNxjC4wMyP6llluV+iIfU6dtprERUgbcCtao38`. If it lists a different key later, the key was rotated; the history signed before the rotation stays verifiable against the old public key, which is why you should keep a copy of the one you verified against.

The trust list this repository's own checks use is **not** part of the published package, because a trust list belongs to each instance. To verify an upstream tag from a clone, write the key into an allowed-signers file of your own and point git at it:

```bash
git config gpg.ssh.allowedSignersFile ./upstream_signers
git tag -v v0.5.0
```

## What the licence already guarantees

Shizune is under the **Apache License 2.0**, and nothing in this page can narrow it. For every version already published:

- **The grant cannot be taken back.** Section 2 gives you a perpetual, worldwide, royalty-free, irrevocable copyright licence; Section 3 gives you the matching patent licence from each contributor.
- **You may fork, change and redistribute**, commercially or not, as long as you keep the `LICENSE` and `NOTICE` files and mark the files you changed (Section 4).
- **You need no one's permission** to keep using the version you have, to fix it, or to publish your fork.

What the licence does not give you is the name. Section 6 grants no trademark rights, and the `NOTICE` file says how the name may be used: a fork must not present itself under the composite name or imply endorsement; "built with Shizune" is fine.

## How a fork declares itself a continuation

If the project goes quiet and you carry it on, say so in a way a reader can check. A continuation fork:

1. **Names the last upstream tag it builds on**, and that tag verifies against the key above (`git tag -v`). A fork from an unsigned or unverifiable point says that too.
2. **Signs with its own key, and publishes it** the same way: as a signing key on the account that owns the fork, with the fingerprint in its own `SUCCESSION.md`.
3. **Never re-signs the original maintainer's decisions.** The decision rows signed upstream stay signed by the upstream key, as history. A decision the fork still holds becomes a new row, with a new number, signed by the fork's key. Making an old signature look like it came from someone else is exactly the defect this project exists to catch.
4. **Uses its own name, or describes itself plainly as a fork**, per the `NOTICE` file.

If the original maintainer comes back, nothing above has to be undone: the fork's history stays signed by the fork, and the upstream's by the upstream.

## What this page does not cover

- **Access to the repository, the domain or the package accounts.** There is no transfer arrangement for any of them today. If one is made, it lands here, in a signed commit.
- **Your own instance.** Your records, keys and decisions are yours; nothing here reaches them, and nothing upstream can sign for you.
