// @vitest-environment jsdom
// useShadowRuntime.shadow-key.integration.test.ts — T4 REAL-координатор + REAL
// useWorkspace (тот же риг, что hold-seam). Дополняет
// useShadowRuntime.shadow-key.test.ts (fake-координатор, изолированная логика):
// здесь проверяем, что armRange реально армит НАСТОЯЩИЙ координатор эфемерным
// объектом (не крашит exerciseWorkspaceParams/effectiveShadowSettings) и что
// playhead-exit-снятие проходит через НАСТОЯЩИЕ гарды coordinator.onLeave
// (justPastEnd-транзиент vs реальный уход).
import { describe, it, expect, vi, afterEach } from 'vitest';
import type React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import type { Cue as LiveCue } from '../useSubtitles';
import type { ShadowState } from '../../workspace/panel-types';

const SHADOW_STATE: ShadowState = {
  active: true, recording: false, wsConnected: false, listeningPaused: false,
  partialText: '', committedSegments: [], attempts: [], currentLoopIndex: 0,
  loopMode: true, advanceEnabled: false, advanceThreshold: 80,
  mode: 'subtitle', customText: '', documentPath: '', bind: 'off', saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
};

// Grading-эфемерный = non-looping + auto-advance ON → G5-путь (скоринг по КОНЦУ
// непетлевого отрезка). Именно тут живёт форвард-escape-гонка teardown↔G5.
const GRADING_STATE: ShadowState = {
  ...SHADOW_STATE,
  loopMode: false, advanceEnabled: true, advanceThreshold: 80,
};

const liveCues: LiveCue[] = [{ start: 5, end: 10, text_en: 'hello', text_ru: 'привет' }];

function setup(
  state: ShadowState = SHADOW_STATE,
  evaluate: (req: unknown, signal: AbortSignal) => Promise<unknown> = vi.fn(),
) {
  const adapter = makeFakeAdapter({ t: 7 });
  const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };

  // currentTime читается ЖИВЫМ на КАЖДЫЙ рендер (adapter.currentTime()) — rerender()
  // после adapter._setTime(x) двигает args.currentTime → lifecycle/G5-эффекты (keyed
  // на нём) перезапускаются. Это тот же идиом, что был в исходном риге.
  const { result: rt, rerender } = renderHook(() =>
    useShadowRuntime({
      videoId: 'v1',
      liveCues,
      currentTime: adapter.currentTime(),
      getCurrentTime: () => adapter.currentTime(),
      getShadowState: () => state,
      wsActuatorsRef,
      seek: adapter.seek,
      pauseVideo: adapter.pause,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evaluate: evaluate as any,
    }),
  );

  const { result: ws } = renderHook(() =>
    useWorkspace(adapter, [{ start: 5, end: 10 }], 'v1', false,
      rt.current.onLoopBoundary, rt.current.shouldPauseAtBoundary, rt.current.onLoopRestart),
  );

  act(() => {
    wsActuatorsRef.current = {
      restoreWorkspace: ws.current.restoreWorkspace,
      resumeFromBoundary: ws.current.resumeFromBoundary,
      deactivateWorkspace: ws.current.deactivateWorkspace,
      countdownThenPlay: ws.current.countdownThenPlay,
      getWorkspaceSnapshot: ws.current.getWorkspaceSnapshot,
    };
  });

  return { adapter, rt, ws, rerender };
}

afterEach(() => { vi.useRealTimers(); });

describe('T4 integration — armRange против НАСТОЯЩЕГО координатора', () => {
  it('armRange эфемерным объектом армит реальный координатор (id совпадает, time-range)', () => {
    const { rt } = setup();
    act(() => { rt.current.armRange(5, 10); });
    const ex = rt.current.getEphemeralArm();
    expect(ex).not.toBeNull();
    expect(ex!.anchorMode).toBe('time-range');
    // Реальный координатор принял эфемерный отрезок и держит ЕГО id.
    expect(rt.current.armedSegmentId()).toBe(ex!.id);
  });

  it('handleShadowKey на субтитре (без A-B) → армит cue-диапазон в реальном координаторе', () => {
    const { rt } = setup(); // adapter t=7 внутри cue [5,10], A-B нет (rangeEnd==rangeStart==0)
    act(() => { rt.current.handleShadowKey(); });
    const ex = rt.current.getEphemeralArm();
    expect(ex).not.toBeNull();
    expect([ex!.startTime, ex!.endTime]).toEqual([5, 10]);
    expect(rt.current.armedSegmentId()).toBe(ex!.id);
  });

  it('playhead-exit: реальный уход за end → coordinator.onLeave снимает арм, ref=null', () => {
    const { rt, adapter, rerender } = setup();
    act(() => { rt.current.armRange(5, 10); });
    const ex = rt.current.getEphemeralArm()!;
    expect(rt.current.armedSegmentId()).toBe(ex.id);
    // Уводим playhead ДАЛЕКО за end (> end + LOOP_BOUNDARY_TRANSIENT_S) — реальный
    // уход, не B-фрейм-транзиент.
    adapter._setTime(20);
    act(() => { rerender(); });
    expect(rt.current.getEphemeralArm()).toBeNull(); // ref очищен
    expect(rt.current.armedSegmentId()).toBeNull();   // реальный координатор снял арм
  });

  it('playhead B-фрейм-транзиент (t чуть за end) → реальный coordinator.onLeave держит арм', () => {
    const { rt, adapter, rerender } = setup();
    act(() => { rt.current.armRange(5, 10); });
    const ex = rt.current.getEphemeralArm()!;
    adapter._setTime(10.2); // < end + 0.5 → justPastEnd-транзиент петли
    act(() => { rerender(); });
    // Реальный coordinator.onLeave вернулся рано (justPastEnd) → арм жив, ref сохранён.
    expect(rt.current.armedSegmentId()).toBe(ex.id);
    expect(rt.current.getEphemeralArm()).toBe(ex);
  });
});

