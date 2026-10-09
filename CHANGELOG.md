# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sugarmaster666/dsh-persona-forge/releases/tag/v0.1.0
