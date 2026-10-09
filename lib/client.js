/**
 * Browser half of dsh-persona-forge.
 *
 * Contributes three surfaces:
 *  - `conversation.input.left`  — the persona control: pick a character, set
 *    the intensity, and choose send-directly vs review-first.
 *  - `conversation.input.dock`  — the review panel: original vs rewrite, the
 *    preservation verdict, and the send / fill / retry / restore actions.
 *  - `settings.section`         — the character-card manager.
 *
 * The host owns the card store and the model call; this half only reads the
 * catalog, asks for a rewrite, and puts the result where the user decides.
 * The user's draft is never modified without an explicit action.
 *
 * Loaded through the shell's lazy-CJS module table, so the factory body is
 * plain CommonJS with `require` resolved against the shell's module table.
 * No harness Client package is imported: everything the shell owns is reached
 * through injected services, and the components are hand-written so a renamed
 * internal never blanks the slot.
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-forge',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React

    // ---------------------------------------------------------------------
    // Copy
    // ---------------------------------------------------------------------

    const NS = 'persona-forge'

    const ZH = {
      'control.title': '角色扮演改写',
      'control.none': '无角色',
      'control.busy': '改写中…',
      'control.menu.title': '选择角色',
      'control.menu.empty': '还没有角色卡。把 .yml 文件放进角色卡目录即可添加。',
      'control.menu.manage': '管理角色卡…',
      'control.menu.reveal': '打开角色卡目录',
      'control.intensity': '强度',
      'control.intensity.light': '轻',
      'control.intensity.medium': '中',
      'control.intensity.zealot': '狂热',
      'control.sendMode': '发送方式',
      'control.sendMode.review': '先审查',
      'control.sendMode.direct': '直接发出',
      'control.sendMode.hint.review': '改写结果先回填到输入框，由你确认后再发送。',
      'control.sendMode.hint.direct': '改写完成后立即作为你的消息发出，不再确认。',
      'panel.title': '角色改写',
      'panel.loading': '正在按「{name}」改写…',
      'panel.original': '你写的',
      'panel.rewritten': '改写后',
      'panel.send': '发送',
      'panel.fill': '仅回填',
      'panel.restore': '还原原文',
      'panel.sendOriginal': '用原文发送',
      'panel.retry': '重写',
      'panel.close': '关闭',
      'panel.sent': '已直接发出',
      'panel.sent.hint': '消息已发出，无法撤回。下面是实际发出的内容。',
      'panel.meta': '{provider} / {model} · {ms}ms · 强度 {intensity}',
      'panel.template': '模板模式（未调用模型）',
      'panel.drift': '技术事实可能被改动',
      'panel.checkUnavailable': '未完成事实校验',
      'panel.checkOk': '技术事实已保留',
      'panel.stale': '草稿在改写期间有改动——结果基于改写前的文本。',
      'error.empty': '输入框是空的，先写下你的需求。',
      'error.phase': '输入框正忙（提交中），请稍后再试。',
      'error.busy': '已有一个改写在进行中。',
      'error.noCard': '请先选择一个角色。',
      'error.unconfigured': '无法确定模型：先在本会话发一条消息，或设置一个默认模型。',
      'error.timeout': '改写超时，请重试；原输入未改动。',
      'error.upstream': '模型服务返回错误，请重试；原输入未改动。',
      'error.internal': '改写失败，请重试；原输入未改动。',
      'error.network': '无法连接宿主服务，请确认 dsh 正在运行。',
      'settings.title': '角色扮演',
      'settings.desc': '管理角色卡。每张卡定义一种把提示词改写成的角色风格；改写跟随当前会话使用的模型。',
      'settings.dir': '角色卡目录',
      'settings.reveal': '打开目录',
      'settings.new': '新建角色卡',
      'settings.builtin': '内置',
      'settings.user': '自定义',
      'settings.edit': '编辑',
      'settings.delete': '删除',
      'settings.deleteConfirm': '确定删除这张角色卡？',
      'settings.save': '保存',
      'settings.cancel': '取消',
      'settings.saved': '已保存',
      'settings.reload': '重新载入',
      'settings.field.id': 'ID（小写字母、数字、连字符）',
      'settings.field.name': '名称',
      'settings.field.icon': '图标（单个 emoji）',
      'settings.field.description': '简介',
      'settings.field.mode': '改写方式',
      'settings.field.mode.llm': '模型改写（推荐）',
      'settings.field.mode.template': '模板套用',
      'settings.field.fidelity': '保真度',
      'settings.field.fidelity.style': '只改语气（不改需求）',
      'settings.field.fidelity.strategy': '允许增加行为约束',
      'settings.field.intensity': '默认强度',
      'settings.field.style': '角色风格描述（给改写模型的指令）',
      'settings.field.template': '模板（用 {{input}} 代表你的原话）',
      'settings.field.examples': '转换范例（每行一条，格式：原话 => 改写后）',
      'settings.hint.examples': '范例是最强的风格锚点。每条范例里原话的技术事实必须出现在改写结果中——否则模型会学会"用氛围替换需求"。',
      'settings.diagnostics': '加载问题',
      'settings.count': '共 {n} 张角色卡',
    }

    const EN = {
      'control.title': 'Persona rewrite',
      'control.none': 'No persona',
      'control.busy': 'Rewriting…',
      'control.menu.title': 'Choose a character',
      'control.menu.empty': 'No character cards yet. Drop a .yml file into the card directory to add one.',
      'control.menu.manage': 'Manage cards…',
      'control.menu.reveal': 'Open card directory',
      'control.intensity': 'Intensity',
      'control.intensity.light': 'Light',
      'control.intensity.medium': 'Medium',
      'control.intensity.zealot': 'Zealot',
      'control.sendMode': 'Send mode',
      'control.sendMode.review': 'Review first',
      'control.sendMode.direct': 'Send directly',
      'control.sendMode.hint.review': 'The rewrite fills the composer; you confirm before it is sent.',
      'control.sendMode.hint.direct': 'The rewrite is sent as your message immediately, without confirmation.',
      'panel.title': 'Persona rewrite',
      'panel.loading': 'Rewriting as “{name}”…',
      'panel.original': 'You wrote',
      'panel.rewritten': 'Rewritten',
      'panel.send': 'Send',
      'panel.fill': 'Fill only',
      'panel.restore': 'Restore original',
      'panel.sendOriginal': 'Send original',
      'panel.retry': 'Rewrite again',
      'panel.close': 'Close',
      'panel.sent': 'Sent directly',
      'panel.sent.hint': 'The message is already sent and cannot be recalled. This is what was sent.',
      'panel.meta': '{provider} / {model} · {ms}ms · intensity {intensity}',
      'panel.template': 'Template mode (no model call)',
      'panel.drift': 'Technical facts may have changed',
      'panel.checkUnavailable': 'Preservation check did not complete',
      'panel.checkOk': 'Technical facts preserved',
      'panel.stale': 'The draft changed while rewriting — the result is based on the earlier text.',
      'error.empty': 'The input box is empty — write your request first.',
      'error.phase': 'The input box is busy (submitting) — try again shortly.',
      'error.busy': 'A rewrite is already running.',
      'error.noCard': 'Choose a character first.',
      'error.unconfigured': 'No model resolved: send a message in this session first, or set a default model.',
      'error.timeout': 'The rewrite timed out. Retry; your draft is untouched.',
      'error.upstream': 'The model provider returned an error. Retry; your draft is untouched.',
      'error.internal': 'The rewrite failed. Retry; your draft is untouched.',
      'error.network': 'Cannot reach the host service — check that dsh is running.',
      'settings.title': 'Persona',
      'settings.desc': 'Manage character cards. Each card defines one persona a prompt can be rewritten into; the rewrite follows the model the current session uses.',
      'settings.dir': 'Card directory',
      'settings.reveal': 'Open directory',
      'settings.new': 'New character card',
      'settings.builtin': 'Built-in',
      'settings.user': 'Custom',
      'settings.edit': 'Edit',
      'settings.delete': 'Delete',
      'settings.deleteConfirm': 'Delete this character card?',
      'settings.save': 'Save',
      'settings.cancel': 'Cancel',
      'settings.saved': 'Saved',
      'settings.reload': 'Reload',
      'settings.field.id': 'ID (lowercase letters, digits, hyphens)',
      'settings.field.name': 'Name',
      'settings.field.icon': 'Icon (one emoji)',
      'settings.field.description': 'Description',
      'settings.field.mode': 'Rewrite mode',
      'settings.field.mode.llm': 'Model rewrite (recommended)',
      'settings.field.mode.template': 'Template',
      'settings.field.fidelity': 'Fidelity',
      'settings.field.fidelity.style': 'Voice only (never changes the request)',
      'settings.field.fidelity.strategy': 'May add behavioural constraints',
      'settings.field.intensity': 'Default intensity',
      'settings.field.style': 'Character style (instructions for the rewriting model)',
      'settings.field.template': 'Template (use {{input}} for the user\'s text)',
      'settings.field.examples': 'Conversion examples (one per line, format: original => rewritten)',
      'settings.hint.examples': 'Examples are the strongest style anchor. Every technical fact in an example\'s input must appear in its output — otherwise the model learns to replace requirements with atmosphere.',
      'settings.diagnostics': 'Load problems',
      'settings.count': '{n} character card(s)',
    }

    /**
     * Active dictionary. Starts at Chinese and follows the live locale once
     * the optional locale service mounts; a profile without it keeps this
     * bundled copy rather than rendering raw keys.
     */
    let dict = ZH
    const t = (key, params) => {
      let text = dict[key] ?? ZH[key] ?? key
      if (params !== undefined) {
        for (const [name, value] of Object.entries(params)) {
          text = text.split(`{${name}}`).join(String(value))
        }
      }
      return text
    }

    /** Point the dictionary at one locale id, falling back to Chinese. */
    function useLocale(id) {
      dict = typeof id === 'string' && id.toLowerCase().startsWith('en') ? EN : ZH
      // Re-render every mounted surface so the new copy is visible.
      notify({})
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = `
.pf-control{display:flex;align-items:center;min-width:0}
.pf-btn{display:flex;align-items:center;gap:4px;max-width:220px;height:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;cursor:pointer;outline:none}
.pf-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pf-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.pf-btn:disabled{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-secondary));cursor:default}
.pf-btn.is-active{color:var(--dsw-alias-label-primary)}
.pf-btn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pf-chevron{flex:none;opacity:.7;font-size:10px}
.pf-menu{position:fixed;z-index:1100;width:max-content;min-width:260px;max-width:min(420px,100vw - 24px);max-height:min(60vh,520px);overflow:auto;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.24))}
.pf-menu-title{padding:6px 8px 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pf-menu-sep{height:1px;margin:6px 0;background:var(--dsw-alias-border-l1)}
.pf-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;text-align:left;font-size:13px;cursor:pointer}
.pf-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pf-item.is-selected{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));font-weight:500}
.pf-item-icon{flex:none;width:18px;text-align:center}
.pf-item-body{min-width:0;flex:1}
.pf-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-item-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.pf-check{flex:none;color:var(--dsw-alias-brand-primary)}
.pf-row{display:flex;align-items:center;gap:8px;padding:6px 8px;flex-wrap:wrap}
.pf-row-label{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:52px}
.pf-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);overflow:hidden}
.pf-seg button{padding:3px 9px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.pf-seg button.is-on{background:var(--dsw-alias-brand-primary);color:#fff}
.pf-hint{padding:0 8px 6px;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:16px}
.pf-panel{margin:0 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.pf-panel-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.pf-panel-title{font-size:13px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-panel-body{padding:10px 12px;display:grid;gap:10px}
.pf-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:720px){.pf-cols{grid-template-columns:1fr}}
.pf-col{min-width:0}
.pf-col-title{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.pf-text{margin:0;padding:8px;max-height:200px;overflow:auto;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;font-family:inherit}
.pf-text.is-result{background:var(--dsw-alias-bg-layer-2)}
.pf-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pf-action{height:28px;padding:0 12px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.pf-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pf-action.is-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.pf-action.is-primary:hover{filter:brightness(1.06)}
.pf-note{font-size:11px;line-height:16px;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px)}
.pf-note.is-warn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-state-warn-primary)}
.pf-note.is-error{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary)}
.pf-note.is-ok{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary)}
.pf-note.is-muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pf-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.pf-spin{display:inline-block;animation:pf-rot 1s linear infinite}
@keyframes pf-rot{to{transform:rotate(360deg)}}
.pf-settings{padding:4px 0 24px;color:var(--dsw-alias-label-primary);font-size:13px}
.pf-settings h3{margin:0 0 6px;font-size:15px;font-weight:600}
.pf-settings p{margin:0 0 14px;color:var(--dsw-alias-label-secondary);line-height:19px}
.pf-settings-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.pf-dir{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.pf-list{display:grid;gap:6px;margin-bottom:16px}
.pf-card{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1)}
.pf-card-icon{flex:none;width:22px;text-align:center;font-size:15px}
.pf-card-body{flex:1;min-width:0}
.pf-card-name{font-size:13px;display:flex;align-items:center;gap:6px}
.pf-card-desc{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-tag{font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pf-form{display:grid;gap:10px;max-width:720px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.pf-field{display:grid;gap:4px}
.pf-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.pf-field input,.pf-field select,.pf-field textarea{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;outline:none}
.pf-field textarea{min-height:96px;resize:vertical;line-height:18px}
.pf-field input:focus,.pf-field select:focus,.pf-field textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.pf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pf-small{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:16px}
`

    let stylesInjected = false
    function ensureStyles() {
      if (stylesInjected) return
      stylesInjected = true
      try {
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.textContent = CSS
        document.head.appendChild(tag)
      } catch {
        // A stylesheet failure degrades appearance only.
      }
    }

    // ---------------------------------------------------------------------
    // Host API
    // ---------------------------------------------------------------------

    const PREFIX = '/persona-forge'

    async function postJson(path, body) {
      let response
      try {
        response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
      } catch {
        const error = new Error(t('error.network'))
        error.wire = { code: 'network', message: t('error.network') }
        throw error
      }
      let parsed
      try {
        parsed = await response.json()
      } catch {
        const error = new Error(t('error.internal'))
        error.wire = { code: 'internal', message: t('error.internal') }
        throw error
      }
      if (parsed !== null && typeof parsed === 'object' && parsed.ok === true) return parsed.value
      const wire = parsed !== null && typeof parsed === 'object' && parsed.error !== undefined
        ? parsed.error
        : { code: 'internal', message: t('error.internal') }
      const error = new Error(wire.message ?? t('error.internal'))
      error.wire = wire
      throw error
    }

    const fetchCards = () => postJson(`${PREFIX}/cards`, {})
    const rewriteDraft = (payload) => postJson(`${PREFIX}/rewrite`, payload)
    const saveCard = (card) => postJson(`${PREFIX}/cards/save`, { card })
    const deleteCard = (id) => postJson(`${PREFIX}/cards/delete`, { id })
    const revealDir = () => postJson(`${PREFIX}/reveal`, {})

    // ---------------------------------------------------------------------
    // Shared UI state
    // ---------------------------------------------------------------------

    /** Per-composer key: the host id when present, else a stable per-zone id. */
    let fallbackSeq = 0
    const zoneKeys = new WeakMap()
    function useSessionKey(hostId, share) {
      const fallback = useRef(undefined)
      if (typeof hostId === 'string' && hostId !== '') return hostId
      if (fallback.current === undefined) {
        if (share !== undefined && share !== null && typeof share === 'object') {
          const known = zoneKeys.get(share)
          if (known !== undefined) fallback.current = known
          else {
            const minted = `pf:zone:${++fallbackSeq}`
            zoneKeys.set(share, minted)
            fallback.current = minted
          }
        } else {
          fallback.current = `pf:mount:${++fallbackSeq}`
        }
      }
      return fallback.current
    }

    /** Send mode per session, persisted so the choice survives a reload. */
    const sendModeKey = (key) => `persona-forge:sendMode:${key}`
    const cardKey = (key) => `persona-forge:card:${key}`
    const intensityKey = (key) => `persona-forge:intensity:${key}`

    function readLocal(key) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    }
    function writeLocal(key, value) {
      try {
        if (value === null || value === undefined) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, value)
      } catch {
        // A storage failure only costs persistence of a UI preference.
      }
    }

    /** One module-level store so the control and the panel agree on state. */
    const listeners = new Set()
    let state = {
      version: 0,
      catalog: null,
      catalogError: null,
      diagnostics: [],
      directory: '',
      hostSendMode: 'review',
      factCheck: true,
      panel: null,
    }
    function notify(next) {
      state = { ...state, ...next, version: state.version + 1 }
      for (const listener of listeners) listener()
    }
    const subscribe = (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
    const getState = () => state

    /** Load (or reload) the card catalog. */
    let catalogFlight
    function loadCatalog(force) {
      if (catalogFlight !== undefined) return catalogFlight
      if (state.catalog !== null && force !== true) return Promise.resolve(state.catalog)
      catalogFlight = fetchCards().then(
        (value) => {
          catalogFlight = undefined
          notify({
            catalog: Array.isArray(value.cards) ? value.cards : [],
            diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : [],
            directory: typeof value.directory === 'string' ? value.directory : '',
            hostSendMode: value.sendMode === 'direct' ? 'direct' : 'review',
            factCheck: value.factCheck !== false,
            catalogError: null,
          })
          return state.catalog
        },
        (error) => {
          catalogFlight = undefined
          notify({ catalogError: error?.message ?? t('error.network') })
          throw error
        },
      )
      return catalogFlight
    }

    // ---------------------------------------------------------------------
    // Rewrite controller
    // ---------------------------------------------------------------------

    /**
     * Run one rewrite and settle the panel. Exactly one rewrite runs at a
     * time: the panel is a single surface, so a second concurrent run would
     * have nowhere to render.
     */
    function runRewrite(options) {
      if (state.panel !== null && state.panel.phase === 'loading') return
      notify({
        panel: {
          sessionKey: options.sessionKey,
          phase: 'loading',
          cardId: options.cardId,
          cardName: options.cardName,
          original: options.original,
          intensity: options.intensity,
          sendMode: options.sendMode,
        },
      })
      rewriteDraft({
        sessionId: options.sessionId,
        cardId: options.cardId,
        text: options.original,
        intensity: options.intensity,
      }).then(
        (value) => {
          const current = state.panel
          if (current === null || current.sessionKey !== options.sessionKey || current.phase !== 'loading') return
          notify({
            panel: {
              ...current,
              phase: 'result',
              result: value,
            },
          })
        },
        (error) => {
          const current = state.panel
          if (current === null || current.sessionKey !== options.sessionKey || current.phase !== 'loading') return
          notify({
            panel: {
              ...current,
              phase: 'error',
              error: error?.wire ?? { code: 'internal', message: error?.message ?? t('error.internal') },
            },
          })
        },
      )
    }

    const closePanel = () => notify({ panel: null })

    // ---------------------------------------------------------------------
    // Persona control (conversation.input.left)
    // ---------------------------------------------------------------------

    function PersonaControl(props) {
      const sessionKey = useSessionKey(props.sessionId, props.inputActions)
      const shared = useSyncExternalStore(subscribe, getState)
      const draft = props.useInput !== undefined
        ? props.useInput((value) => (typeof value?.draft === 'string' ? value.draft : ''))
        : ''
      const phase = props.useInput !== undefined ? props.useInput((value) => value?.phase) : undefined

      const [open, setOpen] = useState(false)
      const [menuPos, setMenuPos] = useState(null)
      const buttonRef = useRef(null)
      const menuRef = useRef(null)

      // Local preferences, seeded from storage and the host config.
      const [sendMode, setSendMode] = useState(() => {
        const stored = readLocal(sendModeKey(sessionKey))
        return stored === 'direct' || stored === 'review' ? stored : null
      })
      const [cardId, setCardId] = useState(() => readLocal(cardKey(sessionKey)))
      const [intensity, setIntensity] = useState(() => readLocal(intensityKey(sessionKey)))

      useEffect(() => {
        if (shared.catalog === null && shared.catalogError === null) {
          void loadCatalog(false).catch(() => {})
        }
      }, [shared.catalog, shared.catalogError])

      const effectiveSendMode = sendMode ?? shared.hostSendMode
      const cards = shared.catalog ?? []
      const selected = cards.find((card) => card.id === cardId) ?? null
      const busy = shared.panel !== null && shared.panel.phase === 'loading'
      const effectiveIntensity = intensity ?? selected?.intensity ?? 'medium'

      const setSend = useCallback((mode) => {
        setSendMode(mode)
        writeLocal(sendModeKey(sessionKey), mode)
      }, [sessionKey])

      const pickCard = useCallback((id) => {
        setCardId(id)
        writeLocal(cardKey(sessionKey), id)
        setOpen(false)
      }, [sessionKey])

      const setLevel = useCallback((level) => {
        setIntensity(level)
        writeLocal(intensityKey(sessionKey), level)
      }, [sessionKey])

      // Position the menu above the button, clamped to the viewport.
      useEffect(() => {
        if (!open) return
        const rect = buttonRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        const width = Math.min(400, window.innerWidth - 24)
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
        setMenuPos({ left, bottom: Math.max(12, window.innerHeight - rect.top + 6), width })
      }, [open])

      // Dismiss on outside click or Escape.
      useEffect(() => {
        if (!open) return
        const onDown = (event) => {
          const target = event.target
          if (menuRef.current?.contains(target) === true) return
          if (buttonRef.current?.contains(target) === true) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      /** Guard, then dispatch one rewrite for this composer. */
      const start = useCallback(() => {
        if (busy) return
        if (selected === null) {
          notify({ panel: { sessionKey, phase: 'error', original: draft, error: { code: 'no-card', message: t('error.noCard') } } })
          return
        }
        const text = typeof draft === 'string' ? draft : ''
        if (text.trim() === '') {
          notify({ panel: { sessionKey, phase: 'error', original: text, error: { code: 'rejected', message: t('error.empty') } } })
          return
        }
        if (phase !== undefined && phase !== 'plain') {
          notify({ panel: { sessionKey, phase: 'error', original: text, error: { code: 'rejected', message: t('error.phase') } } })
          return
        }
        runRewrite({
          sessionKey,
          sessionId: typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined,
          cardId: selected.id,
          cardName: selected.name,
          original: text,
          intensity: effectiveIntensity,
          sendMode: effectiveSendMode,
        })
      }, [busy, draft, effectiveIntensity, effectiveSendMode, phase, props.sessionId, selected, sessionKey])

      const label = selected !== null
        ? `${selected.icon !== undefined ? `${selected.icon} ` : ''}${selected.name}`
        : t('control.none')

      return h(
        'div',
        { className: 'pf-control' },
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: `pf-btn${selected !== null ? ' is-active' : ''}${busy ? ' is-busy' : ''}`,
            title: selected !== null ? `${t('control.title')} — ${selected.name}` : t('control.title'),
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => setOpen((value) => !value),
            onContextMenu: (event) => {
              // Right-click runs the rewrite directly: the fast path for a
              // user who already picked a character.
              event.preventDefault()
              start()
            },
          },
          h('span', { 'aria-hidden': true }, busy ? h('span', { className: 'pf-spin' }, '◌') : '🎭'),
          h('span', { className: 'pf-btn-label' }, busy ? t('control.busy') : label),
          h('span', { className: 'pf-chevron', 'aria-hidden': true }, '▾'),
        ),
        open && menuPos !== null
          ? h(
              'div',
              {
                ref: menuRef,
                className: 'pf-menu',
                role: 'menu',
                style: { left: `${menuPos.left}px`, bottom: `${menuPos.bottom}px`, width: `${menuPos.width}px` },
              },
              h('div', { className: 'pf-menu-title' }, t('control.menu.title')),
              cards.length === 0
                ? h('div', { className: 'pf-hint' }, shared.catalogError ?? t('control.menu.empty'))
                : cards.map((card) => h(
                    'button',
                    {
                      key: card.id,
                      type: 'button',
                      role: 'menuitemradio',
                      'aria-checked': card.id === cardId ? 'true' : 'false',
                      className: `pf-item${card.id === cardId ? ' is-selected' : ''}`,
                      onClick: () => pickCard(card.id),
                    },
                    h('span', { className: 'pf-item-icon', 'aria-hidden': true }, card.icon ?? '🎭'),
                    h(
                      'span',
                      { className: 'pf-item-body' },
                      h('span', { className: 'pf-item-name' }, card.name),
                      card.description !== undefined
                        ? h('span', { className: 'pf-item-desc' }, card.description)
                        : null,
                    ),
                    card.id === cardId ? h('span', { className: 'pf-check', 'aria-hidden': true }, '✓') : null,
                  )),
              h('div', { className: 'pf-menu-sep' }),
              h(
                'div',
                { className: 'pf-row' },
                h('span', { className: 'pf-row-label' }, t('control.intensity')),
                h(
                  'span',
                  { className: 'pf-seg' },
                  ['light', 'medium', 'zealot'].map((level) => h(
                    'button',
                    {
                      key: level,
                      type: 'button',
                      className: effectiveIntensity === level ? 'is-on' : '',
                      onClick: () => setLevel(level),
                    },
                    t(`control.intensity.${level}`),
                  )),
                ),
              ),
              h(
                'div',
                { className: 'pf-row' },
                h('span', { className: 'pf-row-label' }, t('control.sendMode')),
                h(
                  'span',
                  { className: 'pf-seg' },
                  ['review', 'direct'].map((mode) => h(
                    'button',
                    {
                      key: mode,
                      type: 'button',
                      className: effectiveSendMode === mode ? 'is-on' : '',
                      onClick: () => setSend(mode),
                    },
                    t(`control.sendMode.${mode}`),
                  )),
                ),
              ),
              h('div', { className: 'pf-hint' }, t(`control.sendMode.hint.${effectiveSendMode}`)),
              h('div', { className: 'pf-menu-sep' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'pf-item',
                  onClick: () => {
                    setOpen(false)
                    void revealDir().catch(() => {})
                  },
                },
                h('span', { className: 'pf-item-icon', 'aria-hidden': true }, '📂'),
                h('span', { className: 'pf-item-body' }, t('control.menu.reveal')),
              ),
            )
          : null,
      )
    }

    // ---------------------------------------------------------------------
    // Review panel (conversation.input.dock)
    // ---------------------------------------------------------------------

    function ReviewPanel(props) {
      const sessionKey = useSessionKey(props.sessionId, props.inputActions)
      const shared = useSyncExternalStore(subscribe, getState)
      const draft = props.useInput !== undefined
        ? props.useInput((value) => (typeof value?.draft === 'string' ? value.draft : ''))
        : ''
      const panel = shared.panel
      const inputActions = props.inputActions
      const setDraft = typeof inputActions?.setDraft === 'function' ? inputActions.setDraft : null
      const submit = typeof inputActions?.submit === 'function' ? inputActions.submit : null
      const owned = panel !== null && panel.sessionKey === sessionKey ? panel : null
      // Guards the direct-send effect against firing twice for one result.
      const autoSentRef = useRef(null)

      // Direct mode: send the rewrite as soon as it settles, without a
      // confirmation step. The panel stays open afterwards so the user can see
      // exactly what was sent (and restore the original if it went wrong).
      useEffect(() => {
        if (owned === null || owned.phase !== 'result' || owned.sendMode !== 'direct') return
        if (setDraft === null || submit === null) return
        const resultText = typeof owned.result?.text === 'string' ? owned.result.text : ''
        if (resultText === '') return
        const token = `${owned.sessionKey}:${owned.cardId}:${resultText.length}:${owned.original.length}`
        if (autoSentRef.current === token) return
        autoSentRef.current = token
        setDraft(resultText)
        const timer = window.setTimeout(() => {
          try {
            submit()
          } catch {
            // A refused submit leaves the text in the composer.
          }
        }, 60)
        return () => window.clearTimeout(timer)
      }, [owned, setDraft, submit])

      if (owned === null) return null

      /** Replace the composer content, then optionally submit it. */
      const apply = (text, thenSubmit) => {
        if (setDraft === null) return
        setDraft(text)
        if (thenSubmit !== true || submit === null) {
          closePanel()
          return
        }
        // The editor commits synchronously, but give the submit machine one
        // turn so it observes the new draft rather than the previous one.
        window.setTimeout(() => {
          try {
            submit()
          } catch {
            // A refused submit leaves the rewritten text in the composer, so
            // the user can send it by hand.
          }
        }, 60)
        closePanel()
      }

      const header = (title, extra) => h(
        'div',
        { className: 'pf-panel-head' },
        h('span', { className: 'pf-panel-title' }, title),
        extra ?? null,
        h(
          'button',
          { type: 'button', className: 'pf-action', onClick: closePanel },
          t('panel.close'),
        ),
      )

      if (panel.phase === 'loading') {
        return h(
          'div',
          { className: 'pf-panel' },
          header(t('panel.title')),
          h(
            'div',
            { className: 'pf-panel-body' },
            h('div', { className: 'pf-meta' }, t('panel.loading', { name: panel.cardName ?? panel.cardId })),
          ),
        )
      }

      if (panel.phase === 'error') {
        const message = panel.error?.message ?? t('error.internal')
        return h(
          'div',
          { className: 'pf-panel' },
          header(t('panel.title')),
          h(
            'div',
            { className: 'pf-panel-body' },
            h('div', { className: 'pf-note is-error' }, message),
            h(
              'div',
              { className: 'pf-actions' },
              h('button', { type: 'button', className: 'pf-action', onClick: () => apply(panel.original, false) }, t('panel.fill')),
              submit !== null
                ? h('button', { type: 'button', className: 'pf-action', onClick: () => apply(panel.original, true) }, t('panel.sendOriginal'))
                : null,
            ),
          ),
        )
      }

      const result = panel.result ?? {}
      const text = typeof result.text === 'string' ? result.text : ''
      const isTemplate = result.mode === 'template'
      const check = result.factCheck ?? { state: 'skipped' }
      const stale = typeof draft === 'string' && draft !== panel.original
      const direct = panel.sendMode === 'direct'
      const intensityLabel = t(`control.intensity.${result.intensity ?? panel.intensity ?? 'medium'}`)

      const notes = []
      if (stale && !direct) notes.push(h('div', { key: 'stale', className: 'pf-note is-muted' }, t('panel.stale')))
      if (check.state === 'drift') {
        notes.push(h('div', { key: 'drift', className: 'pf-note is-warn' }, `${t('panel.drift')}${check.reason !== undefined ? `：${check.reason}` : ''}`))
      } else if (check.state === 'unavailable') {
        notes.push(h('div', { key: 'unavail', className: 'pf-note is-muted' }, `${t('panel.checkUnavailable')}${check.reason !== undefined ? `：${check.reason}` : ''}`))
      } else if (check.state === 'ok') {
        notes.push(h('div', { key: 'ok', className: 'pf-note is-ok' }, t('panel.checkOk')))
      }
      if (direct) notes.push(h('div', { key: 'sent', className: 'pf-note is-muted' }, `${t('panel.sent')} — ${t('panel.sent.hint')}`))

      return h(
        'div',
        { className: 'pf-panel' },
        header(`${t('panel.title')} · ${panel.cardName ?? panel.cardId}`),
        h(
          'div',
          { className: 'pf-panel-body' },
          h(
            'div',
            { className: 'pf-cols' },
            h(
              'div',
              { className: 'pf-col' },
              h('div', { className: 'pf-col-title' }, t('panel.original')),
              h('pre', { className: 'pf-text' }, panel.original),
            ),
            h(
              'div',
              { className: 'pf-col' },
              h('div', { className: 'pf-col-title' }, t('panel.rewritten')),
              h('pre', { className: 'pf-text is-result' }, text),
            ),
          ),
          ...notes,
          h(
            'div',
            { className: 'pf-meta' },
            isTemplate
              ? t('panel.template')
              : t('panel.meta', {
                  provider: result.provider ?? '',
                  model: result.model ?? '',
                  ms: result.elapsedMs ?? 0,
                  intensity: intensityLabel,
                }),
          ),
          h(
            'div',
            { className: 'pf-actions' },
            submit !== null
              ? h('button', { type: 'button', className: 'pf-action is-primary', onClick: () => apply(text, true) }, t('panel.send'))
              : null,
            h('button', { type: 'button', className: 'pf-action', onClick: () => apply(text, false) }, t('panel.fill')),
            h('button', { type: 'button', className: 'pf-action', onClick: () => apply(panel.original, false) }, t('panel.restore')),
            h(
              'button',
              {
                type: 'button',
                className: 'pf-action',
                onClick: () => runRewrite({
                  sessionKey,
                  sessionId: typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined,
                  cardId: panel.cardId,
                  cardName: panel.cardName,
                  original: panel.original,
                  intensity: panel.intensity,
                  sendMode: panel.sendMode,
                }),
              },
              t('panel.retry'),
            ),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Card manager (settings.section)
    // ---------------------------------------------------------------------

    const BLANK_CARD = {
      id: '',
      name: '',
      icon: '',
      description: '',
      mode: 'llm',
      fidelity: 'style',
      intensity: 'medium',
      style: '',
      template: '',
      examplesText: '',
    }

    /** Render a card into the form's flat shape. */
    function toForm(card) {
      return {
        id: card.id ?? '',
        name: card.name ?? '',
        icon: card.icon ?? '',
        description: card.description ?? '',
        mode: card.mode ?? 'llm',
        fidelity: card.fidelity ?? 'style',
        intensity: card.intensity ?? 'medium',
        style: card.style ?? '',
        template: card.template ?? '',
        examplesText: (card.examples ?? []).map((example) => `${example.from} => ${example.to}`).join('\n'),
      }
    }

    /** Parse the examples textarea back into conversion pairs. */
    function parseExamples(text) {
      const out = []
      for (const line of (text ?? '').split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        const index = trimmed.indexOf('=>')
        if (index === -1) continue
        const from = trimmed.slice(0, index).trim()
        const to = trimmed.slice(index + 2).trim()
        if (from === '' || to === '') continue
        out.push({ from, to })
      }
      return out
    }

    function CardsSettings() {
      const shared = useSyncExternalStore(subscribe, getState)
      const [form, setForm] = useState(null)
      const [status, setStatus] = useState(null)

      useEffect(() => {
        void loadCatalog(false).catch(() => {})
      }, [])

      const cards = shared.catalog ?? []
      const set = (patch) => setForm((current) => ({ ...(current ?? BLANK_CARD), ...patch }))

      const commit = () => {
        if (form === null) return
        const payload = {
          id: form.id.trim().toLowerCase(),
          name: form.name.trim(),
          mode: form.mode,
          fidelity: form.fidelity,
          intensity: form.intensity,
          style: form.style,
          examples: parseExamples(form.examplesText),
        }
        if (form.icon.trim() !== '') payload.icon = form.icon.trim()
        if (form.description.trim() !== '') payload.description = form.description.trim()
        if (form.mode === 'template') payload.template = form.template
        saveCard(payload).then(
          () => {
            setStatus({ kind: 'ok', text: t('settings.saved') })
            setForm(null)
            void loadCatalog(true).catch(() => {})
          },
          (error) => setStatus({ kind: 'error', text: error?.message ?? t('error.internal') }),
        )
      }

      const remove = (card) => {
        if (!window.confirm(t('settings.deleteConfirm'))) return
        deleteCard(card.id).then(
          () => {
            setStatus({ kind: 'ok', text: t('settings.saved') })
            void loadCatalog(true).catch(() => {})
          },
          (error) => setStatus({ kind: 'error', text: error?.message ?? t('error.internal') }),
        )
      }

      return h(
        'div',
        { className: 'pf-settings' },
        h('h3', null, t('settings.title')),
        h('p', null, t('settings.desc')),
        h(
          'div',
          { className: 'pf-settings-bar' },
          h('button', { type: 'button', className: 'pf-action', onClick: () => { setForm({ ...BLANK_CARD }) ; setStatus(null) } }, t('settings.new')),
          h(
            'button',
            {
              type: 'button',
              className: 'pf-action',
              onClick: () => revealDir().then(
                (value) => { if (value?.directory !== undefined) notify({ directory: value.directory }) },
                () => {},
              ),
            },
            t('settings.reveal'),
          ),
          h('button', { type: 'button', className: 'pf-action', onClick: () => void loadCatalog(true).catch(() => {}) }, t('settings.reload')),
          h('span', { className: 'pf-small' }, t('settings.count', { n: cards.length })),
        ),
        shared.directory !== ''
          ? h('div', { className: 'pf-dir' }, `${t('settings.dir')}: ${shared.directory}`)
          : null,
        status !== null
          ? h('div', { className: `pf-note ${status.kind === 'ok' ? 'is-ok' : 'is-error'}`, style: { margin: '10px 0' } }, status.text)
          : null,
        shared.catalogError !== null
          ? h('div', { className: 'pf-note is-error', style: { margin: '10px 0' } }, shared.catalogError)
          : null,
        shared.diagnostics.length > 0
          ? h(
              'div',
              { style: { margin: '10px 0' } },
              h('div', { className: 'pf-small', style: { marginBottom: '4px' } }, t('settings.diagnostics')),
              ...shared.diagnostics.map((row, index) => h(
                'div',
                { key: `${row.file}:${index}`, className: 'pf-note is-warn', style: { marginBottom: '4px' } },
                `${row.file}: ${row.error}`,
              )),
            )
          : null,
        form !== null
          ? h(
              'div',
              { className: 'pf-form', style: { margin: '12px 0' } },
              h(
                'div',
                { className: 'pf-grid2' },
                h('div', { className: 'pf-field' }, h('label', null, t('settings.field.id')), h('input', { value: form.id, disabled: cards.some((card) => card.id === form.id && card.source === 'user'), onChange: (event) => set({ id: event.target.value }) })),
                h('div', { className: 'pf-field' }, h('label', null, t('settings.field.name')), h('input', { value: form.name, onChange: (event) => set({ name: event.target.value }) })),
              ),
              h(
                'div',
                { className: 'pf-grid2' },
                h('div', { className: 'pf-field' }, h('label', null, t('settings.field.icon')), h('input', { value: form.icon, maxLength: 8, onChange: (event) => set({ icon: event.target.value }) })),
                h('div', { className: 'pf-field' }, h('label', null, t('settings.field.description')), h('input', { value: form.description, onChange: (event) => set({ description: event.target.value }) })),
              ),
              h(
                'div',
                { className: 'pf-grid2' },
                h(
                  'div',
                  { className: 'pf-field' },
                  h('label', null, t('settings.field.mode')),
                  h(
                    'select',
                    { value: form.mode, onChange: (event) => set({ mode: event.target.value }) },
                    h('option', { value: 'llm' }, t('settings.field.mode.llm')),
                    h('option', { value: 'template' }, t('settings.field.mode.template')),
                  ),
                ),
                h(
                  'div',
                  { className: 'pf-field' },
                  h('label', null, t('settings.field.intensity')),
                  h(
                    'select',
                    { value: form.intensity, onChange: (event) => set({ intensity: event.target.value }) },
                    ['light', 'medium', 'zealot'].map((level) => h('option', { key: level, value: level }, t(`control.intensity.${level}`))),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'pf-field' },
                h('label', null, t('settings.field.fidelity')),
                h(
                  'select',
                  { value: form.fidelity, onChange: (event) => set({ fidelity: event.target.value }) },
                  h('option', { value: 'style' }, t('settings.field.fidelity.style')),
                  h('option', { value: 'strategy' }, t('settings.field.fidelity.strategy')),
                ),
              ),
              form.mode === 'llm'
                ? h(
                    'div',
                    { className: 'pf-field' },
                    h('label', null, t('settings.field.style')),
                    h('textarea', { value: form.style, onChange: (event) => set({ style: event.target.value }) }),
                  )
                : h(
                    'div',
                    { className: 'pf-field' },
                    h('label', null, t('settings.field.template')),
                    h('textarea', { value: form.template, onChange: (event) => set({ template: event.target.value }) }),
                  ),
              form.mode === 'llm'
                ? h(
                    'div',
                    { className: 'pf-field' },
                    h('label', null, t('settings.field.examples')),
                    h('textarea', { value: form.examplesText, onChange: (event) => set({ examplesText: event.target.value }) }),
                    h('div', { className: 'pf-small' }, t('settings.hint.examples')),
                  )
                : null,
              h(
                'div',
                { className: 'pf-actions' },
                h('button', { type: 'button', className: 'pf-action is-primary', onClick: commit, disabled: form.id.trim() === '' || form.name.trim() === '' }, t('settings.save')),
                h('button', { type: 'button', className: 'pf-action', onClick: () => setForm(null) }, t('settings.cancel')),
              ),
            )
          : null,
        h(
          'div',
          { className: 'pf-list' },
          ...cards.map((card) => h(
            'div',
            { key: card.id, className: 'pf-card' },
            h('span', { className: 'pf-card-icon', 'aria-hidden': true }, card.icon ?? '🎭'),
            h(
              'span',
              { className: 'pf-card-body' },
              h(
                'span',
                { className: 'pf-card-name' },
                card.name,
                h('span', { className: 'pf-tag' }, card.builtin === true ? t('settings.builtin') : t('settings.user')),
                h('span', { className: 'pf-tag' }, card.mode === 'template' ? 'template' : 'llm'),
                h('span', { className: 'pf-tag' }, t(`control.intensity.${card.intensity}`)),
              ),
              h('span', { className: 'pf-card-desc' }, card.description ?? card.id),
            ),
            h('button', { type: 'button', className: 'pf-action', onClick: () => { setForm(toForm(card)); setStatus(null) } }, t('settings.edit')),
            h('button', { type: 'button', className: 'pf-action', onClick: () => remove(card) }, t('settings.delete')),
          )),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Apply
    // ---------------------------------------------------------------------

    return {
      inject: [],
      apply(ctx) {
        ensureStyles()

        // Dictionaries are optional: without the locale service the plugin
        // renders its bundled Chinese copy instead of blocking boot.
        ctx.inject(['locale'], (localeCtx) => {
          ctx.effect(() => {
            const disposers = []
            try {
              // The (ns, {locale: dict}) overload: the shell resolves the
              // active locale itself, so no per-locale registration is needed.
              disposers.push(localeCtx.locale.register(NS, { zh: ZH, en: EN }))
            } catch {
              // Registration failure only costs localized copy.
            }
            // Follow the live locale: read it now and on every change.
            const sync = () => {
              try {
                useLocale(localeCtx.locale.getLocale().id)
              } catch {
                useLocale('zh')
              }
            }
            sync()
            try {
              disposers.push(localeCtx.locale.subscribe(sync))
            } catch {
              // No subscription: the initial read still applies.
            }
            return () => {
              for (const dispose of disposers) {
                try {
                  dispose()
                } catch {
                  // Already disposed.
                }
              }
            }
          }, 'persona-forge: dictionaries')
        })

        ctx.inject(['slots'], (slotsCtx) => {
          const slots = slotsCtx.slots
          ctx.effect(() => {
            try {
              return slots.inject('conversation.input.left', () => slots.register(
                { name: 'conversation.input.left', id: 'persona-forge', order: 30 },
                PersonaControl,
              ))
            } catch {
              return () => {}
            }
          }, 'persona-forge: composer control')

          ctx.effect(() => {
            try {
              return slots.inject('conversation.input.dock', () => slots.register(
                { name: 'conversation.input.dock', id: 'persona-forge-panel', order: 20 },
                ReviewPanel,
              ))
            } catch {
              return () => {}
            }
          }, 'persona-forge: review panel')

          ctx.effect(() => {
            try {
              return slots.inject('settings.section', () => slots.register(
                { name: 'settings.section', id: 'persona-forge', order: 47, label: () => t('settings.title') },
                CardsSettings,
              ))
            } catch {
              return () => {}
            }
          }, 'persona-forge: settings page')
        })

        // Warm the catalog so the composer control has names on first open.
        void loadCatalog(false).catch(() => {})
      },
    }
  },
})
