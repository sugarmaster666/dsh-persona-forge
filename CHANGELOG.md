# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sugarmaster666/dsh-persona-forge/releases/tag/v0.1.0
