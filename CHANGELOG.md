# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.3] - 2026-10-10

### Fixed

- **The character may be on EITHER side of the conversation, and the prompts no
  longer pretend otherwise.** Both the rewrite prompt and the card generator
  asserted flatly that *the character is the ASSISTANT's identity*. That is false
  for half the cards, and the bundled set proves it:

  | Card | Who is the character |
  |---|---|
  | 万机之神 · 欧姆弥赛亚 | the **AI** — the user addresses it as a petitioner |
  | 肌肉集团 · 硬邦邦 | the **user** — "**the user is** the client", addressing their own team |

  The rewrite prompt now states both cases, tells the model to take the direction
  from the card's style text, and defines the assistant-side default for a card
  that is genuinely silent. The generator is told the same, and takes the
  direction from the idea it is handed.

- **The AI-draft direction note no longer states the wrong rule.** It said "你是
  对角色说话的那个人，**不是角色本身**" — an absolute that contradicts 硬邦邦,
  where you *are* the character. It now says the character can be on either side
  and that picking one and saying so is all that is required.

  The brief example and description keep asking for the same three things (who
  the AI plays, who you are, how they talk) — the ambiguity was the bug, not the
  two-sidedness.

## [0.6.2] - 2026-10-10

### Fixed

- **The AI-draft example now states the speaker direction.** The placeholder was
  "一个脾气暴躁但极其可靠的老灯塔守夜人，说话简短、爱用航海比喻" — a character
  and nothing else. It never said whether **you** play that character or the
  **AI** does, which is precisely the ambiguity this plugin exists to avoid: the
  character is the *assistant's* identity, and the message being rewritten is
  always the *user's*.

  The mismatch was sharpest because the generator's own system prompt **requires**
  the style field to state the direction explicitly, while the example it was
  handed omitted it. The example is the strongest teaching signal in that box, so
  it now demonstrates what it demands:

  > 例如：AI 扮演一位脾气暴躁但极其可靠的老灯塔守夜人，我是他的学徒；他说话简短、爱用航海比喻

  The description asks for the same three things (who the AI plays, who you are,
  how they talk), and the box carries a standing line stating the rule. Both
  bundled cards already named it — 欧姆弥赛亚 is "a supplicant's prayer to the
  Machine God", 硬邦邦 is "**the user** is the client".

- **The AI-draft copy said who does what, and what "the spec" actually is.**
  It read "用一句话描述角色的思路，AI 会按同一套规范把表单填好" — with no
  subject, so it was unclear whether *you* describe the character or the AI
  does, and "同一套规范" pointed at an internal quality standard the user cannot
  see or act on.

  Both languages now name the actor and the fields: **you** write one sentence
  about the character, and the AI fills the form by the character-card fields —
  name, icon, description, style text, and a conversion example set per
  intensity level. The hint also states the two things a generated card
  deliberately pins: **fidelity is always voice-only** and **rewrite mode is
  always model rewrite**, so a generated card never quietly acquires the power
  to add constraints to your request.

### Added

- **Checks pin the direction into the brief.** The placeholder must demonstrate
  who plays whom and must name the user's own role; the description must ask for
  it; the rule must be stated in the box; and the copy must carry no markdown,
  since the shell renders it as plain text. Confirmed red against the old
  placeholder.

- **Checks pin that copy to the behaviour.** The description must name the four
  fields the generator fills and must not fall back to "规范", and the generated
  card must stay pinned to `fidelity: 'style'` / `mode: 'llm'` with the copy
  saying so. Confirmed red against the old wording.

## [0.6.0] - 2026-10-10

### Changed

