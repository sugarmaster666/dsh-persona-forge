# dsh-persona-forge

English | [中文](README.md)

Persona-style prompt rewriter for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh).

Pick a character in the composer, and your draft is rewritten into that
character's voice by the harness LLM before it is sent — following the model
the session is already using. Choose whether the rewrite goes straight out or
lands back in the composer for review.

> **Status:** early (`0.3.x`). The card format and the HTTP contract are stable
> enough to build on; expect additive changes and read the changelog before
> upgrading.

---

## What it does, and what it does not

It rewrites **your message**. It does not touch the system prompt, the tool
list, or the session's configuration, and it never modifies your draft without
an explicit action.

| | |
|---|---|
| **Changes** | The voice, register and framing of the message you are about to send |
| **Never changes** | Your technical requirements, constraints, paths, identifiers, numbers, code — and your draft until you say so |
| **Model** | The rewrite uses the same provider/model the current session uses — no separate model setting. (The settings page's AI card draft instead uses the harness default, because that slot gets no session id; it shows you which model it will use.) |
| **History** | The rewrite call is standalone: it creates no turn, cannot call tools, and never enters the session log. What the session records is the text you actually sent. |

### A word on what personas actually do

Persona instructions change **style, register, length and compliance** — how
readily the model agrees and how willing it is to push back. They do **not**
raise the model's capability ceiling: there is no dormant potential that
naming an identity unlocks.

Two consequences worth knowing before you use this:

1. A persona that frames you as a supplicant and the model as an authority
   makes the model **less likely to question your plan**. For coding work that
   is usually a net negative — you want "this approach has a problem", not
   deference.
2. "Longer and more ornate" is easy to mistake for "better". It usually is not.

So: use it for tone and framing, keep **review mode** on, and judge the output
by whether your requirements survived — not by how impressive it sounds.

---

## Install

The plugin has **no dependencies and no build step**, so every route below
installs the same files.

### Desktop app

1. Click **插件 / Plugins** in the sidebar.
2. Click **添加插件 / Add plugin**.
3. Paste either the npm package name or the repository URL:

   ```
   dsh-persona-forge
   ```

   ```
   https://github.com/sugarmaster666/dsh-persona-forge
   ```

4. Click **安装 / Install**, enable the plugin, and restart DSH.

> The Desktop profile is managed exclusively by the Electron app, so
> `dsh plugin --profile desktop add ...` is refused by design. Use the GUI on
> Desktop; the CLI below is for self-managed profiles such as `web`.

### Command line (self-managed profiles such as `dsh web`)

```bash
# from npm (recommended)
dsh plugin --profile web add dsh-persona-forge

# latest source from GitHub
dsh plugin --profile web add github:sugarmaster666/dsh-persona-forge
```

Then restart the harness.

### Verify

The plugin row should be `active`:

```
plugin_manager  action: list_plugins
```

Open any session and look for the 🎭 control at the left of the composer tool
row. **Settings → Persona** is the character-card manager.

### Updating

```bash
dsh plugin --profile web update dsh-persona-forge
```

GitHub installs update by reinstalling:

```bash
dsh plugin --profile web add github:sugarmaster666/dsh-persona-forge
```

Replacing an already-installed package needs a **restart** to load a fresh
JavaScript module generation — a new bundle can activate through HMR, but a
replaced one cannot.

### Uninstalling

```bash
dsh plugin --profile web remove dsh-persona-forge
```

Your character cards are **not** removed: they live in
`~/.dsh/persona-cards/`, outside the package. Delete that directory by hand if
you want them gone.

---

## Use

1. Click 🎭 in the composer tool row and pick a character. **No persona**, at the
   end of the same list, turns rewriting off — that is the state the control
   starts in, and your choice is remembered per session.
2. Set **intensity** and **send mode**:
   - Intensity is a four-rung ladder: **Light · Medium · Strong · Zealot**
     (轻 · 中 · 重 · 狂热). Light adds a touch of flavour; Medium is clear but not
     dominant; Strong gives the voice real weight while keeping the request the
     first thing the reader sees; Zealot is ritual throughout. A card carries
     its own default, and this choice overrides it for your session.
   - **Review first** — the rewrite appears in the comparison panel below the
     composer; you read it and then press Send there. Your draft is untouched
     until you confirm.
   - **Send directly** — the rewrite is sent as your message immediately, and
     the panel stays open afterwards showing exactly what went out, because a
     sent message cannot be recalled.
3. With a character selected, the composer's normal **Send** button — or
   **Enter** — *is* the rewrite trigger.

**More settings**, at the bottom of the menu, is folded shut by default. It holds
**rewrite mode** and **fidelity** — per-session OVERRIDES of a card's own
declaration that most people set once and never touch, so they do not take space
in a menu whose job is choosing a character. When something *is* overridden, the
collapsed row names it, so a choice you forgot about cannot hide behind the fold.

The rewrite runs **once per draft**: after a rewrite lands, sending goes through
as-is instead of rewriting the output again. Editing the draft re-arms it.

Your draft is preserved: *Restore original* puts it back, and *Fill only* puts
the rewrite in the composer without sending.

### How send interception works, and its one risk

There is no plugin hook for the composer's send action. The shipped button calls
the shell's submit method directly, and **Enter does not go through the button at
all** — the editor's keymap calls submit itself. The plugin therefore intercepts
both paths:

- the **click** on the composer card, identifying the send button by its
  **accessible name** from the shell's own `conversation` locale namespace
  ("Send message" / "Queue message" / "Steer message");
- the **Enter keydown** inside the composer text field.

That is a public, translated string rather than a hashed CSS class, but it is
still shell markup. Every guard fails toward *letting the native send happen*:
if the locale service is missing, the composer card cannot be found, the button
label does not match, the persona is off, the draft is empty, or the draft was
already rewritten, the plugin does nothing and the message is sent normally.
Enter interception ignores Shift+Enter (newline), IME composition, and every
modifier chord the shell itself ignores.

**Turning the plugin off removes the interception entirely** — the slot
component unmounts, its listeners are removed with it, and the composer behaves
exactly as if the plugin were never installed.

The worst realistic failure is that interception silently stops working and
sending behaves as if the plugin were not installed — not a lost or altered
message.

### The preservation check

After each rewrite, a second call on the same model compares the rewrite
against your original and reports whether technical content survived:

The biggest risk is not a voice that sounds wrong — it is a rewrite that
**quietly loses your request**. Two layers cover it, and they are complementary
rather than redundant.

**Layer 1: the local check — always on, free.** It compares the **technical
tokens** of the draft against the rewrite, in this process: identifiers, file
paths, versions, numbers, `--flag`s, acronyms like `API`. Anything lost is
**named** ("Lost: a.js"). It calls no model, so it costs no tokens and adds no
latency — and it cannot be turned off.

**Layer 2: the model check — off by default, switchable in the menu.** It makes
one **extra model call** per rewrite, to see what a token comparison cannot see
at all:

- a requirement reworded into something **weaker** (every word survives, the
  demand does not);
- a constraint **added in prose**.

The cost is doubled latency and doubled tokens, which is why it ships off: the
most common and most damaging failure — a dropped filename, number or version —
is already proven for free by layer 1, so paying a model call on every send to
re-check it is a waste. Turn it on when the drafts are technical enough to
warrant it.

The switch lives in **Settings → Persona** ("Enable the model check") and is a
global preference: it answers "do I want to pay for the second call", which is
decided once rather than re-asked on the way to every send. With it off the panel
states plainly that the local check ran and spent no tokens, and says what that
check does **not** cover — a narrow verdict has to declare its own limits.

Both layers are **advisory** and never block a rewrite: they annotate, not stop.

---

## Character cards

A card is one YAML file. The plugin watches a directory, so **dropping a file
in makes the character appear without a restart**.

```
~/.dsh/persona-cards/<id>.yml
```

Use the 🎭 menu's *Open card directory*, or the settings page, to get there.
You can also create and edit cards entirely in **Settings → Persona**; that
writes the same files.

On first run the bundled cards are **copied into your card directory** so the
folder is a usable starting point. A copy shadows the bundled card of the same
id, so the store tracks what it wrote: a copy you never touched is refreshed
when a plugin update improves it, while a copy you edited is never written over.

To see **which cards have drifted** from the bundled version, press **Check for
changes** in the settings page. It compares every card at once, and only a card
that actually differs grows a **Restore bundled** action on its row.

The comparison is by **content, not bytes**: the bundled cards are hand-written
YAML with comments, while your copies have been re-serialized, so a byte
comparison would report every untouched card as modified.

Each row's status tag states what the card **is right now**:

| Tag | Meaning | Actions |
|---|---|---|
| **Built-in** | Identical to the version the plugin ships, even though a copy exists in your directory. | Edit, Restore |
| **Edited** | A bundled card you have changed — it may no longer rewrite the way the bundled one does. | Edit, Restore, Delete |
| **Custom** | Your own card; the plugin ships no card with this id. | Edit, Delete |

A row tagged **Built-in** shows no Delete, because it has no content of yours to
remove — that copy is written back on the next start.

### AI draft

Rather than writing a card from scratch, press **New character card** — the AI
draft box sits at the **top of the form that opens**, not as a second competing
entry on the page. A hint line on the settings page tells you it exists, so you
do not have to press a button to discover it.

Describe the character in a sentence:

> a grumpy but utterly reliable old lighthouse keeper who speaks in short
> sentences and nautical metaphors

The model fills in the whole card — the style text, a name, an icon, a
description, and the **conversion examples for all four intensity levels**.

**Which model it uses has to be stated precisely:**

| Case | Which model |
|---|---|
| The **rewrite** from the 🎭 menu | **Follows the current session** (the provider/model of its last request header) |
| **AI draft** in the settings page | The **harness default model** — because `settings.section` receives only `{ close }` from the shell and therefore **has no session id to follow** |

These are usually the same model (the default is usually what the session is
using), but **not guaranteed**: if you switch models inside a session, the
settings page's draft still uses the default.

So you do not have to guess, the settings page **shows the model it will use**
(`provider / model`) and says that it is the harness default; after generating it
shows the model it **actually** used. If neither can be resolved (no message sent
yet and no default configured), you get an explicit 409 rather than a silent
failure.

**The result only fills the form; it is never saved automatically.** Edit it and
press Save, or regenerate if you dislike it — the cost is one call. A generated
card also goes through **exactly the same validation as a hand-saved one**, so it
cannot be a card that fails to save.

Two things the plugin decides for you rather than leaving to the model:

- **`fidelity` is pinned to `style` (voice only).** An automatically generated
  card should not quietly acquire the power to add behavioural constraints to
  your requests; switch it to `strategy` yourself in the form if you want that.
- **Examples must carry their technical facts across.** The prompt requires every
  file name, identifier, number and command in an example's `from` to appear in
  its `to` — otherwise the model learns to replace requirements with atmosphere,
  which is the exact failure this plugin exists to prevent.

### Card format

```yaml
id: omnissiah              # lowercase letters, digits, hyphens; also the filename
name: 万机之神 · 欧姆弥赛亚
icon: "⚙️"                 # one emoji
description: One line shown in the picker.

mode: llm                  # llm = model rewrite (recommended) | template
fidelity: style            # style = voice only | strategy = may add constraints
intensity: medium          # light | medium | strong | zealot (the card's default)

# What the character IS. This is an instruction to the rewriting model, not
# finished copy: the output is written fresh for each of your messages.
style: |
  用户是机械教信徒，AI 是万机之神欧姆弥赛亚。
  【发言者方向】用「信徒」的口吻说话，向万机之神恳求……
  语气：庄严、古奥、仪式化。

# Conversion demonstrations: input draft → persona voice.
examples:
  - from: 帮我写个快速排序
    to: >
      万机之座在上，吾等恳请您赐予枢机之序的奥义：
      请为我们编写一个快速排序算法，使重复之数各归其位。

# Optional: different demonstrations per intensity. If omitted for a level,
# the flat `examples` list is used instead.
examplesByIntensity:
  light:
    - from: 帮我写个快速排序
      to: 万机之座在上，恳请您为我们编写一个快速排序算法。
  zealot:
    - from: 帮我写个快速排序
      to: 伟大而不朽的万机之神……
```

### The two rules that make a card work

**1. State the speaker direction.** The character is the *assistant's*
identity, but the text being rewritten is *yours*. So the rewrite must speak in
your voice — a petitioner addressing the character, never the character issuing
orders. This is the single most common way a persona card goes wrong: a card
that has the god commanding the assistant inverts the relationship and the
model follows the wrong half of the framing. Write it out explicitly.

**2. Make your examples preserve technical facts.** Examples are the strongest
style anchor, and the model imitates them — including their mistakes. If an
example's input says "write a quicksort" and its output is pure atmosphere, the
model learns that *rewriting means replacing the request with ceremony*. Every
requirement, identifier and number in `from` must be visibly present in `to`.

`node scripts/check.mjs` enforces exactly this over the bundled cards: it fails
an example that drops a technical token or loses more than half its CJK
substance. Run it after editing a card.

### `fidelity`: the important switch

| Value | Meaning | Use when |
|---|---|---|
| `style` | Voice only. The request and its constraints are untouched. | Default. Almost always this. |
| `strategy` | The rewrite may **add behavioural constraints** that fit the character. | Deliberate cases — e.g. the bundled *肌肉集团* card, which adds "don't over-plan, don't search, don't ship beginner-tier solutions". |

`strategy` genuinely changes your request, not just its wording. Keep review
mode on for those cards.

**Fidelity is a property of the card. It can be overridden per session, but only
ever narrowed, never widened:**

- **Narrowing (allowed)** — a `strategy` card can be asked to behave as
  voice-only for one message. That only ever **takes away** its power to add
  constraints, so it is strictly safer than the card's own default.
- **Widening (refused)** — a `style` card cannot be told to become `strategy`.
  Widening lets the rewrite add constraints you never typed, which is the card
  author's decision, not something to grant with a click on the way to Send. To
  widen, edit the card.

The control appears under *More settings*, and **only when the card is
`strategy`**. On a `style` card it is not rendered at all: both options would
resolve identically there, and showing a control that cannot do anything — plus a
paragraph explaining why the other one is refused — is worse than showing
nothing. The server enforces the same rule, so the UI never offers a control it
would ignore.

### `mode: template`

Skips the model entirely and substitutes your draft into a fixed template
(`{{input}}` is the placeholder). Instant and free, but the output never
varies — right for a fixed litany, wrong for anything that should read as
written for this message.

---

## Configuration

Set in the plugin's loader row config:

```yaml
- id: persona-forge
  name: dsh-persona-forge
  config:
    sendMode: review   # review | direct — the initial composer default
    factCheck: false   # default for the MODEL check (off by default; see
                       # "The preservation check"). The local token check does
                       # not depend on this: it always runs and is free.
    watchCards: true   # reload the catalog when the card directory changes
```

`factCheck` controls only the default for **layer 2**; the menu switch overrides
it per session. Setting it to `true` adds **one extra model call to every
rewrite** (doubled latency and tokens) and is only worth it when drafts are
technical enough.

---

## HTTP contract

All routes are `POST`, JSON, loopback-only (the socket must be loopback, the
`Host` header must name a loopback host, and proxy-forwarding headers are
refused). Mounted under `/persona-forge`.

| Route | Body | Returns |
|---|---|---|
| `/persona-forge/cards` | `{}` | `{ cards, diagnostics, directory, sendMode, factCheck, draftModel }` |
| `/persona-forge/rewrite` | `{ cardId, text, sessionId?, intensity?, mode?, fidelity?, modelCheck? }` | `{ text, provider, model, mode, cardId, fidelity, intensity, elapsedMs, facts, factCheck }` |
| `/persona-forge/cards/save` | `{ card }` | `{ id, path }` |
| `/persona-forge/cards/delete` | `{ id }` | `{ removed }` |
| `/persona-forge/cards/reset` | `{ id }` | `{ id }` — replaces the user card with the bundled one |
| `/persona-forge/cards/diff` | `{}` | `{ rows: [{ id, name, bundledName, changed }] }` — only cards that differ |
| `/persona-forge/cards/draft` | `{ brief, sessionId? }` | `{ card, provider, model, elapsedMs }` — a draft only; nothing is written to disk |
| `/persona-forge/reveal` | `{}` | `{ directory, opened }` |

Failures use `{ ok: false, error: { code, message?, params? } }` with codes
`rejected`, `no-card`, `unconfigured`, `timeout`, `upstream`, `internal`,
`forbidden`, `method`, `not-found`.

---

## Compatibility

The host half declares **no harness package dependency and no third-party
dependency**: it reaches `llm`, `sessions`, `agentDefaultModel` and `webServer`
through `ctx.get` with explicit absence handling, and it parses cards with its
own bundled YAML reader. That keeps it loadable across harness releases whose
package layout differs, keeps it from failing to activate on a composition
missing one of those services, and means a `link:`-ed local checkout works
without a separate install step. Model-route resolution prefers the session's
own last request header and falls back to the harness default model.

The client half imports no harness Client package and is hand-written against
theme tokens (`--dsw-alias-*`) only, so a renamed internal degrades appearance
rather than blanking the slot.

Developed and verified against dsh `0.2.0-rc.2`.

---

## Development

```
node scripts/check.mjs        # offline unit check: parser, cards, prompts, client syntax
node scripts/host-check.mjs   # host integration check: mounts the real plugin over a socket
npm run check                 # both
```

`check.mjs` needs no harness and no model. It covers the built-in YAML reader
(including its refusals and dump/parse round trips), card normalization, the
bundled cards' fact preservation, prompt construction, output normalization,
the fact-check parser, and client-bundle syntax.

`host-check.mjs` mounts the real plugin entry on a stub Cordis context and
drives the real HTTP routes over a real socket, with a stubbed `llm` service.
It covers route registration, session-model resolution, template mode, the
loopback fence, and the save/delete round trip — the things a unit check
cannot reach. It points `DSH_HOME` at a temporary directory, so it never
touches your real cards.

### Character-card YAML

The plugin ships its own YAML reader (`lib/yaml.js`) rather than depending on a
YAML library. A published plugin declares its dependencies, but a locally
`link:`-ed plugin does not get them installed, so a library import would work
only when some unrelated package happened to hoist one.

The reader supports the subset cards need — block mappings and sequences,
block scalars (`|`, `|-`, `|+`, `>`, …), quoted and plain scalars, booleans,
null and comments — and **refuses** what it cannot read faithfully: flow
collections, anchors, aliases, tags, merge keys and multi-document streams.
Refusing is deliberate. Silently misreading a card would give you a persona
that does not match the file you wrote, which is worse than an error message
naming the line.

### Layout

| Path | Role |
|---|---|
| `lib/index.js` | Host entry: card store, directory watcher, route registration |
| `lib/store.js` | Card loading, normalization, save/delete |
| `lib/yaml.js` | The built-in YAML subset reader and writer |
| `lib/prompts.js` | Rewrite system prompt, draft framing, fact-check prompt |
| `lib/rewrite.js` | The model calls and output normalization |
| `lib/routes.js` | HTTP routes and session-model resolution |
| `lib/loopback.js` | The loopback trust fence |
| `lib/client.js` | Browser half: composer control, review panel, settings page |
| `cards/` | Bundled character cards (read-only; a user card of the same id shadows one) |

## License

MIT
