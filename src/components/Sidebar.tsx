import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import { Icon, Modal, SessionVisual } from './shared';
import type { SessionMember } from './shared';
import type { ChatSession, NpcCharacter } from '../types/models';
import { NewSessionMenu } from './NewSessionMenu';
import { useT } from '../core/i18n';

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 520;

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const npcs = useStore((s) => s.npcs);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const activeView = useStore((s) => s.activeView);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const setActiveView = useStore((s) => s.setActiveView);
  const deleteSession = useStore((s) => s.deleteSession);
  const addToast = useStore((s) => s.addToast);
  const t = useT();

  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ChatSession | null>(null);
  const [query, setQuery] = useState('');
  // 搜索命中的会话 id 集合（null = 未在搜索中）
  const [searchHits, setSearchHits] = useState<Set<number> | null>(null);
  // 群聊会话 → 参与者中的 NPC 角色
  const [groupMembers, setGroupMembers] = useState<Record<number, NpcCharacter[]>>({});

  // 可拖拽侧边栏宽度
  const [sidebarW, setSidebarW] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('tav-sidebar-w') || '0');
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 356;
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-w', `${sidebarW}px`);
    localStorage.setItem('tav-sidebar-w', String(sidebarW));
  }, [sidebarW]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.startW + (e.clientX - d.startX)));
      setSidebarW(w);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.classList.remove('resizing');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const npcById = (id: number | null) => (id != null ? npcs.find((n) => n.id === id) : null);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const sid = confirmDelete.id!;
    await deleteSession(sid);
    addToast(t('toast.sessionDeleted'));
    setConfirmDelete(null);
  };

  // 搜索：标题 / 消息内容关键词匹配
  useEffect(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      setSearchHits(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // 标题匹配
      const titleHits = new Set(
        sessions.filter((s) => s.title.toLowerCase().includes(keyword)).map((s) => s.id!)
      );
      // 消息内容匹配（分页扫描，避免大结果集）
      const contentHits = new Set<number>();
      let offset = 0;
      const pageSize = 500;
      while (true) {
        const page = await db.messages.orderBy('timestamp').offset(offset).limit(pageSize).toArray();
        if (page.length === 0) break;
        for (const m of page) {
          const text = (m.content || '').toLowerCase();
          if (text.includes(keyword)) contentHits.add(m.sessionId);
        }
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      if (!cancelled) {
        const merged = new Set([...titleHits, ...contentHits]);
        setSearchHits(merged);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, sessions]);

  const visibleSessions = useMemo(() => {
    const list = [...sessions];
    if (searchHits != null) {
      return list.filter((s) => searchHits.has(s.id!));
    }
    return list;
  }, [sessions, searchHits]);

  const searching = searchHits != null;

  // 加载各群聊会话的参与角色（用于群头像拼贴，每个会话一次即可）
  useEffect(() => {
    const groupSessions = sessions.filter((s) => s.mode === 'GROUP');
    if (groupSessions.length === 0) return;
    let cancelled = false;
    (async () => {
      const loaded: Record<number, NpcCharacter[]> = {};
      await Promise.all(
        groupSessions.map(async (s) => {
          const parts = await db.participants.where('sessionId').equals(s.id!).toArray();
          const npcs1 = parts
            .filter((p) => p.kind === 'NPC' && p.npcId != null)
            .map((p) => npcs.find((n) => n.id === p.npcId))
            .filter((n): n is NpcCharacter => Boolean(n));
          loaded[s.id!] = npcs1;
        })
      );
      if (!cancelled) setGroupMembers(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, npcs]);

  const sessionMembers = (s: ChatSession): SessionMember[] | undefined =>
    (groupMembers[s.id!] ?? []).slice(0, 4).map((n) => ({
      name: n.name,
      colorOrdinal: n.avatarColorOrdinal,
      imageUrl: n.avatarDataUrl,
    }));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <div className="brand-logo">🫖</div>
          <div>
            <div className="brand-name">Tavern Harness</div>
            <div className="brand-sub">{t('nav.brandSub')}</div>
          </div>
        </div>
        <div className="side-nav" data-hscroll>
          <button className={`nav-chip ${activeView === 'chat' ? 'active' : ''}`} onClick={() => setActiveView('chat')}>
            <Icon name="send" size={13} /> {t('nav.chat')}
          </button>
          <button className={`nav-chip ${activeView === 'characters' ? 'active' : ''}`} onClick={() => setActiveView('characters')}>
            <Icon name="users" size={13} /> {t('nav.characters')}
          </button>
          <button className={`nav-chip ${activeView === 'stats' ? 'active' : ''}`} onClick={() => setActiveView('stats')}>
            <Icon name="trophy" size={13} /> {t('nav.achievements')}
          </button>
          <button className={`nav-chip ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}>
            <Icon name="settings" size={13} /> {t('nav.settings')}
          </button>
        </div>
      </div>

      <div className="session-list">
        {/* 会话列表头部：标题 + 新建对话按钮 */}
        <div className="session-list-head">
          <span className="section-title" style={{ margin: 0 }}>{t('nav.sessions')}</span>
          <button className="session-new-btn" onClick={() => setShowNew(true)} title={t('nav.newChatTitle')}>
            <Icon name="plus" size={13} /> {t('nav.newChat')}
          </button>
        </div>
        {visibleSessions.map((s) => {
          const npc = npcById(s.associatedId);
          return (
            <button
              key={s.id}
              className={`session-item ${s.id === activeSessionId && activeView === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveSession(s.id!)}
            >
              {s.mode === 'NPC' ? (
                <SessionVisual mode="NPC" npcName={npc?.name ?? 'NPC'} hue={npc?.avatarColorOrdinal ?? 0} imageUrl={npc?.avatarDataUrl} />
              ) : (
                <SessionVisual mode={s.mode} members={s.mode === 'GROUP' ? sessionMembers(s) : undefined} />
              )}
              <div className="smeta">
                <div className="stitle">{s.title}</div>
                <div className="sprev">{s.lastMessage || t('nav.newConversation')}</div>
              </div>
              <span
                className="sdel"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(s);
                }}
              >
                <Icon name="trash" size={13} />
              </span>
            </button>
          );
        })}
        {!searching && sessions.length === 0 && (
          <div className="empty-state" style={{ padding: 30 }}>
            <div className="big">🍺</div>
            <span>{t('nav.empty')}</span>
          </div>
        )}
        {searching && visibleSessions.length === 0 && (
          <div className="empty-state" style={{ padding: 30 }}>
            <div className="big">🔍</div>
            <span>{t('nav.noMatch')}</span>
          </div>
        )}
      </div>

      {/* 底部：搜索框 */}
      <div className="sidebar-search">
        <input
          className="input search-input"
          type="text"
          placeholder={t('nav.searchPh')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} title={t('common.clear')}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      {showNew && <NewSessionMenu onClose={() => setShowNew(false)} />}

      {/* 删除会话确认弹窗 */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} width="min(400px, calc(100vw - 32px))">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="trash" size={15} /> {t('nav.deleteSession')}
            </span>
            <button className="icon-btn" onClick={() => setConfirmDelete(null)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              {t('nav.deleteSessionConfirm', { title: confirmDelete.title })}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
            <button className="btn btn-danger" onClick={handleDelete}>
              <Icon name="trash" size={13} /> {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}

      {/* 拖拽手柄：调整侧边栏宽度 */}
      <div
        className="sidebar-resizer"
        title={t('nav.resize')}
        onMouseDown={(e) => {
          dragRef.current = { startX: e.clientX, startW: sidebarW };
          document.body.classList.add('resizing');
        }}
      />
    </aside>
  );
}

// 重新导出类型（供 App 使用）
export type { ChatSession };