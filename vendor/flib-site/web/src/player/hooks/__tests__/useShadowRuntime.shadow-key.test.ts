// @vitest-environment jsdom
// useShadowRuntime.shadow-key.test.ts — T4 (hands-free S + AB-логика + ЭФЕМЕРНЫЙ
// арм lifecycle + class-3). САМЫЙ РИСКОВЫЙ таск порта: эфемерный канал — рукописная
// координация поверх гард-плотной части. Тестируем COMPOSITION-слой ИЗОЛИРОВАННО
// через FAKE-координатор — так мы детерминированно управляем held/eval/armed-
// состоянием и проверяем ИМЕННО T4-логику (порядок ветвлений, lifecycle-снятие,
// object-identity), а не поведение координатора (оно покрыто
// useShadowLoopCoordinator.test.ts). Реальная интеграция armRange↔координатор —
// в useShadowRuntime.shadow-key.integration.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';
import type { Cue as LiveCue } from '../useSubtitles';

// ── FAKE-координатор: детерминированный контроль armed/eval + захват onArm-арга и
//    log-канала (чтобы симулировать 'hold'-emit, которого fake сам не делает). ──
const h = vi.hoisted(() => ({
  armedId: null as string | null,
  evalInFlight: false,
  onLeaveClears: true, // симулирует «координатор снял арм» (true) vs loop-transient-decline (false)
  onArmArgs: [] as ShadowExerciseAnnotation[],
  onLeaveCalls: [] as string[],
  capturedLog: null as ((e: { event: string; exId?: string | null }) => void) | null,
}));

vi.mock('../useShadowLoopCoordinator', () => ({
  useShadowLoopCoordinator: (args: { log?: (e: { event: string; exId?: string | null }) => void }) => {
    h.capturedLog = args.log ?? null;
    return {
      shouldPauseAtBoundary: () => false,
      onArm: (ex: ShadowExerciseAnnotation) => { h.onArmArgs.push(ex); h.armedId = ex.id; },
      onLeave: (id: string) => { h.onLeaveCalls.push(id); if (h.onLeaveClears && h.armedId === id) h.armedId = null; },
      onLoopBoundary: () => {},
      armedSegmentId: () => h.armedId,
      setArmedLooping: () => {},
      setArmedGrading: () => {},
      isEvalInFlight: () => h.evalInFlight,
    };
  },
}));

const SHADOW_STATE: ShadowState = {
  active: true, recording: false, wsConnected: false, listeningPaused: false,
  partialText: '', committedSegments: [], attempts: [], currentLoopIndex: 0,
  loopMode: true, advanceEnabled: false, advanceThreshold: 80,
  mode: 'subtitle', customText: '', documentPath: '', bind: 'off', saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
};

const liveCues: LiveCue[] = [
  { start: 5, end: 10, text_en: 'hello', text_ru: 'привет' },
  { start: 20, end: 25, text_en: 'world', text_ru: 'мир' },
];

interface Harness {
  snapshot: { rangeStart: number; rangeEnd: number; viewStart: number; viewEnd: number; looping: boolean; pauseAtEnd: number; active: boolean };
  t: number;
}

// Grading-эфемерный = auto-advance ON + non-looping (G5-путь: скоринг по КОНЦУ
// непетлевого отрезка). Именно для него F1(а) вводит justPastEnd-окно.
const GRADING_STATE: ShadowState = {
  ...SHADOW_STATE,
  loopMode: false, advanceEnabled: true, advanceThreshold: 80,
};

function setup(initial: Partial<Harness> = {}, state: ShadowState = SHADOW_STATE) {
  const harness: Harness = {
    snapshot: { rangeStart: 0, rangeEnd: 0, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: false },
    t: 7,
    ...initial,
  };
  const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };
  const resumeSpy = vi.fn();
  wsActuatorsRef.current = {
    restoreWorkspace: vi.fn(),
    resumeFromBoundary: resumeSpy,
    deactivateWorkspace: vi.fn(),
    countdownThenPlay: vi.fn(),
    getWorkspaceSnapshot: () => harness.snapshot,
  };

  const { result, rerender } = renderHook(
    (props: { currentTime: number }) =>
      useShadowRuntime({
        videoId: 'v1',
        liveCues,
        currentTime: props.currentTime,
        getCurrentTime: () => harness.t,
        getShadowState: () => state,
        wsActuatorsRef,
        seek: vi.fn(),
        pauseVideo: vi.fn(),
        evaluate: vi.fn(),
      }),
    { initialProps: { currentTime: harness.t } },
  );
  let reactTime = harness.t; // последний React-`currentTime`, поданный в проп
  return {
    rt: result, harness, resumeSpy,
    setTime: (t: number) => { harness.t = t; reactTime = t; act(() => rerender({ currentTime: t })); },
    // F1(б): «посторонний рендер» — ЖИВОЙ getCurrentTime уезжает вперёд (liveT), но
    // React-`currentTime` НЕ меняется (ASR-partial и т.п.). Эффект keyed на
    // args.currentTime → НЕ должен перезапускаться. reactTime остаётся прежним.
    foreignRender: (liveT: number) => { harness.t = liveT; act(() => rerender({ currentTime: reactTime })); },
    emit: (e: { event: string; exId?: string | null }) => act(() => h.capturedLog?.(e)),
  };
}

