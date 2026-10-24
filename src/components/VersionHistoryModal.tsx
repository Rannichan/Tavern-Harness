import { useEffect } from 'react';
import { CHANGELOG, compareUrl, entryGroups, type ChangelogEntry, type ChangelogGroup } from '../core/changelog';
import { currentLanguage, useT } from '../core/i18n';
import { APP_VERSION, markVersionSeen } from '../core/version';
import { Icon, Modal } from './shared';

// ============================================================
// 版本记录弹窗（设置 → 关于）
// ============================================================

/** 行内格式：只支持 `code` 与 **强调**，不引入完整 Markdown 渲染 */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function GroupList({ group }: { group: ChangelogGroup }) {
  const t = useT();
  const items = (
    <ul>
      {group.items.map((item, index) => (
        <li key={index}>
          <InlineText text={item} />
        </li>
      ))}
    </ul>
  );

  if (group.kind === 'internal') {
    return (
      <details className="changelog-group changelog-internal">
        <summary>{t('changelog.internal')}</summary>
        {items}
      </details>
    );
  }

  return (
    <section className="changelog-group">
      <h4>{t(`changelog.${group.kind}`)}</h4>
      {items}
    </section>
  );
}

function Entry({ entry, isCurrent }: { entry: ChangelogEntry; isCurrent: boolean }) {
  const t = useT();
  const groups = entryGroups(entry, currentLanguage());
  return (
    <article className={`changelog-entry ${isCurrent ? 'current' : ''}`}>
      <header className="changelog-entry-head">
        <h3>v{entry.version}</h3>
        <time dateTime={entry.date}>{entry.date}</time>
        <span className="changelog-flags">
          {isCurrent && <span className="changelog-flag">{t('changelog.currentTag')}</span>}
          {entry.breaking && <span className="changelog-flag breaking">{t('changelog.breaking')}</span>}
        </span>
      </header>
      {groups.map((group) => (
        <GroupList key={group.kind} group={group} />
      ))}
      <a
        className="changelog-compare"
        href={compareUrl(entry)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {entry.compare ?? `v${entry.version}`} ↗
      </a>
    </article>
  );
}

export function VersionHistoryModal({ onClose }: { onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    markVersionSeen();
  }, []);

  return (
    <Modal onClose={onClose} size="wide">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>{t('changelog.title')}</span>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body changelog-body">
        <p className="changelog-meta">{t('changelog.current', { version: APP_VERSION })}</p>
        {CHANGELOG.entries.map((entry) => (
          <Entry key={entry.version} entry={entry} isCurrent={entry.version === APP_VERSION} />
        ))}
      </div>
      <div className="modal-foot">
        <button className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
