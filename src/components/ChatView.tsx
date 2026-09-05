import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import type { ChatMessage, ChatParticipant, ChatSession, ToolCallRecord } from '../types/models';
import { Avatar, Icon, Markdown, Collapse } from './shared';
import { formatMetrics } from '../core/stats';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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
        {streaming && <div className="typing-dots"><span /><span /><span /></div>}
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

  const isUser = msg.role === 'user' || (msg.role === 'assistant' && msg.speakerParticipantId == null && session.mode === 'STANDARD' && false);
  const speaker = msg.speakerParticipantId != null
    ? participants.find((p) => p.participantId === msg.speakerParticipantId)
    : undefined;
  const speakerName = msg.speakerName ?? (isUser ? '用户' : session.mode === 'NPC' ? '角色' : '助手');
  const npcHue = speaker?.npcId ? useStore((s) => s.npcs.find((n) => n.id === speaker.npcId)?.avatarColorOrdinal ?? 0) : 0;
  const npcAvatar = speaker?.npcId ? useStore((s) => s.npcs.find((n) => n.id === speaker.npcId)?.avatarDataUrl ?? null) : null;

  if (isUser) {
    return <UserBubble msg={msg} session={session} />;
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
        <div className={`bubble ${isUser ? 'bubble-user' : ''}`}>
          {msg.attachments.length > 0 && (
            <div className="attachments">
              {msg.attachments.map((a, i) => (
                a.startsWith('data:image')
                  ? <img key={i} src={a} alt="attach" className="attach-img" />
                  : <video key={i} src={a} controls className="attach-img" />
              ))}
            </div>
          )}
          {msg.content ? <Markdown text={msg.content} mentionNames={participants.map((p) => p.displayName)} /> : streaming && <span className="stream-cursor" />}
        </div>
        {(msg.latencyMs != null || msg.promptTokens > 0 || msg.completionTokens > 0) && !streaming && (
          <div className="msg-metrics">{formatMetrics(msg)}</div>
        )}
        {streaming && <div className="msg-metrics"><span className="stream-cursor" />生成中…</div>}
      </div>
    </div>
  );
}

function UserBubble({ msg, session }: { msg: ChatMessage; session: ChatSession }) {
  return (
    <div className="msg-row user-row fade-up" onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, msg, session); }}>
      <div className="avatar user-avatar">我</div>
      <div className="msg-body">
        <div className="msg-head right">
          <span className="msg-time">{fmtTime(msg.timestamp)}</span>
          <span className="msg-name">你</span>
        </div>
        <div className="bubble bubble-user">
          {msg.attachments.length > 0 && (
            <div className="attachments">
              {msg.attachments.map((a, i) => (
                a.startsWith('data:image')
                  ? <img key={i} src={a} alt="attach" className="attach-img" />
                  : <video key={i} src={a} controls className="attach-img" />
              ))}
            </div>
          )}
          {msg.content && <Markdown text={msg.content} />}
        </div>
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
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showCmd, setShowCmd] = useState(false);
  const [typing, setTyping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendMessage = useStore((s) => s.sendMessage);
  const streaming = useStore((s) => s.streaming.sessionId === sessionId);
  const stopStreaming = useStore((s) => s.stopStreaming);
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId));

  const canSend = text.trim().length > 0 || attachments.length > 0;

  const doSend = () => {
    if (!canSend || typing) return;
    if (streaming) return;
    setTyping(true);
    sendMessage(text.trim(), attachments).finally(() => {
      setTyping(false);
      setText('');
      setAttachments([]);
      setShowCmd(false);
    });
  };

  // 拖放附件
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0 && files[0].type.startsWith('image')) {
        e.preventDefault();
        readFileAsDataUrl(files[0]).then((url) => setAttachments((a) => [...a, url]));
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
            <div key={i} className="attach-chip">
              <img src={a} alt="" />
              <button className="attach-rm" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button>
            </div>
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
        <button className="icon-btn" title="添加图片（粘贴或点击）" onClick={() => fileRef.current?.click()}>
          <Icon name="image" />
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
              Array.from(files).forEach((f) => readFileAsDataUrl(f).then((url) => setAttachments((a) => [...a, url])));
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
          style={{ height: 'auto', minHeight: 44 }}
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

export function MessageMenu() {
  const [, force] = useState(0);
  const regenerateLast = useStore((s) => s.regenerateLast);
  const addToast = useStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<{ msg: ChatMessage; session: ChatSession } | null>(null);

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    msgMenuListeners.push(fn);
    return () => {
      msgMenuListeners = msgMenuListeners.filter((f) => f !== fn);
    };
  }, []);

  // 编辑 modal（独立于右键菜单状态）
  if (editing && editTarget) {
    return (
      <EditMessageModal
        msg={editTarget.msg}
        session={editTarget.session}
        onClose={() => {
          setEditing(false);
          setEditTarget(null);
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
        setEditTarget({ msg, session });
        closeMsgMenu();
        setEditing(true);
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
        const raw = buildRawLog(msg);
        const blob = new Blob([raw], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `raw-log-${msg.id}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        addToast('已导出原始日志（自动脱敏）');
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

function EditMessageModal({ msg, session, onClose }: { msg: ChatMessage; session: ChatSession; onClose: () => void }) {
  const [text, setText] = useState(msg.content);
  const editMessage = useStore((s) => s.editMessage);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 14 }}>编辑消息</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            <textarea className="textarea mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await editMessage(msg.id!, text, session.id!);
                onClose();
              }}
            >
              保存并重新生成
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ChatView;