beforeEach(() => {
  h.armedId = null; h.evalInFlight = false; h.onLeaveClears = true;
  h.onArmArgs = []; h.onLeaveCalls = []; h.capturedLog = null;
});

describe('T4 handleShadowKey — порядок ветвлений', () => {
  it('4. playhead ВНУТРИ активного A-B → armRange(A,B), эфемерный установлен', () => {
    const { rt } = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => rt.current.handleShadowKey());
    const ex = rt.current.getEphemeralArm();
    expect(ex).not.toBeNull();
    expect(ex!.startTime).toBe(5);
    expect(ex!.endTime).toBe(10);
    expect(ex!.anchorMode).toBe('time-range');
    expect(h.armedId).toBe(ex!.id); // координатор армлен ТЕМ ЖЕ отрезком
  });

  it('5. вне A-B, НА субтитре → armRange(cue.start, cue.end)', () => {
    const { rt } = setup({ snapshot: { rangeStart: 0, rangeEnd: 0, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: false }, t: 22 });
    act(() => rt.current.handleShadowKey());
    const ex = rt.current.getEphemeralArm();
    expect(ex).not.toBeNull();
    expect([ex!.startTime, ex!.endTime]).toEqual([20, 25]); // второй cue
  });

  it('6. вне A-B, НЕ на субтитре → no-op', () => {
    const { rt } = setup({ snapshot: { rangeStart: 0, rangeEnd: 0, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: false }, t: 100 });
    act(() => rt.current.handleShadowKey());
    expect(rt.current.getEphemeralArm()).toBeNull();
    expect(h.onArmArgs).toHaveLength(0);
  });

  it('3. живое PERSISTED-упражнение армлено (armedSegmentId && !ephemeral) → no-op', () => {
    const { rt } = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    // Симулируем автостарт persisted-упражнения через runtime.onArm (не armRange →
    // ephemeralArmRef остаётся null).
    const persisted: ShadowExerciseAnnotation = {
      id: 'persisted-1', startTime: 5, endTime: 10, anchorMode: 'subtitle', subIndex: 0,
      settings: { loopMode: true, advanceEnabled: false, advanceThreshold: 80, mode: 'subtitle', saveAudio: false, engines: SHADOW_STATE.engines },
      createdAt: 'x', updatedAt: 'x',
    };
    act(() => rt.current.onArm(persisted));
    expect(h.onArmArgs).toHaveLength(1);
    act(() => rt.current.handleShadowKey());
    expect(rt.current.getEphemeralArm()).toBeNull(); // S НЕ создал эфемерный
    expect(h.onArmArgs).toHaveLength(1); // и НЕ переармил
    expect(h.armedId).toBe('persisted-1');
  });

  it('1. isHeld && !isEvalInFlight → resumeFromHold (не armRange)', () => {
    const { rt, resumeSpy, emit } = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    emit({ event: 'hold', exId: 'held-x' }); // heldRef=true
    h.evalInFlight = false;
    act(() => rt.current.handleShadowKey());
    expect(resumeSpy).toHaveBeenCalledWith('advance'); // resumeFromHold path
    expect(rt.current.getEphemeralArm()).toBeNull(); // НЕ армили эфемерный
    expect(rt.current.isHeld()).toBe(false); // hold снят
  });

  it('2. isHeld && isEvalInFlight → no-op (carry T3 FIX B)', () => {
    const { rt, resumeSpy, emit } = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    emit({ event: 'hold', exId: 'held-x' });
    h.evalInFlight = true; // eval в полёте
    act(() => rt.current.handleShadowKey());
    expect(resumeSpy).not.toHaveBeenCalled(); // не резюмим
    expect(rt.current.getEphemeralArm()).toBeNull(); // и не армим
    expect(h.onArmArgs).toHaveLength(0);
  });
});