- **Fidelity is now free in both directions, on every card.** It used to be
  one-way — a `strategy` card could be narrowed to `style`, but a `style` card
  could never be widened — and the control was rendered only on `strategy` cards.
  The reasoning was that a click on the way to Send should not grant the power to
  add constraints to your request.

  That reasoning does not hold up: **the card is the user's own file**, and the
  settings page has always let them set `fidelity:` directly. Refusing in the
  menu did not remove the capability, it only made the choice disappear from the
  place where the work happens. The server rule is now symmetric, and all three
  options — card default, voice only, constraints too — appear on every card.

  The honest framing is kept: "constraints too" genuinely changes the request, so
  the tooltip says so and points at review mode.

- **The settings fold no longer explains itself in permanent prose.** Every row
  and every option now carries its explanation as a **tooltip** on the control.
  The fold had grown to four rows plus six lines of standing explanation, which
  is a wall of text for a menu whose job is picking a character.

- **Rewrite mode and fidelity now follow the character too**, not the session.
  They were already displayed under the character while being stored per session,
  which meant the setting you saw and the setting you got could disagree after
  switching character. All four settings are now read from, and written to, the
  card's own keys.

### Added

- **The check suite guards the READMEs.** The status line and the inspiration
  link had both already rotted unnoticed, so three checks per README now pin the
  current minor version, the video link and its author, and the named target
  model.

## [0.5.2] - 2026-10-10

### Changed

