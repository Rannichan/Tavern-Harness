import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store/store';
import type { ChatMessage, ChatParticipant, ChatSession, ToolCallRecord } from '../types/models';
import { Avatar, Icon, Markdown, Collapse, Modal, AttachCard } from './shared';
import { formatMetrics } from '../core/stats';
import { saveTextFile } from '../core/fileDownload';
import { effectiveDisplayQueue, initializeTurnQueue, speakerLabel } from '../core/turnLoop';
import { onChatScroll, registerChatEl, onQueueScroll, registerQueueEl, scrollChatTo, scrollQueueToLoop } from '../core/linkedScroll';
import { useT, translate } from '../core/i18n';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 从 dataUrl / URL 猜测一个可显示的文件名 */
function attachmentName(a: string): string {
  const attach = translate('common.attachment');
  if (a.startsWith('data:')) {
    const m = /^data:([^;]+);/.exec(a);
    const mime = m ? m[1] : '';
    const ext = mime.split('/')[1] || 'bin';
    return `${attach}.${ext}`;
  }
  try {
    const u = new URL(a);
    const name = u.pathname.split('/').pop();
    if (name) return decodeURIComponent(name);
  } catch {
    /* ignore */
  }
  return attach;
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
  const t = useT();

  useEffect(() => {
    const el = scrollRef.current;
    // 注册滚动容器，供「对话⇄队列」双向联动（registerChatEl 内部会重置抑制标志）
    registerChatEl(el);
    return () => registerChatEl(null); // 卸载时解除引用，避免跨会话联动到已卸载的容器
  }, []);

  // 自动滚动到底（新消息 / 流式更新时）：群聊流式生成时同样跟随最新内容
  const isGroup = session.mode === 'GROUP';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    // 群聊：仅在已处于底部或正在流式生成时自动吸附（流式画布增长时继续跟随），
    // 用户主动向上回看时不打断
    if (!isGroup || nearBottom || updateStreaming) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, updateStreaming, messages[messages.length - 1]?.content.length, isGroup]);

  const npcId = session.associatedId;
  const npc = useStore((s) => s.npcs.find((n) => n.id === npcId));

  return (
    <div className="chat-scroll" ref={scrollRef} onScroll={onChatScroll}>
      <div className="chat-col">
        {messages.length === 0 && (
          <div className="empty-state fade-up">
            <div className="big">🫖</div>
            <div>
              {session.mode === 'STANDARD' && <><b>{t('chat.emptyStandardTitle')}</b><br />{t('chat.emptyStandardSub')}</>}
              {session.mode === 'NPC' && <><b>{t('chat.emptyNpcTitle', { name: npc?.name ?? t('chat.speakerChar') })}</b><br />{npc?.greeting}</>}
              {session.mode === 'GROUP' && <><b>{t('chat.emptyGroupTitle')}</b><br />{t('chat.emptyGroupSub')}</>}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble 
            key={m.id} 
            msg={m} 
            session={session} 
            participants={participants} 
            loopIndex={isGroup ? (m.loopIndex ?? 0) : null}
            streaming={streaming && m.id === lastMsgId(messages)} />
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
  loopIndex,
}: {
  msg: ChatMessage;
  session: ChatSession;
  participants: ChatParticipant[];
  streaming: boolean;
  /** 群聊循环号（0 起）；非群聊为 null */
  loopIndex: number | null;
}) {
  const t = useT();
  // System 消息（/new 标记）
  if (msg.role === 'system') {
    return (
      <div className="sys-banner fade-up" data-loop={loopIndex ?? undefined}>⟐ {msg.content}</div>
    );
  }

  // 工具消息
  if (msg.role === 'tool') {
    const isError = msg.content.startsWith('ERROR:') || msg.content.startsWith('CANCELLED:');
    return (
      <div className="msg-row tool-row fade-up" data-loop={loopIndex ?? undefined} data-speaker={msg.speakerParticipantId != null ? String(msg.speakerParticipantId) : undefined}>
        <div className="msg-body">
          <div className={`tool-result ${isError ? 'err' : ''}`}>
            <Icon name={isError ? 'cancel' : 'check'} size={13} />
            <span className="mono">{msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}</span>
          </div>
        </div>
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
  const speakerName = msg.speakerName ?? (isUser ? t('common.user') : session.mode === 'NPC' ? t('chat.speakerChar') : t('chat.speakerAssistant'));
  const npcHue = speaker?.npcId ? useStore((s) => s.npcs.find((n) => n.id === speaker.npcId)?.avatarColorOrdinal ?? 0) : 0;
  const npcAvatar = speaker?.npcId ? useStore((s) => s.npcs.find((n) => n.id === speaker.npcId)?.avatarDataUrl ?? null) : null;

  if (isUser) {
    return <UserBubble msg={msg} session={session} editing={isEditing} loopIndex={loopIndex} />;
  }

  // 用于「点击队列发言 → 对话定位」：NPC 用 participantId，玩家/未知用 null（定位到循环首条）
  const speakerKey = msg.speakerParticipantId != null ? String(msg.speakerParticipantId) : null;

  // 群聊：NPC 发言的 @台词 高亮（斜体加粗 + 特殊颜色）
  const mentionNames = session.mode === 'GROUP'
    ? participants.filter((p) => p.participantId !== msg.speakerParticipantId).map((p) => p.displayName)
    : [];

  if (isEditing) {
    return (
      <div className="msg-row fade-up" data-loop={loopIndex ?? undefined} data-speaker={speakerKey ?? undefined}>
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
    <div
      className={`msg-row fade-up ${streaming ? 'streaming' : ''}`}
      data-loop={loopIndex ?? undefined}
      data-speaker={speakerKey ?? undefined}
      onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, msg, session); }}
    >
      <Avatar name={speakerName} colorOrdinal={npcHue} imageUrl={npcAvatar} />
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-name">{speakerName}</span>
          {msg.modelUsed && !msg.modelUsed.startsWith('scheduled:') && <span className="msg-model" title={msg.modelUsed}>{msg.modelUsed}</span>}
          <span className="msg-time">{fmtTime(msg.timestamp)}</span>
        </div>
        {msg.thinkingContent && streaming && (
          <Collapse title={t('chat.thinking')} icon="🧠" accent="think" preview={msg.thinkingContent} live>
            <Markdown text={msg.thinkingContent} mathEnabled={false} />
          </Collapse>
        )}
        {msg.thinkingContent && !streaming && (
          <Collapse title={t('chat.thinking')} icon="🧠" accent="think" defaultOpen={false} preview={msg.thinkingContent}>
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
                {msg.content ? <Markdown text={msg.content} mentionNames={mentionNames} /> : streaming && <span className="stream-cursor" />}
              </div>
              {/* 编辑按钮：位于正文气泡内最右侧，铅笔图标 */}
              <button className="msg-edit-btn" title={t('chat.editMsg')} onClick={() => startEditingMsg(msg.id!)}>
                <Icon name="pencil" size={13} />
              </button>
            </div>
          </div>
        )}
        {(msg.latencyMs != null || msg.promptTokens > 0 || msg.completionTokens > 0) && !streaming && (
          <div className="msg-metrics">{formatMetrics(msg)}</div>
        )}
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
  const t = useT();
  const [text, setText] = useState(msg.content);
  const [attachments, setAttachments] = useState<{ dataUrl: string; name: string }[]>(
    msg.attachments.map((a, i) => ({ dataUrl: a, name: msg.attachmentInfos?.[i]?.displayName || attachmentName(a) }))
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const editMessage = useStore((s) => s.editMessage);
  const saveMessageOnly = useStore((s) => s.saveMessageOnly);
  const streaming = useStore((s) => s.streaming.sessionId === session.id);
  // 玩家（user）消息：保存并重新生成；NPC（assistant）消息：仅保存、不触发生成
  const isUserMsg = msg.role === 'user';

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

  const doSaveOnly = async () => {
    if (!text.trim() || streaming) return;
    await saveMessageOnly(
      msg.id!,
      text,
      session.id!,
      attachments.map((a) => a.dataUrl),
      attachments.map((a) => a.name)
    );
    onDone();
  };

  // 主按钮动作：玩家 → 保存并重新生成；NPC → 仅保存
  const primaryAction = isUserMsg ? doSave : doSaveOnly;

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
            primaryAction();
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
            <Icon name="image" size={12} /> {t('chat.addAttachment')}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="bubble-editor-hint">{t('chat.saveHint')}</span>
          <button className="btn btn-sm" onClick={onDone}>{t('common.cancel')}</button>
          <button className="btn btn-sm btn-primary" disabled={!text.trim() || streaming} onClick={primaryAction}>
            {isUserMsg ? t('chat.saveRegenerate') : t('chat.saveOnly')}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ msg, session, editing, loopIndex }: { msg: ChatMessage; session: ChatSession; editing?: boolean; loopIndex?: number | null }) {
  const t = useT();
  const participants = useStore((s) => (session.id != null ? (s.participants[session.id] ?? []) : []));
  // 群聊中「用户消息」的 @角色名 也作为特殊指令高亮（点名）
  const mentionNames =
    session.mode === 'GROUP'
      ? participants.filter((p) => p.kind === 'NPC').map((p) => p.displayName)
      : [];
  return (
    <div className="msg-row user-row fade-up" data-loop={loopIndex ?? undefined} data-speaker="player" onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, msg, session); }}>
      <div className="avatar sm user-avatar">{t('common.me')}</div>
      <div className="msg-body">
        <div className="msg-head right">
          <span className="msg-time">{fmtTime(msg.timestamp)}</span>
          <span className="msg-name">{t('common.you')}</span>
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
                {msg.content && <Markdown text={msg.content} mentionNames={mentionNames} />}
              </div>
              <button className="msg-edit-btn" title={t('chat.editMsg')} onClick={() => startEditingMsg(msg.id!)}>
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
  const t = useT();
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
        <span className="tool-card-icon">{executing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '🔧'}</span>
        <span className="tool-card-name">{t('chat.toolCall', { name: tc.name })}</span>
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
  const t = useT();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ dataUrl: string; name: string }[]>([]);
  const [showCmd, setShowCmd] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    const sendingText = text.trim();
    const sendingAttachments = [...attachments];
    setText('');
    setAttachments([]);
    setShowCmd(false);
    setShowMention(false);
    setTyping(true);
    sendMessage(
      sendingText,
      sendingAttachments.map((a) => a.dataUrl),
      sendingAttachments.map((a) => a.name)
    ).finally(() => {
      setTyping(false);
    });
  };

  // 输入区 @ 自动补全（仅在群聊、且匹配到成员时展示；不支持 @自己）
  const sessionParticipants = useStore((s) => s.participants[sessionId] ?? []);
  const groupMembers = useMemo(() => {
    return sessionParticipants
      .filter((p) => p.kind === 'NPC')
      .map((p) => p.displayName)
      .sort((a, b) => a.length - b.length);
  }, [sessionParticipants]);
  const mentionCandidates = useMemo(() => {
    if (!showMention || session?.mode !== 'GROUP') return [];
    const q = mentionQuery.trim().toLowerCase();
    return groupMembers.filter((n) => !q || n.toLowerCase().includes(q));
  }, [showMention, mentionQuery, groupMembers, session?.mode]);
  const activeMentionIdx = useRef(0);

  const closeMention = () => {
    setShowMention(false);
    setMentionQuery('');
    activeMentionIdx.current = 0;
  };

  const applyMention = (name: string) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const pos = el.selectionStart ?? text.length;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const atIdx = before.lastIndexOf('@');
    const hasSpaceAfter = /^\s/.test(after);
    const suffix = hasSpaceAfter || after === '' ? '' : ' ';
    const next = before.slice(0, atIdx) + `@${name}` + suffix + after;
    setText(next);
    closeMention();
    requestAnimationFrame(() => {
      el.focus();
      const caret = before.slice(0, atIdx).length + name.length + 1 + suffix.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const detectMention = (value: string, caret: number) => {
    if (session?.mode !== 'GROUP') {
      setShowMention(false);
      return;
    }
    if (caret < 0 || caret > value.length) {
      setShowMention(false);
      return;
    }
    const before = value.slice(0, caret);
    const m = /(?:^|[^A-Za-z0-9_@])(@[\u4e00-\u9fa5A-Za-z0-9_]{0,30})$/.exec(before);
    if (!m) {
      setShowMention(false);
      return;
    }
    setMentionQuery(m[1].slice(1).toLowerCase());
    setShowMention(true);
    activeMentionIdx.current = 0;
  };

  // 拖放 / 粘贴附件
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0 && files[0].type.startsWith('image')) {
        e.preventDefault();
        const f = files[0];
        readFileAsDataUrl(f).then((url) => setAttachments((a) => [...a, { dataUrl: url, name: f.name || translate('chat.pasteImage', { ext: f.type.split('/')[1] || 'png' }) }]));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // 点击自动补全面板外部时关闭
  useEffect(() => {
    if (!showMention) return;
    const onDoc = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) closeMention();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showMention]);

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
              <span className="cmd-desc">{c === '/new' ? t('chat.cmdNew') : t('chat.cmdPass')}</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-box">
        {/* 模型选择器：输入框左侧，弹出列表（非弹窗） */}
        <div className="composer-model">
          <button
            className={`composer-model-btn ${showModels ? 'open' : ''}`}
            title={t('chat.selectModel')}
            onClick={() => setShowModels(!showModels)}
          >
            <span className="composer-model-label">{defaultModel || t('chat.chooseModel')}</span>
          </button>
          {showModels && (
            <ModelPickerPanel onClose={() => setShowModels(false)} />
          )}
        </div>
        <button
          className="icon-btn composer-attach"
          title={t('chat.attachTip')}
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
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              setShowCmd(v.startsWith('/') && !v.includes('\n'));
              detectMention(v, e.target.selectionStart ?? v.length);
            }}
            onKeyDown={(e) => {
              // @ 自动补全面板键盘导航
              if (showMention && mentionCandidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  activeMentionIdx.current = (activeMentionIdx.current + 1) % mentionCandidates.length;
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  activeMentionIdx.current = (activeMentionIdx.current - 1 + mentionCandidates.length) % mentionCandidates.length;
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  applyMention(mentionCandidates[activeMentionIdx.current]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeMention();
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                doSend();
              }
              if (e.key === 'Escape') {
                setShowCmd(false);
                setShowMention(false);
              }
            }}
            onClick={(e) => detectMention(text, e.currentTarget.selectionStart ?? text.length)}
            onKeyUp={(e) => detectMention(text, e.currentTarget.selectionStart ?? text.length)}
            placeholder={
              session?.mode === 'GROUP'
                ? t('chat.phGroup')
                : t('chat.phSingle')
            }
            rows={1}
            style={{ height: 'auto', minHeight: 38 }}
          />
          {showMention && mentionCandidates.length > 0 && (
            <div className="mention-pop" ref={mentionRef}>
              <div className="mention-pop-head">{t('chat.mentionHead')}</div>
              {mentionCandidates.map((n, i) => (
                <button
                  key={n}
                  className={`mention-item ${i === activeMentionIdx.current ? 'active' : ''}`}
                  onMouseEnter={() => { activeMentionIdx.current = i; }}
                  onClick={() => applyMention(n)}
                >
                  <span className="mention-item-at">@</span>
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
        {streaming ? (
          <button className="btn btn-primary btn-round" onClick={stopStreaming} title={t('chat.stopTip')}>
            <Icon name="stop" size={15} />
          </button>
        ) : (
          <button className="btn btn-primary btn-round" disabled={!canSend} onClick={doSend} title={t('chat.sendTip')}>
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
      <div className="composer-hint">
        <span>{t('chat.hintSend')}</span>
        <span className="composer-hint-right">{t('chat.hintMagic')}{session?.mode === 'GROUP' ? t('chat.hintMention') : ''}</span>
      </div>
    </div>
  );
}

/** 模型选择下拉列表（弹出在输入框左侧上方） */
function ModelPickerPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
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
        <span>{t('chat.selectModel')}</span>
        <button className="icon-btn" onClick={onClose} title={t('common.close')}><Icon name="x" size={12} /></button>
      </div>
      {models.length === 0 ? (
        <div className="model-popover-empty">
          {t('chat.modelEmpty')}
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
  const t = useT();
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
          const result = await saveTextFile(raw, 'text/plain', `raw-log-${rawLog.id}.txt`);
          if (result === 'canceled') {
            addToast(t('toast.exportCanceled'));
          } else {
            addToast(t('toast.rawExported'));
            setRawLog(null);
          }
        }}
      />
    );
  }

  if (!msgMenuState) return null;
  const { x, y, msg, session } = msgMenuState;

  const actions: Array<{ label: string; icon: string; onClick: () => void; danger?: boolean }> = [];
  if (msg.role === 'user' || msg.role === 'assistant') {
    actions.push({
      label: t('chat.editMsg'),
      icon: 'settings',
      onClick: () => {
        startEditingMsg(msg.id!);
      },
    });
  }
  if (msg.role === 'assistant') {
    actions.push({
      label: t('chat.regenerate'),
      icon: 'refresh',
      onClick: async () => {
        closeMsgMenu();
        await regenerateLast();
      },
    });
  }
  if (msg.rawRequestBody || msg.rawResponseBody) {
    actions.push({
      label: t('chat.viewRaw'),
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
        {actions.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-faint)' }}>{t('chat.noActions')}</div>}
      </div>
    </>
  );
}

/** 原始日志弹窗：将流式 SSE 分片拼装为完整回复 JSON，便于阅读 */
function RawLogModal({ msg, onClose, onExport }: { msg: ChatMessage; onClose: () => void; onExport: () => void }) {
  const t = useT();
  const req = msg.rawRequestBody ? prettyJson(msg.rawRequestBody) : '';
  const merged = assembleFullResponseJson(msg.rawResponseBody);

  const [tab, setTab] = useState<'request' | 'merged'>('request');

  return (
    <Modal onClose={onClose} width="min(760px, calc(100vw - 40px))">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="file" size={15} /> {t('chat.rawLogTitle', { id: msg.id ?? '' })}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="raw-tabs">
            <button className={`raw-tab ${tab === 'request' ? 'active' : ''}`} onClick={() => setTab('request')}>{t('chat.requestBody')}</button>
            <button className={`raw-tab ${tab === 'merged' ? 'active' : ''}`} onClick={() => setTab('merged')}>{t('chat.fullResponse')}</button>
          </div>
          <button className="btn btn-sm" onClick={onExport} title={t('chat.exportTip')}>
            <Icon name="download" size={12} /> {t('common.export')}
          </button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
      </div>
      <div className="modal-body" style={{ padding: 0 }}>
        {tab === 'request' && (
          <pre className="raw-pre mono">{req || t('chat.noRequestBody')}</pre>
        )}
        {tab === 'merged' && (
          merged ? (
            <div className="raw-merged">
              <div className="raw-merged-head">
                <span>{t('chat.fullResponseJson')}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('chat.fromSse')}</span>
              </div>
              <pre className="raw-pre mono">{JSON.stringify(merged, null, 2)}</pre>
            </div>
          ) : (
            <div className="raw-empty">{t('chat.noRawContent')}</div>
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

// ============================================================
// 发言队列面板（群聊右侧）：按循环展示完整发言顺序历史 + 实时指示正在发言者
// ============================================================

export function TurnQueuePanel({
  session,
  participants,
}: {
  session: ChatSession;
  participants: ChatParticipant[];
}) {
  // ⚠️ 保持 hooks 无条件执行：本组件在 App 中始终挂载，切换会话（群聊 ⇄ 单人）
  // 时若 hooks 数量变化会触发 “Rendered fewer hooks than expected” 导致整页白屏。
  // 因此把模式判断放在所有 hooks 之后，仅用返回 JSX 与否控制渲染。
  const t = useT();
  const byId = useMemo(() => new Map(participants.map((p) => [p.participantId, p])), [participants]);
  const npcs = useStore((s) => s.npcs);
  const streamingSessionId = useStore((s) => s.streaming.sessionId);
  // 订阅实时队列快照（每个回合推进 / 发言开始 / 玩家轮到都会更新）
  const live = useStore((s) => s.liveQueueBySession[session.id!]);
  // 展示历史：多个循环的完整顺序（发言过的角色不移除，新循环追加在历史后面）
  const loops = useMemo(() => {
    if (live) {
      return live.history.length > 0 ? live.history : [live.queue.length > 0 ? live.queue : initializeTurnQueue(participants, live.turnOrderMode)];
    }
    const fallback = effectiveDisplayQueue(session, participants);
    return [fallback];
  }, [live, session, participants]);

  const isStreamingThisSession = streamingSessionId === session.id;
  // 正在发言者 = 剩余队列队首（live.queue[0]；随发言推进而变化）且正在流式生成
  const liveQueue = live?.queue ?? effectiveDisplayQueue(session, participants);
  const currentId = liveQueue.length > 0 ? parseInt(liveQueue[0], 10) : null;
  const current = currentId != null ? byId.get(currentId) : null;
  const isCurrentPlaying = current != null && current.kind === 'NPC' && isStreamingThisSession;
  const currentSpeakingId = isCurrentPlaying ? String(currentId) : null;
  const loopLabel = (live?.loopIndex ?? session.loopIndex) + 1;

  // ---- 联动滚动：注册队列滚动容器，双向驱动由 linkedScroll 协调 ----
  const bodyRef = useRef<HTMLDivElement>(null);
  // 注册容器（registerQueueEl 内部重置抑制标志），body 只做注册，不含自驱动滚动
  const isGroup = session.mode === 'GROUP';
  useEffect(() => {
    // 仅群聊时注册队列滚动容器，避免非群聊下误注册/联动
    if (!isGroup) return;
    registerQueueEl(bodyRef.current);
    return () => registerQueueEl(null); // 卸载时解除引用
  }, [isGroup]);
  // 新循环加入（轮数变化）→ 队列自动滚到当前循环（底部对齐，整组可见）
  const loopsLen = loops.length;
  useEffect(() => {
    // 非群聊下不触发联动滚动
    if (!isGroup) return;
    if (loopsLen > 0) scrollQueueToLoop(loopLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopsLen, isGroup]);

  // 非群聊：不渲染发言队列（hooks 已无条件执行，只在这里返回空）
  if (!isGroup) return null;

  const handleQueueItemClick = (loopNum: number, speakerKey: string | null) => {
    scrollChatTo(loopNum - 1, speakerKey);
  };

  const renderLoop = (loopQueue: string[], loopNum: number) => {
    const isCurrent = loopNum === loopLabel;
    return (
      <div
        className="turn-queue-loop-group"
        key={loopNum}
        data-loop={loopNum - 1}
      >
        <div className="turn-queue-loop-head">
          <span>{t('chat.loop', { n: loopNum })}</span>
          {isCurrent && <span className="turn-queue-loop-cur">{t('chat.current')}</span>}
        </div>
        <ul className="turn-queue-list">
          {loopQueue.map((id, i) => {
            const p = byId.get(parseInt(id, 10));
            if (!p) return null;
            const isPlayer = p.kind === 'PLAYER';
            const npc = p.npcId ? npcs.find((n) => n.id === p.npcId) : undefined;
            const hue = npc?.avatarColorOrdinal ?? 0;
            const avatarUrl = npc?.avatarDataUrl ?? null;
            // 正在发言：仅当前循环中该角色 = 剩余队首（含思考阶段）
            const isSpeaking = isCurrent && id === currentSpeakingId;
            // 轮到玩家（且未在发言中）：队列首部 = 玩家 → 等待你
            const isWaitingPlayer = isCurrent && isPlayer && currentId != null && id === String(currentId);
            return (
              <li
                key={`${loopNum}-${id}`}
                className={`turn-queue-item ${isSpeaking ? 'active playing' : ''} ${isWaitingPlayer ? 'waiting-user' : ''}`}
                onClick={() => handleQueueItemClick(loopNum, isPlayer ? 'player' : id)}
                title={isPlayer ? t('chat.queueLocateSelf') : t('chat.queueLocateNpc', { name: speakerLabel(p) })}
              >
                {isSpeaking && <span className="turn-queue-badge">{t('chat.speaking')}</span>}
                {!isSpeaking && isWaitingPlayer && <span className="turn-queue-badge waiting">{t('chat.waitingYou')}</span>}
                {!isSpeaking && !isWaitingPlayer && <span className="turn-queue-idx">{i + 1}</span>}
                <Avatar name={speakerLabel(p)} colorOrdinal={hue} imageUrl={avatarUrl} size="xs" />
                <span className="turn-queue-name">{speakerLabel(p)}</span>
                {isPlayer && <span className="turn-queue-seat">{t('common.you')}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="turn-queue">
      <div className="turn-queue-head">
        <span>{t('chat.queueTitle')}</span>
        <span className="turn-queue-loop">{t('chat.queueLoops', { n: loops.length })}</span>
      </div>
      <div className="turn-queue-body" ref={bodyRef} onScroll={onQueueScroll}>
        {loops.map((loopQueue, idx) => renderLoop(loopQueue, idx + 1))}
      </div>
      <div className="turn-queue-foot">
        <span>{(live?.turnOrderMode ?? session.turnOrderMode) === 'RANDOM' ? t('chat.queueRandom') : t('chat.queueFixed')}</span>
      </div>
    </div>
  );
}

// ============================================================
// 群聊排队排序弹窗（固定顺序模式下的手工调整 / 随机切换）
// 使用 @dnd-kit/sortable 实现带平滑过渡动画的拖拽排序
// ============================================================

function SortItemBody({
  participant,
  index,
  npc,
}: {
  participant: ChatParticipant;
  index: number;
  npc?: { avatarColorOrdinal: number; avatarDataUrl?: string | null };
}) {
  const t = useT();
  return (
    <>
      <span className="sort-grip">⠿</span>
      <Avatar
        name={speakerLabel(participant)}
        colorOrdinal={npc?.avatarColorOrdinal ?? 0}
        imageUrl={npc?.avatarDataUrl ?? null}
        size="xs"
      />
      <span className="sort-name">{speakerLabel(participant)}</span>
      {participant.kind === 'PLAYER' && <span className="sort-tag">{t('common.you')}</span>}
      <span className="sort-idx">{index + 1}</span>
    </>
  );
}

function SortableItem({
  participant,
  index,
  npc,
}: {
  participant: ChatParticipant;
  index: number;
  npc?: { avatarColorOrdinal: number; avatarDataUrl?: string | null };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: participant.participantId,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sort-item ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <SortItemBody participant={participant} index={index} npc={npc} />
    </div>
  );
}

export function SortOrderModal({
  session,
  participants,
  onClose,
}: {
  session: ChatSession;
  participants: ChatParticipant[];
  onClose: () => void;
}) {
  const t = useT();
  const setTurnOrderMode = useStore((s) => s.setTurnOrderMode);
  const reorderParticipants = useStore((s) => s.reorderParticipants);
  const addToast = useStore((s) => s.addToast);
  const npcs = useStore((s) => s.npcs);
  const [mode, setMode] = useState<'PRESET' | 'RANDOM'>(session.turnOrderMode);
  // 排序列表始终以「参与者的预设座位顺序」为基准预览（随机模式下不可拖拽）
  const [order, setOrder] = useState<ChatParticipant[]>(() =>
    [...participants].sort((a, b) => a.seatOrder - b.seatOrder)
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const applyMode = async (m: 'PRESET' | 'RANDOM') => {
    setMode(m);
    if (m === 'PRESET') {
      await setTurnOrderMode(session.id!, 'PRESET');
      addToast(t('toast.fixedOrder'));
    } else {
      await setTurnOrderMode(session.id!, 'RANDOM');
      addToast(t('toast.randomOrder'));
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.findIndex((p) => p.participantId === active.id);
      const to = prev.findIndex((p) => p.participantId === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const onSave = async () => {
    await reorderParticipants(session.id!, order.map((p) => p.participantId));
    addToast(t('toast.orderSaved'));
    onClose();
  };

  return (
    <Modal onClose={onClose} width="min(440px, calc(100vw - 32px))">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>{t('chat.sortTitle')}</span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        {/* 顺序模式切换 */}
        <div className="seg">
          <button
            className={`seg-btn ${mode === 'PRESET' ? 'active' : ''}`}
            onClick={() => applyMode('PRESET')}
            title={t('chat.sortFixedTip')}
          >
            {t('chat.sortFixed')}
          </button>
          <button
            className={`seg-btn ${mode === 'RANDOM' ? 'active' : ''}`}
            onClick={() => applyMode('RANDOM')}
            title={t('chat.sortRandomTip')}
          >
            {t('chat.sortRandom')}
          </button>
        </div>
        <div className="sort-hint">
          {mode === 'PRESET' ? t('chat.sortHintFixed') : t('chat.sortHintRandom')}
        </div>
        {mode === 'PRESET' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={order.map((p) => p.participantId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="sort-list">
                {order.map((p, i) => {
                  const npc = p.npcId ? npcs.find((n) => n.id === p.npcId) : undefined;
                  return (
                    <SortableItem key={p.participantId} participant={p} index={i} npc={npc} />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="sort-list sort-list-locked">
            {order.map((p, i) => {
              const npc = p.npcId ? npcs.find((n) => n.id === p.npcId) : undefined;
              return (
                <div key={p.participantId} className="sort-item">
                  <SortItemBody participant={p} index={i} npc={npc} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={mode !== 'PRESET'} onClick={onSave}>{t('chat.saveOrder')}</button>
      </div>
    </Modal>
  );
}

export default ChatView;