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
      'control.none.desc': '关闭改写，原样发送你写的内容',
      'control.busy': '改写中…',
      'control.menu.title': '选择角色',
      'control.menu.empty': '还没有角色卡。把 .yml 文件放进角色卡目录即可添加。',
      'control.cardCfg': '「{name}」的设置',
      'control.cardCfg.hint': '这些设置跟着这张角色卡走 —— 在别的会话里选它，也是这一套。',
      'control.intensity': '强度',
      'control.intensity.light': '轻',
      'control.intensity.medium': '中',
      'control.intensity.strong': '重',
      'control.intensity.zealot': '狂热',
      'control.sendMode': '发送方式',
      'control.sendMode.review': '先审查',
      'control.sendMode.direct': '直接发出',
      'control.sendMode.hint': '改写结果送到哪里。',
      'control.sendMode.hint.review': '先审查：改写结果先在下方的对比面板显示，你确认后再发送；原草稿不受影响。',
      'control.sendMode.hint.direct': '直接发出：改写完成后立即作为你的消息发出，不再确认。',
      'control.mode': '改写方式',
      'control.mode.card': '跟随卡片',
      'control.mode.cardWith': '跟随卡片（{value}）',
      'control.mode.llm': '模型改写',
      'control.mode.template': '模板套用',
      'control.mode.hint': '怎么把草稿变成这个角色的口吻。',
      'control.mode.desc.card': '跟随卡片：用这张卡在设置页里声明的方式。',
      'control.mode.desc.llm': '模型改写：调用模型把草稿改写成这个角色的口吻。最灵活，需要一次模型调用。',
      'control.mode.desc.template': '模板套用：把草稿填进卡片预设的模板，不调用模型。零延迟零 token，但语气固定。',
      'control.fidelity': '保真度',
      'control.fidelity.card': '跟随卡片',
      'control.fidelity.cardWith': '跟随卡片（{value}）',
      'control.fidelity.style': '只改语气',
      'control.fidelity.strategy': '可加约束',
      'control.fidelity.hint': '改写被允许改变到什么程度。',
      'control.fidelity.hint.card': '跟随卡片：用这张卡在设置页里声明的保真度。',
      'control.fidelity.hint.style': '只改语气：只换说法，你的需求一字不动。',
      'control.fidelity.hint.strategy': '可加约束：改写还能追加符合角色的做事风格（例如「别做冗长规划」）——这会真的改变你的需求，建议配合「先审查」。',
      'panel.title': '角色改写',
      'panel.loading': '正在按「{name}」改写…',
      'panel.rewritten': '改写后',
      'panel.send': '发送',
      'panel.fill': '仅回填',
      'panel.restore': '还原原文',
      'panel.edited': '已手动修改 —— 发送/回填将使用你改过的文本。',
      'panel.sendOriginal': '用原文发送',
      'panel.retry': '重写',
      'panel.close': '关闭',
      'panel.sent': '已直接发出',
      'panel.sent.hint': '消息已发出，无法撤回。下面是实际发出的内容。',
      'panel.meta': '{provider} / {model} · {ms}ms · 强度 {intensity}',
      'panel.template': '模板模式（未调用模型）',
      'panel.slow': '已经 {seconds} 秒了 —— 模型可能较慢。再等一会儿通常会有结果；若一直不动，可关闭面板后重试。',
      'panel.factsDrift': '检测到技术内容变动',
      'panel.factsMissing': '丢失：',
      'panel.factsAdded': '新增：',
      'panel.factsOnly': '本地检查通过：标识符、路径、版本号、数字均未丢失',
      'panel.factsOnly.hint': '检查只比对技术记号，不消耗 token。它看不出「需求被悄悄改弱」，也看不出「用散文追加了约束」——这两类要靠你自己看，或者手动改改写结果。',
      'panel.stale': '草稿在改写期间有改动——结果基于改写前的文本。',
      'error.empty': '输入框是空的，先写下你的需求。',
      'error.phase': '输入框正忙（提交中），请稍后再试。',
      'error.noCard': '请先选择一个角色。',
      'error.unconfigured': '无法确定模型：先在本会话发一条消息，或设置一个默认模型。',
      'error.timeout': '改写超时，请重试；原输入未改动。',
      'error.upstream': '模型服务返回错误，请重试；原输入未改动。',
      'error.internal': '改写失败，请重试；原输入未改动。',
      'error.network': '无法连接宿主服务，请确认 dsh 正在运行。',
      'error.timeout': '改写迟迟没有返回，已放弃等待。原输入未改动，可以直接发送或重试。',
      'settings.title': '角色扮演',
      'settings.desc': '管理角色卡。每张卡定义一种把提示词改写成的角色风格；改写跟随当前会话使用的模型。',
      'settings.dir': '角色卡目录',
      'settings.reveal': '打开目录',
      'settings.new': '新建角色卡',
      'settings.ai': 'AI 代填',
      'settings.ai.tip': '懒得从零写卡？新建角色卡时可以用 AI 代填：你写一句角色设想，剩下的交给它。',
      'settings.ai.model': '使用模型：{provider} / {model}（设置页没有会话上下文，用的是 harness 默认模型；改写本身跟随当前会话的模型）',
      'settings.ai.desc': '你写一句角色设想，AI 按角色卡的字段把表单填好：名字、图标、简介、风格，以及四档强度各自的转换范例。',
      'settings.ai.briefPlaceholder': '例如：AI 扮演一位脾气暴躁但极其可靠的老灯塔守夜人，我是他的学徒；他说话简短、爱用航海比喻',
      'settings.ai.generate': '生成草稿',
      'settings.ai.busy': 'AI 正在撰写角色卡…',
      'settings.ai.hint': '生成结果只填入表单，不会自动保存。保真度固定为「只改语气」，要放宽请手动改。改完再按「保存」。',
      'settings.ai.needBrief': '请先写下你的角色设想。',
      'settings.ai.failed': '生成失败：{message}',
      'settings.origin.builtin': '内置',
      'settings.origin.edited': '已修改',
      'settings.origin.custom': '自定义',
      'settings.edit': '编辑',
      'settings.delete': '删除',
      'settings.deleteConfirm': '确定删除这张角色卡？',
      'settings.deleteEditedConfirm': '这张卡改自内置版本。删除会丢弃你的修改，恢复成内置版本。继续？',
      'settings.reset': '还原为内置',
      'settings.resetConfirm': '用插件内置的版本覆盖这张卡？你对它的本地修改会丢失。',
      'settings.resetHint': '把这张卡恢复成插件内置的版本，丢弃本地修改。',
      'settings.check': '检查是否有改动',
      'settings.check.busy': '检查中…',
      'settings.check.none': '所有角色卡都与内置版本一致。',
      'settings.check.some': '有 {n} 张角色卡与内置版本不一致：',
      'settings.check.desc': '点一次即可查出哪些卡偏离了内置版本。只有不一致的卡才显示「还原为内置」。',
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
      'settings.hint.intensity': '这张卡默认的语气浓度，可在输入框菜单里临时覆盖。轻=只加一点味道；中=明显但不喧宾夺主；重=语气充分，需求依然一眼可见；狂热=通篇仪式化。',
      'settings.field.style': '角色风格描述（给改写模型的指令）',
      'settings.field.template': '模板（不调用模型，{{input}} 原样替换成你写的内容）',
      'settings.field.template.empty': '例如：万机之座在上，恳请您垂听：\n{{input}}\n愿机魂安宁。',
      'settings.hint.template': '「模板套用」用的固定外壳。写不写都能用模型改写；但没有模板时，「模板套用」这个选项会静默退回模型调用。',
      'settings.field.byIntensity': '转换范例 · 只改语气（每档一组，每行一条，格式：原话 => 改写后）',
      'settings.field.byIntensity.empty': '例如：帮我写个快速排序 => 万机之座在上，恳请您…',
      'settings.hint.byIntensity': '范例是最强的风格锚点，四档各写一组：档位越高语气越重，但每条范例里原话的技术事实都必须出现在改写结果中——否则模型会学会「用氛围替换需求」。',
      'settings.field.byIntensityStrategy': '转换范例 · 可加实现细节（同样四档各一组）',
      'settings.hint.byIntensityStrategy': '保真度选「可加约束」时给模型看的范例：除了语气，还要示范**追加实现要求**（比如「写一个我的世界」加上方块系统、合成表、生存模式）。留空则该档退回上面那套纯语气范例。',
      'settings.hint.fidelity': '只改语气：只换说法，需求一字不动。可加约束：改写还能追加**你没写但显然要的**实现要求（例如「写一个我的世界」加上方块系统、合成表、生存模式）——这会真的改变你的需求，建议配合「先审查」。',
      'settings.diagnostics': '加载问题',
      'settings.count': '共 {n} 张角色卡',
    }

    const EN = {
      'control.title': 'Persona rewrite',
      'control.none': 'No persona',
      'control.none.desc': 'Turn rewriting off and send exactly what you typed',
      'control.busy': 'Rewriting…',
      'control.menu.title': 'Choose a character',
      'control.menu.empty': 'No character cards yet. Drop a .yml file into the card directory to add one.',
      'control.cardCfg': 'Settings for {name}',
      'control.cardCfg.hint': 'These settings belong to this character — pick it in another session and you get the same ones.',
      'control.intensity': 'Intensity',
      'control.intensity.light': 'Light',
      'control.intensity.medium': 'Medium',
      'control.intensity.strong': 'Strong',
      'control.intensity.zealot': 'Zealot',
      'control.sendMode': 'Send mode',
      'control.sendMode.review': 'Review first',
      'control.sendMode.direct': 'Send directly',
      'control.sendMode.hint': 'Where the rewrite goes.',
      'control.sendMode.hint.review': 'Review first: the rewrite appears in the comparison panel below; you confirm before it is sent, and your draft is untouched.',
      'control.sendMode.hint.direct': 'Send directly: the rewrite is sent as your message immediately, without confirmation.',
      'control.mode': 'Rewrite mode',
      'control.mode.card': 'Card default',
      'control.mode.cardWith': 'Card default ({value})',
      'control.mode.llm': 'Model rewrite',
      'control.mode.template': 'Template',
      'control.mode.hint': 'How the draft is turned into this character\'s voice.',
      'control.mode.desc.card': 'Card default: use whatever this card declares on the settings page.',
      'control.mode.desc.llm': 'Model rewrite: calls the model to rewrite your draft in this character\'s voice. Most flexible; costs one model call.',
      'control.mode.desc.template': 'Template: fills your draft into the card\'s preset template, with no model call. No latency, no tokens, but the voice is fixed.',
      'control.fidelity': 'Fidelity',
      'control.fidelity.card': 'Card default',
      'control.fidelity.cardWith': 'Card default ({value})',
      'control.fidelity.style': 'Voice only',
      'control.fidelity.strategy': 'Constraints too',
      'control.fidelity.hint': 'How far the rewrite is allowed to go.',
      'control.fidelity.hint.card': 'Card default: use the fidelity this card declares on the settings page.',
      'control.fidelity.hint.style': 'Voice only: wording changes, your request does not.',
      'control.fidelity.hint.strategy': 'Constraints too: the rewrite may also add the character\'s working style (e.g. "no long planning") — that genuinely changes your request, so pair it with Review first.',
      'panel.title': 'Persona rewrite',
      'panel.loading': 'Rewriting as “{name}”…',
      'panel.rewritten': 'Rewritten',
      'panel.send': 'Send',
      'panel.fill': 'Fill only',
      'panel.restore': 'Restore original',
      'panel.edited': 'Edited by hand — Send/Fill will use your text.',
      'panel.sendOriginal': 'Send original',
      'panel.retry': 'Rewrite again',
      'panel.close': 'Close',
      'panel.sent': 'Sent directly',
      'panel.sent.hint': 'The message is already sent and cannot be recalled. This is what was sent.',
      'panel.meta': '{provider} / {model} · {ms}ms · intensity {intensity}',
      'panel.template': 'Template mode (no model call)',
      'panel.slow': '{seconds} s and counting — the model may just be slow. It usually returns; if it never does, close the panel and retry.',
      'panel.factsDrift': 'Technical content changed',
      'panel.factsMissing': 'Lost: ',
      'panel.factsAdded': 'Added: ',
      'panel.factsOnly': 'Local check passed: no identifier, path, version or number was lost',
      'panel.factsOnly.hint': 'The check compares technical tokens only and spends no tokens. It cannot see a requirement quietly weakened, or a constraint added in prose — those are yours to judge, or to fix by editing the rewrite.',
      'panel.stale': 'The draft changed while rewriting — the result is based on the earlier text.',
      'error.empty': 'The input box is empty — write your request first.',
      'error.phase': 'The input box is busy (submitting) — try again shortly.',
      'error.noCard': 'Choose a character first.',
      'error.unconfigured': 'No model resolved: send a message in this session first, or set a default model.',
      'error.timeout': 'The rewrite timed out. Retry; your draft is untouched.',
      'error.upstream': 'The model provider returned an error. Retry; your draft is untouched.',
      'error.internal': 'The rewrite failed. Retry; your draft is untouched.',
      'error.network': 'Cannot reach the host service — check that dsh is running.',
      'error.timeout': 'The rewrite never came back, so waiting was abandoned. Your draft is untouched — send it, or retry.',
      'settings.title': 'Persona',
      'settings.desc': 'Manage character cards. Each card defines one persona a prompt can be rewritten into; the rewrite follows the model the current session uses.',
      'settings.dir': 'Card directory',
      'settings.reveal': 'Open directory',
      'settings.new': 'New character card',
      'settings.ai': 'AI draft',
      'settings.ai.tip': 'Do not want to write a card from scratch? The new-card form has an AI draft: you write one sentence about the character and it does the rest.',
      'settings.ai.model': 'Model: {provider} / {model} (the settings page has no session context, so this is the harness default; the rewrite itself follows the current session\'s model)',
      'settings.ai.desc': 'You write one sentence about the character; the AI fills the form by the character-card fields — name, icon, description, style text, and a conversion example set per intensity level.',
      'settings.ai.briefPlaceholder': 'e.g. the AI plays a grumpy but utterly reliable old lighthouse keeper, and I am his apprentice; he speaks in short sentences and nautical metaphors',
      'settings.ai.generate': 'Generate draft',
      'settings.ai.busy': 'Writing the character card…',
      'settings.ai.hint': 'The result only fills the form — it is never saved automatically. Fidelity is fixed at voice-only; raise it by hand if you want. Edit it, then press Save.',
      'settings.ai.needBrief': 'Write your idea for the character first.',
      'settings.ai.failed': 'Generation failed: {message}',
      'settings.origin.builtin': 'Built-in',
      'settings.origin.edited': 'Edited',
      'settings.origin.custom': 'Custom',
      'settings.edit': 'Edit',
      'settings.delete': 'Delete',
      'settings.deleteConfirm': 'Delete this character card?',
      'settings.deleteEditedConfirm': 'This card is an edit of a bundled one. Deleting it discards your changes and restores the bundled version. Continue?',
      'settings.reset': 'Restore bundled',
      'settings.resetConfirm': 'Replace this card with the bundled version? Your local edits to it will be lost.',
      'settings.resetHint': 'Restore this card to the version the plugin ships, discarding local edits.',
      'settings.check': 'Check for changes',
      'settings.check.busy': 'Checking…',
      'settings.check.none': 'Every character card matches its bundled version.',
      'settings.check.some': '{n} card(s) differ from the bundled version:',
      'settings.check.desc': 'Finds which cards have drifted from the bundled version. Only a drifted card shows a Restore bundled action.',
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
      'settings.hint.intensity': 'This card\'s default voice strength; you can override it per session from the composer menu. Light = a touch of flavour; Medium = clear but not dominant; Strong = full voice, request still obvious; Zealot = ritual throughout.',
      'settings.field.style': 'Character style (instructions for the rewriting model)',
      'settings.field.template': 'Template (no model call; {{input}} is replaced verbatim with your text)',
      'settings.field.template.empty': 'e.g. Great Machine God, hear us:\n{{input}}\nMay the machine-spirits rest.',
      'settings.hint.template': 'The fixed wrapper used by "Template" mode. Model rewrite works without one, but with no template the Template option silently falls back to a model call.',
      'settings.field.byIntensity': 'Conversion examples · voice only (one set per level, one per line, format: original => rewritten)',
      'settings.field.byIntensity.empty': 'e.g. write me a quicksort => Great Machine God, we humbly beg you…',
      'settings.hint.byIntensity': 'Examples are the strongest style anchor, so write one set per level: higher levels carry more voice, but every technical fact in an example\'s input must appear in its output — otherwise the model learns to replace requirements with atmosphere.',
      'settings.field.byIntensityStrategy': 'Conversion examples · may add implementation detail (all four levels again)',
      'settings.hint.byIntensityStrategy': 'Shown to the model when fidelity is "Constraints too": besides the voice, these must demonstrate **added implementation requirements** (for "写一个我的世界": 方块系统、合成表、生存模式). A level left empty falls back to the voice-only set above.',
      'settings.hint.fidelity': 'Voice only: wording changes, the request does not. Constraints too: the rewrite may also add concrete implementation requirements the request implies but does not state — that genuinely changes your request, so pair it with Review first.',
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

    // Styles. Every colour comes from a `--dsw-alias-*` token so the control
    // follows the active light/dark theme. Two rules learned the hard way:
    //  - `--dsw-alias-brand-primary` is an INVERTED token (near-white in the
    //    dark theme). It is an accent, never a fill for text. A filled primary
    //    control uses `--dsw-alias-button-primary-fill` with
    //    `--dsw-alias-label-primary-foreground`, exactly like the host Button.
    //  - `--dsw-menu-surface-fill` is TRANSLUCENT by design (about 58% alpha)
    //    and only reads correctly with the host's `backdrop-filter` behind it.
    //    Using it without the blur lets the conversation show through the menu,
    //    so both are applied together, exactly as the host Menu does. The
    //    opaque `--dsw-alias-bg-overlay` is the fallback.
    //  - `--dsw-elevation-prominent` only resolves on a surface that also sets
    //    `--dsw-elevation-stroke-color`, so the menu sets it the way the host
    //    Menu does.
    const CSS = `
.pf-control{display:flex;align-items:center;min-width:0}
.pf-btn{display:flex;align-items:center;gap:4px;max-width:220px;height:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;outline:none}
.pf-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pf-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.pf-btn:disabled{cursor:default;opacity:.5}
.pf-btn.is-active{color:var(--dsw-alias-label-primary)}
.pf-btn.is-off{color:var(--dsw-alias-label-tertiary)}
.pf-btn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pf-chevron{flex:none;opacity:.7;font-size:10px}
.pf-menu{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:300px;max-width:min(460px,100vw - 24px);max-height:min(70vh,560px);overflow-y:auto;padding:4px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-overlay));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));color:var(--dsw-alias-label-primary);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.pf-menu-title{padding:6px 8px 4px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.pf-menu-sep{height:.5px;margin:3px 2px;background:var(--dsw-alias-border-l2)}
/* The fold for the selected card's settings: a quiet row, not another
 * equal-weight control. */
.pf-more-body{padding:2px 8px 8px;display:grid;gap:6px}
/* The selected card's own settings fold. Indented under the card row it
 * belongs to, so it reads as that character's settings rather than a sibling
 * of every other card in the list. */
.pf-card-cfg{color:var(--dsw-alias-label-secondary);padding-left:16px}
.pf-hint.is-quiet{color:var(--dsw-alias-label-tertiary);opacity:.85}
/* The row label is the tooltip anchor for what that row controls. */
.pf-row-label[title]{cursor:help}
.pf-pref-row{display:flex;align-items:center;gap:6px;cursor:pointer}
.pf-pref-row input{margin:0}
/* The live counter during a rewrite: a muted suffix so the wait reads as
 * progress rather than a freeze. */
.pf-elapsed{margin-left:8px;padding:0 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}

.pf-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);text-align:left;font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.pf-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pf-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.pf-item.is-selected{background:var(--dsw-alias-interactive-bg-hover)}
.pf-item.is-danger{color:var(--dsw-alias-state-error-primary)}
.pf-item-icon{display:inline-flex;flex:none;width:16px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-secondary))}
.pf-item-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.pf-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-item-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.pf-check{flex:none;color:var(--dsw-alias-label-primary)}
.pf-row{display:flex;align-items:center;gap:10px;padding:5px 8px;flex-wrap:wrap}
.pf-row-label{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);min-width:52px;flex:none}
.pf-seg{display:inline-grid;grid-auto-flow:column;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover)}
.pf-seg button{min-width:44px;height:26px;padding:0 12px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer}
.pf-seg button:hover{color:var(--dsw-alias-label-primary)}
.pf-seg button.is-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft)}
.pf-hint{padding:2px 8px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
/* The panel sits in the composer stack, which is flex:none — it never
 * shrinks. So a tall panel does not compress the composer, it pushes the whole
 * stack UP, and at the start of a conversation there is no transcript above to
 * scroll, so the top of the panel goes off-screen and is simply unreachable.
 *
 * The fix is to bound the panel and scroll INSIDE it: it can then be any height
 * without ever pushing itself out of the viewport. The cap leaves room for the
 * composer card (~120px) and the surrounding chrome. */
/* The panel sits in the host's composer stack, which is a flex COLUMN. Two
 * failure modes have to be avoided at once:
 *
 *   1. flex:1 (the default) lets the stack squash the panel to nothing — the
 *      body collapsed to a ~10px strip while the title and buttons kept their
 *      size.
 *   2. flex:none makes the panel refuse to shrink, so when the stack offers
 *      less height than the panel wants, the panel overflows and the host
 *      clips it — the footer, buttons and all, disappears off the bottom.
 *
 * The answer is flex-shrink:1 with min-height:0, so the panel DOES fit the
 * space it is given, plus an internal structure that puts every bit of the
 * shrink on the body: header and footer are flex:none, the body takes the
 * remaining height and scrolls. Any height the host offers is then usable —
 * the buttons are always the last thing to go, and the body is the only thing
 * that ever scrolls.
 *
 * The max-height is generous on purpose: it exists to stop the panel eating
 * the transcript on a tall window, not to cap the content on a short one. */
/* The panel stays IN FLOW, directly above the composer.
 *
 * It briefly floated (position:fixed, anchored to the viewport bottom), which
 * was wrong: a fixed panel is placed against the viewport, not against the
 * composer, so in hero mode — where the composer sits mid-screen — the panel
 * drifted to the bottom of the window and covered the composer instead of
 * following it.
 *
 * In flow it is positioned by construction: the composer stack lays it out
 * right above the composer, wherever the composer happens to be.
 *
 * The earlier in-flow attempts failed for two different reasons, both fixed
 * here: flex:1 let the stack squash the panel to a ~45px text area, and a
 * max-height in plain vh did not know how much of the window the header and
 * composer already take. flex:0 0 auto means the panel gets the height it asks
 * for; the dvh-based cap means it can never ask for more than is left.
 *
 * --pf-panel-reserve is the header + composer + gaps. If a shell renders a
 * taller composer, that one value is the knob. */
.pf-panel{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);overflow:hidden;display:flex;flex-direction:column;flex:0 0 auto;max-height:calc(100dvh - var(--pf-panel-reserve,260px))}
.pf-panel-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none}
.pf-panel-title{font-size:13px;line-height:20px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The body is what scrolls; the header and the footer stay pinned. Bounding the
 * panel was only half the earlier fix: the action row lived INSIDE the scrolling
 * body, so 发送 sat below the fold and a tall rewrite still hid it. The buttons
 * are the decision point — they must not be something the user has to scroll to
 * find. */
/* A flex column, not a grid: the textarea needs to grow into the panel's
 * spare height, and flex:1 does nothing inside a grid track sized by its
 * own content.
 *
 * The body scrolls, and it must be allowed to shrink (min-height:0) for that
 * scroll to happen. The textarea inside it carries its own floor, so when the
 * host hands the panel less height than it asks for, the shortfall shows up as
 * the body scrolling — which is survivable — rather than the text collapsing
 * to a strip while the title and buttons keep their size. */
.pf-panel-body{padding:10px 12px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;min-height:0}
.pf-panel-foot{padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:6px;flex:none;background:var(--dsw-alias-bg-layer-1)}
/* The supporting lines: one horizontal, wrapping row. They used to be three stacked blocks in the body, where they cost the text area its height. */
.pf-foot-meta{display:flex;gap:12px;flex-wrap:wrap;align-items:baseline;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.pf-foot-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The textarea is the content, so it grows with the rewrite instead of
 * starting at a fixed six rows. max-height is the ceiling: past it the
 * textarea scrolls itself.
 *
 * min-height is a floor that YIELDS. flex-shrink stays 1 so it gives way when
 * the host hands the panel less height; the shortfall then lands on the body's
 * scrollbar instead of pushing the footer out of the panel. The original
 * min-height:96px looked like a floor but sat in a grid track, where it was
 * ignored - which is why the text collapsed to a strip while the buttons kept
 * their size. */
.pf-text{margin:0;padding:8px;max-height:min(40vh,320px);overflow:auto;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;font-family:inherit;color:var(--dsw-alias-label-primary)}
.pf-text.is-editable{display:block;width:100%;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);resize:vertical;min-height:72px;flex:1 1 auto}
.pf-text.is-editable:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.pf-text.is-edited{border-color:var(--dsw-alias-state-business-primary)}
.pf-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pf-action{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.pf-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pf-action:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.pf-action:disabled{cursor:not-allowed;opacity:.4}
.pf-action.is-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.pf-action.is-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.pf-note{font-size:11px;line-height:16px;padding:6px 8px;border-radius:var(--dsw-radius-sm)}
.pf-note.is-warn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary)}
.pf-note.is-error{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}
.pf-note.is-ok{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary)}
.pf-note.is-muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pf-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.pf-spin{display:inline-block;animation:pf-rot 1s linear infinite}
@keyframes pf-rot{to{transform:rotate(360deg)}}
.pf-settings{padding:4px 0 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.pf-settings h3{margin:0 0 6px;font-size:15px;line-height:23px;font-weight:600;color:var(--dsw-alias-label-primary)}
.pf-settings p{margin:0 0 14px;color:var(--dsw-alias-label-secondary);line-height:19px}
.pf-settings-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.pf-dir{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.pf-list{display:grid;gap:6px;margin-bottom:16px}
.pf-card{display:flex;align-items:center;gap:10px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}
.pf-card-icon{flex:none;width:22px;text-align:center;font-size:15px}
/* A flex COLUMN, so the name and description are blockified. overflow:hidden
 * and text-overflow do not apply to inline elements, and both are spans — as
 * plain inline children a long description simply spilled out of the card and
 * landed under the buttons. */
.pf-card-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
/* The row's actions keep their size; only the description gives way. */
.pf-card > .pf-action{flex:none}
.pf-card-name{font-size:13px;line-height:20px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
/* Two lines, then clamped: the description carries real information, but it
 * must never push the row's buttons around. */
.pf-card-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);word-break:break-word}
.pf-tag{font-size:10px;line-height:15px;padding:1px 5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.pf-form{display:grid;gap:10px;max-width:720px;padding:12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2)}
/* The AI box inside the new-card form: a quiet inset panel, not a second
 * competing call to action. */
.pf-ai{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.pf-ai-head{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;font-weight:500;text-align:left;cursor:pointer}
.pf-ai-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pf-field{display:grid;gap:4px}
.pf-field label{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.pf-field input,.pf-field select,.pf-field textarea{width:100%;box-sizing:border-box;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;outline:none}
.pf-field textarea{min-height:96px;resize:vertical;line-height:18px}
.pf-field input:focus,.pf-field select:focus,.pf-field textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.pf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pf-small{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
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
    const resetCard = (id) => postJson(`${PREFIX}/cards/reset`, { id })
    const diffCards = () => postJson(`${PREFIX}/cards/diff`, {})
    const revealDir = () => postJson(`${PREFIX}/reveal`, {})
    const draftCard = (payload) => postJson(`${PREFIX}/cards/draft`, payload)

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

    /**
     * Storage keys.
     *
     * EVERYTHING that configures a character is keyed by CARD: intensity, send
     * mode, rewrite mode and fidelity. They describe how one character behaves
     * ("硬邦邦 always goes out 狂热 and un-reviewed"), which is a property of the
     * character rather than of the conversation you happen to be in. Choosing a
     * character and configuring it are the same act, so they live together and
     * follow the card everywhere.
     *
     * Which card is selected stays per SESSION: that is the choice you are
     * making right now, in this conversation.
     */
    const sendModeKey = (card) => `persona-forge:sendMode:${card}`
    const cardKey = (key) => `persona-forge:card:${key}`
    const intensityKey = (card) => `persona-forge:intensity:${card}`
    const modeKey = (card) => `persona-forge:mode:${card}`
    const fidelityKey = (card) => `persona-forge:fidelity:${card}`
    /** Effective mode for a card: the session's pick when the card can honour it, else the card's. */
    function effectiveModeOf(card, override) {
      if (card === null) return 'llm'
      if (override === 'template') return typeof card.template === 'string' && card.template.trim() !== '' ? 'template' : card.mode
      if (override === 'llm') return typeof card.style === 'string' && card.style.trim() !== '' ? 'llm' : card.mode
      return card.mode
    }

    /**
     * Effective fidelity for a card: the session's choice when it made one,
     * otherwise the card's own.
     *
     * Free in both directions. It used to be one-way (narrow a strategy card,
     * never widen a style card), but the card is the user's own file and the
     * settings page has always let them set `fidelity:` directly — refusing it
     * in the menu only made the choice invisible where the work happens. What
     * widening really does is let the rewrite add the character's working
     * style, which genuinely changes the request, so the UI pairs it with
     * review mode instead of forbidding it.
     */
    function effectiveFidelityOf(card, override) {
      if (override === 'style' || override === 'strategy') return override
      if (card === null) return 'style'
      return card.fidelity
    }

    /**
     * The "no persona" selection. It is a real, persisted state rather than the
     * absence of one, so turning the rewrite off is as deliberate as turning it
     * on — and it is what the control starts in.
     */
    const OFF = 'off'

    /**
     * The translate function of the shell's `conversation` namespace, captured
     * when the locale service mounts. It is how the native send button is
     * identified: the button carries `aria-label={t('input.send')}` (or the
     * queue/steer variant), so the label is the one stable handle on it that
     * does not depend on a hashed CSS class name.
     *
     * Null until the locale service mounts; interception is simply inactive
     * while it is null, which is the safe direction to fail.
     */
    let conversationT = null

    /** Send-button labels, or an empty set when they cannot be resolved. */
    function sendLabels() {
      const translate = conversationT
      if (translate === null) return EMPTY_LABELS
      const labels = new Set()
      for (const key of ['input.send', 'input.send.queue', 'input.send.steer']) {
        try {
          const value = translate(key)
          // An unregistered namespace returns the key itself; that is "no
          // answer", not a label.
          if (typeof value === 'string' && value !== '' && value !== key) labels.add(value)
        } catch {
          // A missing dictionary only costs interception.
        }
      }
      return labels
    }

    const EMPTY_LABELS = new Set()

    /**
     * The composer card that owns one of our controls, or null.
     *
     * Prefers the shell's own `data-composer-card` attribute; falls back to
     * walking up to the first ancestor holding the composer's editable, so a
     * renamed attribute costs nothing. Returning null only means "this event is
     * not ours" — the listeners live on `window`, so a miss here no longer
     * disarms interception the way an un-found card used to.
     * @param own - the plugin's own element inside the composer.
     * @returns the composer card element, or null.
     */
    function composerCardOf(own) {
      if (own === null || own === undefined || typeof own.closest !== 'function') return null
      const declared = own.closest('[data-composer-card]')
      if (declared !== null) return declared
      let element = own.parentElement
      while (element !== null && element !== document.body) {
        if (typeof element.querySelector === 'function' && element.querySelector('[data-composer-input]') !== null) return element
        element = element.parentElement
      }
      return null
    }

    /**
     * Decide whether ONE send gesture should become a rewrite, as a pure
     * function over a plain snapshot.
     *
     * This is deliberately not inline in the component. The decision fails
     * SILENTLY in both directions — swallow a gesture that should have been
     * sent and the message vanishes; let one through that should have been
     * rewritten and the persona quietly does nothing — and neither throws, so
     * the only symptom is "it just stopped working". Extracting it is what
     * makes those cases testable offline; the reference implementation for this
     * shell reached the same conclusion for the same reason.
     *
     * @param snapshot - current composer state (see `stateRef.current`).
     * @param previous - this session's last rewrite, or undefined.
     * @returns `{ action, reason }` where action is 'rewrite' | 'send' |
     *   'swallow'. `reason` is for diagnostics and tests.
     */
    function decideSend(snapshot, previous) {
      if (snapshot === null || snapshot === undefined) return { action: 'send', reason: 'no-state' }
      // Persona off: the composer sends exactly what the user typed.
      if (snapshot.cardId === OFF || snapshot.cardId === undefined) return { action: 'send', reason: 'persona-off' }
      // A rewrite for THIS session is already running. Letting the gesture
      // through would send the raw draft while the panel still says
      // "rewriting", so swallow it — but only for THIS session: another
      // session's wedged rewrite must never eat this one's send.
      if (snapshot.busy === true) return { action: 'swallow', reason: 'rewrite-in-flight' }
      // The review panel is open with a settled result. The composer's send
      // arrow is deliberately inert while it is: the panel IS the decision
      // point, and letting the arrow through would either send the raw draft
      // past the review or start a second rewrite of it. The user closes the
      // panel (or picks an action in it) to get the composer back.
      if (snapshot.panelOpen === true) return { action: 'swallow', reason: 'panel-open' }
      const text = snapshot.draft
      if (typeof text !== 'string' || text.trim() === '') return { action: 'send', reason: 'empty-draft' }
      // The shell is mid-submit or mid-stream; its own gesture handling owns it.
      if (snapshot.phase !== undefined && snapshot.phase !== 'plain') return { action: 'send', reason: 'input-busy' }
      // The composer holds the REWRITE: sending it must not rewrite it again.
      //
      // Only `result` is compared, NOT `original`. Restoring the original
      // already deletes this memory (`lastRewrite.delete` in `apply`), so
      // matching `original` here bought nothing and cost the obvious thing:
      // typing the same sentence twice — or sending it once as typed and then
      // deciding to rewrite it after all — was silently sent un-rewritten.
      // That is the reported "it just sends my text now".
      if (previous !== undefined && typeof previous.result === 'string' && previous.result === text) {
        return { action: 'send', reason: 'already-rewritten' }
      }
      return { action: 'rewrite', reason: 'plain-draft' }
    }

    /**
     * The last rewrite per session, so the send gesture can tell two cases
     * apart without guessing:
     *
     *  - the composer holds the REWRITE (`result`)   -> send it as-is
     *  - anything else                               -> rewrite it
     *
     * Editing the draft makes it match neither value, which re-arms the
     * rewrite — the behaviour a user expects after changing their request.
     */
    const lastRewrite = new Map()

    /**
     * The intensity ladder, weakest to strongest. Four rungs rather than three:
     * a jump from "medium" straight to "zealot" left no way to ask for a strong
     * voice that is not yet full ritual.
     */
    const INTENSITY_LEVELS = ['light', 'medium', 'strong', 'zealot']

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
      /** Which model an AI draft would use, as a ready-to-render sentence. */
      draftModelLabel: '',
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
            // Say which model an AI draft runs on. The settings slot is
            // root-scoped and receives no session id, so this is the harness
            // default — stating it beats letting the user assume.
            draftModelLabel: value.draftModel === null || value.draftModel === undefined
              ? ''
              : t('settings.ai.model', { provider: value.draftModel.provider, model: value.draftModel.model }),
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
     * Run one rewrite and settle the panel.
     *
     * One rewrite per SESSION: the panel is a single shared surface, so two
     * concurrent runs for the same composer would fight over it. A run for a
     * DIFFERENT session is allowed to take the panel over — the abandoned run's
     * result is dropped by the `sessionKey` check in its own continuation, and
     * refusing instead would let one wedged session block every other one.
     *
     * A watchdog settles the panel even if the host never answers. The host has
     * its own 120s deadline, but this half must not depend on the other half
     * being alive to stay usable: a panel stuck at `loading` is not just a
     * cosmetic problem, it blocks every later rewrite for that session.
     */
    const CLIENT_REWRITE_WATCHDOG_MS = 135_000

    function runRewrite(options) {
      const inFlight = state.panel
      if (inFlight !== null && inFlight.phase === 'loading' && inFlight.sessionKey === options.sessionKey) return
      notify({
        panel: {
          sessionKey: options.sessionKey,
          phase: 'loading',
          startedAt: Date.now(),
          cardId: options.cardId,
          cardName: options.cardName,
          original: options.original,
          intensity: options.intensity,
          mode: options.mode,
          fidelity: options.fidelity,
          sendMode: options.sendMode,
        },
      })
      // The watchdog: if neither settle path runs (host dead, connection hung,
      // a promise that never resolves), the panel must still leave `loading`.
      const watchdog = window.setTimeout(() => {
        const current = state.panel
        if (current === null || current.sessionKey !== options.sessionKey || current.phase !== 'loading') return
        notify({
          panel: {
            ...current,
            phase: 'error',
            error: { code: 'timeout', message: t('error.timeout') },
          },
        })
      }, CLIENT_REWRITE_WATCHDOG_MS)
      rewriteDraft({
        sessionId: options.sessionId,
        cardId: options.cardId,
        text: options.original,
        intensity: options.intensity,
        mode: options.mode,
        fidelity: options.fidelity,
      }).then(
        (value) => {
          window.clearTimeout(watchdog)
          const current = state.panel
          if (current === null || current.sessionKey !== options.sessionKey || current.phase !== 'loading') return
          // Remember both sides of this rewrite so the send gesture can tell
          // "send the rewrite" from "already reviewed, send the draft" from
          // "not rewritten yet".
          if (typeof value?.text === 'string' && value.text !== '') {
            lastRewrite.set(options.sessionKey, { result: value.text, original: options.original })
          }
          notify({
            panel: {
              ...current,
              phase: 'result',
              result: value,
            },
          })
        },
        (error) => {
          window.clearTimeout(watchdog)
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

      // Which character this session is using. Per session: it is the choice
      // you are making right now, in this conversation.
      const [cardId, setCardId] = useState(() => readLocal(cardKey(sessionKey)) ?? OFF)
      // How the SELECTED card behaves. All four are read from that card's own
      // keys, so configuring "硬邦邦" once applies wherever you pick it — and
      // all four are re-read when the selection changes, so switching cards
      // switches settings rather than carrying the previous card's across.
      const [sendMode, setSendMode] = useState(null)
      const [intensity, setIntensity] = useState(null)
      const [modeOverride, setModeOverride] = useState(null)
      const [fidelityOverride, setFidelityOverride] = useState(null)
      // The selected card's settings start folded: the menu's job is choosing a
      // character, and these are set once and then forgotten.
      const [cardCfgOpen, setCardCfgOpen] = useState(false)

      // Re-read the per-card settings whenever the selection changes. Doing it
      // in an effect (rather than at render) keeps the stored value the single
      // source of truth: a card you configured earlier comes back configured.
      useEffect(() => {
        const stored = readLocal(sendModeKey(cardId))
        setSendMode(stored === 'direct' || stored === 'review' ? stored : null)
        setIntensity(readLocal(intensityKey(cardId)))
        const storedMode = readLocal(modeKey(cardId))
        setModeOverride(storedMode === 'llm' || storedMode === 'template' ? storedMode : null)
        const storedFidelity = readLocal(fidelityKey(cardId))
        setFidelityOverride(storedFidelity === 'style' || storedFidelity === 'strategy' ? storedFidelity : null)
      }, [cardId])

      useEffect(() => {
        if (shared.catalog === null && shared.catalogError === null) {
          void loadCatalog(false).catch(() => {})
        }
      }, [shared.catalog, shared.catalogError])

      const effectiveSendMode = sendMode ?? shared.hostSendMode
      const cards = shared.catalog ?? []
      const isOff = cardId === OFF
      const selected = isOff ? null : cards.find((card) => card.id === cardId) ?? null
      // The panel is ONE shared surface, so its state is global — but what the
      // BUTTON shows must be per session. Reading the global phase here made
      // every open composer render "改写中…" while any single session was
      // rewriting, which reads as "the plugin is stuck" in sessions that are
      // doing nothing at all.
      const panelOwned = shared.panel !== null && shared.panel.sessionKey === sessionKey ? shared.panel : null
      const busy = panelOwned !== null && panelOwned.phase === 'loading'
      const effectiveIntensity = intensity ?? selected?.intensity ?? 'medium'
      const effectiveMode = effectiveModeOf(selected, modeOverride)
      const effectiveFidelity = effectiveFidelityOf(selected, fidelityOverride)

      // The send-gesture listener is attached once per session but must read
      // CURRENT values. A ref carries them across renders without re-attaching
      // the DOM listener on every keystroke.
      //
      // `busyHere` is PER SESSION (from `panelOwned` above). The shared panel
      // admits one rewrite at a time, but another session's rewrite must not
      // swallow this session's send — only a rewrite for THIS session means
      // "sending now would send the raw draft".
      const busyHere = busy
      // A settled panel for this session: its actions are the way forward, so
      // the composer's own send arrow stays inert until it is closed.
      const panelOpen = panelOwned !== null && panelOwned.phase !== 'loading'
      const stateRef = useRef(null)
      stateRef.current = {
        sessionKey,
        cardId,
        busy: busyHere,
        panelOpen,
        draft,
        phase,
      }

      // Both write to the CARD's own key, so the choice belongs to the
      // character rather than to this session.
      const setSend = useCallback((mode) => {
        setSendMode(mode)
        writeLocal(sendModeKey(cardId), mode)
      }, [cardId])

      const pickCard = useCallback((id) => {
        setCardId(id)
        writeLocal(cardKey(sessionKey), id)
        // Stay open: choosing a character and configuring it are one act, and
        // closing here forced a reopen to touch intensity at all.
      }, [sessionKey])

      const setLevel = useCallback((level) => {
        setIntensity(level)
        writeLocal(intensityKey(cardId), level)
      }, [cardId])

      const setMode = useCallback((mode) => {
        setModeOverride(mode)
        writeLocal(modeKey(cardId), mode)
      }, [cardId])

      const setFidelity = useCallback((fidelity) => {
        setFidelityOverride(fidelity)
        writeLocal(fidelityKey(cardId), fidelity)
      }, [cardId])

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
        // Per-session, matching `runRewrite`. Using the global panel state here
        // meant one session's wedged rewrite silently swallowed every later
        // rewrite in every other session — no error, no rewrite, no send.
        if (busyHere) return
        // `off` is a first-class state: the composer simply sends what the user
        // typed, with no rewrite at all.
        if (cardId === OFF || selected === null) {
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
          mode: effectiveMode,
          fidelity: effectiveFidelity,
          sendMode: effectiveSendMode,
        })
      }, [busyHere, cardId, draft, effectiveFidelity, effectiveIntensity, effectiveMode, effectiveSendMode, phase, props.sessionId, selected, sessionKey])

      // Intercept the composer's OWN send action.
      //
      // There is no plugin hook for this: the shipped send button calls the
      // shell's submit method directly, and the UI-plugin guidance warns against
      // reaching into another plugin's DOM. The one stable handle is the button's
      // accessible name, which comes from the `conversation` locale namespace
      // ("Send message" / "Queue message" / "Steer message") — a public,
      // translated string rather than a hashed CSS class.
      //
      // The whole path is FAIL-SAFE, and each guard fails toward "do nothing
      // special, let the native send happen":
      //  - no locale service mounted      -> no labels -> no interception
      //  - no composer card found         -> no listener attached
      //  - persona is off / no card       -> native send
      //  - draft is empty or not "plain"  -> native send
      //  - draft already rewritten        -> native send (so a rewrite is never
      //    rewritten again; editing the draft re-arms it)
      //  - rewrite already in flight      -> swallow the click, because letting
      //    it through would send the UN-rewritten draft
      const startRef = useRef(start)
      useEffect(() => {
        startRef.current = start
      })

      /**
       * Decide whether one send gesture should be turned into a rewrite.
       *
       * Returns true when the caller must swallow the gesture. Every guard
       * falls toward "let the native send happen", so a shell change can only
       * ever disable interception, never send something the user did not write
       * — and never swallow a gesture into nothing.
       * @param event - the DOM event about to perform the send.
       * @returns whether the gesture was consumed by a rewrite.
       */
      const interceptSend = (event) => {
        const snapshot = stateRef.current
        const decision = decideSend(snapshot, snapshot === null ? undefined : lastRewrite.get(snapshot.sessionKey))
        if (decision.action === 'send') return false
        // Swallow FIRST, so a rewrite can never race the shell's own submit.
        event.preventDefault()
        event.stopPropagation()
        // `swallow` means a rewrite for this session is already in flight:
        // consume the gesture and do nothing else. Starting a second rewrite
        // would be refused by `runRewrite` anyway.
        if (decision.action === 'rewrite') startRef.current()
        return true
      }

      useEffect(() => {
        // Listeners go on `window`, not on the composer card.
        //
        // The card is found through the plugin's own button, and a card that is
        // not found meant the whole interception silently did not arm — the
        // plugin looked dead with no error anywhere. A window-level capture
        // listener is armed regardless of where the shell renders the control,
        // and the guards below decide per event whether it is even a send.
        const onClickCapture = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const button = target.closest('button')
          if (button === null) return
          const labels = sendLabels()
          if (labels.size === 0) return
          const name = button.getAttribute('aria-label')
          if (name === null || !labels.has(name)) return
          // Only gestures inside this composer's own card.
          const card = composerCardOf(buttonRef.current)
          if (card === null || !card.contains(button)) return
          if (interceptSend(event)) return
        }

        // Enter is the primary send gesture, and it does NOT go through the
        // button: the editor's keymap calls the shell's submit directly. The
        // listener is therefore on the keydown capture phase, and it only acts
        // when the key event is the plain send chord the shell would accept —
        // Shift+Enter (newline), IME composition, and the modifier chords the
        // shell ignores all fall through untouched.
        const onKeyDownCapture = (event) => {
          if (event.key !== 'Enter') return
          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
          if (event.isComposing || event.keyCode === 229) return
          const target = event.target
          if (!(target instanceof Element)) return
          // Only inside the composer's own text field.
          if (target.closest('[data-composer-input]') === null) return
          if (interceptSend(event)) return
        }

        window.addEventListener('click', onClickCapture, true)
        window.addEventListener('keydown', onKeyDownCapture, true)
        return () => {
          window.removeEventListener('click', onClickCapture, true)
          window.removeEventListener('keydown', onKeyDownCapture, true)
        }
      }, [sessionKey])

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
            className: `pf-btn${selected !== null ? ' is-active' : ' is-off'}${busy ? ' is-busy' : ''}`,
            title: selected !== null ? `${t('control.title')} — ${selected.name}` : t('control.title'),
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => setOpen((value) => !value),
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
              // "No persona" is a real choice, listed like any card so the
              // control can always be turned back off — but LAST: it is an exit
              // action, and putting it above the cards made it the first thing
              // a user reads in a menu whose whole point is picking a character.
              h(
                'button',
                {
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': isOff ? 'true' : 'false',
                  className: `pf-item${isOff ? ' is-selected' : ''}`,
                  onClick: () => pickCard(OFF),
                },
                h('span', { className: 'pf-item-icon', 'aria-hidden': true }, '🚫'),
                h(
                  'span',
                  { className: 'pf-item-body' },
                  h('span', { className: 'pf-item-name' }, t('control.none')),
                  h('span', { className: 'pf-item-desc' }, t('control.none.desc')),
                ),
                isOff ? h('span', { className: 'pf-check', 'aria-hidden': true }, '✓') : null,
              ),

              // The selected character's own settings, folded UNDER its row.
              //
              // Everything that configures how this character rewrites lives
              // here: intensity, send mode, rewrite mode, fidelity. All of it is
              // a fact about the character — "硬邦邦 goes out 狂热 and
              // un-reviewed" — rather than about the menu or the conversation.
              // Shown as one shared block above every card, they read as global
              // switches, and switching character silently carried the previous
              // card's settings over. Folded because picking a character is
              // still the common act.
              isOff
                ? null
                : [
                    h(
                      'button',
                      {
                        key: 'cfg',
                        type: 'button',
                        className: 'pf-item pf-card-cfg',
                        'aria-expanded': cardCfgOpen ? 'true' : 'false',
                        onClick: () => setCardCfgOpen((value) => !value),
                      },
                      h('span', { className: 'pf-item-icon', 'aria-hidden': true }, cardCfgOpen ? '▾' : '▸'),
                      h(
                        'span',
                        { className: 'pf-item-body' },
                        h('span', { className: 'pf-item-name' }, t('control.cardCfg', { name: selected?.name ?? '' })),
                        h(
                          'span',
                          { className: 'pf-item-desc' },
                          [
                            t(`control.intensity.${effectiveIntensity}`),
                            t(`control.sendMode.${effectiveSendMode}`),
                            t(`control.mode.${effectiveMode === 'template' ? 'template' : 'llm'}`),
                            t(`control.fidelity.${effectiveFidelity === 'strategy' ? 'strategy' : 'style'}`),
                          ].join(' · '),
                        ),
                      ),
                    ),
                    cardCfgOpen
                      ? h(
                          'div',
                          { key: 'cfg-body', className: 'pf-more-body' },
                          h(
                            'div',
                            { className: 'pf-row' },
                            h('span', { className: 'pf-row-label' }, t('control.intensity')),
                            h(
                              'span',
                              { className: 'pf-seg' },
                              INTENSITY_LEVELS.map((level) => h(
                                'button',
                                {
                                  key: level,
                                  type: 'button',
                                  'aria-pressed': effectiveIntensity === level ? 'true' : 'false',
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
                            h('span', { className: 'pf-row-label', title: t('control.sendMode.hint') }, t('control.sendMode')),
                            h(
                              'span',
                              { className: 'pf-seg' },
                              ['review', 'direct'].map((mode) => h(
                                'button',
                                {
                                  key: mode,
                                  type: 'button',
                                  className: effectiveSendMode === mode ? 'is-on' : '',
                                  title: t(`control.sendMode.hint.${mode}`),
                                  onClick: () => setSend(mode),
                                },
                                t(`control.sendMode.${mode}`),
                              )),
                            ),
                          ),

                          h(
                            'div',
                            { className: 'pf-row' },
                            h('span', { className: 'pf-row-label', title: t('control.mode.hint') }, t('control.mode')),
                            h(
                              'span',
                              { className: 'pf-seg' },
                              [
                                // "Follow the card" is a black box unless it says
                                // what the card declares: the row showed the same
                                // four words whether the card was llm or template,
                                // so the actual behaviour was invisible.
                                ['', t('control.mode.cardWith', { value: t(`control.mode.${selected?.mode === 'template' ? 'template' : 'llm'}`) })],
                                ['llm', t('control.mode.llm')],
                                ['template', t('control.mode.template')],
                              ].map(([value, label]) => h(
                                'button',
                                {
                                  key: value === '' ? 'card' : value,
                                  type: 'button',
                                  'aria-pressed': (modeOverride ?? '') === value ? 'true' : 'false',
                                  className: (modeOverride ?? '') === value ? 'is-on' : '',
                                  title: t(`control.mode.desc.${value === '' ? 'card' : value}`),
                                  onClick: () => setMode(value === '' ? undefined : value),
                                },
                                label,
                              )),
                            ),
                          ),

                          // Fidelity is offered on EVERY card now, in both
                          // directions. It used to appear only on a strategy card
                          // and only ever narrow, on the theory that widening
                          // grants a per-message toggle the power to add
                          // constraints the author never allowed — but the card
                          // is the user's own file, and the settings page has
                          // always let them set `fidelity:` directly. Hiding the
                          // control here only made the choice invisible where the
                          // work actually happens.
                          h(
                            'div',
                            { className: 'pf-row' },
                            h('span', { className: 'pf-row-label', title: t('control.fidelity.hint') }, t('control.fidelity')),
                            h(
                              'span',
                              { className: 'pf-seg' },
                              [
                                // Same reason as the mode row: "follow the card"
                                // must name the card's own value, or the row tells
                                // you nothing about what will actually run.
                                ['', t('control.fidelity.cardWith', { value: t(`control.fidelity.${selected?.fidelity === 'strategy' ? 'strategy' : 'style'}`) })],
                                ['style', t('control.fidelity.style')],
                                ['strategy', t('control.fidelity.strategy')],
                              ].map(([value, label]) => h(
                                'button',
                                {
                                  key: value === '' ? 'card' : value,
                                  type: 'button',
                                  'aria-pressed': (fidelityOverride ?? '') === value ? 'true' : 'false',
                                  className: (fidelityOverride ?? '') === value ? 'is-on' : '',
                                  title: t(`control.fidelity.hint.${value === '' ? 'card' : value}`),
                                  onClick: () => setFidelity(value === '' ? undefined : value),
                                },
                                label,
                              )),
                            ),
                          ),

                          h('div', { className: 'pf-hint is-quiet' }, t('control.cardCfg.hint')),
                        )
                      : null,
                  ],
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

      // Seconds since the in-flight rewrite started, ticking once a second.
      //
      // Without this the panel shows "改写中" with no sense of progress, so a
      // rewrite waiting on a slow model reads as FROZEN — the user cannot tell
      // "working" from "hung", and reports it as stuck. A live counter answers
      // that for nothing, and makes the host's own timeout (120s) legible
      // instead of arbitrary.
      const [tick, setTick] = useState(0)
      // The editable result column. Declared here, above every early return,
      // because a hook after a conditional return changes the hook order
      // between the loading and result renders and React rejects it.
      //
      // The result is a STARTING POINT, not a verdict: fixing a dropped
      // identifier by hand is faster than another round trip, and the edit is
      // what Send/Fill must carry. Seeded by a key derived from the result, so
      // a re-render never clobbers typing and a NEW result reseeds it.
      const [edited, setEdited] = useState(null)
      useEffect(() => {
        if (panel === null || panel.phase !== 'loading') return
        const started = typeof panel.startedAt === 'number' ? panel.startedAt : Date.now()
        setTick(Math.round((Date.now() - started) / 1000))
        const timer = window.setInterval(() => setTick(Math.round((Date.now() - started) / 1000)), 1000)
        return () => window.clearInterval(timer)
      }, [panel === null, panel?.phase, panel?.startedAt])
      const elapsedSeconds = panel !== null && panel.phase === 'loading' ? Math.max(0, tick) : null
      const submit = typeof inputActions?.submit === 'function' ? inputActions.submit : null
      const owned = panel !== null && panel.sessionKey === sessionKey ? panel : null
      // Guards the direct-send effect against firing twice for one result.
      const autoSentRef = useRef(null)

      // Direct mode: send the rewrite as soon as it settles, without a
      // confirmation step. The panel then CLOSES, because there is nothing left
      // to confirm — the message is already in the conversation.
      //
      // It used to stay open "so the user can see what was sent", which cost
      // more than it bought: a settled panel makes `panelOpen` true, and that
      // swallows the composer's send arrow, so the very next message could not
      // be sent until the panel was dismissed by hand. Review mode keeps its
      // panel open (that IS the decision point); direct mode has already decided.
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
            // A refused submit leaves the text in the composer, so the panel
            // stays up and the user can send it by hand.
            return
          }
          closePanel()
        }, 60)
        return () => window.clearTimeout(timer)
      }, [owned, setDraft, submit])

      if (owned === null) return null

      /** Replace the composer content, then optionally submit it. */
      const apply = (text, thenSubmit) => {
        if (setDraft === null) return
        if (text === panel.original) {
          // Putting the ORIGINAL back is a REWIND, not a reviewed result: the
          // composer is back to an un-rewritten draft, so the next send must be
          // free to rewrite it again. Forget the memory outright.
          lastRewrite.delete(sessionKey)
        } else {
          // Anything else is the text the user has settled on — the model's
          // rewrite, or their own edit of it. Record it as the result, so
          // sending it from the composer does not rewrite it a second time.
          // Without this, an edited result would come back as a fresh rewrite
          // of the user's own edit.
          lastRewrite.set(sessionKey, { result: text, original: panel.original })
        }
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
        const seconds = elapsedSeconds ?? 0
        return h(
          'div',
          { className: 'pf-panel' },
          header(t('panel.title')),
          h(
            'div',
            { className: 'pf-panel-body' },
            h(
              'div',
              { className: 'pf-meta' },
              t('panel.loading', { name: panel.cardName ?? panel.cardId }),
              h('span', { className: 'pf-elapsed', 'aria-live': 'off' }, `${seconds}s`),
            ),
            // Past half the host's own timeout, say so instead of leaving the
            // user to wonder whether anything is still happening.
            seconds >= 45
              ? h('div', { className: 'pf-note is-muted', style: { marginTop: '8px' } }, t('panel.slow', { seconds }))
              : null,
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
              h('button', { type: 'button', className: 'pf-action', onClick: () => apply(panel.original, false) }, t('panel.restore')),
              submit !== null
                ? h('button', { type: 'button', className: 'pf-action', onClick: () => apply(panel.original, true) }, t('panel.sendOriginal'))
                : null,
            ),
          ),
        )
      }

      const result = panel.result ?? {}
      const generated = typeof result.text === 'string' ? result.text : ''
      const editSeed = `${panel.sessionKey}:${generated.length}:${panel.startedAt ?? ''}`
      const text = edited !== null && edited.seed === editSeed ? edited.text : generated
      const setEditedText = (next) => setEdited({ seed: editSeed, text: next })
      const editedAway = text !== generated
      const isTemplate = result.mode === 'template'
      const facts = result.facts ?? { state: 'ok', missing: [], added: [] }
      const stale = typeof draft === 'string' && draft !== panel.original
      const direct = panel.sendMode === 'direct'
      const intensityLabel = t(`control.intensity.${result.intensity ?? panel.intensity ?? 'medium'}`)

      const notes = []
      if (stale && !direct) notes.push(h('div', { key: 'stale', className: 'pf-note is-muted' }, t('panel.stale')))
      // The local verdict is the only verdict: it is always available, it costs
      // nothing, and it names the exact token that went missing.
      if (facts.state === 'drift') {
        const parts = []
        if (facts.missing.length > 0) parts.push(`${t('panel.factsMissing')}${facts.missing.join('、')}`)
        if (facts.added.length > 0) parts.push(`${t('panel.factsAdded')}${facts.added.join('、')}`)
        notes.push(h('div', { key: 'facts', className: 'pf-note is-warn' }, `${t('panel.factsDrift')} — ${parts.join('；')}`))
      } else {
        // The clean verdict is one short line; what the check does NOT cover is
        // a tooltip. It used to be a permanent three-line paragraph, which cost
        // a third of the panel's height on every single rewrite to say the same
        // thing — and the panel's height is exactly what pushed the buttons out
        // of view. The boundary is still stated, just not at the expense of the
        // thing the user came to look at.
        notes.push(
          h(
            'div',
            { key: 'factsonly', className: 'pf-note is-muted', title: t('panel.factsOnly.hint') },
            t('panel.factsOnly'),
          ),
        )
      }
      if (direct) {
        notes.push(
          h(
            'div',
            { key: 'sent', className: 'pf-note is-muted', title: t('panel.sent.hint') },
            t('panel.sent'),
          ),
        )
      }

      return h(
        'div',
        { className: 'pf-panel' },
        header(`${t('panel.title')} · ${panel.cardName ?? panel.cardId}`),
        h(
          'div',
          { className: 'pf-panel-body' },
          // The body holds the rewrite and nothing else. Every extra row here —
          // a "you wrote" column, a standing explanation, a model/elapsed line —
          // comes straight out of the text area's height, and on a short window
          // (a new session, before the transcript exists) that budget is already
          // tight: 359px of viewport leaves ~169px for the whole panel, and the
          // chrome alone used to exceed it. The supporting lines moved to the
          // footer, which is one horizontal row and costs no extra height.
          h('textarea', {
            className: `pf-text is-result is-editable${editedAway ? ' is-edited' : ''}`,
            value: text,
            spellCheck: false,
            rows: 4,
            'aria-label': t('panel.rewritten'),
            onChange: (event) => setEditedText(event.target.value),
          }),
        ),
        // The actions live in a pinned footer, OUTSIDE the scrolling body. Inside
        // it, 发送 sat below the fold whenever the rewrite was long — the panel
        // scrolled, but the button you needed was the thing being scrolled away.
        h(
          'div',
          { className: 'pf-panel-foot' },
          h(
            'div',
            { className: 'pf-actions' },
            submit !== null
              ? h('button', { type: 'button', className: 'pf-action is-primary', onClick: () => apply(text, true) }, t('panel.send'))
              : null,
            // "Fill only" is gone: the result column is editable, so writing the
            // text into the composer without sending is the same act as
            // reviewing it. This button only exists for a shell that exposes no
            // `submit` at all, where it is the sole way to get the text out.
            submit === null
              ? h('button', { type: 'button', className: 'pf-action', onClick: () => apply(text, false) }, t('panel.fill'))
              : null,
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
                  mode: panel.mode,
                  fidelity: panel.fidelity,
                  sendMode: panel.sendMode,
                }),
              },
              t('panel.retry'),
            ),
          ),
          // The supporting lines live here, on the footer's second row: one
          // horizontal line instead of three stacked blocks inside the body.
          h(
            'div',
            { className: 'pf-foot-meta' },
            editedAway ? h('span', { className: 'pf-foot-note' }, t('panel.edited')) : null,
            ...notes,
            h(
              'span',
              { className: 'pf-foot-note' },
              isTemplate
                ? t('panel.template')
                : t('panel.meta', {
                    provider: result.provider ?? '',
                    model: result.model ?? '',
                    ms: result.elapsedMs ?? 0,
                    intensity: intensityLabel,
                  }),
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
      byIntensityText: { light: '', medium: '', strong: '', zealot: '' },
      byIntensityStrategyText: { light: '', medium: '', strong: '', zealot: '' },
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
        // The per-intensity demonstrations are part of the card, so the form
        // carries them. Leaving them out of the form dropped them on the next
        // save: editing a bundled card's name silently discarded all four
        // intensity example sets, and the card fell back to the flat list.
        byIntensityText: Object.fromEntries(
          INTENSITY_LEVELS.map((level) => [
            level,
            (card.examplesByIntensity?.[level] ?? []).map((example) => `${example.from} => ${example.to}`).join('\n'),
          ]),
        ),
        // The second set is a separate field, so it needs its own textareas.
        // Missing from the form it would be silently DELETED on the next save,
        // which is exactly the data loss the first set already suffered once.
        byIntensityStrategyText: Object.fromEntries(
          INTENSITY_LEVELS.map((level) => [
            level,
            (card.examplesByIntensityStrategy?.[level] ?? []).map((example) => `${example.from} => ${example.to}`).join('\n'),
          ]),
        ),
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

    function CardsSettings(props) {
      const shared = useSyncExternalStore(subscribe, getState)
      const [form, setForm] = useState(null)
      const [status, setStatus] = useState(null)
      // `null` = not checked yet. `undefined` = checking. An array = the result.
      // Nothing here runs on its own: the drift check is an explicit action so
      // the list stays clean, and only a drifted card grows a restore button.
      const [drift, setDrift] = useState(null)
      // AI 代填: a rough idea in, a prefilled form out.
      const [brief, setBrief] = useState('')
      const [drafting, setDrafting] = useState(false)
      // The AI box belongs to the NEW-card flow, not to the page: showing it
      // permanently put two unrelated "make a card" actions side by side and
      // left the user guessing which one to press. It opens with 新建角色卡.
      const [aiOpen, setAiOpen] = useState(false)

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
        }
        if (form.icon.trim() !== '') payload.icon = form.icon.trim()
        if (form.description.trim() !== '') payload.description = form.description.trim()
        if (form.mode === 'template') payload.template = form.template
        // The template is carried whatever the mode is.
        //
        // It used to be sent only for a template-mode card, so an llm card that
        // HAD one lost it on the next save — and template mode is offered on
        // every card, which made the switch silently fall back to a model call.
        else if (form.template.trim() !== '') payload.template = form.template
        // A card that still carries the retired flat `examples` keeps them.
        //
        // The form no longer offers that field, and `save` writes the payload as
        // the WHOLE card rather than merging, so simply omitting it would delete
        // the flat list from any legacy file the moment the user renamed it. They
        // are carried through untouched instead: invisible in the form, still
        // there on disk, still the fallback `examplesFor` reaches for when a rung
        // has no set of its own.
        const original = cards.find((card) => card.id === form.id.trim().toLowerCase())
        if (Array.isArray(original?.examples) && original.examples.length > 0) {
          payload.examples = original.examples
        }
        // Only rungs the user actually filled are sent. An empty textarea means
        // "no per-intensity set for this level", which makes `examplesFor` fall
        // back to the flat list — the documented behaviour, not an empty demo.
        const byIntensity = {}
        for (const level of INTENSITY_LEVELS) {
          const parsed = parseExamples(form.byIntensityText?.[level])
          if (parsed.length > 0) byIntensity[level] = parsed
        }
        if (Object.keys(byIntensity).length > 0) payload.examplesByIntensity = byIntensity
        // The second set travels the same way. An empty one is simply absent,
        // and `examplesFor` then falls back to the voice-only set.
        const byIntensityStrategy = {}
        for (const level of INTENSITY_LEVELS) {
          const parsed = parseExamples(form.byIntensityStrategyText?.[level])
          if (parsed.length > 0) byIntensityStrategy[level] = parsed
        }
        if (Object.keys(byIntensityStrategy).length > 0) payload.examplesByIntensityStrategy = byIntensityStrategy
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
        // Deleting an edited card is not the same act as deleting a card the
        // user wrote from scratch: it falls back to the bundled version rather
        // than removing the character entirely, and the wording has to say so.
        const confirmKey = card.origin === 'edited' ? 'settings.deleteEditedConfirm' : 'settings.deleteConfirm'
        if (!window.confirm(t(confirmKey))) return
        deleteCard(card.id).then(
          () => {
            setStatus({ kind: 'ok', text: t('settings.saved') })
            void loadCatalog(true).catch(() => {})
          },
          (error) => setStatus({ kind: 'error', text: error?.message ?? t('error.internal') }),
        )
      }

      const reset = (card) => {
        if (!window.confirm(t('settings.resetConfirm'))) return
        resetCard(card.id).then(
          () => {
            setStatus({ kind: 'ok', text: t('settings.saved') })
            // Re-check so the row's restore action disappears once it matches.
            setDrift(undefined)
            void loadCatalog(true)
              .then(() => diffCards())
              .then((value) => setDrift(Array.isArray(value?.rows) ? value.rows : []))
              .catch(() => {})
          },
          (error) => setStatus({ kind: 'error', text: error?.message ?? t('error.internal') }),
        )
      }

      /**
       * Ask the host to write a card from the user's rough idea, then drop the
       * result into the form.
       *
       * The generated card is NEVER saved here. It only prefills the form, so
       * the user reviews the wording, the examples and the id before anything
       * reaches the card directory — the same standard the rewrite panel is
       * held to. A generation the user dislikes costs one reload.
       */
      const generate = () => {
        const text = brief.trim()
        if (text === '') {
          setStatus({ kind: 'error', text: t('settings.ai.needBrief') })
          return
        }
        setDrafting(true)
        setStatus(null)
        draftCard({ brief: text, sessionId: typeof props?.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined }).then(
          (value) => {
            setDrafting(false)
            setForm(toForm(value?.card ?? {}))
            setStatus({ kind: 'ok', text: t('settings.ai.hint') })
          },
          (error) => {
            setDrafting(false)
            setStatus({ kind: 'error', text: t('settings.ai.failed', { message: error?.message ?? t('error.internal') }) })
          },
        )
      }

      /**
       * Start a new card: open a blank form AND offer the AI box beside it.
       *
       * Both live in the same flow on purpose. A blank form and an AI box
       * presented as two equal toolbar buttons made the user choose between
       * them before knowing they were related; opening them together makes
       * "write it yourself, or describe it and let the AI start you off" one
       * decision instead of two.
       */
      const startNew = () => {
        setForm({ ...BLANK_CARD })
        setBrief('')
        setAiOpen(true)
        setStatus(null)
      }

      /** Close the new-card flow entirely (form and AI box together). */
      const cancelForm = () => {
        setForm(null)
        setAiOpen(false)
        setBrief('')
      }

      /** Ask the host which user cards differ from their bundled counterpart. */
      const check = () => {
        setDrift(undefined)
        diffCards().then(
          (value) => setDrift(Array.isArray(value?.rows) ? value.rows : []),
          (error) => {
            setDrift(null)
            setStatus({ kind: 'error', text: error?.message ?? t('error.internal') })
          },
        )
      }

      // Only a card the host reported as drifted gets a restore action; look up
      // by id so the check result and the rendered list cannot disagree.
      const driftedIds = new Set(Array.isArray(drift) ? drift.map((row) => row.id) : [])

      return h(
        'div',
        { className: 'pf-settings' },
        h('h3', null, t('settings.title')),
        h('p', null, t('settings.desc')),
        h(
          'div',
          { className: 'pf-settings-bar' },
          h('button', { type: 'button', className: 'pf-action', onClick: startNew }, t('settings.new')),
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
          h(
            'button',
            {
              type: 'button',
              className: 'pf-action',
              title: t('settings.check.desc'),
              disabled: drift === undefined,
              onClick: check,
            },
            drift === undefined ? t('settings.check.busy') : t('settings.check'),
          ),
          h('span', { className: 'pf-small' }, t('settings.count', { n: cards.length })),
        ),
        // Discoverability, not a second action. The AI box lives inside the
        // new-card flow; this line is what tells a user it exists, so they do
        // not have to press a button to find out.
        h('div', { className: 'pf-small', style: { margin: '0 0 10px' } }, t('settings.ai.tip')),
        // The check RESULT is real feedback. The instruction line is not
        // rendered: the button's tooltip already explains the action, and
        // repeating it on the page is the same text twice.
        drift === null
          ? null
          : drift === undefined
            ? h('div', { className: 'pf-note is-muted', style: { marginBottom: '10px' } }, t('settings.check.busy'))
            : drift.length === 0
              ? h('div', { className: 'pf-note is-ok', style: { marginBottom: '10px' } }, t('settings.check.none'))
              : h('div', { className: 'pf-note is-warn', style: { marginBottom: '10px' } }, t('settings.check.some', { n: drift.length })),
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
              // The AI box, first thing in the new-card flow: describe it, or
              // fill the fields below by hand. It is collapsible so a user who
              // came to type does not have to scroll past it.
              h(
                'div',
                { className: 'pf-ai' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'pf-ai-head',
                    'aria-expanded': aiOpen ? 'true' : 'false',
                    onClick: () => setAiOpen((value) => !value),
                  },
                  h('span', { 'aria-hidden': true }, aiOpen ? '▾' : '▸'),
                  h('span', null, t('settings.ai')),
                ),
                aiOpen
                  ? h(
                      'div',
                      { style: { display: 'grid', gap: '8px', padding: '8px 10px 10px' } },
                      h('textarea', {
                        value: brief,
                        placeholder: t('settings.ai.briefPlaceholder'),
                        disabled: drafting,
                        onChange: (event) => setBrief(event.target.value),
                        style: { width: '100%', boxSizing: 'border-box', minHeight: '60px', padding: '6px 8px', border: '.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-sm)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px', lineHeight: '18px', outline: 'none', resize: 'vertical' },
                      }),
                      h('div', { className: 'pf-small' }, t('settings.ai.desc')),
                      h(
                        'div',
                        { className: 'pf-actions' },
                        h('button', {
                          type: 'button',
                          className: 'pf-action',
                          disabled: drafting || brief.trim() === '',
                          onClick: generate,
                        }, drafting ? t('settings.ai.busy') : t('settings.ai.generate')),
                        h('span', { className: 'pf-small' }, shared.draftModelLabel),
                      ),
                    )
                  : null,
              ),
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
                    INTENSITY_LEVELS.map((level) => h('option', { key: level, value: level }, t(`control.intensity.${level}`))),
                  ),
                  h('div', { className: 'pf-small' }, t('settings.hint.intensity')),
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
                h('div', { className: 'pf-small' }, t('settings.hint.fidelity')),
              ),
              form.mode === 'llm'
                ? h(
                    'div',
                    { className: 'pf-field' },
                    h('label', null, t('settings.field.style')),
                    h('textarea', { value: form.style, onChange: (event) => set({ style: event.target.value }) }),
                  )
                : null,
              // The template is its own field whatever the mode is: it powers
              // template mode, which is offered on EVERY card, and a card
              // without one silently falls back to a model call.
              h(
                'div',
                { className: 'pf-field' },
                h('label', null, t('settings.field.template')),
                h('textarea', {
                  value: form.template,
                  placeholder: t('settings.field.template.empty'),
                  onChange: (event) => set({ template: event.target.value }),
                }),
                h('div', { className: 'pf-small' }, t('settings.hint.template')),
              ),
              // The two example sets. Both are part of the card, so the form has
              // to show both: an editable card whose content is invisible is a
              // card the user cannot trust an edit to preserve — and the second
              // set would be DELETED on the next save if it were not here.
              form.mode === 'llm'
                ? h(
                    'div',
                    { className: 'pf-field' },
                    h('label', null, t('settings.field.byIntensity')),
                    ...INTENSITY_LEVELS.map((level) => h(
                      'div',
                      { key: level, style: { display: 'grid', gap: '2px', marginBottom: '6px' } },
                      h('div', { className: 'pf-small' }, t(`control.intensity.${level}`)),
                      h('textarea', {
                        value: form.byIntensityText?.[level] ?? '',
                        placeholder: t('settings.field.byIntensity.empty'),
                        onChange: (event) => set({ byIntensityText: { ...(form.byIntensityText ?? {}), [level]: event.target.value } }),
                        style: { minHeight: '60px' },
                      }),
                    )),
                    h('div', { className: 'pf-small' }, t('settings.hint.byIntensity')),
                  )
                : null,
              form.mode === 'llm'
                ? h(
                    'div',
                    { className: 'pf-field' },
                    h('label', null, t('settings.field.byIntensityStrategy')),
                    ...INTENSITY_LEVELS.map((level) => h(
                      'div',
                      { key: level, style: { display: 'grid', gap: '2px', marginBottom: '6px' } },
                      h('div', { className: 'pf-small' }, t(`control.intensity.${level}`)),
                      h('textarea', {
                        value: form.byIntensityStrategyText?.[level] ?? '',
                        placeholder: t('settings.field.byIntensity.empty'),
                        onChange: (event) => set({ byIntensityStrategyText: { ...(form.byIntensityStrategyText ?? {}), [level]: event.target.value } }),
                        style: { minHeight: '60px' },
                      }),
                    )),
                    h('div', { className: 'pf-small' }, t('settings.hint.byIntensityStrategy')),
                  )
                : null,
              h(
                'div',
                { className: 'pf-actions' },
                h('button', { type: 'button', className: 'pf-action is-primary', onClick: commit, disabled: form.id.trim() === '' || form.name.trim() === '' }, t('settings.save')),
                h('button', { type: 'button', className: 'pf-action', onClick: cancelForm }, t('settings.cancel')),
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
                h('span', { className: 'pf-tag' }, t(`settings.origin.${card.origin ?? 'custom'}`)),
                h('span', { className: 'pf-tag' }, card.mode === 'template' ? 'template' : 'llm'),
                h('span', { className: 'pf-tag' }, t(`control.intensity.${card.intensity}`)),
              ),
              h('span', { className: 'pf-card-desc' }, card.description ?? card.id),
            ),
            h('button', { type: 'button', className: 'pf-action', onClick: () => { setForm(toForm(card)); setStatus(null) } }, t('settings.edit')),
            // Only a card the check actually flagged gets a restore action.
            driftedIds.has(card.id)
              ? h('button', {
                  type: 'button',
                  className: 'pf-action',
                  title: t('settings.resetHint'),
                  onClick: () => reset(card),
                }, t('settings.reset'))
              : null,
            // Delete is offered only where it can actually take effect. A card
            // whose content still matches the bundle has no user-owned file:
            // removing it just clears a copied seed that the next start writes
            // back, so the button would report success and change nothing.
            card.origin === 'builtin'
              ? null
              : h('button', { type: 'button', className: 'pf-action', onClick: () => remove(card) }, t('settings.delete')),
          )),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Apply
    // ---------------------------------------------------------------------

    return {
      inject: [],
      /**
       * Test seam.
       *
       * The send-gesture decision and the panel guards cannot be exercised in a
       * browser from this suite, and they fail SILENTLY — a wrong call either
       * swallows a message or quietly disables the persona, and neither throws.
       * Exposing the pure pieces is the only way to lock that behaviour down
       * offline. Nothing in the browser reads this field, so it costs the
       * runtime nothing.
       */
      __internals: {
        decideSend,
        composerCardOf,
        sendLabels,
      },
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
            // Bind the shell's own `conversation` namespace. Its send labels are
            // how the native send button is identified for interception; a
            // failure here only disables interception, never the rewrite.
            try {
              const translate = localeCtx.locale.bind('conversation')
              if (typeof translate === 'function') conversationT = translate
            } catch {
              conversationT = null
            }
            return () => {
              conversationT = null
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
