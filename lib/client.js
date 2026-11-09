window.__ModuleLoader__.load({
  id: '@emptyvessel_003/dsh-prompt-shelf',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var ReactDOM = require('react-dom')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var h = React.createElement

    var Switch = primitives.Switch
    var Button = primitives.Button
    var Tag = primitives.Tag
    var Input = primitives.Input
    var Pill = primitives.Pill
    var IconPlus = primitives.IconPlusOutlineRegular
    var IconSearch = primitives.IconSearchOutlineRegular
    var IconPin = primitives.IconPinOutlineRegular
    var IconPinFill = primitives.IconPinFillRegular
    var IconShelf = primitives.IconListPenOutlineRegular

    var TAB_ID = 'prompt-shelf'
    var CHANNEL = '/dsh-prompt-shelf'
    var COMPOSER = '[data-composer-input]'
    var slotsRef = null
    var connection = null
    var loaded = false
    var storageError = ''
    var writeQueue = Promise.resolve()
    var book = { cards: [] }
    var sessionBook = {}
    var selections = Object.create(null)

    async function storageCall(endpoint, payload) {
      var result = await connection.rpc.call(CHANNEL, endpoint, payload)
      if (result.ok !== true) throw new Error(result.error.message)
      return result.value
    }

    // 唯一的状态出口：通知界面，然后把整份状态排进写队列。
    function writeState() {
      emit()
      if (!loaded) return
      var snapshot = JSON.parse(JSON.stringify({ cards: book.cards, sessions: sessionBook }))
      writeQueue = writeQueue.catch(function () {}).then(async function () {
        await storageCall('save', snapshot)
        if (storageError !== '') {
          storageError = ''
          emit()
        }
      })
      writeQueue.catch(function (error) {
        storageError = '写入 ~/.dsh/dsh-prompt-shelf/data.json 失败：' + error.message
        console.error('[prompt-shelf]', storageError)
        emit()
      })
    }

    // 目录里已经消失的会话，连着它的每轮注入清单一起删掉。
    function pruneSessions(list) {
      if (list.phase !== 'ready') return
      var alive = list.ids.concat(Object.keys(list.byId))
      var keys = Object.keys(sessionBook)
      var changed = false
      for (var i = 0; i < keys.length; i += 1) {
        if (alive.indexOf(keys[i]) >= 0) continue
        delete sessionBook[keys[i]]
        delete selections[keys[i]]
        changed = true
      }
      if (changed) writeState()
    }

    function loadStorage(source) {
      connection = source
      return storageCall('load', {}).then(function (stored) {
        if (stored === null) stored = { cards: [], sessions: {} }
        book = { cards: stored.cards }
        sessionBook = stored.sessions
        loaded = true
        storageError = ''
        emit()
      }).catch(function (error) {
        storageError = '无法读取 ~/.dsh/dsh-prompt-shelf/data.json：' + error.message
        console.error('[prompt-shelf]', storageError)
        emit()
      })
    }

    var listeners = []

    function emit() {
      var copy = listeners.slice()
      for (var i = 0; i < copy.length; i += 1) {
        try { copy[i]() } catch (error) { console.error('[prompt-shelf]', error) }
      }
    }

    function subscribe(listener) {
      listeners.push(listener)
      return function () {
        var at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    }

    function everyOf(sid) {
      var list = sessionBook[sid]
      return Array.isArray(list) ? list : []
    }

    function selectionOf(sid) {
      if (!Object.prototype.hasOwnProperty.call(selections, sid)) selections[sid] = everyOf(sid).slice()
      return selections[sid]
    }

    // 可见选区只在内存里；发送成功后重置为该会话的每轮注入清单。
    function attachedFor(sid) {
      var selected = selectionOf(sid)
      return book.cards.filter(function (card) { return selected.indexOf(card.id) >= 0 })
    }

    function suffixOf(list) {
      var parts = []
      for (var i = 0; i < list.length; i += 1) {
        var body = list[i].content.trim()
        if (body !== '') parts.push(body)
      }
      return parts.join('\n\n')
    }

    function cardById(id) {
      for (var i = 0; i < book.cards.length; i += 1) if (book.cards[i].id === id) return book.cards[i]
      return undefined
    }

    function toggleInclude(sid, id) {
      var selected = selectionOf(sid)
      var at = selected.indexOf(id)
      if (at >= 0) selected.splice(at, 1)
      else selected.push(id)
      emit()
    }

    function toggleEvery(sid, id, next) {
      var list = sessionBook[sid]
      if (list === undefined) {
        list = []
        sessionBook[sid] = list
      }
      var at = list.indexOf(id)
      if (next && at < 0) list.push(id)
      if (!next && at >= 0) list.splice(at, 1)
      if (list.length === 0) delete sessionBook[sid]
      var selected = selectionOf(sid)
      var selectedAt = selected.indexOf(id)
      if (next && selectedAt < 0) selected.push(id)
      if (!next && selectedAt >= 0) selected.splice(selectedAt, 1)
      writeState()
    }

    function refreshSelection(sid) {
      selections[sid] = everyOf(sid).slice()
      emit()
    }

    function createCard(fields) {
      var card = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: fields.title.trim().slice(0, 80) || '未命名指令',
        tags: normalizeTags(fields.tags),
        content: fields.content,
        pinned: false
      }
      book.cards.push(card)
      writeState()
      return card
    }

    function updateCard(id, fields) {
      var card = cardById(id)
      if (card === undefined) return
      card.title = fields.title.trim().slice(0, 80) || '未命名指令'
      card.tags = normalizeTags(fields.tags)
      card.content = fields.content
      writeState()
    }

    // 置顶只改标记，卡片的相对位置不动；显示时置顶组整体排在前面。
    function setPinned(id, pinned) {
      var card = cardById(id)
      if (card === undefined) return
      card.pinned = pinned
      writeState()
    }

    var END = '__end__'

    // 置顶与不置顶是两个分区，只在同一区内部换位；拖到别区的卡上不生效。
    function moveCard(dragId, overId, before) {
      if (dragId === overId) return
      var from = -1
      for (var i = 0; i < book.cards.length; i += 1) if (book.cards[i].id === dragId) { from = i; break }
      if (from < 0) return
      var card = book.cards[from]
      if (overId !== END) {
        var target = cardById(overId)
        if (target === undefined || (target.pinned === true) !== (card.pinned === true)) return
      }
      book.cards.splice(from, 1)
      if (overId === END) {
        // 列表末尾：不置顶卡落到最后，置顶卡落到置顶组末尾。
        if (card.pinned !== true) book.cards.push(card)
        else {
          var lastPinned = -1
          for (var k = 0; k < book.cards.length; k += 1) if (book.cards[k].pinned === true) lastPinned = k
          book.cards.splice(lastPinned + 1, 0, card)
        }
        writeState()
        return
      }
      var to = -1
      for (var j = 0; j < book.cards.length; j += 1) if (book.cards[j].id === overId) { to = j; break }
      if (to < 0) { book.cards.splice(from, 0, card); return }
      book.cards.splice(before ? to : to + 1, 0, card)
      writeState()
    }

    function removeCard(id) {
      for (var i = 0; i < book.cards.length; i += 1) {
        if (book.cards[i].id !== id) continue
        book.cards.splice(i, 1)
        break
      }
      for (var key in selections) {
        var selected = selections[key]
        var selectedAt = selected.indexOf(id)
        if (selectedAt >= 0) selected.splice(selectedAt, 1)
      }
      var sessionIds = Object.keys(sessionBook)
      for (var s = 0; s < sessionIds.length; s += 1) {
        var list = sessionBook[sessionIds[s]]
        var everyAt = list.indexOf(id)
        if (everyAt >= 0) list.splice(everyAt, 1)
      }
      writeState()
    }

    function normalizeTags(value) {
      var out = []
      for (var i = 0; i < value.length; i += 1) {
        var tag = value[i].trim().slice(0, 24)
        if (tag !== '' && out.indexOf(tag) < 0) out.push(tag)
      }
      return out
    }

    function allTags() {
      var out = []
      for (var i = 0; i < book.cards.length; i += 1) {
        var tags = book.cards[i].tags
        for (var j = 0; j < tags.length; j += 1) if (out.indexOf(tags[j]) < 0) out.push(tags[j])
      }
      return out
    }

    function useStore() {
      var state = React.useState(0)
      var bump = state[1]
      React.useEffect(function () {
        return subscribe(function () { bump(function (n) { return n + 1 }) })
      }, [])
    }

    // ---- 发送时把附带指令并进消息 ----
    // 发送入口在会话内挂载：键盘与发送按钮的事件只在当前会话存在期间监听。
    var SEND_LABELS = ['发送消息', '排队发送', '插话发送', 'Send message', 'Queue message', 'Steer message']

    // ---- 样式 ----
    var STYLE_ID = 'dsh-prompt-shelf-style'
    var CSS = [
      '.ps-root{display:flex;flex-direction:column;height:100%;min-height:0;gap:12px;padding:12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);}',
      '.ps-root,.ps-root *,.ps-root *::before,.ps-root *::after{box-sizing:border-box;}',
      '.ps-toolbar{display:flex;align-items:center;gap:8px;flex:none;min-width:0;}',
      '.ps-toolbar>span{flex:1;min-width:0;}',
      '.ps-toolbar .ps-new{flex:none;height:32px;border-radius:var(--dsw-radius-md);}',
      '.ps-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:none;max-height:88px;overflow-y:auto;}',
      '.ps-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px;}',
      '.ps-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;cursor:pointer;background:transparent;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;}',
      '.ps-card:hover{border-color:var(--dsw-alias-border-l4);}',
      '.ps-card--on{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);}',
      '.ps-card--on:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.ps-card--pulse{animation:ps-pop .2s ease;}',
      '.ps-card--drag{opacity:.45;border-style:dashed;cursor:grabbing;}',
      '.ps-drop{flex:none;height:3px;margin:3px 2px;border-radius:2px;background:var(--dsw-alias-brand-primary);}',
      '.ps-tail{flex:none;height:32px;}',
      '@keyframes ps-pop{0%{transform:scale(1)}45%{transform:scale(.991)}100%{transform:scale(1)}}',
      '.ps-head{display:flex;align-items:center;gap:12px;min-width:0;}',
      '.ps-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.ps-title{font-size:13px;line-height:20px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ps-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ps-tagrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}',
      '.ps-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-right:-10px;}',
      '.ps-every{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;}',
      '.ps-ops{display:flex;align-items:center;gap:2px;}',
      '.ps-empty{margin:auto 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;text-align:center;padding:24px 8px;}',
      '.ps-form{border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2);cursor:default;}',
      '.ps-field{display:flex;flex-direction:column;gap:6px;min-width:0;}',
      '.ps-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
      '.ps-textarea{width:100%;min-width:0;resize:vertical;min-height:100px;padding:8px 10px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font-family:inherit;font-size:13px;line-height:20px;outline:none;}',
      '.ps-textarea:focus{border-color:var(--dsw-alias-state-business-primary);}',
      '.ps-textarea::placeholder{color:var(--dsw-alias-label-dimmed);}',
      '.ps-form-foot{display:flex;justify-content:flex-end;gap:8px;}',
      '.ps-suggest{display:flex;flex-wrap:wrap;gap:6px;}',
      '.ps-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;line-height:18px;}',
      '.ps-bar-label{display:inline-flex;align-items:center;gap:4px;height:24px;color:var(--dsw-alias-label-tertiary);}',
      '.ps-chip{display:inline-flex;align-items:center;gap:2px;max-width:200px;flex:none;height:24px;padding:0 2px 0 10px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;}',
      '.ps-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}',
      '.ps-chip>button{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;background:transparent;color:inherit;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;padding:0;opacity:.6;font-family:inherit;}',
      '.ps-chip>button:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover);}',
      '.ps-chip--more{padding:0 10px;border-color:var(--dsw-alias-border-l4);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:default;}',
      '.ps-umsg{display:block;min-width:0;}',
      '.ps-umsg-slot{display:contents;}',
      // 与宿主图标按钮逐条对齐（dsh-client-ui-chat 的 .xzv4MW_action），自己 draw 的框来自缺少这些重置。
      '.ps-umsg-act{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex;appearance:none;-webkit-appearance:none;font:inherit;line-height:1;}',
      '.ps-umsg-act svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));}',
      '.ps-umsg-act:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}',
      '.ps-umsg-act:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.ps-umsg-fallback{padding:8px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);white-space:pre-wrap;}'
    ].join('')

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return
      var el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
    }

    // 输入状态只在发送那一刻被读取，放进不渲染的子组件里订阅，
    // 附带条本身只为选区和存储变化重渲染。
    function InputTap(props) {
      props.live.current.input = props.useInput(function (state) { return state })
      return null
    }

    // ---- 输入框下方的本次附带行 ----
    function AttachBar(props) {
      useStore()
      var sid = props.sessionId
      var pendingIds = props.useSession(function (state) { return state.pendingSubmissions.map(function (item) { return item.requestId }).join('\n') })
      var promptError = props.useSession(function (state) { return state.promptError })
      var chatIds = props.useChat(function (snapshot) {
        var ids = []
        for (var i = 0; i < snapshot.order.length; i += 1) {
          var node = snapshot.nodes.get(snapshot.order[i])
          if (node === undefined) continue
          if (node.kind !== 'user' && node.kind !== 'steering') continue
          var source = node.data.source
          if (source.kind === 'user' && typeof source.rpcId === 'string') ids.push(source.rpcId)
        }
        return ids.join('\n')
      })
      var inboxIds = props.useProjection('inbox', function (inbox) {
        if (inbox === undefined) return ''
        var ids = []
        var lists = [inbox['next-turn'] || [], inbox['next-step'] || []]
        for (var i = 0; i < lists.length; i += 1) {
          for (var j = 0; j < lists[i].length; j += 1) {
            var source = lists[i][j].source
            if (source.kind === 'user' && typeof source.rpcId === 'string') ids.push(source.rpcId)
          }
        }
        return ids.join('\n')
      })
      var awaitingState = React.useState(null)
      var awaiting = awaitingState[0]
      var setAwaiting = awaitingState[1]
      var live = React.useRef(null)
      if (live.current === null) live.current = { sid: sid, inserted: false }
      live.current.sid = sid
      live.current.actions = props.inputActions || null
      live.current.pendingIds = pendingIds
      live.current.chatIds = chatIds
      live.current.inboxIds = inboxIds
      live.current.promptError = promptError

      React.useEffect(function () {
        if (awaiting === null) return
        if (awaiting.sid !== sid) { setAwaiting(null); return }
        var accepted = '\n' + chatIds + '\n' + inboxIds + '\n'
        var candidate = awaiting.requestId
        if (candidate === '') {
          var pendingParts = pendingIds.split('\n')
          for (var j = 0; j < pendingParts.length; j += 1) {
            var pendingId = pendingParts[j]
            if (pendingId !== '' && awaiting.baselinePending.indexOf('\n' + pendingId + '\n') < 0) { candidate = pendingId; break }
          }
          if (candidate === '') {
            var acceptedParts = accepted.split('\n')
            for (var n = 0; n < acceptedParts.length; n += 1) {
              var acceptedId = acceptedParts[n]
              if (acceptedId !== '' && awaiting.baselineAccepted.indexOf('\n' + acceptedId + '\n') < 0) { candidate = acceptedId; break }
            }
          }
          if (candidate !== '') {
            if (accepted.indexOf('\n' + candidate + '\n') >= 0) {
              refreshSelection(awaiting.sid)
              setAwaiting(null)
            } else setAwaiting({ ...awaiting, requestId: candidate })
          }
          return
        }
        if (accepted.indexOf('\n' + candidate + '\n') >= 0) {
          refreshSelection(awaiting.sid)
          setAwaiting(null)
          return
        }
        if (pendingIds.split('\n').indexOf(candidate) < 0) { setAwaiting(null); return }
        if (promptError !== null && promptError !== awaiting.promptError) setAwaiting(null)
      }, [awaiting, sid, pendingIds, chatIds, inboxIds, promptError])

      React.useEffect(function () {
        function inComposer(node) {
          return node instanceof Element && node.closest(COMPOSER) !== null
        }
        function overlayOpen() {
          return document.querySelector('[data-trigger-menu], [data-conversation-composer-overlay]') !== null
        }
        function isSendButton(node) {
          if (!(node instanceof Element)) return false
          var button = node.closest('button')
          return button !== null && button.closest('[data-composer-card]') !== null && SEND_LABELS.indexOf(button.getAttribute('aria-label') || '') >= 0
        }
        function appendIncoming() {
          var current = live.current
          if (!loaded || current.actions === null || current.inserted) return
          var draft = current.input.draft
          var attachmentIds = current.input.attachmentIds || []
          if (draft.trim() === '' && attachmentIds.length === 0) return
          // 只挡住同一次发送的重复事件；下一条消息不等接纳结果。
          current.inserted = true
          window.setTimeout(function () { current.inserted = false }, 0)
          var suffix = suffixOf(attachedFor(current.sid))
          if (suffix !== '' && !draft.endsWith(suffix)) {
            var span = current.actions.captureInsertion()
            if (span.draftRev !== current.input.draftRev) return
            var end = draft.length
            for (var i = 0; i < current.input.occurrences.length; i += 1) end -= current.input.occurrences[i].length - 1
            var separator = draft.trim() === '' ? '' : draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
            if (!current.actions.insertText(separator + suffix, { start: end, end: end, draftRev: span.draftRev })) return
          }
          var attempt = {
            sid: current.sid,
            baselinePending: '\n' + current.pendingIds + '\n',
            baselineAccepted: '\n' + current.chatIds + '\n' + current.inboxIds + '\n',
            promptError: current.promptError,
            requestId: ''
          }
          setAwaiting(attempt)
        }
        function onKeyDown(event) {
          if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
          if (event.shiftKey || event.altKey) return
          if (!inComposer(event.target) || overlayOpen()) return
          appendIncoming()
        }
        function onClick(event) {
          if (isSendButton(event.target)) appendIncoming()
        }
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('click', onClick, true)
        return function () {
          window.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('click', onClick, true)
        }
      }, [])

      if (!loaded) return null
      var list = attachedFor(sid)
      var shown = list.length > 3 ? list.slice(0, 3) : list
      var hidden = list.length - shown.length
      return h(React.Fragment, null,
        h(InputTap, { live: live, useInput: props.useInput }),
        list.length === 0 ? null : h('div', { className: 'ps-root', style: { height: 'auto', padding: 0 } },
        h('div', { className: 'ps-bar' },
          h('span', { className: 'ps-bar-label' }, h(IconShelf, { size: 14 }), '本次附带'),
          shown.map(function (card) {
            return h('span', { key: card.id, className: 'ps-chip', title: card.title },
              h('span', null, card.title),
              h('button', { type: 'button', 'aria-label': '本次不附带', onClick: function () { toggleInclude(sid, card.id) } }, '×')
            )
          }),
          hidden === 0 ? null : h('span', { key: 'ps-more', className: 'ps-chip ps-chip--more' }, '+' + hidden)
        ))
      )
    }

    // ---- 每条用户消息下方的保存入口 ----
    // 消息文本只取正文文字块；纯附件消息没有可存的指令内容。
    function messageText(node) {
      var content = node.data.content
      var parts = []
      for (var i = 0; i < content.length; i += 1) {
        var block = content[i]
        if (block.type !== 'text') continue
        var text = block.text.trim()
        if (text !== '') parts.push(text)
      }
      return parts.join('\n')
    }

    // 宿主自己的用户消息渲染器：接管 key 后要原样渲染它。
    // 注册表的 entries 数组在两次变更之间是同一个引用，直接拿它当缓存键：
    // 注册表一变（插件热重载、他人后注册、优先级变化）缓存自动失效，不需要失效逻辑。
    var nativeRows = new WeakMap()

    function subscribeChatNodes(listener) {
      return slotsRef.subscribe('conversation.chat.node', listener)
    }

    function chatNodeEntries() {
      return slotsRef.entries('conversation.chat.node')
    }

    function nativeRowComponent(entries, kind) {
      var known = nativeRows.get(entries)
      if (known === undefined) {
        known = Object.create(null)
        nativeRows.set(entries, known)
      }
      if (known[kind] !== undefined) return known[kind]
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i]
        if (entry.options.key !== kind) continue
        if (entry.component === UserMessageRow) continue
        known[kind] = entry.component
        return entry.component
      }
      return null
    }

    // 按钮放进宿主自己渲染的图标行（那一行带 data-clock），插在复制按钮之前，不额外占一行。
    function UserMessageRow(props) {
      var rootRef = React.useRef(null)
      var slotRef = React.useRef(null)
      var rowState = React.useState(null)
      var row = rowState[0]
      var setRow = rowState[1]
      var doneState = React.useState(false)
      var done = doneState[0]
      var setDone = doneState[1]
      // 只跟 loaded：存储读完才让保存按钮出现，其他状态变化不重渲染整条消息。
      var readyState = React.useState(loaded)
      var ready = readyState[0]
      React.useEffect(function () {
        return subscribe(function () { readyState[1](loaded) })
      }, [])
      var node = props.node
      var text = messageText(node)
      // 注册表一变就重渲染，宿主渲染器换了不用刷新页面。
      var entries = React.useSyncExternalStore(subscribeChatNodes, chatNodeEntries)
      var Native = nativeRowComponent(entries, node.kind)

      React.useEffect(function () {
        var root = rootRef.current
        var actions = root === null ? null : root.querySelector('[data-clock="start"]')
        if (actions === null) {
          if (row !== null) setRow(null)
          return
        }
        var slot = slotRef.current
        if (slot === null) {
          slot = document.createElement('span')
          slot.className = 'ps-umsg-slot'
          slotRef.current = slot
        }
        // 只看宿主行直属的子节点：插进去的槽自己也可能含按钮，不能再选到它。
        var copy = null
        for (var i = 0; i < actions.children.length; i += 1) {
          var child = actions.children[i]
          if (child === slot) continue
          if (child.tagName === 'BUTTON' || child.querySelector('button') !== null) { copy = child; break }
        }
        if (slot.parentNode !== actions || (copy !== null && slot.nextSibling !== copy)) {
          if (copy === null) actions.appendChild(slot)
          else actions.insertBefore(slot, copy)
        }
        if (row !== slot) setRow(slot)
      })

      React.useEffect(function () {
        return function () {
          var slot = slotRef.current
          if (slot !== null && slot.parentNode !== null) slot.parentNode.removeChild(slot)
          slotRef.current = null
        }
      }, [])

      if (Native === null) {
        // 宿主渲染器不在时至少把消息文字留在页面上，不吞掉用户的话。
        return text === '' ? null : h('div', { className: 'ps-umsg-fallback' }, text)
      }
      var turn = node.location.turn.turn
      var save = text === '' || done || row === null || !ready ? null : ReactDOM.createPortal(
        h(primitives.Tooltip, { label: '存为指令', side: 'bottom', children: h('button', {
          type: 'button',
          className: 'ps-umsg-act',
          'aria-label': '存为指令',
          onClick: function () {
            createCard({ title: turn > 0 ? '第 ' + turn + ' 轮' : '', tags: [], content: text })
            setDone(true)
          }
        }, h(IconPlus)) }),
        row
      )
      return h('div', { className: 'ps-umsg', ref: rootRef },
        h(Native, {
          node: node,
          renderMessageImages: props.renderMessageImages,
          openFile: props.openFile,
          openSkill: props.openSkill,
          t: props.t
        }),
        save
      )
    }

    // ---- 侧栏面板 ----
    function Panel(props) {
      useStore()
      var sid = props.sessionId
      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var tagState = React.useState('')
      var tagFilter = tagState[0]
      var setTagFilter = tagState[1]
      var editState = React.useState(null)
      var editing = editState[0]
      var setEditing = editState[1]
      var deleteState = React.useState('')
      var deleting = deleteState[0]
      var setDeleting = deleteState[1]
      var pulseState = React.useState('')
      var pulse = pulseState[0]
      var setPulse = pulseState[1]
      var dragState = React.useState({ id: '', over: '', before: true })
      var drag = dragState[0]
      var setDrag = dragState[1]

      var tags = allTags()
      var needle = query.trim().toLowerCase()
      var matched = book.cards.filter(function (card) {
        if (tagFilter !== '' && card.tags.indexOf(tagFilter) < 0) return false
        if (needle === '') return true
        var hay = (card.title + '\n' + card.content + '\n' + card.tags.join(' ')).toLowerCase()
        return hay.indexOf(needle) >= 0
      })
      // 置顶是独立分区：置顶组永远在前，两组内部都保持数组顺序。
      var rows = []
      for (var pinAt = 0; pinAt < matched.length; pinAt += 1) if (matched[pinAt].pinned === true) rows.push(matched[pinAt])
      for (var restAt = 0; restAt < matched.length; restAt += 1) if (matched[restAt].pinned !== true) rows.push(matched[restAt])

      function flash(id) {
        setPulse(id)
        window.setTimeout(function () {
          setPulse(function (current) { return current === id ? '' : current })
        }, 210)
      }

      function startEdit(card) {
        setDeleting('')
        setEditing({
          id: card === null ? '' : card.id,
          title: card === null ? '' : card.title,
          tags: card === null ? '' : card.tags.join(', '),
          content: card === null ? '' : card.content
        })
      }

      function commit() {
        if (editing === null) return
        var fields = {
          title: editing.title,
          tags: editing.tags.split(/[,，、]+/),
          content: editing.content
        }
        if (editing.id === '') createCard(fields)
        else updateCard(editing.id, fields)
        setEditing(null)
      }

      function editor() {
        return h('div', { className: 'ps-form' },
          h('div', { className: 'ps-field' },
            h('label', { className: 'ps-label' }, '指令标题'),
            h(Input, {
              value: editing.title,
              placeholder: '例如：先问清目标再动手',
              autoFocus: true,
              onChange: function (event) { setEditing({ id: editing.id, title: event.target.value, tags: editing.tags, content: editing.content }) }
            })
          ),
          h('div', { className: 'ps-field' },
            h('label', { className: 'ps-label' }, '标签（可留空；已有标签点一下加入）'),
            h(Input, {
              value: editing.tags,
              placeholder: '用逗号分隔，例如：写作, 代码',
              onChange: function (event) { setEditing({ id: editing.id, title: editing.title, tags: event.target.value, content: editing.content }) }
            }),
            tags.length === 0 ? null : h('div', { className: 'ps-suggest' },
              tags.map(function (tag) {
                return h(Pill, {
                  key: tag,
                  onClick: function () {
                    var current = editing.tags.split(/[,，、]+/).map(function (item) { return item.trim() }).filter(Boolean)
                    if (current.indexOf(tag) >= 0) return
                    current.push(tag)
                    setEditing({ id: editing.id, title: editing.title, tags: current.join(', '), content: editing.content })
                  }
                }, tag)
              })
            )
          ),
          h('div', { className: 'ps-field' },
            h('label', { className: 'ps-label' }, '指令内容（发送时并入消息）'),
            h('textarea', {
              className: 'ps-textarea',
              value: editing.content,
              placeholder: '这段文字会在发送时接在你的消息后面',
              onChange: function (event) { setEditing({ id: editing.id, title: editing.title, tags: editing.tags, content: event.target.value }) }
            })
          ),
          h('div', { className: 'ps-form-foot' },
            h(Button, { size: 'sm', variant: 'ghost', onClick: function () { setEditing(null) } }, '取消'),
            h(Button, { size: 'sm', variant: 'primary', onClick: commit }, '保存')
          )
        )
      }

      function row(card) {
        if (editing !== null && editing.id === card.id) return h(React.Fragment, { key: card.id }, editor())
        var every = everyOf(sid).indexOf(card.id) >= 0
        var on = selectionOf(sid).indexOf(card.id) >= 0
        var classes = 'ps-card' + (on ? ' ps-card--on' : '')
          + (pulse === card.id ? ' ps-card--pulse' : '')
          + (drag.id === card.id ? ' ps-card--drag' : '')
        return h('div', {
          key: card.id,
          className: classes,
          draggable: true,
          onClick: function (event) {
            if (event.target.closest('button') !== null) return
            if (drag.id !== '') return
            toggleInclude(sid, card.id)
            flash(card.id)
          },
          onDragStart: function (event) {
            event.dataTransfer.effectAllowed = 'move'
            try { event.dataTransfer.setData('text/plain', card.id) } catch (error) {}
            setDrag({ id: card.id, over: '', before: true })
          },
          onDragOver: function (event) {
            if (drag.id === '' || drag.id === card.id) return
            var dragged = cardById(drag.id)
            if (dragged === undefined || (dragged.pinned === true) !== (card.pinned === true)) return
            event.preventDefault()
            var rect = event.currentTarget.getBoundingClientRect()
            var before = event.clientY < rect.top + rect.height / 2
            if (drag.over !== card.id || drag.before !== before) setDrag({ id: drag.id, over: card.id, before: before })
          },
          onDrop: function (event) {
            event.preventDefault()
            if (drag.id !== '' && drag.id !== card.id) moveCard(drag.id, card.id, drag.before)
            setDrag({ id: '', over: '', before: true })
          },
          onDragEnd: function () { setDrag({ id: '', over: '', before: true }) }
        },
          h('div', { className: 'ps-head' },
            h('div', { className: 'ps-body' },
              h('div', { className: 'ps-title', title: card.title }, card.title),
              h('div', { className: 'ps-sub', title: card.content }, card.content.replace(/\s+/g, ' ').trim() || '（空指令）')
            )
          ),
          card.tags.length === 0 ? null : h('div', { className: 'ps-tagrow' },
            card.tags.map(function (tag) { return h(Tag, { key: tag, tone: 'outline' }, tag) })
          ),
          h('div', { className: 'ps-foot' },
            h('span', { className: 'ps-every' },
              '每轮注入',
              h(Switch, {
                checked: every,
                label: '每轮注入',
                onChange: function (next) { toggleEvery(sid, card.id, next) }
              })
            ),
            h('div', { className: 'ps-ops' },
              h(Button, {
                size: 'sm', variant: 'ghost',
                icon: card.pinned ? h(IconPinFill, { size: 16 }) : h(IconPin, { size: 16 }),
                onClick: function () { setPinned(card.id, !card.pinned) }
              }, card.pinned ? '取消置顶' : '置顶'),
              h(Button, { size: 'sm', variant: 'ghost', onClick: function () { startEdit(card) } }, '编辑'),
              deleting === card.id
                ? h(React.Fragment, null,
                    h(Button, { size: 'sm', variant: 'ghost', onClick: function () { setDeleting('') } }, '取消'),
                    h(Button, {
                      size: 'sm', variant: 'ghost',
                      style: { color: 'var(--dsw-alias-state-error-primary)' },
                      onClick: function () { setDeleting(''); removeCard(card.id) }
                    }, '确认删除')
                  )
                : h(Button, { size: 'sm', variant: 'ghost', onClick: function () { setDeleting(card.id) } }, '删除')
            )
          )
        )
      }

      function dropLine(key) {
        return h('div', { key: key, className: 'ps-drop' })
      }

      // 插入线就是松手后卡片所在的缝。
      function listRows() {
        var out = []
        for (var i = 0; i < rows.length; i += 1) {
          var card = rows[i]
          var here = drag.id !== '' && drag.over === card.id
          if (here && drag.before) out.push(dropLine('drop-' + card.id + '-before'))
          out.push(row(card))
          if (here && !drag.before) out.push(dropLine('drop-' + card.id + '-after'))
        }
        if (drag.id !== '' && drag.over === END) out.push(dropLine('drop-end'))
        return out
      }

      function tailZone() {
        if (drag.id === '') return null
        return h('div', {
          key: 'ps-tail',
          className: 'ps-tail',
          onDragOver: function (event) {
            event.preventDefault()
            if (drag.over !== END) setDrag({ id: drag.id, over: END, before: false })
          },
          onDrop: function (event) {
            event.preventDefault()
            if (drag.id !== '') moveCard(drag.id, END, false)
            setDrag({ id: '', over: '', before: true })
          }
        })
      }

      if (!loaded) return h('div', { className: 'ps-root' }, storageError || '正在从 DSH 存储读取指令…')
      return h('div', { className: 'ps-root' },
        storageError === '' ? null : h('div', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, storageError),
        h('div', { className: 'ps-toolbar' },
          h(Input, {
            icon: h(IconSearch, { size: 14 }),
            value: query,
            placeholder: '搜索标题、内容或标签',
            onChange: function (event) { setQuery(event.target.value) }
          }),
          h(Button, {
            size: 'sm', variant: 'outline', className: 'ps-new',
            icon: h(IconPlus, { size: 16 }),
            onClick: function () { startEdit(null) }
          }, '新建')
        ),
        tags.length === 0 ? null : h('div', { className: 'ps-filters' },
          h(Pill, { key: '*', active: tagFilter === '', onClick: function () { setTagFilter('') } }, '全部'),
          tags.map(function (tag) {
            return h(Pill, {
              key: tag,
              active: tagFilter === tag,
              onClick: function () { setTagFilter(tagFilter === tag ? '' : tag) }
            }, tag)
          })
        ),
        h('div', { className: 'ps-list' },
          editing !== null && editing.id === '' ? editor() : null,
          rows.length === 0 && !(editing !== null && editing.id === '')
            ? h('div', { className: 'ps-empty' },
                book.cards.length === 0
                  ? '还没有指令。点右上角「新建」，或在已发送的消息下方点「存为指令」。'
                  : '没有匹配的指令。换个关键词或标签试试。')
            : listRows(),
          tailZone()
        )
      )
    }

    // ---- 注册 ----
    function apply(ctx) {
      var slots = ctx.slots
      ensureStyle()
      loadStorage(ctx.connection).then(function () {
        pruneSessions(ctx.sessions.list.getSnapshot())
      })
      ctx.effect(function () {
        var list = ctx.sessions.list
        return list.subscribe(function () { pruneSessions(list.getSnapshot()) })
      }, 'dsh-prompt-shelf: prune sessions')

      // 分叉当下复制来源会话的每轮注入清单，不在别处追踪分叉关系。
      ctx.effect(function () {
        var sessions = ctx.sessions
        var fork = sessions.fork
        var wrapper = function (opts) {
          return fork.call(sessions, opts).then(function (childId) {
            var source = everyOf(opts.sessionId)
            if (source.length > 0) {
              sessionBook[childId] = source.slice()
              writeState()
            }
            return childId
          })
        }
        sessions.fork = wrapper
        return function () { if (sessions.fork === wrapper) sessions.fork = fork }
      }, 'dsh-prompt-shelf: fork settings')

      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_ID,
          priority: 'extension',
          title: function () { return '快捷指令' },
          guide: [{
            id: TAB_ID,
            order: 40,
            icon: IconShelf,
            title: function () { return '快捷指令' },
            description: function () { return '存取常用指令，按需加入本次消息或每轮自动注入' }
          }]
        })
      }, 'dsh-prompt-shelf: tab type')

      ctx.effect(function () {
        return slots.inject('sidebar.right.pane.tab', function () {
          return slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Panel)
        })
      }, 'dsh-prompt-shelf: tab body')

      ctx.effect(function () {
        return slots.inject('conversation.composer.dock', function () {
          return slots.register({ name: 'conversation.composer.dock', id: 'prompt-shelf-attach', order: 30, label: function () { return '本次附带' } }, AttachBar)
        })
      }, 'dsh-prompt-shelf: attach bar')

      // 用户消息的键控渲染位：以更低优先级接管该 key，再原样渲染宿主组件，
      // 只在它下面补一行保存按钮，原生气泡、图片、引用都保持宿主实现。
      slotsRef = slots
      function mountRow(kind) {
        return slots.inject('conversation.chat.node', function () {
          return slots.register({ name: 'conversation.chat.node', key: kind, priority: -1, locale: 'chat' }, UserMessageRow)
        })
      }
      ctx.effect(function () {
        var user = mountRow('user')
        var steering = mountRow('steering')
        return function () { user(); steering() }
      }, 'dsh-prompt-shelf: message save')

    }

    exports.name = '@emptyvessel_003/dsh-prompt-shelf'
    exports.inject = ['slots', 'sidebarRightTabs', 'sessions', 'connection']
    exports.apply = apply
    return module.exports
  }
})
