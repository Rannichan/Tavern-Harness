import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import type { ChatMessage, ChatParticipant, ChatSession, ToolCallRecord } from '../types/models';
import { Avatar, Icon, Markdown, Collapse, Modal, AttachCard } from './shared';
import { formatMetrics } from '../core/stats';
import { saveTextFile } from '../core/fileDownload';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 从 dataUrl / URL 猜测一个可显示的文件名 */
function attachmentName(a: string): string {
  if (a.startsWith('data:')) {
    const m = /^data:([^;]+);/.exec(a);
    const mime = m ? m[1] : '';
    const ext = mime.split('/')[1] || 'bin';
    return `附件.${ext}`;
  }
  try {
    const u = new URL(a);
    const name = u.pathname.split('/').pop();
    if (name) return decodeURIComponent(name);
  } catch {
    /* ignore */
  }
  return '附件';
}

// ============================================================
// 聊天内容区
// ============================================================

export function ChatView({
  session,
  messages,
  participants,
  streaming,
}: {
  session: ChatSession;
  messages: ChatMessage[];
  participants: ChatParticipant[];
  streaming: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const updateStreaming = useStore((s) => s.streaming.sessionId === session.id);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, updateStreaming, messages[messages.length - 1]?.content.length]);

  const npcId = session.associatedId;
  const npc = useStore((s) => s.npcs.find((n) => n.id === npcId));

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-col">
        {messages.length === 0 && (
          <div className="empty-state fade-up">
            <div className="big">🫖</div>
            <div>
              {session.mode === 'STANDARD' && <><b>开始一段新的对话</b><br />输入消息开始聊天</>}
              {session.mode === 'NPC' && <><b>与 {npc?.name ?? '角色'} 对话</b><br />{npc?.greeting}</>}
              {session.mode === 'GROUP' && <><b>群聊</b><br />多位角色轮番发言</>}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} session={session} participants={participants} streaming={streaming && m.id === lastMsgId(messages)} />
        ))}
      </div>
    </div>
  );
}

function lastMsgId(messages: ChatMessage[]): number | undefined {
  return messages.length > 0 ? messages[messages.length - 1].id : undefined;
}

// ============================================================
// 单条消息气泡
// ============================================================

