# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/sugarmaster666/dsh-persona-forge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sugarmaster666/dsh-persona-forge/releases/tag/v0.1.0
