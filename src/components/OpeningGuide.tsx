import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useT } from '../core/i18n';

const RESTART_EVENT = 'th-opening-restart';
const RESTART_CHAPTER_TWO_EVENT = 'th-manual-chapter-two-restart';

export function restartOpeningGuide() {
  window.dispatchEvent(new CustomEvent(RESTART_EVENT));
}

export function restartManualChapterTwo() {
  window.dispatchEvent(new CustomEvent(RESTART_CHAPTER_TWO_EVENT));
}

type OpeningStep =
  | 'settings'
  | 'api'
  | 'add-provider'
  | 'provider-name'
  | 'provider-base-url'
  | 'provider-api-key'
  | 'provider-test'
  | 'provider-save'
  | 'new-chat'
  | 'add-owner'
  | 'owner-option'
  | 'create-chat'
  | 'model-button'
  | 'model-option'
  | 'message-send';

const STEPS: OpeningStep[] = [
  'settings', 'api', 'add-provider', 'provider-name', 'provider-base-url', 'provider-api-key', 'provider-test', 'provider-save', 'new-chat',
  'add-owner', 'owner-option', 'create-chat', 'model-button', 'model-option', 'message-send',
];

const NEXT_ON_CLICK: Partial<Record<OpeningStep, OpeningStep>> = {
  settings: 'api',
  api: 'add-provider',
  'add-provider': 'provider-name',
  'new-chat': 'add-owner',
  'add-owner': 'owner-option',
  'owner-option': 'create-chat',
  'model-button': 'model-option',
  'model-option': 'message-send',
};

type ChapterTwoStep =
  | 'workshop'
  | 'characters-tab'
  | 'new-character'
  | 'avatar'
  | 'name'
  | 'prompt'
  | 'greeting'
  | 'add-greeting'
  | 'skills'
  | 'close-character'
  | 'png-import'
  | 'new-chat';

const CHAPTER_TWO_STEPS: ChapterTwoStep[] = [
  'workshop', 'characters-tab', 'new-character', 'avatar', 'name', 'prompt', 'greeting', 'add-greeting', 'skills',
  'close-character', 'png-import', 'new-chat',
];

const CHAPTER_TWO_NEXT_ON_CLICK: Partial<Record<ChapterTwoStep, ChapterTwoStep>> = {
  workshop: 'characters-tab',
  'characters-tab': 'new-character',
  'new-character': 'avatar',
  'close-character': 'png-import',
};

const CHAPTER_TWO_INFO_NEXT: Partial<Record<ChapterTwoStep, ChapterTwoStep>> = {
  avatar: 'name',
  name: 'prompt',
  prompt: 'greeting',
  greeting: 'add-greeting',
  'add-greeting': 'skills',
  skills: 'close-character',
  'png-import': 'new-chat',
  'new-chat': undefined,
};

function clickVisibleTarget(attribute: 'data-opening-target' | 'data-manual-two-target', step: string) {
  const target = [...document.querySelectorAll<HTMLElement>(`[${attribute}="${step}"]`)]
    .find((candidate) => candidate.getClientRects().length > 0);
  if (!target || target.hasAttribute('disabled')) return;
  target.click();
  target.focus();
}