function MessageBubble({
  msg,
  session,
  participants,
  streaming,
}: {
  msg: ChatMessage;
  session: ChatSession;
  participants: ChatParticipant[];
  streaming: boolean;
}) {
  // System 消息（/new 标记）
  if (msg.role === 'system') {
    return (
      <div className="sys-banner fade-up">⟐ {msg.content}</div>
    );
  }

  // 工具消息
  if (msg.role === 'tool') {
    const isError = msg.content.startsWith('ERROR:') || msg.content.startsWith('CANCELLED:');
    return (
      <div className={`tool-result fade-up ${isError ? 'err' : ''}`}>
        <Icon name={isError ? 'cancel' : 'check'} size={13} />
        <span className="mono">{msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}</span>
      </div>
    );
  }

  const toolCalls = useMemo(() => {
    try {
      return JSON.parse(msg.toolCallsJson || '[]') as ToolCallRecord[];
    } catch {
      return [];
    }
  }, [msg.toolCallsJson]);

  // ---- 内联编辑状态（右键菜单 → 编辑消息，直接在气泡内编辑，不弹窗） ----
  const [isEditing, setIsEditing] = useState(false);
  useEffect(() => {
    const fn = () => {
      const isTarget = editingMsgState?.msgId === msg.id;
      setIsEditing(isTarget);
    };
    editingMsgListeners.push(fn);
    return () => {
      editingMsgListeners = editingMsgListeners.filter((f) => f !== fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id]);

  const isUser = msg.role === 'user' || (msg.role === 'assistant' && msg.speakerParticipantId == null && session.mode === 'STANDARD' && false);
  const speaker = msg.speakerParticipantId != null
    ? participants.find((p) => p.participantId === msg.speakerParticipantId)
    : undefined;
  const speakerName = msg.speakerName ?? (isUser ? '用户' : session.mode === 'NPC' ? '角色' : '助手');
  const npcHue = speaker?.npcId ? useStore((s) => s.npcs.find((n) => n.id === speaker.npcId)?.avatarColorOrdinal ?? 0) : 0;
  const npcAvatar = speaker?.npcId ? useStore((s) => s.npcs.find((n) => n.id === speaker.npcId)?.avatarDataUrl ?? null) : null;

  if (isUser) {
    return <UserBubble msg={msg} session={session} editing={isEditing} />;
  }

  if (isEditing) {
    return (
      <div className="msg-row fade-up">
        <Avatar name={speakerName} colorOrdinal={npcHue} imageUrl={npcAvatar} />
        <div className="msg-body">
          <div className="msg-head">
            <span className="msg-name">{speakerName}</span>
            <span className="msg-time">{fmtTime(msg.timestamp)}</span>
          </div>
          <BubbleEditor msg={msg} session={session} onDone={stopEditingMsg} />
        </div>
      </div>
    );
  }

  return (
    <div className={`msg-row fade-up ${streaming ? 'streaming' : ''}`} onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, msg, session); }}>
      <Avatar name={speakerName} colorOrdinal={npcHue} imageUrl={npcAvatar} />
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-name">{speakerName}</span>
          {msg.modelUsed && !msg.modelUsed.startsWith('scheduled:') && <span className="msg-model" title={msg.modelUsed}>{msg.modelUsed}</span>}
          <span className="msg-time">{fmtTime(msg.timestamp)}</span>
        </div>
        {msg.thinkingContent && streaming && (
          <Collapse title="思考" icon="🧠" accent="think" preview={msg.thinkingContent} live>
            <Markdown text={msg.thinkingContent} mathEnabled={false} />
          </Collapse>
        )}
        {msg.thinkingContent && !streaming && (
          <Collapse title="思考" icon="🧠" accent="think" defaultOpen={false} preview={msg.thinkingContent}>
            <Markdown text={msg.thinkingContent} mathEnabled={false} />
          </Collapse>
        )}
        {toolCalls.length > 0 && (
          <div className="tool-calls">
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={i} tc={tc} executing={streaming} />
            ))}
          </div>
        )}
        {(msg.content || msg.attachments.length > 0) && (
          <div className={`bubble ${isUser ? 'bubble-user' : ''}`}>
            {msg.attachments.length > 0 && (
              <div className="attachments">
                {msg.attachments.map((a, i) => (
                  <AttachCard key={i} name={msg.attachmentInfos?.[i]?.displayName || attachmentName(a)} />
                ))}
              </div>
            )}
            <div className="bubble-content-row">
              <div className="bubble-text">
                {msg.content ? <Markdown text={msg.content} mentionNames={participants.map((p) => p.displayName)} /> : streaming && <span className="stream-cursor" />}
              </div>
              {/* 编辑按钮：位于正文气泡内最右侧，铅笔图标 */}
              <button className="msg-edit-btn" title="编辑消息" onClick={() => startEditingMsg(msg.id!)}>
                <Icon name="pencil" size={13} />
              </button>
            </div>
          </div>
        )}
        {(msg.latencyMs != null || msg.promptTokens > 0 || msg.completionTokens > 0) && !streaming && (
          <div className="msg-metrics">{formatMetrics(msg)}</div>
        )}
        {streaming && <div className="msg-metrics"><span className="stream-cursor" />生成中…</div>}
      </div>
    </div>
  );
}