- **The README's "what a persona changes" section now says where this came
  from.** The old text was a flat disclaimer — personas do not raise the
  capability ceiling, do not expect a performance switch. That is still true and
  still stated, but it read like a warning label on a project whose whole point
  is delight.

  It now credits the source: [**“ds：好的，我现在是万机之神了（”**](https://www.bilibili.com/video/BV1Ata26pE92)
  by 身居幻想乡の长乐安生 — a 30-second video whose comment section describes the
  effect better than any spec sheet ("another AI is you pretending to be Guan
  Yu; when Big Fat Fish pretends, she really rides out and cuts down Hua
  Xiong"). It also names **DeepSeek Flash** as the model this is tuned for,
  which was never said anywhere.

  Both READMEs also carried a stale `0.3.x` status line; they now state `0.5.x`.

### Added

- **The check suite now guards the READMEs.** The status line and the
  inspiration link had both already rotted unnoticed, so three checks per README
  now pin the current minor version, the video link and its author, and the
  named target model.

## [0.5.1] - 2026-10-10

### Changed

- **"More settings" is gone; everything it held moved into the character's own
  fold.** Having two folds split one idea across two places — intensity and send
  mode under the character, rewrite mode and fidelity somewhere else — so
  **rewrite mode** and **fidelity** now sit in the same **"Settings for
  <name>"** fold as the rest. The folded row's summary names the intensity, the
  send mode and the rewrite mode, so the whole configuration is legible without
  opening it.

- **Every rewrite mode now says what it does.** The segmented control named
  three options and explained none of them, so the difference between a model
  rewrite and a template was something you had to guess:

  - *Card default* — use whatever this card declares on the settings page.
  - *Model rewrite* — calls the model to rewrite your draft in the character's
    voice. Most flexible; costs one model call.
  - *Template* — fills your draft into the card's preset template with no model
    call. No latency, no tokens, but the voice is fixed.

### Removed

- **"Open card directory" left the rewrite menu.** The settings page already has
  an *Open directory* button, so the menu row was a second door to the same room
  — and it put occasional housekeeping in the path of choosing a character.

## [0.5.0] - 2026-10-10

### Changed

- **Intensity and send mode now belong to the CHARACTER, not to the session.**
  "硬邦邦 always goes out Zealot, un-reviewed" is a property of that character
  rather than a choice about one conversation, so both are stored per card:
  configure it once and picking that card in another session gives you the same
  settings.

  They also moved out of the shared block above the list and under the card they
  apply to, as a folded **"Settings for <name>"** row. Sitting above every card,
  they read as global switches for the whole menu — and switching character
  silently carried the previous card's intensity over. The fold's summary line
  shows the current rung and send mode, so the state is visible without opening
  it.

  Switching character now **re-reads that card's settings**; without that the
  previous card's values stayed on screen and were then written to the new
  card's key.

- **Picking a character no longer closes the menu.** Choosing a character and
  configuring it are one act, and closing on pick forced a reopen to touch
  intensity at all.

- **The card directory moved into "More settings".** It is housekeeping you do
  occasionally, not something to scroll past on the way to choosing a character.

## [0.4.1] - 2026-10-10

### Removed

- **The model-based preservation check.** It made a second model call on every
  rewrite to catch what the free token comparison cannot see — a requirement
  reworded weaker, a constraint added in prose. It is gone, along with its
  prompt, its verdict parser and every wire field (`factCheck`, `modelCheck`).

  It doubled the latency and the token cost of every send to re-check what the
  local comparison answers for nothing, and the settings page never offered a
  working switch for it — a documented feature with no reachable control. For
  the residue it was meant to cover, the rewrite column is now editable, which
  is more direct than another round trip.

  The retired `factCheck` config key is **ignored rather than rejected**, so a
  profile still carrying it loads unchanged and simply makes no second call.

### Fixed

- **Rewriting in one session no longer makes every other session look busy.**
  The composer button read the panel's phase **globally**, so while any single
  session was rewriting, every open composer rendered "改写中…". The panel is one
  shared surface, so its phase is global — but what the button shows must be
  scoped to its own session. It now reads the session-filtered panel, the same
  value the send guards already used.

## [0.4.0] - 2026-10-10

### Added

- **The rewrite column is editable.** What the model wrote is a starting point,
  not a verdict: fixing a dropped identifier or a tone that is slightly off by
  hand is faster than another round trip. **Send** and **Fill** carry the
  edited text, and the panel says when the text differs from what the model
  produced, so nothing goes out silently different.

- **While the review panel is open, the composer's send arrow is inert.** The
  panel is the decision point. Pressing send with it up either pushed the
  un-reviewed draft out or started a **second** rewrite of the same draft —
  the duplicate that appeared once the panel was on screen. Closing the panel,
  or choosing an action in it, re-arms the composer. Direct-send mode is
  unaffected: it submits programmatically rather than through a gesture.

### Removed

- **The "Fill only" button, from the normal flow.** With an editable result,
  writing the text into the composer without sending is the same act as
  reviewing it, so the button was a second control for one idea. It survives
  only for a shell that exposes no submit action, where it is the sole way to
  get the text out.

### Fixed

- **An edited result is no longer rewritten again.** `apply` recorded only the
  untouched original as "already rewritten", so sending a hand-edited result
  from the composer came back as a fresh rewrite of the user's own edit. Any
  settled text is now recorded. *Restore original* still deletes the memory
  outright, because that is a rewind rather than a settled result.

## [0.3.5] - 2026-10-10

### Fixed

- **The same sentence typed twice is rewritten both times.** The send guard
  skipped a rewrite when the draft matched the last rewrite's result **or** its
  original text. Restoring the original already clears that memory, so matching
  `original` bought nothing and silently disabled the persona for any repeated
  draft — type "讲个笑话", send it, type it again, and it went out
  un-rewritten.

- **Interception can no longer disarm itself.** The send listeners were bound
  to the composer card, found through the plugin's own button. A card that was
  not found meant the whole feature silently did not arm — the plugin looked
  dead, with no error anywhere. The listeners now sit on `window` and each
  guard scopes its event to the composer card it belongs to, so a miss costs
  one event rather than the feature.

### Changed

- **The send-gesture decision is now a pure function** (`decideSend`) returning
  `{ action, reason }`, and the client exposes `__internals` so the check suite
  can boot the real bundle and drive it. This decision fails **silently** in
  both directions — swallow a gesture that should have been sent and the
  message vanishes; let one through that should have been rewritten and the
  persona quietly does nothing — and neither throws, so the only symptom is "it
  stopped working". Thirteen behavioural cases now cover it, replacing
  source-shape assertions. The repeated-draft case was confirmed to fail
  against the old predicate.

  The pure-guard-plus-seam approach follows
  [`dsh-prompt-hardener`](https://github.com/ffyfox/dsh-prompt-hardener), which
  reached the same conclusion about this class of silent failure.

## [0.3.4] - 2026-10-10

### Fixed

- **One wedged rewrite no longer freezes the plugin for good.** The review
  panel is a single shared surface, but the guards around it were global while
  the send interceptor guarded per session. A single rewrite left stuck at
  `loading` therefore poisoned everything after it: `start()` hit its global
  `busy` guard and **silently did nothing** — no rewrite, no error — while in
  another session the interceptor let the gesture through to the native send.
  Reported as "after it hangs, it just sends my text and the plugin never
  intercepts again".

  - `runRewrite` now refuses only a concurrent run for the **same** session, so
    one wedged session cannot block another.
  - `start()` guards on the **per-session** busy, matching `runRewrite` and the
    interceptor. A send gesture is now either rewritten or sent; it is never
    swallowed into nothing.
  - A client-side watchdog settles the panel after 135s even if the host never
    answers. The host's own deadline is not enough: this half must stay usable
    without depending on the other half being alive.

## [0.3.3] - 2026-10-09

### Fixed

- **A rewrite now runs on the model you picked, even before you send with
  it.** Switching models in the composer and then rewriting used the
  **previous** model: the route came only from the session's last request
  header, which does not advance until a message is actually sent. Observed
  live as the composer showing `hy4-preview` while the rewrite ran on a stale
  `workbuddy-xdpool-global / deepseek-v4.1-flash` route.

  The host's own precedence, in `api-session`'s `selectionFor`, is
  **pending → request header → harness default**; the plugin implemented only
  the last two. It now reads the `modelSelection` projection's `pending` first,
  so a dropdown pick takes effect immediately. Every step is still optional and
  falls through to the next, so a harness without that projection behaves
  exactly as before.

- **A rewrite whose model never answers now fails instead of hanging
  forever.** `for await (const chunk of llm.stream(...))` only exits when the
  adapter stops yielding. A provider that accepts the request and then sends
  nothing — a rate-limited model — yields no chunk, so the 120s deadline's
  `abort()` was invisible to the loop and the call never returned: the panel
  spun with no result, no error, and no timeout.

  Each pull is now raced against the deadline, so the loop leaves on its own
  and reports `TIMEOUT` instead of waiting on a stream that will never speak.
  The stream is abandoned rather than drained, because draining a wedged
  provider is the hang this guards against.

  Two regression tests cover both, and both were confirmed to fail against the
  old code: the route test goes red, and the deadline test hangs the suite
  outright (`Detected unsettled top-level await`) — the reported symptom.

## [0.3.2] - 2026-10-09

### Changed

- **The rewrite stops naming a reasoning effort, so it works again on routes
  that declare none.** An earlier attempt to speed slow rewrites up pinned
  `reasoningEffort: 'low'`; on `workbuddy-xdpool` / `hy4-preview` every rewrite
  then failed outright with
  `does not support reasoning effort "low"`.

  The harness validates the field before it reaches any provider: when a
  route's model declares **no** reasoning metadata, **any present value**
  throws — including `''`, which is the host's own "Provider default" sentinel
  in the ACP session-config layer, and including `'off'`. Absence is therefore
  the only portable way to ask for the route's default, and the call now leaves
  the field out.

  The latency this was meant to fix is **not** fixed by it. On a reasoning
  model the rewrite may still spend thinking time before it emits anything; the
  120s deadline and the elapsed-seconds readout from 0.3.1 remain the honest
  answer there.

## [0.3.1] - 2026-10-09

### Fixed

- **A rewrite waiting on a slow model no longer reads as frozen.** The panel
  showed 改写中 with no sense of time, so a slow rewrite was indistinguishable
  from a hang. The host has had a 120s deadline all along, so the panel was
  never stuck forever — but two minutes of a silent spinner looks exactly like a
  freeze. It now ticks elapsed seconds, and past 45s says the model may just be
  slow and how to give up.

### Removed

- **The settings page's model-check checkbox.** It duplicated the plugin row's
  own `factCheck` config — a second setting for the same thing, sitting on a
  page that is about cards. The host config is the single control and already
  defaults to off. The checkbox, its dictionary keys and the client-side
  preference behind it are gone.
- **The permanent drift-check instruction line.** The button's tooltip already
  carried the same sentence. The page now renders only the check RESULT, which
  is real feedback rather than the same copy twice.
- Three dictionary keys no route or component referenced:
  `settings.ai.briefLabel`, `settings.changed`, `error.busy`.

## [0.3.0] - 2026-10-09

### Added

- **AI 代填（AI draft）**, in the character-card manager. Describe the character
  in a sentence — "a grumpy but utterly reliable old lighthouse keeper" — and the
  model writes the whole card: the style text, a name, an icon, a description and
  the conversion examples for all four intensity levels.

  The result **only prefills the form**. Nothing is written to the card directory
  until the user reviews it and presses Save, so a generation the user dislikes
  costs one reload — the same review discipline the rewrite panel enforces. The
  generated card is also passed through the very same validator the save path
  uses, so this route cannot hand the form a card that cannot be saved.

  It sits **inside the new-card flow** (the form that "New character card" opens),
  with a hint line on the settings page so it is discoverable without pressing a
  button. It uses the **harness default model**, and says so: the
  `settings.section` slot receives only `{ close }` from the shell, so it has no
  session id to follow. The resolved model is displayed before and after
  generating, rather than leaving the user to assume it matches the session.

- A **free, local preservation check** (`lib/preserve.js`), always on. It compares
  the technical tokens of the draft against the rewrite — identifiers, paths,
  versions, numbers, `--flags`, acronyms — and **names** what went missing. It
  makes no model call, so it costs no tokens and adds no latency.

- **Per-message rewrite mode and fidelity** in the 🎭 menu, alongside intensity.
  Mode falls back to the card's own when the card has no content for the chosen
  mode. Fidelity may be **narrowed** (a `strategy` card asked to behave as
  voice-only for one message) but never **widened**, and the server enforces the
  same rule.

- A **model-check switch** in the 🎭 menu, remembered per session.

- The card form now edits the **per-intensity examples**. They were part of the
  card but invisible in the UI, which is what made the bug below possible.

### Changed

- **The composer menu is a picker again, not a settings form.** It had grown to
  five equal-weight segmented rows plus 248 characters of permanently visible
  explanation, so picking a character meant scanning past four configuration
  rows every time. It is now two layers: card list, intensity and send mode
  always visible; **rewrite mode and fidelity** — per-session overrides of a
  card's own declaration — folded behind "More settings", shut by default. The
  collapsed row still names anything overridden, so a hidden choice cannot
  surprise the user later. Measured: 5 rows + 248 hint chars → 2 rows + 0
  permanent hint chars.

- **Fidelity is only offered when the card may add behavioural constraints.** On
  a voice-only card both options resolve identically, so the row was a control
  that could not do anything, paired with a paragraph explaining why the thing
  you would want was refused. It is now absent on `style` cards.

- **The model check moved to the settings page** as a global preference rather
  than a per-session switch in the composer menu. It answers "do I want to pay
  for the second call", which is decided once, not re-asked on the way to every
  send.

- "No persona" moved to the end of the card list: it is an exit action, and
  listing it first made it the first thing read in a menu whose point is choosing
  a character.

- **The model-based preservation check is now off by default** and switchable
  from the settings page. It is the only thing that can see a requirement
  reworded weaker, or a constraint added in prose — but it costs a second model
  call on **every** send, and the new local check already proves the common and
  most damaging failure for free. `factCheck` in the plugin config now sets that
  default, and only an explicit `true` enables it.

- The Chinese README is the primary `README.md` and the English one is
  `README.en.md`, so GitHub, npm and the repository landing page open in Chinese,
  with a language switch at the top of each file. The npm package description is
  Chinese for the same reason.

### Fixed

- **Editing a card silently destroyed its per-intensity examples.** The form did
  not carry `examplesByIntensity`, so pressing Save on any card rebuilt it
  without the four demonstration sets and the card fell back to its flat
  `examples` list. Renaming a bundled card was enough to lose all four intensity
  sets. The form now shows and round-trips them.

- **Every bundled card was labelled 自定义 (custom).** Bundled cards are seeded
  into the user card directory as editable starting points, so the tag was
  derived from "does a user file exist for this id" — true for cards nobody had
  ever touched. The row tag now reports real provenance, with a new **已修改
  (edited)** state for a bundled card the user has changed, and it is computed
  with the same semantic comparison the drift check uses, so the tag and the
  check's verdict now agree **by construction** instead of contradicting each
  other on the same screen.

- **Delete was offered where it could not take effect.** A card whose content
  still matches the bundle has no user-owned file: removing it cleared a seeded
  copy that the next start wrote straight back, so the button reported success
  and changed nothing. Delete is now shown only where it does something, and the
  confirmation for an edited bundled card says that its changes are discarded
  and the bundled version returns.

- **A cancelled rewrite could not be retried.** `lastRewrite` was written on
  every successful rewrite and never removed, so that the send gesture could
  tell "the rewrite is already in the composer" from "not rewritten yet".
  Restoring the original put the draft text back but left that memory in place,
  so the next send matched "already rewritten" and the plugin silently let the
  raw text through. Restoring is a rewind, not a reviewed result, so it now
  deletes the entry — conditionally on putting back the original, because
  sending the rewrite itself must still count as already rewritten.

- **A narrowed fidelity never reached the model.** The route computed the
  narrowed value and reported it in the response, but `buildSystemPrompt` read
  `card.fidelity` directly — so the setting appeared to work and did nothing. The
  effective fidelity is now passed into the prompt builder, and a test asserts on
  the prompt itself rather than only on the response.

- Three examples in the bundled 肌肉集团 · 硬邦邦 card dropped the word "bug"
  from their input. The self-check now verifies the per-intensity examples too,
  not just the flat list, which is what surfaced them.

## [0.2.1] - 2026-10-09

### Added

- **Check for changes**, in the character-card manager. It compares every user
  card against the bundled card of the same id and reports only the ones that
  actually differ; only a drifted card grows a **Restore bundled** action on its
  row. The alternative — a restore button on every user card — turns a long list
  into noise, and "restore" on a card that never changed is a no-op nobody
  asked for.
- The drift report names the differing fields (`style`, `examples`, …).

### Fixed

- **The card row's description overlapped the buttons.** `.pf-card-desc` is a
  `<span>`, and `overflow: hidden` / `text-overflow: ellipsis` do not apply to
  inline elements, so a long description — such as the bundled 硬邦邦 card's —
  spilled out of the card instead of being clipped. The body is now a flex
  column, which blockifies its children, and the description is clamped to two
  lines. The row's actions are `flex: none`, so the description yields rather
  than the buttons.

### Changed

- The drift comparison is by **content, not bytes**. Bundled cards are
  hand-written YAML carrying comments, while a saved card round-trips through
  the store's serializer and loses them, so a byte comparison reported every
  untouched seeded card as modified.

## [0.2.0] - 2026-10-09

### Added

- **The composer's own send gesture starts the rewrite.** Pressing the native
  **Send** button, or **Enter**, rewrites the draft instead of sending it raw.
  In review mode the comparison panel appears; in direct mode the rewrite is
  sent. The menu's separate "Rewrite with this persona" button is gone, because
  the send gesture replaced it.
- **Enter gets its own listener.** Enter is the primary send gesture and does
  not go through the button at all — the editor's keymap calls the shell's
  submit directly. Shift+Enter (newline), IME composition and the modifier
  chords the shell ignores still fall through untouched.
- **A fourth intensity rung, 重 / Strong.** The ladder was light → medium →
  zealot, which left no way to ask for a strong voice that is not yet full
  ritual. Every bundled card now ships demonstrations for all four rungs.
- **Restore bundled** in the character-card manager, for a user card that
  shadows a bundled one.
- Inline explanations for `intensity` and `fidelity` in the card editor.

### Changed

- The review-first description now describes what actually happens: the rewrite
  appears in the comparison panel and the draft is left alone until you confirm.
- Segmented controls are wider, and the review panel is capped to the composer
  card width instead of spanning the whole conversation.

### Fixed

- **A seeded card could freeze a bundled card at the version that shipped
  first.** Seeding wrote a copy of each bundled card into the user directory,
  and that copy shadows the bundled one — so an improved bundled card in a later
  release could never reach anyone who had already run an earlier version. The
  store now records what it seeded, together with a hash of the exact bytes: a
  copy still matching that hash is untouched and is refreshed on upgrade, while
  a copy the user edited is never written over. A file with no ledger entry is
  treated as the user's own card and is left alone.
- **The seed ledger was loaded as a character card**, producing a spurious
  "card has no name" diagnostic on every catalog read. The loader now skips
  dot-files.
- **`check.mjs` read the developer's real card directory.** The store merges the
  bundled cards with `$DSH_HOME/persona-cards`, so a stale seeded card silently
  replaced the bundled one and the suite's results depended on whatever the
  developer happened to have saved. The suite now isolates `DSH_HOME` to a
  temporary directory before importing the store.

### Security

- Both send-intercept paths are fail-safe: the locale service being absent, the
  composer card not being found, a label mismatch, the persona being off, an
  empty draft, or a draft that was already rewritten all fall through to the
  native send. Disabling the plugin unmounts the component and removes its
  listeners entirely, so sending behaves exactly as if it were never installed.

## [0.1.2] - 2026-10-09

### Fixed

- **No route was ever registered, so the whole UI was inert.** The plugin
  declares no service dependencies, so it applied *before* the web server
  mounted; reading `ctx.get('webServer')` at that moment found nothing and the
  route registration was silently skipped. Every request then fell through to
  the SPA fallback — an empty `405`/`404` body, which is what made the character
  list empty and "open the card directory" appear to fail. The entry now waits
  for the service with `ctx.inject(['webServer'], …)` and still loads on a
  composition that has no web server.
- **The menu let the conversation show through it.** `--dsw-menu-surface-fill`
  is translucent by design (~58% alpha) and only reads correctly with the
  host's `backdrop-filter` behind it; the plugin used the fill without the blur.
  Both are now applied together, exactly as the host Menu does, with the opaque
  `--dsw-alias-bg-overlay` as the fallback.
- **The card watcher could leak on unload.** The watcher is created
  asynchronously, so a plugin unloaded in that window never closed it. A
  disposed flag now closes a watcher created after teardown.

### Added

- `host-check.mjs` reproduces the mounting order that caused the missing
  routes: its stub context only runs `inject` callbacks for mounted services,
  and asserts that routes register through `inject` and that a
  web-server-less composition still loads.

## [0.1.1] - 2026-10-09

Three defects found by using the plugin in a real session.

### Fixed

- **The rewrite could not be started from the UI.** The only trigger was a
  right-click on the 🎭 control, which is undiscoverable — picking a character
  and an intensity changed settings and then nothing happened. The menu now
  opens with a full-width **"Rewrite with this persona"** action, disabled with
  an explanatory hint until a character is selected.
- **Filled controls were invisible in the light theme.** The selected segment
  and the primary action used `--dsw-alias-brand-primary` as a fill with a
  hard-coded white label. That token is *inverted* — near-white in the dark
  theme and near-black in the light theme — so the label vanished against it.
  Filled controls now use `--dsw-alias-button-primary-fill` with
  `--dsw-alias-label-primary-foreground`, exactly like the host Button, and the
  segmented control uses the host's translucent-track + raised-pill pattern.
- **The card directory was empty.** The bundled cards live read-only inside the
  package, so "open the card directory" showed an empty folder. The bundled
  cards are now seeded into `~/.dsh/persona-cards/` on first mount as editable
  files. Seeding uses an exclusive create (`wx`), so it can never overwrite a
  card you wrote — including one created in the window between a stat and a
  write.
- **A half-written card could silently replace a good one.** A single file save
  emits several watcher events, and a reload could read the file mid-write and
  parse a truncated card. Reloads are now debounced so they read settled files.

### Added

- **An explicit "No persona" state.** The control previously had no way back to
  sending exactly what you typed; it is now a first-class, persisted choice
  listed alongside the cards, and the state the control starts in.
- `scripts/host-check.mjs` covers the seeding behaviour, including that a user
  edit is never overwritten.
- `scripts/check.mjs` asserts the UI contract that regressed here: the off
  state exists, the rewrite is reachable from a visible menu action, and no
  hidden gesture-only trigger remains.

## [0.1.0] - 2026-10-09

First public release.

### Added

- **Composer persona control** (`conversation.input.left`): pick a character,
  set intensity (light / medium / zealot), and choose **review first** or
  **send directly**. Right-clicking the control runs a rewrite immediately.
- **Review panel** (`conversation.input.dock`): original vs rewrite side by
  side, with Send, Fill only, Restore original and Rewrite again. The original
  draft is never modified without an explicit action.
- **Character-card manager** (`settings.section`): create, edit and delete
  cards from the UI, or drop a `.yml` file into `~/.dsh/persona-cards/` — the
  directory is watched, so a new card appears without a restart.
- **Rewrites follow the session's own model.** The rewrite runs on the exact
  provider/model the session last used, falling back to the harness default
  only before the session's first request. There is no separate model setting.
- **Technical-fact preservation check**: a second call on the same model
  compares the rewrite against the original and reports whether substance was
  lost or invented. Advisory, never blocking, and never reports approval when
  the check itself failed.
- **Two fidelity modes**: `style` changes only the voice; `strategy` may also
  add behavioural constraints that fit the character. Fidelity is a property of
  the card, not a per-message toggle.
- **Template mode**: a card may skip the model entirely and substitute the
  draft into a fixed template.
- Two bundled cards: **万机之神 · 欧姆弥赛亚** (`omnissiah`, style fidelity) and
  **肌肉集团 · 硬邦邦** (`muscle-crew`, strategy fidelity).
- **Zero dependencies.** The plugin ships its own YAML subset reader
  (`lib/yaml.js`) instead of importing a YAML library, because a locally
  `link:`-ed plugin does not get its dependencies installed. The reader refuses
  constructs it cannot read faithfully — flow collections, anchors, aliases,
  tags, merge keys, multi-document streams — naming the offending line, rather
  than silently misreading a card.
- **Zero build step.** `lib/` is plain ESM and the browser half is a plain-JS
  module, so a git checkout installs and runs as-is.
- Two self-check suites: `scripts/check.mjs` (offline unit: parser, cards,
  prompts, client syntax) and `scripts/host-check.mjs` (host integration: the
  real plugin mounted over a real socket with a stubbed model).

### Security

- All HTTP routes are loopback-fenced: the socket must be loopback, the `Host`
  header must name a loopback host (defeating DNS rebinding), and
  proxy-forwarding headers are refused.
- The rewrite call is standalone: it creates no session turn, cannot call
  tools, and never enters the session log. What the session records is the text
  the user actually sent.

[Unreleased]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.6.3...HEAD
[0.6.3]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.5...v0.4.0
[0.3.5]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sugarmaster666/dsh-persona-forge/releases/tag/v0.1.0
