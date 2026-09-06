import { useState } from 'react';
import { useStore, createSession } from '../store/store';
import { Avatar, Icon, Modal } from './shared';
import { useT } from '../core/i18n';

// ============================================================
// 新建对话弹窗（侧边栏「新建」与仪表盘「新建对话」共用）
// ============================================================

export function NewSessionMenu({ onClose }: { onClose: () => void }) {
  const npcs = useStore((s) => s.npcs);
  const worldBooks = useStore((s) => s.worldBooks);
  const addToast = useStore((s) => s.addToast);
  const t = useT();

  // 最多 5 个角色槽位（1 = NPC 对话；2-5 = 群聊）；初始为空，通过「+」添加
  const [slots, setSlots] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [userPersonaNpcId, setUserPersonaNpcId] = useState<number | null>(null);
  const [worldBookId, setWorldBookId] = useState<number | null>(null);

  const modeLabel = slots.length === 0 ? t('newSession.notSelected') : slots.length === 1 ? t('newSession.npcChat') : t('newSession.groupChat', { n: slots.length });

  const create = async () => {
    if (slots.length === 0) {
      addToast(t('toast.pickOneNpc'), 'error');
      return;
    }
    const finalTitle = title.trim() || slots.map((id) => npcs.find((n) => n.id === id)?.name).filter(Boolean).join('、');
    let sid: number;
    if (slots.length === 1) {
      sid = await createSession('NPC', {
        associatedId: slots[0],
        title: finalTitle,
        worldBookId,
        userPersonaNpcId,
      });
    } else {
      sid = await createSession('GROUP', {
        npcIds: slots,
        title: finalTitle,
        worldBookId,
        userPersonaNpcId,
      });
    }
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
    onClose();
  };

  const addSlot = () => {
    if (slots.length < 5) setSlots([...slots, 0]);
  };
  const setSlot = (idx: number, npcId: number) => {
    // 不允许重复选择
    const others = slots.filter((_, i) => i !== idx);
    if (others.includes(npcId)) {
      addToast(t('toast.dupNpc'), 'error');
      return;
    }
    const next = [...slots];
    next[idx] = npcId;
    setSlots(next);
  };
  const removeSlot = (idx: number) => {
    setSlots(slots.filter((_, i) => i !== idx));
  };

  const canCreate = slots.length > 0;

  return (
    <Modal onClose={onClose} width={460}>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>{t('newSession.title')}</span>
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
            placeholder={slots.length > 0 ? slots.map((id) => npcs.find((n) => n.id === id)?.name).join('、') : t('newSession.unnamed')}
          />
        </div>

        {/* 角色槽位：仅展示已选角色 + 加号按钮（缺省选择器由加号替代） */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 0.3 }}>{t('newSession.participants')}</label>
            <span className="tag">{modeLabel}</span>
          </div>
          {npcs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--warn)', background: 'var(--warn-soft)', padding: '8px 12px', borderRadius: 9 }}>
              {t('newSession.noNpcWarn')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {slots.map((id, i) => {
                const npc = npcs.find((n) => n.id === id);
                return (
                  <div key={i} className="npc-slot">
                    <Avatar name={npc?.name ?? '?'} colorOrdinal={npc?.avatarColorOrdinal ?? 0} imageUrl={npc?.avatarDataUrl} size="sm" />
                    <span className="npc-slot-name">{npc?.name ?? t('newSession.notSelected')}</span>
                    <button className="npc-slot-x" onClick={() => removeSlot(i)}><Icon name="x" size={11} /></button>
                  </div>
                );
              })}
              {slots.length < 5 && (
                <SlotPicker
                  excluded={slots}
                  onPick={(npcId) => {
                    const idx = slots.indexOf(0);
                    if (idx >= 0) setSlot(idx, npcId);
                    else setSlot(slots.length, npcId);
                  }}
                />
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>
            {t('newSession.addHint')}
          </div>
        </div>

        {/* 用户人设 */}
        <div className="field">
          <label>{t('newSession.persona')}</label>
          <select className="select" value={userPersonaNpcId ?? ''} onChange={(e) => setUserPersonaNpcId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('newSession.noPersona')}</option>
            {npcs.filter((n) => n.id != null && !slots.includes(n.id!)).map((n) => (
              <option key={n.id} value={n.id!}>{n.name}</option>
            ))}
          </select>
        </div>

        {/* 世界书 */}
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
        <button className="btn btn-primary" disabled={!canCreate} onClick={create}>{t('common.ok')}</button>
      </div>
    </Modal>
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
        ＋
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