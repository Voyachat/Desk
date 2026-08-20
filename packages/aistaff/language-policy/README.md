# Aistaff language policy

English | [中文](README.zh.md)

Product language behaviors for the AI Staff desktop deployment, contributed
entirely through documented DSH extension points (system-prompt sections and
contexts, the settings document, one model-facing tool) so upstream harness
updates merge without touching this package.

Three behaviors compose one policy:

1. **Default output language.** A standing system-prompt section names the
   default language for replies and for every deliverable kind (web pages,
   spreadsheets, documents, presentations, media). It resolves the user's
   `locale.preference` settings value, falling back to the row's
   `defaultLocale` config.
2. **Conversation adaptation.** A runtime-context delta reports the language
   detected from the user's own recent input whenever it differs from the
   baseline. The fold derives purely from logged user messages, so restored
   sessions replay the same answer.
3. **Explicit language rules.** The model records user instructions such as
   "this web page stays in English" through the `language_rule` tool. Rules
   persist in the `aistaff-language` settings namespace and are rendered into
   every honoring session's runtime context until removed.

The settings namespace is registered whenever the Host settings service is
available. Prompt and tool contributions attach independently when their
services appear, and all registrations follow the owning plugin's disposal.

## Config

| Field | Meaning |
| --- | --- |
| `defaultLocale` | Language tag applied while the settings document carries no explicit `locale.preference`. |

## Model Experience

### Default output language section

#### What the model sees

One system-prompt section directly after the persona, e.g. `Default output
language: Simplified Chinese (zh). Use Simplified Chinese for all assistant
replies and for all user-facing content in every deliverable …`.

#### Token effect

Roughly 120 tokens, present in every request of every session composed by
this deployment.

#### KV Cache effect

The section is stable until the user changes the language setting, so the
system-prompt prefix stays cache-resident across turns and sessions.

### Conversation delta context

#### What the model sees

Nothing on the common path (the baseline already matches). When the user's
input language differs, one runtime-context paragraph names the active
conversation language; recorded rules append one block. The context renders
into the standard logged runtime-context snapshot.

#### Token effect

Zero when inactive; tens of tokens per active override or rule.

#### KV Cache effect

Rides the existing runtime-context snapshot lifecycle; changes only when the
detection or the rule store changes.

## Known Limitations and Deferred Work

- Sessions running under drivers that bypass DSH prompt assembly (the Claude
  Agent SDK runtime, external CLI subagent providers) receive none of this
  policy; covering them needs a seam in those drivers first.
- Language detection is a deterministic script/vocabulary heuristic; rare
  mixed-script input stays undecided and keeps the prior language.