describe('T4 armRange — эфемерный объект', () => {
  it('object-identity: getEphemeralArm() === объект, переданный в coordinator.onArm (для T5)', () => {
    const { rt } = setup();
    act(() => rt.current.armRange(5, 10));
    expect(h.onArmArgs).toHaveLength(1);
    // КРИТИЧНО для T5: НЕ клонируется между ephemeralArmRef и onArm.
    expect(rt.current.getEphemeralArm()).toBe(h.onArmArgs[0]);
  });

  it('эфемерный собирается из ТЕКУЩИХ настроек ShadowState', () => {
    const { rt } = setup();
    act(() => rt.current.armRange(5, 10));
    const ex = rt.current.getEphemeralArm()!;
    expect(ex.settings.loopMode).toBe(SHADOW_STATE.loopMode);
    expect(ex.settings.mode).toBe(SHADOW_STATE.mode);
    expect(ex.settings.engines).toBe(SHADOW_STATE.engines);
    expect(ex.anchorMode).toBe('time-range');
  });

  it('вырожденный диапазон (end<=start) → no-op', () => {
    const { rt } = setup();
    act(() => rt.current.armRange(10, 10));
    expect(rt.current.getEphemeralArm()).toBeNull();
    expect(h.onArmArgs).toHaveLength(0);
    act(() => rt.current.armRange(10, 5));
    expect(rt.current.getEphemeralArm()).toBeNull();
    expect(h.onArmArgs).toHaveLength(0);
  });

  it('7a. новый armRange ЗАМЕНЯЕТ старый эфемерный (onArm-supersede, БЕЗ onLeave прежнего)', () => {
    const { rt } = setup();
    act(() => rt.current.armRange(5, 10));
    const first = rt.current.getEphemeralArm();
    act(() => rt.current.armRange(20, 25));
    const second = rt.current.getEphemeralArm();
    expect(second).not.toBe(first); // новый объект
    expect(second!.startTime).toBe(20);
    expect(h.onArmArgs).toHaveLength(2); // оба переданы координатору
    expect(h.onLeaveCalls).toHaveLength(0); // прежний НЕ снимался onLeave (не ломаем снимок)
    expect(h.armedId).toBe(second!.id);
  });
});

