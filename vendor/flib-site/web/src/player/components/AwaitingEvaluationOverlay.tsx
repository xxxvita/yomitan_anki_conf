// AwaitingEvaluationOverlay — Phase 9.3 "shadowing awaiting-evaluation"
//
// Shown over the video while the shadowing finalize-attempt LLM round-trip
// is in flight. Mounted as an absolutely-positioned div by VideoPlayerPanel
// only when a fetch is pending.
//
// Visual: dim backdrop + centered card with spinner + Russian status text.
// Optional decision summary shown briefly after the call returns (so the
// user sees the verdict + LLM message before the overlay disappears).
//
// WEB-SEAM: framer-motion → CSS transition (project idiom). Web has no
// framer-motion dependency (task-A-brief.md A3: do not add it) — the desktop
// motion.div enter/exit fade is replaced by a plain div with an inline
// `transition: opacity 0.18s` + opacity driven by `visible`. The component
// already early-returns `null` when `!visible` (below), so a CSS transition
// only ever animates the *appear* edge; exit-fade-on-unmount is an open
// question tracked separately (T3), not addressed here.
import React from 'react';
import { Loader2, CheckCircle2, RotateCcw, Play } from 'lucide-react';
// WEB-SEAM: useI18n→useLocale — desktop reads `useI18n(s => s.lang)` from its
// zustand i18n store; web's i18n (web/src/player/i18n.ts) has no zustand and
// exposes `useLocale()` directly, returning 'ru'|'en'.
import { useLocale } from '../i18n';

export type EvaluationDecision = {
  decision: 'pass' | 'retry' | 'replay';
  user_message?: string;
  score?: number;
  source: string;
  provider?: string; // Ф3a (task #1068): which scorer produced this (ollama/turmalin)
  trace_id?: number;
};

interface Props {
  visible: boolean;
  // When non-null, the call has completed — show verdict card. Auto-fade is
  // managed by the parent; this component is purely presentational.
  decision?: EvaluationDecision | null;
}

// Метки локализованы по языку интерфейса (Issue 3b: при английском UI — английский).
const DECISION_LABEL: Record<EvaluationDecision['decision'], { ru: string; en: string; color: string; Icon: any }> = {
  pass: { ru: 'Принято', en: 'Accepted', color: '#22c55e', Icon: CheckCircle2 },
  retry: { ru: 'Попробуйте ещё раз', en: 'Try again', color: '#f59e0b', Icon: RotateCcw },
  replay: { ru: 'Послушайте ещё раз', en: 'Listen again', color: '#3b82f6', Icon: Play },
};

export const SOURCE_LABEL: Record<string, { ru: string; en: string }> = {
  llm: { ru: 'LLM', en: 'LLM' },
  standard: { ru: 'Стандартная оценка', en: 'Standard check' },
  fallback_timeout: { ru: 'Таймаут — стандартная оценка', en: 'Timeout — standard check' },
  fallback_missing_decision: { ru: 'Нет решения — стандартная', en: 'No decision — standard' },
  fallback_document_error: { ru: 'Ошибка документа — стандартная', en: 'Document error — standard' },
  // Ф3a (task #1068) — speak LLM-scoring fallbacks.
  fallback_no_prompt: { ru: 'Нет промпта — стандартная', en: 'No prompt — standard' },
  fallback_non_numeric: { ru: 'Ответ не число — стандартная', en: 'Non-numeric — standard' },
  fallback_provider_error: { ru: 'Ошибка провайдера — стандартная', en: 'Provider error — standard' },
};

export const AwaitingEvaluationOverlay: React.FC<Props> = ({ visible, decision }) => {
  const lang = useLocale();
  const en = lang === 'en';
  if (!visible) return null;
  const verdict = decision ? DECISION_LABEL[decision.decision] : null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 80,
        pointerEvents: 'auto',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.18s',
      }}
    >
      <div
        style={{
          minWidth: 320,
          maxWidth: 520,
          padding: '20px 24px',
          borderRadius: 12,
          backgroundColor: 'rgba(20, 22, 28, 0.96)',
          color: '#f5f6f8',
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {!decision ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Loader2 size={20} className="ac-spin-icon" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{en ? 'Analyzing answer…' : 'Анализ ответа…'}</div>
              <div style={{ fontSize: 12, color: '#a5acb9', marginTop: 2 }}>
                {en ? 'LLM is checking your shadowing attempt' : 'LLM проверяет Вашу попытку shadowing'}
              </div>
            </div>
          </div>
        ) : verdict ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <verdict.Icon size={24} color={verdict.color} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: verdict.color }}>
                {en ? verdict.en : verdict.ru}
              </div>
              {decision.user_message && (
                <div style={{ fontSize: 13, color: '#e5e7eb', marginTop: 6, lineHeight: 1.5 }}>
                  {decision.user_message}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#8a929e', marginTop: 8 }}>
                {(SOURCE_LABEL[decision.source]?.[en ? 'en' : 'ru']) || decision.source}
                {typeof decision.score === 'number' &&
                  ` · ${en ? 'score' : 'оценка'} ${decision.score.toFixed(1)}`}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