/** 气泡内联编辑器（替换弹窗编辑，支持管理附件） */
function BubbleEditor({
  msg,
  session,
  onDone,
}: {
  msg: ChatMessage;
  session: ChatSession;
  onDone: () => void;
}) {
  const [text, setText] = useState(msg.content);
  const [attachments, setAttachments] = useState<{ dataUrl: string; name: string }[]>(
    msg.attachments.map((a, i) => ({ dataUrl: a, name: msg.attachmentInfos?.[i]?.displayName || attachmentName(a) }))
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const editMessage = useStore((s) => s.editMessage);
  const streaming = useStore((s) => s.streaming.sessionId === session.id);

  const doSave = async () => {
    if (!text.trim() || streaming) return;
    await editMessage(
      msg.id!,
      text,
      session.id!,
      attachments.map((a) => a.dataUrl),
      attachments.map((a) => a.name)
    );
    onDone();
  };

  return (
    <div className="bubble-editor">
      <textarea
        className="textarea mono"
        rows={Math.max(3, Math.min(12, text.split('\n').length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            doSave();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          }
        }}
      />
      {/* 附件管理 */}
      {attachments.length > 0 && (
        <div className="attachments" style={{ marginBottom: 0 }}>
          {attachments.map((a, i) => (
            <AttachCard
              key={i}
              name={a.name}
              onRemove={() => setAttachments(attachments.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      <div className="bubble-editor-actions">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              const files = e.target.files;
              if (files) {
                Array.from(files).forEach((f) => readFileAsDataUrl(f).then((url) => setAttachments((prev) => [...prev, { dataUrl: url, name: f.name }])));
              }
              e.target.value = '';
            }}
          />
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={12} /> 添加附件
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="bubble-editor-hint">⌘/Ctrl+Enter 保存 · Esc 取消</span>
          <button className="btn btn-sm" onClick={onDone}>取消</button>
          <button className="btn btn-sm btn-primary" disabled={!text.trim() || streaming} onClick={doSave}>
            保存并重新生成
          </button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ msg, session, editing }: { msg: ChatMessage; session: ChatSession; editing?: boolean }) {
  return (
    <div className="msg-row user-row fade-up" onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, msg, session); }}>
      <div className="avatar sm user-avatar">我</div>
      <div className="msg-body">
        <div className="msg-head right">
          <span className="msg-time">{fmtTime(msg.timestamp)}</span>
          <span className="msg-name">你</span>
        </div>
        {editing ? (
          <BubbleEditor msg={msg} session={session} onDone={stopEditingMsg} />
        ) : (
          <div className="bubble bubble-user">
            {msg.attachments.length > 0 && (
              <div className="attachments">
                {msg.attachments.map((a, i) => (
                  <AttachCard key={i} name={msg.attachmentInfos?.[i]?.displayName || attachmentName(a)} />
                ))}
              </div>
            )}
            <div className="bubble-content-row">
              <div className="bubble-text">
                {msg.content && <Markdown text={msg.content} />}
              </div>
              <button className="msg-edit-btn" title="编辑消息" onClick={() => startEditingMsg(msg.id!)}>
                <Icon name="pencil" size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ tc, executing }: { tc: ToolCallRecord; executing: boolean }) {
  const [open, setOpen] = useState(false);
  let args: unknown;
  try {
    args = JSON.parse(tc.argumentsJson);
  } catch {
    args = tc.argumentsJson;
  }
  return (
    <div className={`tool-card ${executing ? 'executing' : ''}`}>
      <button className="tool-card-head" onClick={() => setOpen(!open)}>
        {executing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="dice" size={13} />}
        <span>调用工具: {tc.name}</span>
        <span className="collp-arrow" style={{ transform: open ? 'rotate(180deg)' : undefined }}>▾</span>
      </button>
      {open && (
        <pre className="tool-args mono">{JSON.stringify(args, null, 2)}</pre>
      )}
    </div>
  );
}

// ============================================================
// 输入区
// ============================================================

export function ChatInput({ sessionId }: { sessionId: number }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ dataUrl: string; name: string }[]>([]);
  const [showCmd, setShowCmd] = useState(false);
  const [typing, setTyping] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendMessage = useStore((s) => s.sendMessage);
  const streaming = useStore((s) => s.streaming.sessionId === sessionId);
  const stopStreaming = useStore((s) => s.stopStreaming);
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId));
  const defaultModel = useStore((s) => s.settings?.defaultModel?.trim() || '');

  const canSend = text.trim().length > 0 || attachments.length > 0;

  const doSend = () => {
    if (!canSend || typing) return;
    if (streaming) return;
    setTyping(true);
    sendMessage(
      text.trim(),
      attachments.map((a) => a.dataUrl),
      attachments.map((a) => a.name)
    ).finally(() => {
      setTyping(false);
      setText('');
      setAttachments([]);
      setShowCmd(false);
    });
  };

  // 拖放 / 粘贴附件
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0 && files[0].type.startsWith('image')) {
        e.preventDefault();
        const f = files[0];
        readFileAsDataUrl(f).then((url) => setAttachments((a) => [...a, { dataUrl: url, name: f.name || `粘贴图片.${f.type.split('/')[1] || 'png'}` }]));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const commands = ['/new', '/pass'];

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="attach-preview">
          {attachments.map((a, i) => (
            <AttachCard
              key={i}
              name={a.name}
              onRemove={() => setAttachments(attachments.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      {showCmd && (
        <div className="cmd-menu">
          {commands.map((c) => (
            <button key={c} className="cmd-item" onClick={() => { setText(c); setShowCmd(false); }}>
              <span className="cmd-text">{c}</span>
              <span className="cmd-desc">{c === '/new' ? '开始新话题（截断上下文）' : '跳过本轮发言（群聊中）'}</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-box">
        {/* 模型选择器：输入框左侧，弹出列表（非弹窗） */}
        <div className="composer-model">
          <button
            className={`composer-model-btn ${showModels ? 'open' : ''}`}
            title="选择模型"
            onClick={() => setShowModels(!showModels)}
          >
            <Icon name="dice" size={15} />
            <span className="composer-model-label">{defaultModel || '选模型'}</span>
          </button>
          {showModels && (
            <ModelPickerPanel onClose={() => setShowModels(false)} />
          )}
        </div>
        <button
          className="icon-btn composer-attach"
          title="添加图片/视频（粘贴或点击）"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="image" size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            if (files) {
              Array.from(files).forEach((f) => readFileAsDataUrl(f).then((url) => setAttachments((a) => [...a, { dataUrl: url, name: f.name }])));
            }
            e.target.value = '';
          }}
        />
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setShowCmd(e.target.value.startsWith('/') && !e.target.value.includes('\n'));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              doSend();
            }
            if (e.key === 'Escape') setShowCmd(false);
          }}
          placeholder={
            session?.mode === 'GROUP'
              ? `输入消息… 支持 @角色名 指定发言，/new 新话题，/pass 跳过`
              : '输入消息… 支持 Markdown / 数学公式，/new 开始新话题'
          }
          rows={1}
          style={{ height: 'auto', minHeight: 38 }}
        />
        {streaming ? (
          <button className="btn btn-primary btn-round" onClick={stopStreaming} title="停止生成">
            <Icon name="stop" size={15} />
          </button>
        ) : (
          <button className="btn btn-primary btn-round" disabled={!canSend} onClick={doSend} title="发送">
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
      <div className="composer-hint">
        <span>Enter 发送 · Shift+Enter 换行</span>
        <span className="composer-hint-right">魔法命令: /new · /pass</span>
      </div>
    </div>
  );
}

/** 模型选择下拉列表（弹出在输入框左侧上方） */
function ModelPickerPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.modelsList);
  const selectModel = useStore((s) => s.selectModel);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const selected = settings?.defaultModel?.trim() || '';

  const pick = async (m: string) => {
    await selectModel(m);
    onClose();
  };

  return (
    <div className="model-popover card" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="model-popover-head">
        <span>选择模型</span>
        <button className="icon-btn" onClick={onClose} title="关闭"><Icon name="x" size={12} /></button>
      </div>
      {models.length === 0 ? (
        <div className="model-popover-empty">
          暂无可用模型列表。请先在「设置 → 模型服务 Provider」添加并测试连接。
        </div>
      ) : (
        <div className="model-popover-list">
          {models.map((m) => (
            <button
              key={m}
              className={`model-option ${m === selected ? 'active' : ''}`}
              onClick={() => pick(m)}
            >
              <span className="model-option-dot">{m === selected ? '●' : '○'}</span>
              <span className="model-option-name">{m}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
// 消息操作菜单（右键：编辑 / 重新生成 / 原始日志 / 分叉）
// ============================================================

let msgMenuState:
  | { x: number; y: number; msg: ChatMessage; session: ChatSession }
  | null = null;
let msgMenuListeners: Array<() => void> = [];
function notifyMsgMenu() {
  msgMenuListeners.forEach((fn) => fn());
}
function openMsgMenu(e: React.MouseEvent, msg: ChatMessage, session: ChatSession) {
  msgMenuState = { x: e.clientX, y: e.clientY, msg, session };
  notifyMsgMenu();
}
function closeMsgMenu() {
  msgMenuState = null;
  notifyMsgMenu();
}

// ---- 内联编辑全局状态（编辑目标由 MessageBubble 监听） ----
let editingMsgState: { msgId: number } | null = null;
let editingMsgListeners: Array<() => void> = [];
function startEditingMsg(msgId: number) {
  editingMsgState = { msgId };
  editingMsgListeners.forEach((fn) => fn());
  closeMsgMenu();
}
function stopEditingMsg() {
  editingMsgState = null;
  editingMsgListeners.forEach((fn) => fn());
}

export function MessageMenu() {
  const [, force] = useState(0);
  const regenerateLast = useStore((s) => s.regenerateLast);
  const addToast = useStore((s) => s.addToast);
  const [rawLog, setRawLog] = useState<ChatMessage | null>(null);

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    msgMenuListeners.push(fn);
    return () => {
      msgMenuListeners = msgMenuListeners.filter((f) => f !== fn);
    };
  }, []);

  // 原始日志弹窗（独立状态，优先于右键菜单）
  if (rawLog) {
    return (
      <RawLogModal
        msg={rawLog}
        onClose={() => setRawLog(null)}
        onExport={async () => {
          const raw = buildRawLog(rawLog);
          await saveTextFile(raw, 'text/plain', `raw-log-${rawLog.id}.txt`);
          addToast('已导出原始日志（自动脱敏）');
          setRawLog(null);
        }}
      />
    );
  }

  if (!msgMenuState) return null;
  const { x, y, msg, session } = msgMenuState;

  const actions: Array<{ label: string; icon: string; onClick: () => void; danger?: boolean }> = [];
  if (msg.role === 'user' || msg.role === 'assistant') {
    actions.push({
      label: '编辑消息',
      icon: 'settings',
      onClick: () => {
        startEditingMsg(msg.id!);
      },
    });
  }
  if (msg.role === 'assistant') {
    actions.push({
      label: '重新生成回复',
      icon: 'refresh',
      onClick: async () => {
        closeMsgMenu();
        await regenerateLast();
      },
    });
  }
  if (msg.rawRequestBody || msg.rawResponseBody) {
    actions.push({
      label: '查看原始日志',
      icon: 'file',
      onClick: () => {
        setRawLog(msg);
        closeMsgMenu();
      },
    });
  }

  return (
    <>
      <div className="overlay-msg" onClick={closeMsgMenu} />
      <div className="msg-menu card" style={{ left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 200) }}>
        {actions.map((a) => (
          <button
            key={a.label}
            className="msg-menu-item"
            onClick={() => {
              closeMsgMenu();
              a.onClick();
            }}
          >
            <Icon name={a.icon} size={13} /> {a.label}
          </button>
        ))}
        {actions.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-faint)' }}>该消息无可用操作</div>}
      </div>
    </>
  );
}

/** 原始日志弹窗：将流式 SSE 分片拼装为完整回复 JSON，便于阅读 */
function RawLogModal({ msg, onClose, onExport }: { msg: ChatMessage; onClose: () => void; onExport: () => void }) {
  const req = msg.rawRequestBody ? prettyJson(msg.rawRequestBody) : '';
  const merged = assembleFullResponseJson(msg.rawResponseBody);

  const [tab, setTab] = useState<'request' | 'merged'>('request');

  return (
    <Modal onClose={onClose} width="min(760px, calc(100vw - 40px))">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="file" size={15} /> 原始日志 · 消息 #{msg.id}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="raw-tabs">
            <button className={`raw-tab ${tab === 'request' ? 'active' : ''}`} onClick={() => setTab('request')}>请求体</button>
            <button className={`raw-tab ${tab === 'merged' ? 'active' : ''}`} onClick={() => setTab('merged')}>完整响应</button>
          </div>
          <button className="btn btn-sm" onClick={onExport} title="下载为 txt 文件">
            <Icon name="download" size={12} /> 导出
          </button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
      </div>
      <div className="modal-body" style={{ padding: 0 }}>
        {tab === 'request' && (
          <pre className="raw-pre mono">{req || '（无请求体）'}</pre>
        )}
        {tab === 'merged' && (
          merged ? (
            <div className="raw-merged">
              <div className="raw-merged-head">
                <span>完整回复 JSON</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>从流式 SSE 分片拼装</span>
              </div>
              <pre className="raw-pre mono">{JSON.stringify(merged, null, 2)}</pre>
            </div>
          ) : (
            <div className="raw-empty">该消息没有可拼装的流式内容</div>
          )
        )}
      </div>
    </Modal>
  );
}

/** 从流式 SSE 原始行拼装出完整回复 JSON（合并所有分片）
 *  注意：rawResponseBody 存的是去掉 "data: " 前缀后的裸 JSON 行，
 *  因此这里同时兼容裸 JSON 行与带 data: 前缀的完整行。 */
interface ChoiceAccum {
  role?: string;
  content: string;
  finish_reason?: string | null;
  toolCalls: Map<number, { id: string; type: string; name: string; args: string }>;
}

function assembleFullResponseJson(rawBody: string | null): Record<string, unknown> | null {
  if (!rawBody) return null;
  const lines = rawBody.split('\n');

  // 用于收集分片信息
  let merged: Record<string, unknown> = {};
  const choicesAccum = new Map<number, ChoiceAccum>();
  let usage: Record<string, unknown> | null = null;

  const applyChunk = (chunk: Record<string, unknown>) => {
    const id = chunk.id;
    const object = chunk.object;
    const created = chunk.created;
    const model = chunk.model;
    if (typeof id === 'string') merged.id = id;
    if (typeof object === 'string') merged.object = object;
    if (typeof created === 'number') merged.created = created;
    if (typeof model === 'string') merged.model = model;

    const choices = chunk.choices as Array<{ index?: number; delta?: Record<string, unknown>; finish_reason?: string | null }> | undefined;
    if (choices) {
      for (const c of choices) {
        const idx = c.index ?? 0;
        let acc = choicesAccum.get(idx);
        if (!acc) {
          acc = { content: '', toolCalls: new Map() };
          choicesAccum.set(idx, acc);
        }
        const delta = c.delta ?? {};
        if (typeof delta.role === 'string' && !acc.role) acc.role = delta.role;
        if (typeof delta.content === 'string') acc.content += delta.content;
        if (typeof c.finish_reason === 'string') acc.finish_reason = c.finish_reason;
        // 工具调用增量按 index 组装（name / arguments 递增拼接）
        const tcDeltas = delta.tool_calls as Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> | undefined;
        if (tcDeltas) {
          for (const tc of tcDeltas) {
            const tci = tc.index ?? 0;
            const cur = acc.toolCalls.get(tci) ?? { id: '', type: 'function', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.type) cur.type = tc.type;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            acc.toolCalls.set(tci, cur);
          }
        }
      }
    }

    if (chunk.usage) usage = chunk.usage as Record<string, unknown>;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!data || data === '[DONE]') continue;
    try {
      applyChunk(JSON.parse(data));
    } catch {
      /* 忽略非 JSON 行 */
    }
  }

  if (Object.keys(merged).length === 0) return null;

  // 组装 choices：message 结构 + finish_reason
  const mergedChoices = Array.from(choicesAccum.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([idx, acc]) => {
      const message: Record<string, unknown> = {};
      if (acc.role) message.role = acc.role;
      if (acc.content) message.content = acc.content;
      if (acc.toolCalls.size > 0) {
        message.tool_calls = Array.from(acc.toolCalls.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, tc]) => ({
            id: tc.id,
            type: tc.type,
            function: { name: tc.name, arguments: tc.args },
          }));
      }
      const choice: Record<string, unknown> = { index: idx, message };
      if (acc.finish_reason != null) choice.finish_reason = acc.finish_reason;
      return choice;
    });
  merged.choices = mergedChoices;
  if (usage) merged.usage = usage;

  return merged;
}

function buildRawLog(msg: ChatMessage): string {
  const req = msg.rawRequestBody ? prettyJson(msg.rawRequestBody) : null;
  const resp = msg.rawResponseBody ? prettyJson(msg.rawResponseBody) : null;
  return [
    `# Raw Log — message #${msg.id}`,
    `role: ${msg.role}`,
    req ? `\n## Request\n${req}` : '',
    resp ? `\n## Response (SSE)\n${resp}` : '',
  ].join('\n');
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export default ChatView;