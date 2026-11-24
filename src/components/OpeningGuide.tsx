import { useEffect, useLayoutEffect, useState } from 'react';
import { useT } from '../core/i18n';

const RESTART_EVENT = 'th-opening-restart';
const RESTART_CHAPTER_TWO_EVENT = 'th-manual-chapter-two-restart';
const RESTART_CHAPTER_FOUR_EVENT = 'th-manual-chapter-four-restart';

export function restartOpeningGuide() {
  window.dispatchEvent(new CustomEvent(RESTART_EVENT));
}

export function restartManualChapterTwo() {
  window.dispatchEvent(new CustomEvent(RESTART_CHAPTER_TWO_EVENT));
}

export function restartManualChapterFour() {
  window.dispatchEvent(new CustomEvent(RESTART_CHAPTER_FOUR_EVENT));
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

function clickVisibleTarget(attribute: 'data-opening-target' | 'data-manual-two-target' | 'data-manual-four-target', step: string) {
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

type ChapterFourStep =
  | 'settings'
  | 'model-tab'
  | 'nsfw-mode'
  | 'session'
  | 'new-chat'
  | 'create-session'
  | 'edit-session'
  | 'guidance'
  | 'save'
  | 'charged-send';

function isNarrowScreen() {
  return window.matchMedia('(max-width: 680px)').matches;
}

function continueChapterFourToSessions(setStep: (step: ChapterFourStep) => void) {
  if (isNarrowScreen()) window.dispatchEvent(new CustomEvent('th-manual-four-open-sidebar'));
  window.setTimeout(() => {
    setStep(document.querySelector('[data-manual-four-target="session"]') ? 'session' : 'new-chat');
  }, 0);
}

function continueChapterFourToEdit(setStep: (step: ChapterFourStep) => void) {
  window.setTimeout(() => {
    if (isNarrowScreen()) window.dispatchEvent(new CustomEvent('th-manual-four-open-session-menu'));
    window.requestAnimationFrame(() => setStep('edit-session'));
  }, 0);
}

export function ManualChapterFourGuide() {
  const t = useT();
  const [step, setStep] = useState<ChapterFourStep | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const restart = () => setStep('settings');
    window.addEventListener(RESTART_CHAPTER_FOUR_EVENT, restart);
    return () => window.removeEventListener(RESTART_CHAPTER_FOUR_EVENT, restart);
  }, []);

  useEffect(() => {
    if (step === 'guidance' || step === 'save') document.documentElement.setAttribute('data-manual-four-guidance-readonly', 'true');
    else document.documentElement.removeAttribute('data-manual-four-guidance-readonly');
    if (step === 'charged-send') document.documentElement.setAttribute('data-manual-four-require-charge', 'true');
    else document.documentElement.removeAttribute('data-manual-four-require-charge');
    return () => {
      document.documentElement.removeAttribute('data-manual-four-guidance-readonly');
      document.documentElement.removeAttribute('data-manual-four-require-charge');
    };
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.opening-guide-card')) return;
      const target = event.target instanceof Element ? event.target.closest(`[data-manual-four-target="${step}"]`) : null;
      if (!target || target.hasAttribute('disabled') || target.getClientRects().length === 0) return;
      // NSFW 步骤只由复选框的 change 事件推进，避免捕获阶段干扰开关默认行为。
      if (step === 'nsfw-mode') return;
      if (step === 'settings') window.setTimeout(() => setStep('model-tab'), 0);
      else if (step === 'model-tab') window.setTimeout(() => setStep('nsfw-mode'), 0);
      else if (step === 'session') continueChapterFourToEdit(setStep);
      else if (step === 'new-chat') window.setTimeout(() => setStep('create-session'), 0);
      else if (step === 'edit-session') window.setTimeout(() => setStep('guidance'), 0);
    };
    const continueAfterNsfwEnabled = () => {
      if (step !== 'nsfw-mode') return;
      continueChapterFourToSessions(setStep);
    };
    const onNsfwEnabled = () => continueAfterNsfwEnabled();
    const onNsfwChange = (event: Event) => {
      const checkbox = event.target;
      if (!(checkbox instanceof HTMLInputElement)
        || checkbox.type !== 'checkbox'
        || !checkbox.closest('[data-manual-four-target="nsfw-mode"]')
        || !checkbox.checked) return;
      window.setTimeout(continueAfterNsfwEnabled, 0);
    };
    const onCreated = () => {
      if (step === 'create-session') continueChapterFourToEdit(setStep);
    };
    const onSaved = () => setStep((current) => current === 'save' ? 'charged-send' : current);
    const onChargedSent = () => setStep((current) => current === 'charged-send' ? null : current);
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onNsfwChange, true);
    window.addEventListener('th-manual-four-nsfw-enabled', onNsfwEnabled);
    window.addEventListener('th-opening-session-created', onCreated);
    window.addEventListener('th-manual-four-session-saved', onSaved);
    window.addEventListener('th-manual-four-charged-sent', onChargedSent);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onNsfwChange, true);
      window.removeEventListener('th-manual-four-nsfw-enabled', onNsfwEnabled);
      window.removeEventListener('th-opening-session-created', onCreated);
      window.removeEventListener('th-manual-four-session-saved', onSaved);
      window.removeEventListener('th-manual-four-charged-sent', onChargedSent);
    };
  }, [step]);

  useEffect(() => {
    if (step === 'charged-send') window.dispatchEvent(new CustomEvent('th-opening-prefill', { detail: '你好~' }));
  }, [step]);

  useEffect(() => {
    if (step !== 'nsfw-mode') return;
    const checkbox = document.querySelector<HTMLInputElement>('[data-manual-four-target="nsfw-mode"] input[type="checkbox"]');
    if (!checkbox?.checked) return;
    checkbox.disabled = true;
    return () => {
      checkbox.disabled = false;
    };
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = [...document.querySelectorAll<HTMLElement>(`[data-manual-four-target="${step}"]`)]
          .find((candidate) => candidate.getClientRects().length > 0);
        if (element) {
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          setRect(element.getBoundingClientRect());
        } else if (step !== 'edit-session') {
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

  function next() {
    if (!step) return;
    if (step === 'guidance') {
      setStep('save');
      return;
    }
    if (step === 'nsfw-mode') {
      const checkbox = document.querySelector<HTMLInputElement>('[data-manual-four-target="nsfw-mode"] input[type="checkbox"]');
      if (!checkbox) return;
      if (!checkbox.checked) {
        checkbox.click();
        return;
      }
      continueChapterFourToSessions(setStep);
      return;
    }
    if (step === 'edit-session') {
      window.dispatchEvent(new CustomEvent('th-manual-four-edit-session'));
      window.setTimeout(() => setStep('guidance'), 0);
      return;
    }
    if (step === 'charged-send') return;
    clickVisibleTarget('data-manual-four-target', step);
  }

  return (
    <div className="opening-guide" aria-live="polite">
      <div className="opening-guide-spotlight" style={hole} />
      <section className="opening-guide-card" style={{ top: cardTop, left: cardLeft }}>
        <h2>{t(`manualFour.${step}.title`)}</h2>
        <p>{t(step === 'nsfw-mode' && document.querySelector<HTMLInputElement>('[data-manual-four-target="nsfw-mode"] input[type="checkbox"]')?.checked
          ? 'manualFour.nsfw-mode-enabled.body'
          : `manualFour.${step}.body`)}</p>
        <div className="opening-guide-actions">
          <button className="opening-guide-next" type="button" onClick={next} disabled={step === 'charged-send'}>
            {t('manualTwo.next')}
          </button>
          <button className="opening-guide-skip" type="button" onClick={() => setStep(null)}>{t('opening.skip')}</button>
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
