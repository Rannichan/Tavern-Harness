import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Modifier,
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
import { useStore, createSession } from '../store/store';
import { Avatar, Icon, Modal } from './shared';
import { useT } from '../core/i18n';
import { db } from '../db/database';
import type { ChatSession } from '../types/models';

// ============================================================
// 新建对话弹窗（侧边栏「新建」与仪表盘「新建对话」共用）
// ============================================================

/** 拖拽约束：只允许上下拖动，且不超出排序列表（表单）的垂直范围。
 *  替代官方 @dnd-kit/modifiers（未安装），语义等同
 *  restrictToVerticalAxis + restrictToParentElement。 */
const restrictToSortList: Modifier = ({ transform, activeNodeRect, containerNodeRect }) => {
  let { x, y } = transform;
  x = 0;
  if (activeNodeRect && containerNodeRect) {
    const containerTop = containerNodeRect.top - activeNodeRect.top;
    const containerBottom = containerNodeRect.bottom - activeNodeRect.bottom;
    y = Math.min(Math.max(y, containerTop), containerBottom);
  }
  return { ...transform, x, y };
};

export function NewSessionMenu({ onClose, editingSession }: { onClose: () => void; editingSession?: ChatSession | null }) {
  const npcs = useStore((s) => s.npcs);
  const worldBooks = useStore((s) => s.worldBooks);
  const addToast = useStore((s) => s.addToast);
  const updateSessionSettings = useStore((s) => s.updateSessionSettings);
  const t = useT();
  const isEditing = Boolean(editingSession?.id);

  const [participantOrder, setParticipantOrder] = useState<number[]>([-1]);
  const [title, setTitle] = useState(editingSession?.title ?? '');
  const [userPersonaNpcId, setUserPersonaNpcId] = useState<number | null>(editingSession?.userPersonaNpcId ?? null);
  const [worldBookId, setWorldBookId] = useState<number | null>(editingSession?.worldBookId ?? null);
  const [turnOrderMode, setTurnOrderMode] = useState<'PRESET' | 'RANDOM'>(editingSession?.turnOrderMode ?? 'PRESET');
  const [enableGreeting, setEnableGreeting] = useState(editingSession?.enableGreeting !== false);
  const selectedNpcIds = participantOrder.filter((id) => id !== -1);
  const modeLabel = selectedNpcIds.length === 0 ? t('newSession.notSelected') : selectedNpcIds.length === 1 ? t('newSession.npcChat') : t('newSession.groupChat', { n: selectedNpcIds.length });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!editingSession?.id) return;
    let cancelled = false;
    (async () => {
      const participants = (await db.participants.where('sessionId').equals(editingSession.id!).toArray()).sort((a, b) => a.seatOrder - b.seatOrder);
      if (!cancelled) {
        setTitle(editingSession.title);
        setUserPersonaNpcId(editingSession.userPersonaNpcId ?? null);
        setWorldBookId(editingSession.worldBookId ?? null);
        setTurnOrderMode(editingSession.turnOrderMode);
        setEnableGreeting(editingSession.enableGreeting !== false);
        setParticipantOrder(participants.map((p) => p.participantId));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingSession?.id]);

  const create = async () => {
    if (selectedNpcIds.length === 0) {
      addToast(t('toast.pickOneNpc'), 'error');
      return;
    }
    const finalTitle = title.trim() || selectedNpcIds.map((id) => npcs.find((n) => n.id === id)?.name).filter(Boolean).join('、');
    if (isEditing && editingSession?.id) {
      await updateSessionSettings(editingSession.id, {
        title: finalTitle,
        npcIds: selectedNpcIds,
        worldBookId,
        userPersonaNpcId,
        turnOrderMode,
        participantOrder,
        enableGreeting,
      });
      await useStore.getState().refreshSessions();
      useStore.getState().setActiveSession(editingSession.id);
      addToast(t('toast.sessionUpdated'));
      onClose();
      return;
    }
    let sid: number;
    if (selectedNpcIds.length === 1) {
      sid = await createSession('NPC', {
        associatedId: selectedNpcIds[0],
        title: finalTitle,
        worldBookId,
        userPersonaNpcId,
        turnOrderMode,
        participantOrder,
        enableGreeting,
      });
    } else {
      sid = await createSession('GROUP', {
        npcIds: selectedNpcIds,
        title: finalTitle,
        worldBookId,
        userPersonaNpcId,
        turnOrderMode,
        participantOrder,
        enableGreeting,
      });
    }
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
    onClose();
  };

  const addParticipant = (npcId: number) => {
    if (selectedNpcIds.includes(npcId)) {
      addToast(t('toast.dupNpc'), 'error');
      return;
    }
    if (selectedNpcIds.length >= 5) return;
    setParticipantOrder((prev) => [...prev, npcId]);
  };
  const removeParticipant = (npcId: number) => {
    setParticipantOrder((prev) => prev.filter((id) => id !== npcId));
  };
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setParticipantOrder((prev) => {
      const from = prev.findIndex((id) => id === active.id);
      const to = prev.findIndex((id) => id === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const canCreate = selectedNpcIds.length > 0;

  return (
    <Modal onClose={onClose} width={460} className="new-session-modal">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>{isEditing ? t('nav.editSession') : t('newSession.title')}</span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 标题 */}
        <div className="field">
          <label>{t('newSession.name')}</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder={selectedNpcIds.length > 0 ? selectedNpcIds.map((id) => npcs.find((n) => n.id === id)?.name).join('、') : t('newSession.unnamed')}
          />
        </div>

        {/* 参与者与顺序 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label className="new-session-section-label">{t('newSession.participants')}</label>
            <span className="tag">{modeLabel}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToSortList]} onDragEnd={onDragEnd}>
              <SortableContext items={participantOrder} strategy={verticalListSortingStrategy}>
                <div className="sort-list">
                  {participantOrder.map((id, index) => {
                    const npc = id === -1 ? null : npcs.find((n) => n.id === id) ?? null;
                    return (
                      <ParticipantSortItem
                        key={id}
                        participantId={id}
                        index={index}
                        name={id === -1 ? t('common.user') : npc?.name ?? t('newSession.notSelected')}
                        avatarColorOrdinal={npc?.avatarColorOrdinal ?? 0}
                        avatarDataUrl={npc?.avatarDataUrl ?? null}
                        removable={id !== -1}
                        onRemove={() => removeParticipant(id)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
            {npcs.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--warn)', background: 'var(--warn-soft)', padding: '8px 12px', borderRadius: 9 }}>
                {t('newSession.noNpcWarn')}
              </div>
            ) : (
              selectedNpcIds.length < 5 && <SlotPicker excluded={selectedNpcIds} onPick={addParticipant} />
            )}
            {selectedNpcIds.length >= 2 && (
              <div className="new-session-random-row">
                <div className="field" style={{ gap: 3 }}>
                  <label>{t('chat.sortRandom')}</label>
                  <span className="field-hint">{t('newSession.orderHint')}</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={turnOrderMode === 'RANDOM'}
                    onChange={(e) => setTurnOrderMode(e.target.checked ? 'RANDOM' : 'PRESET')}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            )}
            <div className="new-session-random-row">
              <div className="field" style={{ gap: 3 }}>
                <label>{t('newSession.greeting')}</label>
                <span className="field-hint">{t('newSession.greetingHint')}</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={enableGreeting}
                  onChange={(e) => setEnableGreeting(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
            </div>
          </div>
        </div>

        {/* 用户人设 */}
        <div className="field">
          <label>{t('newSession.persona')}</label>
          <select className="select" value={userPersonaNpcId ?? ''} onChange={(e) => setUserPersonaNpcId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('newSession.noPersona')}</option>
            {npcs.filter((n) => n.id != null && !selectedNpcIds.includes(n.id!)).map((n) => (
              <option key={n.id} value={n.id!}>{n.name}</option>
            ))}
          </select>
        </div>

        {/* Lorebook */}
        <div className="field">
          <label>{t('newSession.worldbook')}</label>
          <select className="select" value={worldBookId ?? ''} onChange={(e) => setWorldBookId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('newSession.noWorldbook')}</option>
            {worldBooks.map((b) => (
              <option key={b.id} value={b.id!}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!canCreate} onClick={create}>{isEditing ? t('common.save') : t('common.ok')}</button>
      </div>
    </Modal>
  );
}

function ParticipantSortItem({
  participantId,
  index,
  name,
  avatarColorOrdinal,
  avatarDataUrl,
  removable,
  onRemove,
}: {
  participantId: number;
  index: number;
  name: string;
  avatarColorOrdinal: number;
  avatarDataUrl: string | null;
  removable: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: participantId });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : undefined,
        position: 'relative',
      }}
      className={`sort-item ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <span className="sort-grip">⠿</span>
      <Avatar name={name} colorOrdinal={avatarColorOrdinal} imageUrl={avatarDataUrl} size="xs" />
      <span className="sort-name">{name}</span>
      {!removable && <span className="sort-tag">{t('common.you')}</span>}
      <span className="sort-idx">{index + 1}</span>
      {removable && (
        <button className="npc-slot-x" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="x" size={11} />
        </button>
      )}
    </div>
  );
}

/** 角色的「+」添加按钮：点击后弹出角色选择（内联小列表） */
function SlotPicker({ excluded, onPick }: { excluded: number[]; onPick: (npcId: number) => void }) {
  const npcs = useStore((s) => s.npcs);
  const t = useT();
  const [open, setOpen] = useState(false);
  const available = npcs.filter((n) => n.id != null && !excluded.includes(n.id!));

  if (available.length === 0) return null;
  return (
    <div className="slot-picker">
      <button
        className="npc-slot-add"
        title={t('newSession.addCharTip')}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        + {t('newSession.addCharTip')}
      </button>
      {open && (
        <div className="slot-picker-menu card">
          {available.map((n) => (
            <button key={n.id} className="slot-picker-item" onClick={() => { onPick(n.id!); setOpen(false); }}>
              <Avatar name={n.name} colorOrdinal={n.avatarColorOrdinal} imageUrl={n.avatarDataUrl} size="xs" />
              <span>{n.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}