describe('T4 эфемерный LIFECYCLE (playhead-exit-снятие — замена autostart-onLeave)', () => {
  it('7b. playhead вышел за [start,end) (не eval/hold) → эфемерный снят (onLeave + ref=null)', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    s.setTime(20); // playhead ушёл далеко за end=10
    expect(s.harness).toBeDefined();
    expect(h.onLeaveCalls).toContain(ex.id); // делегировали снятие координатору
    expect(s.rt.current.getEphemeralArm()).toBeNull(); // ref очищен (reconcile)
  });

  it('loop-boundary-транзиент: onLeave declines (armedSegmentId держится) → ref НЕ обнуляется', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    h.onLeaveClears = false; // координатор отклоняет снятие (justPastEnd-транзиент)
    s.setTime(10.2); // на миг за end — B-фрейм
    expect(h.onLeaveCalls).toContain(ex.id); // мы попробовали
    expect(s.rt.current.getEphemeralArm()).toBe(ex); // но ref сохранён (координатор держит арм)
  });

  it('гонка eval: playhead за end во время eval → снятие НЕ срабатывает (gate)', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    h.evalInFlight = true;
    s.setTime(20);
    expect(h.onLeaveCalls).toHaveLength(0); // gate: не трогаем во время eval
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
  });

  // F3-fix [MED-HIGH]: гейт `!heldRef` УБРАН из teardown. Разбито на два кейса.
  it('F3: легит-hold — playhead клампнут ВНУТРИ (t<end) → teardown НЕ триггерит (left=false, НЕ из-за heldRef-гейта)', () => {
    // Реальный hold: G5 клампит playhead к end-0.1 ВНУТРЬ отрезка (:695). Значит
    // left=false сам по себе — арм жив и БЕЗ heldRef-гейта.
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    s.emit({ event: 'hold', exId: ex.id });
    s.setTime(9.9); // playhead клампнут ВНУТРИ [5,10)
    expect(h.onLeaveCalls).toHaveLength(0); // left=false → onLeave не звали
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
    expect(s.rt.current.isHeld()).toBe(true); // hold жив
  });

  // T4-fix2 [F3-FORWARD]: ЧЕСТНАЯ версия. Прежняя редакция гнала user-сик через
  // `s.setTime(20)` — а это ТИК lifecycle-эффекта, НЕ реальный сик. Тест «проходил»
  // лишь потому, что fake-координатор БЕЗ G5: в реальности на тике сика вперёд G5
  // (объявлен выше) стреляет ПЕРВЫМ, клампит t обратно и eval'ит → tick-effect
  // упирается в eval-гейт и teardown не срабатывает (эфемерный+hold залипают, yank).
  // Механизм, который РЕАЛЬНО закрывает форвард-escape, — СИНХРОННЫЙ seek-observer:
  // он снимает арм в момент вызова seek, ДО G5-тика. Здесь тестируем ЕГО (изолированно,
  // fake-координатор); что он преемптит НАСТОЯЩИЙ G5 — в integration-риге.
  it('F3-forward: hold активен + seek ПРОЧЬ через seek-chokepoint → эфемерный СНЯТ СИНХРОННО (hold очищен)', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    s.emit({ event: 'hold', exId: ex.id }); // hold активен
    // Юзер сикает ПРОЧЬ через ЕДИНЫЙ seek-chokepoint (не setTime — это реальный путь
    // useHotkeys/timeline). Цель 20 ВНЕ [5,10) → синхронный teardown ДО любого тика.
    act(() => s.rt.current.seek(20));
    expect(h.onLeaveCalls).toContain(ex.id);          // teardown сработал синхронно
    expect(s.rt.current.getEphemeralArm()).toBeNull(); // ref очищен
    expect(s.rt.current.isHeld()).toBe(false);         // композиц-онный onLeave очистил hold по id
  });

  it('F3-forward: seek ВНУТРЬ [start,end) через chokepoint (напр. G5-кламп end-0.1) → эфемерный НЕ снят', () => {
    // Дискриминатор по ЦЕЛИ: внутренний кламп/рестарт целится ВНУТРЬ → seek-observer
    // его игнорирует (ложного teardown нет). Только ВНЕ-диапазона = user-уход.
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    act(() => s.rt.current.seek(9.9)); // кламп G5 к end-0.1 — ВНУТРИ
    expect(h.onLeaveCalls).toHaveLength(0);
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
    act(() => s.rt.current.seek(5)); // рестарт к rangeStart — ВНУТРИ (граница = inside)
    expect(h.onLeaveCalls).toHaveLength(0);
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
  });

  it('F3-forward: seek ПРОЧЬ во время eval → эфемерный НЕ снят (eval-гейт, паритет F1/F2)', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    h.evalInFlight = true;             // eval владеет отрезком
    act(() => s.rt.current.seek(20));  // сик вне диапазона, но eval в полёте
    expect(h.onLeaveCalls).toHaveLength(0); // не рвём eval мид-полётом
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
  });

  it('F3-forward: seek ВНЕ диапазона БЕЗ эфемерного арма (обычный видео-сик) → observer инертен', () => {
    // Регресс-гард: seek-observer НЕ вмешивается, когда эфемерного нет (persisted-арм
    // ведёт autostart-reducer; обычный сик вне shadowing вообще не трогается).
    const s = setup({ snapshot: { rangeStart: 0, rangeEnd: 0, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: false }, t: 7 });
    expect(s.rt.current.getEphemeralArm()).toBeNull();
    act(() => s.rt.current.seek(42));
    expect(h.onLeaveCalls).toHaveLength(0); // ничего не снимали
    expect(h.onArmArgs).toHaveLength(0);
  });

  it('EXERCISE_START_EPS: недолёт seek(A) (t = start - 0.03) НЕ считается выходом', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    s.setTime(4.97); // start=5, eps=0.05 → 4.97 > 4.95 → внутри
    expect(h.onLeaveCalls).toHaveLength(0);
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
    s.setTime(4.9); // < 4.95 → реальный уход назад
    expect(h.onLeaveCalls).toContain(ex.id);
    expect(s.rt.current.getEphemeralArm()).toBeNull();
  });

  it('reconcile (case 4): координатор сам снял арм (advance/complete) → ref обнуляется', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    expect(s.rt.current.getEphemeralArm()).not.toBeNull();
    h.armedId = null; // координатор ушёл вперёд/завершил (armedExerciseRef обнулён)
    s.setTime(8); // любой tick внутри диапазона — эффект перезапустится
    expect(s.rt.current.getEphemeralArm()).toBeNull(); // (A) reconcile обнулил ref
    expect(h.onLeaveCalls).toHaveLength(0); // без повторного onLeave (координатор уже снял)
  });
});

