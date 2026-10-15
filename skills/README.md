---
id: indice-skills
tipo: indice
projeto: global
status: vigente
data: 2026-09-22
autor: shizune
---
<!-- GERADO por scripts/build-index.mjs — não editar à mão -->

# Catálogo de skills

Catálogo gerado a partir dos `SKILL.md` desta pasta (name, categoria, description).
Para regenerar: `bun scripts/build-index.mjs`.

| Skill | Categoria | Descrição | Caminho |
| --- | --- | --- | --- |
| [domain-modeling](core-pipeline/domain-modeling/SKILL.md) | core-pipeline | Extracts entities, relationships, invariants, and lifecycle states from a validated CONTEXT.md, naming everything with the business vocabulary and recording both the modeling decisions and what is deliberately left out.… | `core-pipeline/domain-modeling/SKILL.md` |
| [grill-with-docs](core-pipeline/grill-with-docs/SKILL.md) | core-pipeline | Interrogates real documentation and code before any planning. It collects primary sources, formulates the questions the material must answer, records gaps and contradictions explicitly instead of filling them with assum… | `core-pipeline/grill-with-docs/SKILL.md` |
| [handoff](core-pipeline/handoff/SKILL.md) | core-pipeline | Produces an auditable, self-contained closing document for a session or round, addressed to another agent or a human. It records context and rationale, delivered versus pending scope, execution order in blocks separated… | `core-pipeline/handoff/SKILL.md` |
| [implement](core-pipeline/implement/SKILL.md) | core-pipeline | Implements code against an approved spec in the project repository, adversarially re-verifying every finding at file:line before touching it (Confirmed, Partial or Refuted — refuted findings never become edits), one fea… | `core-pipeline/implement/SKILL.md` |
| [to-spec](core-pipeline/to-spec/SKILL.md) | core-pipeline | Converts validated context and domain understanding into an executable specification with scope, non-scope, expected behavior backed by verifiable acceptance criteria, error cases, dependencies, and risks — one spec per… | `core-pipeline/to-spec/SKILL.md` |
| [writing-for-agents](meta/writing-for-agents/SKILL.md) | meta | Meta-skill that governs ALL document writing in Shizune. Use whenever creating or editing any Markdown document — status, handoff, ADR, ficha, guia, relatorio, skill, template — or reviewing one for quality. Triggers: "… | `meta/writing-for-agents/SKILL.md` |
| [shizune-adr](ops/shizune-adr/SKILL.md) | ops | How to write an ADR (Architecture Decision Record) for Shizune. Use when recording a new decision, superseding an existing ADR, or citing ADRs across projects. Triggers: "criar ADR", "registrar decisão", "novo ADR", "su… | `ops/shizune-adr/SKILL.md` |
| [shizune-rodada](ops/shizune-rodada/SKILL.md) | ops | How to plan and conduct an execution Rodada (round) in Shizune — blocks, mandatory human stops (PARADAs), pre-defined numbered validation criteria and blocking gates, and an immutable final report. Use when planning mul… | `ops/shizune-rodada/SKILL.md` |

## Bibliotecas externas

Referências e bibliotecas de terceiros são catalogadas em [references/README.md](../references/README.md).
Bibliotecas vendor de skills de terceiros permanecem fora do framework por política de licenciamento; o catálogo de referências aponta onde cada acervo vive.