// ── T4-fix2 [F3-FORWARD] — seek-observer преемптит НАСТОЯЩИЙ G5 (yank-back закрыт) ──
// Полный цикл на РЕАЛЬНОМ координаторе с G5: grading-эфемерный → доезд до конца →
// G5 eval → FAIL → HOLD → user-сик ВПЕРЁД через seek-chokepoint → эфемерный СНЯТ
// СИНХРОННО, hold очищен, а G5 на последующем тике видит armedExerciseRef=null →
// НЕ yank'ает (нет повторного pause+seek(end-0.1)). Именно этот путь fake-риг
// (shadow-key.test.ts) доказать НЕ может — у него нет G5.
describe('T4-fix2 F3-forward — seek ВПЕРЁД из hold НЕ yank-нут реальным G5', () => {
  // Прогоняем grading-эфемерный до HOLD, затем возвращаем handle для escape-проверки.
  async function driveToHold() {
    // evaluate → FAIL (score 0 < threshold 80) → grading non-looping → HOLD.
    const evaluate = vi.fn().mockResolvedValue({ decision: 'retry', score: 0 });
    const h = setup(GRADING_STATE, evaluate);
    const { rt, adapter, rerender } = h;
    // Арм эфемерного grading-отрезка [5,10] (playhead=7 внутри).
    act(() => { rt.current.armRange(5, 10); });
    const ex = rt.current.getEphemeralArm()!;
    expect(rt.current.armedSegmentId()).toBe(ex.id);
    // Доезд до конца отрезка: живой t=10 + rerender → G5-эффект фаерит (pause + кламп
    // seek(9.9) + eval). eval резолвится микротаском → await async act прогоняет apply →
    // grading non-looping + fail → HOLD (segEndHandled сброшен).
    adapter._setTime(10);
    await act(async () => { rerender(); });
    // Поллинг догнал кламп: видео на паузе у ~9.9.
    adapter._setTime(9.9);
    await act(async () => { rerender(); });
    return { rt, adapter, rerender, ex, evaluate };
  }

  it('grading-эфемерный доезжает до HOLD (реальный G5 + eval-FAIL)', async () => {
    const { rt, ex } = await driveToHold();
    expect(rt.current.isHeld()).toBe(true);            // hold сформирован
    expect(rt.current.armedSegmentId()).toBe(ex.id);   // арм жив
    expect(rt.current.getEphemeralArm()).toBe(ex);
  });

  it('из HOLD: seek ВПЕРЁД (chokepoint) → эфемерный СНЯТ, hold очищен, G5 НЕ yank\'ает', async () => {
    const { rt, adapter, rerender } = await driveToHold();
    // Пишем все методы адаптера ПОСЛЕ формирования hold — чтобы отследить, что G5
    // не сделает повторный pause+seek(end-0.1) после escape.
    const calls: string[] = [];
    adapter._spy = (m) => calls.push(m);

    // USER сикает ВПЕРЁД через ЕДИНЫЙ seek-chokepoint (rt.seek = observedSeek — тот,
    // что будущий caller разведёт на useHotkeys/timeline). Цель 20 ВНЕ [5,10) →
    // СИНХРОННЫЙ teardown ДО того, как поллинг/тик дотянется до G5.
    act(() => { rt.current.seek(20); });

    // Синхронно, ПРЯМО после сика (ещё до тика): арм снят, hold очищен.
    expect(rt.current.getEphemeralArm()).toBeNull();
    expect(rt.current.armedSegmentId()).toBeNull();
    expect(rt.current.isHeld()).toBe(false);

    // Поллинг догнал сик (t=20 >= end): будь арм ещё жив, G5 бы стрельнул
    // (pause + seek(9.9)). Прогоняем тик и проверяем, что G5 НЕ yank'ул.
    calls.length = 0;
    adapter._setTime(20);
    await act(async () => { rerender(); });
    expect(rt.current.armedSegmentId()).toBeNull();      // всё ещё снят
    expect(rt.current.getEphemeralArm()).toBeNull();
    expect(calls).not.toContain('pause');                // G5 не паузил
    expect(calls.some(c => c.startsWith('seek:9.9'))).toBe(false); // и не клампил назад
  });
});