export function OpeningGuide() {
  const t = useT();
  const [step, setStep] = useState<OpeningStep | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [savedProviderId, setSavedProviderId] = useState<number | null>(null);
  const question = t('opening.question');

  useEffect(() => {
    if (savedProviderId == null) document.documentElement.removeAttribute('data-opening-provider-id');
    else document.documentElement.setAttribute('data-opening-provider-id', String(savedProviderId));
    return () => document.documentElement.removeAttribute('data-opening-provider-id');
  }, [savedProviderId]);

  useEffect(() => {
    const restartFromBeginning = () => {
      setSavedProviderId(null);
      setStep('settings');
    };
    window.addEventListener(RESTART_EVENT, restartFromBeginning);
    return () => window.removeEventListener(RESTART_EVENT, restartFromBeginning);
  }, []);

  useEffect(() => {
    if (!step) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(`[data-opening-target="${step}"]`) : null;
      if (!target || target.hasAttribute('disabled') || target.getClientRects().length === 0) return;
      const next = NEXT_ON_CLICK[step];
      if (next) window.setTimeout(() => setStep(next), 0);
    };
    const onFieldCompleted = (event: Event) => {
      const completed = (event as CustomEvent<OpeningStep>).detail;
      setStep((current) => current === completed
        ? completed === 'provider-name' ? 'provider-base-url'
          : completed === 'provider-base-url' ? 'provider-api-key'
            : completed === 'provider-api-key' ? 'provider-test'
              : current
        : current);
    };
    const onTested = () => setStep((current) => current === 'provider-test' ? 'provider-save' : current);
    const onSaved = (event: Event) => setStep((current) => {
      if (current !== 'provider-save') return current;
      const providerId = (event as CustomEvent<number>).detail;
      if (Number.isFinite(providerId)) setSavedProviderId(providerId);
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('th-opening-show-new-chat')), 0);
      return 'new-chat';
    });
    const onCreated = () => setStep((current) => current === 'create-chat' ? 'model-button' : current);
    const onSent = () => setStep((current) => current === 'message-send' ? null : current);
    document.addEventListener('click', onClick, true);
    window.addEventListener('th-opening-field-completed', onFieldCompleted);
    window.addEventListener('th-opening-provider-tested', onTested);
    window.addEventListener('th-opening-provider-saved', onSaved);
    window.addEventListener('th-opening-session-created', onCreated);
    window.addEventListener('th-opening-message-sent', onSent);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('th-opening-field-completed', onFieldCompleted);
      window.removeEventListener('th-opening-provider-tested', onTested);
      window.removeEventListener('th-opening-provider-saved', onSaved);
      window.removeEventListener('th-opening-session-created', onCreated);
      window.removeEventListener('th-opening-message-sent', onSent);
    };
  }, [step]);

  useEffect(() => {
    if (step === 'message-send') window.dispatchEvent(new CustomEvent('th-opening-prefill', { detail: question }));
  }, [step, question]);

  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = [...document.querySelectorAll<HTMLElement>(`[data-opening-target="${step}"]`)]
          .find((candidate) => candidate.getClientRects().length > 0);
        if (element) {
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          setRect(element.getBoundingClientRect());
        } else {
          setRect(null);
        }
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  const progress = useMemo(() => step ? Math.max(1, Math.ceil(((STEPS.indexOf(step) + 1) / STEPS.length) * 5)) : 0, [step]);
  if (!step || !rect) return null;

  const pad = 7;
  const hole = {
    left: Math.max(6, rect.left - pad),
    top: Math.max(6, rect.top - pad),
    width: Math.min(window.innerWidth - 12, rect.width + pad * 2),
    height: Math.min(window.innerHeight - 12, rect.height + pad * 2),
  };
  const cardBelow = hole.top + hole.height + 16;
  const cardTop = cardBelow + 190 < window.innerHeight ? cardBelow : Math.max(12, hole.top - 176);
  const cardLeft = Math.min(Math.max(12, hole.left), window.innerWidth - 332);

  function finish() {
    setStep(null);
  }

  function next() {
    if (!step) return;
    if (step === 'provider-name' || step === 'provider-base-url' || step === 'provider-api-key') {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-opening-target="${step}"]`)]
        .find((candidate) => candidate.getClientRects().length > 0);
      target?.focus();
      return;
    }
    clickVisibleTarget('data-opening-target', step);
  }

  return (
    <div className="opening-guide" aria-live="polite">
      <div className="opening-guide-spotlight" style={hole} />
      <section className="opening-guide-card" style={{ top: cardTop, left: cardLeft }}>
        <div className="opening-guide-progress">{t('opening.progress', { current: progress, total: 5 })}</div>
        <h2>{t(`opening.${step}.title`)}</h2>
        <p>{t(`opening.${step}.body`, { question })}</p>
        <div className="opening-guide-actions">
          <button className="opening-guide-next" type="button" onClick={next}>{t('manualTwo.next')}</button>
          <button className="opening-guide-skip" type="button" onClick={finish}>{t('opening.skip')}</button>
        </div>
      </section>
    </div>
  );
}

export function ManualChapterTwoGuide() {
  const t = useT();
  const [step, setStep] = useState<ChapterTwoStep | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const restart = () => setStep('workshop');
    window.addEventListener(RESTART_CHAPTER_TWO_EVENT, restart);
    return () => window.removeEventListener(RESTART_CHAPTER_TWO_EVENT, restart);
  }, []);

  useEffect(() => {
    if (!step) return;
    const onClick = (event: MouseEvent) => {
      const card = event.target instanceof Element ? event.target.closest('.opening-guide-card') : null;
      if (card) return;
      const target = event.target instanceof Element ? event.target.closest(`[data-manual-two-target="${step}"]`) : null;
      const next = CHAPTER_TWO_NEXT_ON_CLICK[step];
      if (!target || !next || target.hasAttribute('disabled') || target.getClientRects().length === 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      window.setTimeout(() => setStep(next), 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      if (event.target instanceof Element && event.target.closest('.opening-guide-card')) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = [...document.querySelectorAll<HTMLElement>(`[data-manual-two-target="${step}"]`)]
          .find((candidate) => candidate.getClientRects().length > 0);
        if (element) {
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          setRect(element.getBoundingClientRect());
        } else {
          setRect(null);
        }
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  if (!step || !rect) return null;

  const pad = 7;
  const hole = {
    left: Math.max(6, rect.left - pad),
    top: Math.max(6, rect.top - pad),
    width: Math.min(window.innerWidth - 12, rect.width + pad * 2),
    height: Math.min(window.innerHeight - 12, rect.height + pad * 2),
  };
  const cardBelow = hole.top + hole.height + 16;
  const cardTop = cardBelow + 190 < window.innerHeight ? cardBelow : Math.max(12, hole.top - 190);
  const cardLeft = Math.min(Math.max(12, hole.left), window.innerWidth - 332);
  const stepIndex = CHAPTER_TWO_STEPS.indexOf(step);
  const progress = stepIndex <= 1 ? 1 : stepIndex <= 9 ? 2 : stepIndex === 10 ? 3 : 4;
  const infoNext = CHAPTER_TWO_INFO_NEXT[step];

  function next() {
    if (!step) return;
    if (step === 'new-chat') {
      setStep(null);
      return;
    }
    if (infoNext) {
      setStep(infoNext);
      return;
    }
    clickVisibleTarget('data-manual-two-target', step);
  }

  return (
    <div className="opening-guide" aria-live="polite">
      <div className="opening-guide-spotlight" style={hole} />
      <section className="opening-guide-card" style={{ top: cardTop, left: cardLeft }}>
        <div className="opening-guide-progress">{t('opening.progress', { current: progress, total: 4 })}</div>
        <h2>{t(`manualTwo.${step}.title`)}</h2>
        <p>{t(`manualTwo.${step}.body`)}</p>
        <div className="opening-guide-actions">
          <button className="opening-guide-next" type="button" onClick={next}>
            {step === 'new-chat' ? t('manualTwo.finish') : t('manualTwo.next')}
          </button>
          <button className="opening-guide-skip" type="button" onClick={() => setStep(null)}>{t('opening.skip')}</button>
        </div>
      </section>
    </div>
  );
}