// ── FIX F1 [CRIT] — lifecycle-teardown НЕ обгоняет G5 для grading-эфемерного ──
describe('T4-fix F1 — teardown vs G5 (grading-эфемерный, justPastEnd)', () => {
  it('F1(б): ПОСТОРОННИЙ рендер в лаг-окне (React-t отстаёт, живой t за end, grading) → teardown НЕ срабатывает, арм жив (G5 оценит)', () => {
    // grading + non-looping (G5-путь). Арм внутри [5,10) при t=7.
    const s = setup(
      { snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 },
      GRADING_STATE,
    );
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    // Посторонний рендер (ASR-partial): ЖИВОЙ t уехал за end=10 (в justPastEnd-окно),
    // но React-currentTime остался 7. Эффект keyed на args.currentTime → НЕ перезапуск.
    s.foreignRender(10.2);
    expect(h.onLeaveCalls).toHaveLength(0); // teardown НЕ сработал
    expect(s.rt.current.getEphemeralArm()).toBe(ex); // арм ЖИВ → G5 успеет оценить
  });

  it('F1(а): реальный тик в justPastEnd-окно (end<=t<end+0.5, grading) → арм жив; за окном (t>=end+0.5) → снят', () => {
    const s = setup(
      { snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 },
      GRADING_STATE,
    );
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    s.setTime(10.2); // end=10 → внутри [10,10.5): grading отдаёт G5, teardown НЕ триггерит
    expect(h.onLeaveCalls).toHaveLength(0);
    expect(s.rt.current.getEphemeralArm()).toBe(ex);
    s.setTime(10.6); // за justPastEnd → ЯВНЫЙ уход → teardown
    expect(h.onLeaveCalls).toContain(ex.id);
    expect(s.rt.current.getEphemeralArm()).toBeNull();
  });

  it('F1: НЕ-grading эфемерный снимается сразу за концом (t>=end, БЕЗ justPastEnd-окна)', () => {
    // Контроль: окно применяется ТОЛЬКО к grading; не-grading (default SHADOW_STATE)
    // уходит немедленно — паритет со старым поведением (регресс-гард).
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: false, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    s.setTime(10.2); // не-grading → t>=end сразу = уход
    expect(h.onLeaveCalls).toContain(ex.id);
    expect(s.rt.current.getEphemeralArm()).toBeNull();
  });
});

// ── FIX F2 [HIGH] — не-held S во время eval = no-op (нет re-arm мид-eval) ──
describe('T4-fix F2 — S во время eval не убивает упражнение', () => {
  it('pending eval (evalInFlight, НЕ held) → S = no-op (нет re-arm/onArm); после резолва eval → S работает', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey()); // арм эфемерного
    expect(h.onArmArgs).toHaveLength(1);
    const ex = s.rt.current.getEphemeralArm()!;

    h.evalInFlight = true; // grading-эфемерный оценивается (heldRef ещё false)
    act(() => s.rt.current.handleShadowKey());
    expect(h.onArmArgs).toHaveLength(1); // НЕ переармили → старый eval НЕ убит
    expect(s.rt.current.getEphemeralArm()).toBe(ex); // тот же объект
    expect(s.resumeSpy).not.toHaveBeenCalled(); // workspace НЕ тронут (нет parked-телепорта)

    h.evalInFlight = false; // eval резолвнулся
    act(() => s.rt.current.handleShadowKey());
    expect(h.onArmArgs).toHaveLength(2); // теперь S снова работает (re-arm)
  });
});

// ── FIX spec#1 [MEDIUM] — resumeFromHold чистит ephemeralArmRef СИНХРОННО ──
describe('T4-fix spec#1 — resumeFromHold синхронно обнуляет эфемерный', () => {
  it('арм → hold с его id → resumeFromHold → getEphemeralArm()===null СИНХРОННО (не через побочный ре-рендер)', () => {
    const s = setup({ snapshot: { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true }, t: 7 });
    act(() => s.rt.current.handleShadowKey());
    const ex = s.rt.current.getEphemeralArm()!;
    // onLeaveClears=false: координатор НЕ снимает armedId → reconcile (A) НЕ обнулит
    // ref за нас; единственный, кто может обнулить — синхронный код resumeFromHold.
    h.onLeaveClears = false;
    s.emit({ event: 'hold', exId: ex.id }); // heldRef=true, held id = ex.id
    h.evalInFlight = false;
    act(() => s.rt.current.resumeFromHold());
    expect(h.onLeaveCalls).toContain(ex.id); // делегировали cleanup координатору
    expect(s.rt.current.getEphemeralArm()).toBeNull(); // и обнулили СИНХРОННО
  });
});
