import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import { Icon, Modal, SessionVisual } from './shared';
import type { SessionMember } from './shared';
import type { ChatSession, NpcCharacter } from '../types/models';
import { NewSessionMenu } from './NewSessionMenu';
import { useT } from '../core/i18n';
import { useTouchLongPress } from '../core/longPress';
import { fixedViewportPoint } from '../core/viewport';
import { useHasUnseenVersion } from '../core/version';
import { PopoverMenu } from './PopoverMenu';
import { unlockAchievement } from '../core/achievements';

const SIDEBAR_MIN = 240;
const SHAREHOLDER_CLICK_COUNT = 5;
const SHAREHOLDER_CLICK_WINDOW_MS = 5_000;
const SIDEBAR_MAX = 520;

function FadeOverflowText({ className, children, ...props }: ComponentPropsWithoutRef<'span'> & { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const updateOverflow = () => setOverflowing(element.scrollWidth > element.clientWidth);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);

  return <span ref={ref} className={`${className ?? ''}${overflowing ? ' has-overflow' : ''}`} {...props}>{children}</span>;
}

/** 触发 App 级全局游戏导出弹窗（会话右键菜单共用） */
function openGlobalGameplayExport(sessionId: number, includeHistory: boolean) {
  window.dispatchEvent(
    new CustomEvent('th-gameplay-export', { detail: { sessionId, includeHistory } })
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sessions = useStore((s) => s.sessions);
  const npcs = useStore((s) => s.npcs);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const activeView = useStore((s) => s.activeView);
  const streamingSessionId = useStore((s) => s.streaming.sessionId);
  const activitySessionIds = useStore((s) => s.activitySessionIds);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const setActiveView = useStore((s) => s.setActiveView);
  const deleteSession = useStore((s) => s.deleteSession);
  const togglePin = useStore((s) => s.togglePin);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const hasUnseenVersion = useHasUnseenVersion();

  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ChatSession | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [editTarget, setEditTarget] = useState<ChatSession | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{ session: ChatSession; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [appUrl, setAppUrl] = useState(() => window.location.href);
  // 搜索命中的会话 id 集合（null = 未在搜索中）
  const [searchHits, setSearchHits] = useState<Set<number> | null>(null);
  // 群聊会话 → 参与者中的 NPC 角色
  const [groupMembers, setGroupMembers] = useState<Record<number, NpcCharacter[]>>({});
  const sessionLongPressTarget = useRef<ChatSession | null>(null);
  const homeClickTimes = useRef<number[]>([]);
  const sessionLongPressProps = useTouchLongPress(
    (point) => {
      const session = sessionLongPressTarget.current;
      if (session) setSessionMenu({ session, ...fixedViewportPoint(point) });
    },
    (event) => {
      // 键盘 / 触屏补发的 contextmenu 未必经过 pointerdown，用行上记录的 id 兜底。
      const id = Number(event.currentTarget.dataset.sessionId);
      const session = (Number.isFinite(id) ? sessions.find((item) => item.id === id) : null)
        ?? sessionLongPressTarget.current;
      if (session) setSessionMenu({ session, ...fixedViewportPoint({ x: event.clientX, y: event.clientY }) });
    },
  );

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
    let cancelled = false;
    const updateAppUrl = async () => {
      try {
        const response = await fetch('/api-v2/lan-address', { cache: 'no-store' });
        const { url } = await response.json() as { url?: string | null };
        if (!cancelled) setAppUrl(url || window.location.href);
      } catch {
        if (!cancelled) setAppUrl(window.location.href);
      }
    };
    void updateAppUrl();
    window.addEventListener('popstate', updateAppUrl);
    window.addEventListener('hashchange', updateAppUrl);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', updateAppUrl);
      window.removeEventListener('hashchange', updateAppUrl);
    };
  }, []);

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

  useEffect(() => {
    const isMobile = () => window.matchMedia('(max-width: 680px)').matches;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onTouchStart = (event: TouchEvent) => {
      if (!isMobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const startedInSidebar = sidebarRef.current?.contains(event.target as Node) ?? false;
      if (!mobileOpen && touch.clientX > 24) return;
      if (mobileOpen && !startedInSidebar) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking || !isMobile() || event.changedTouches.length !== 1) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      if (!mobileOpen && deltaX > 0) setMobileOpen(true);
      if (mobileOpen && deltaX < 0) setMobileOpen(false);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [mobileOpen]);

  const npcById = (id: number | null) => (id != null ? npcs.find((n) => n.id === id) : null);

  const handleDelete = async () => {
    if (!confirmDelete || deletingSession) return;
    setDeletingSession(true);
    try {
      await deleteSession(confirmDelete.id!);
      addToast(t('toast.sessionDeleted'));
      setConfirmDelete(null);
    } catch (error) {
      addToast(t('toast.sessionDeleteFailed', { msg: (error as Error).message }), 'error');
    } finally {
      setDeletingSession(false);
    }
  };

  const openEdit = (session: ChatSession) => {
    setSessionMenu(null);
    setEditTarget(session);
  };

  useEffect(() => {
    if (!sessionMenu && !editTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionMenu(null);
        setEditTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionMenu, editTarget]);

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

  const returnHome = () => {
    setMobileOpen(false);
    const now = Date.now();
    homeClickTimes.current = [...homeClickTimes.current, now]
      .filter((time) => now - time <= SHAREHOLDER_CLICK_WINDOW_MS)
      .slice(-SHAREHOLDER_CLICK_COUNT);
    if (homeClickTimes.current.length === SHAREHOLDER_CLICK_COUNT) {
      homeClickTimes.current = [];
      void unlockAchievement('th-shareholder').then(() => useStore.getState().refreshAchievements());
    }
    setActiveSession(null);
    setActiveView('chat');
  };

  return (
    <>
      <div className="mobile-topbar">
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-label={mobileOpen ? t('common.close') : t('nav.sessions')}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <Icon name={mobileOpen ? 'x' : 'menu'} size={22} />
        </button>
        <nav className="mobile-topbar-nav" data-hscroll aria-label={t('nav.chat')}>
          <button
            className="mobile-home-button"
            type="button"
            title={t('nav.home')}
            aria-label={t('nav.home')}
            onClick={returnHome}
          >
            <img src="/tavern-harness-logo.png" alt="" />
          </button>
          <button className={`nav-chip ${activeView === 'chat' ? 'active' : ''}`} onClick={() => { setActiveView('chat'); setMobileOpen(false); }}>
            <Icon name="send" size={15} /> <span>{t('nav.chat')}</span>
          </button>
          <button className={`nav-chip ${activeView === 'characters' ? 'active' : ''}`} onClick={() => { setActiveView('characters'); setMobileOpen(false); }}>
            <Icon name="users" size={15} /> <span>{t('nav.characters')}</span>
          </button>
          <button className={`nav-chip ${activeView === 'stats' ? 'active' : ''}`} onClick={() => { setActiveView('stats'); setMobileOpen(false); }}>
            <Icon name="trophy" size={15} /> <span>{t('nav.achievements')}</span>
          </button>
          <button className={`nav-chip ${activeView === 'settings' ? 'active' : ''}`} onClick={() => { setActiveView('settings'); setMobileOpen(false); }}>
            <Icon name="settings" size={15} /> <span>{t('nav.settings')}</span>
            {hasUnseenVersion && <span className="unseen-dot" title={t('changelog.unseen')} />}
          </button>
        </nav>
      </div>
      {mobileOpen && <button className="mobile-sidebar-backdrop" type="button" aria-label={t('common.close')} onClick={() => setMobileOpen(false)} />}
      <aside ref={sidebarRef} className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-head">
        <div
          className="brand"
          role="button"
          tabIndex={0}
          title={t('nav.home')}
          onClick={returnHome}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              returnHome();
            }
          }}
        >
          <div className="brand-logo">
            <img src="/tavern-harness-logo.png" alt="Tavern Harness" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          </div>
          <div className="brand-copy">
            <div className="brand-name">Tavern Harness</div>
            <div className="brand-sub">{t('nav.brandSub')}</div>
          </div>
          <div className="brand-qr" title={t('nav.qrHint')}>
            <QRCodeSVG value={appUrl} size={52} level="H" includeMargin={false} fgColor="var(--primary)" bgColor="transparent" />
            <span className="brand-qr-icon"><Icon name="phone" size={9} /></span>
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
            {hasUnseenVersion && <span className="unseen-dot" title={t('changelog.unseen')} />}
          </button>
        </div>
      </div>

<div className="session-section">
        {/* 会话列表头部：标题 + 新建按钮（固定不滚动） */}
        <div className="session-list-head">
          <span className="section-title" style={{ margin: 0 }}>{t('nav.sessions')}</span>
          <div className="session-head-actions">
            <button
              className="session-new-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('th-gameplay-import'))}
              title={t('nav.importGameplayTitle')}
            >
              <Icon name="import" size={13} /> {t('nav.importGameplay')}
            </button>
            <button className="session-new-btn" onClick={() => setShowNew(true)} title={t('nav.newChatTitle')}>
              <Icon name="plus" size={13} /> {t('nav.newChat')}
            </button>
          </div>
        </div>
        {/* 可滚动的会话列表 */}
        <div className="session-list">
        {visibleSessions.map((s) => {
          const npc = npcById(s.associatedId);
          const hasActivity = streamingSessionId === s.id || Boolean(activitySessionIds[s.id!]);
          return (
            <button
              key={s.id}
              className={`session-item ${s.id === activeSessionId && activeView === 'chat' ? 'active' : ''}`}
              data-session-id={s.id}
              onClick={() => {
                setActiveSession(s.id!);
                setMobileOpen(false);
              }}
              onPointerDown={(event) => {
                sessionLongPressTarget.current = s;
                sessionLongPressProps.onPointerDown(event);
              }}
              onPointerMove={sessionLongPressProps.onPointerMove}
              onPointerUp={sessionLongPressProps.onPointerUp}
              onPointerCancel={sessionLongPressProps.onPointerCancel}
              onClickCapture={sessionLongPressProps.onClickCapture}
              onContextMenu={sessionLongPressProps.onContextMenu}
            >
              {s.mode === 'NPC' ? (
                <SessionVisual mode="NPC" npcName={npc?.name ?? 'NPC'} hue={npc?.avatarColorOrdinal ?? 0} imageUrl={npc?.avatarDataUrl} />
              ) : (
                <SessionVisual mode={s.mode} members={s.mode === 'GROUP' ? sessionMembers(s) : undefined} />
              )}
              <div className="smeta">
                <div className="stitle">
                  {!!(s as { pinned?: unknown }).pinned && (
                    <span className="spinned" title={t('nav.pinSession')}><Icon name="pin" size={11} /></span>
                  )}
                  <FadeOverflowText className="stitle-text">{s.title}</FadeOverflowText>
                  {hasActivity && <span className="session-activity-dot" aria-label={t('nav.sessionActive')} />}
                </div>
                <FadeOverflowText className="sprev">{s.lastMessage || t('nav.newConversation')}</FadeOverflowText>
              </div>
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
      {editTarget && <NewSessionMenu editingSession={editTarget} onClose={() => setEditTarget(null)} />}

      {sessionMenu &&
        createPortal(
          <PopoverMenu
            key={`${sessionMenu.x}:${sessionMenu.y}:${sessionMenu.session.id ?? ''}`}
            point={sessionMenu}
            onClose={() => setSessionMenu(null)}
          >
            <button className="msg-menu-item" onClick={() => openEdit(sessionMenu.session)}>
              <Icon name="pencil" size={13} /> {t('nav.editSession')}
            </button>
            <button
              className="msg-menu-item"
              onClick={async () => {
                await togglePin(sessionMenu.session.id!);
                setSessionMenu(null);
                addToast(
                  (sessionMenu.session as { pinned?: unknown }).pinned
                    ? t('toast.sessionUnpinned')
                    : t('toast.sessionPinned')
                );
              }}
            >
              <Icon name="pin" size={13} /> {(sessionMenu.session as { pinned?: unknown }).pinned ? t('nav.unpinSession') : t('nav.pinSession')}
            </button>
            <button
              className="msg-menu-item"
              onClick={() => {
                const target = sessionMenu.session;
                setSessionMenu(null);
                openGlobalGameplayExport(target.id!, true);
              }}
            >
              <Icon name="share" size={13} /> {t('nav.exportGameplay')}
            </button>
            <button
              className="msg-menu-item danger"
              onClick={() => {
                setConfirmDelete(sessionMenu.session);
                setSessionMenu(null);
              }}
            >
              <Icon name="trash" size={13} /> {t('nav.deleteSession')}
            </button>
          </PopoverMenu>,
          document.body
        )}

      {/* 删除会话确认弹窗 */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} size="compact">
          <div className="modal-head">
            <span className="typo-dialog-title dialog-title-inline">
              <Icon name="trash" size={15} /> {t('nav.deleteSession')}
            </span>
            <button className="icon-btn" onClick={() => setConfirmDelete(null)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            <div className="sidebar-import-description">
              {t('nav.deleteSessionConfirm', { title: confirmDelete.title })}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
            <button className="btn btn-danger" disabled={deletingSession} onClick={handleDelete}>
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
    </>
  );
}