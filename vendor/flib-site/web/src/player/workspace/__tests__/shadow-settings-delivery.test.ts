// shadow-settings-delivery.test.ts — Срез B (§2). Мутационные тесты обеих
// развилок доставки live-настроек в армленное упражнение:
//   • ЭФЕМЕРНЫЙ: Object.assign IN-PLACE (не спред/клон) — иначе held-объект
//     координатора не увидит смену порога (см. интеграц-тест границы).
//   • PERSISTED: спред СВЕЖЕЙ копии settings — {settings:{patch}} затёр бы
//     customText/engines целиком (CRIT-1, shallow-merge useAnnotations).
import { describe, it, expect, vi } from 'vitest';
import { persistArmedSettings, type ArmedSettingsSink } from '../shadow-settings-delivery';
import type { ShadowExerciseAnnotation } from '../panel-types';

function mkExercise(id: string, overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  return {
    id, startTime: 5, endTime: 10, anchorMode: 'time-range',
    settings: {
      loopMode: true, advanceEnabled: true, advanceThreshold: 80,
      mode: 'subtitle', customText: 'keep me', saveAudio: false,
      engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('persistArmedSettings — ephemeral (in-place, held object)', () => {
  it('mutates getEphemeralArm().settings IN-PLACE (same object identity) and does NOT call updateShadowExercise', () => {
    const eph = mkExercise('ephemeral-1');
    const settingsBefore = eph.settings; // identity we must preserve
    const update = vi.fn();
    const sink: ArmedSettingsSink = {
      armedSegmentId: () => 'ephemeral-1',
      getEphemeralArm: () => eph,
      getExercises: () => [],
      updateShadowExercise: update,
    };

    persistArmedSettings(sink, { advanceThreshold: 50 });

    expect(eph.settings.advanceThreshold).toBe(50);
    expect(eph.settings).toBe(settingsBefore); // MUST be the SAME object (in-place), not a fresh clone
    expect(eph.settings.customText).toBe('keep me'); // untouched fields survive
    expect(update).not.toHaveBeenCalled(); // ephemeral-N is not in the store — no persist
  });

  it('does NOT mutate a STALE ephemeral whose id no longer matches armedSegmentId (advance-window guard); falls through to persisted', () => {
    const stale = mkExercise('ephemeral-1');
    const persisted = mkExercise('ex-live');
    const update = vi.fn();
    const sink: ArmedSettingsSink = {
      armedSegmentId: () => 'ex-live', // coordinator moved on to a persisted arm
      getEphemeralArm: () => stale, // getEphemeralArm still holds the DEAD one
      getExercises: () => [persisted],
      updateShadowExercise: update,
    };

    persistArmedSettings(sink, { advanceThreshold: 55 });

    expect(stale.settings.advanceThreshold).toBe(80); // untouched — it is not the armed one
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe('ex-live');
  });
});

describe('persistArmedSettings — persisted (fresh spread, CRIT-1)', () => {
  it('spreads a FRESH copy of the store settings + patch — customText/engines are NOT wiped', () => {
    const persisted = mkExercise('ex-live', {
      settings: {
        loopMode: false, advanceEnabled: true, advanceThreshold: 80,
        mode: 'custom', customText: 'my custom answer', saveAudio: true,
        engines: { asr: 'a', check: 'b', ocr: 'c' },
      },
    });
    const update = vi.fn();
    const sink: ArmedSettingsSink = {
      armedSegmentId: () => 'ex-live',
      getEphemeralArm: () => null, // not ephemeral
      getExercises: () => [persisted],
      updateShadowExercise: update,
    };

    persistArmedSettings(sink, { advanceThreshold: 65 });

    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe('ex-live');
    // The fresh spread carries EVERY prior field, only advanceThreshold changed —
    // a bare {settings:{advanceThreshold}} would shallow-replace and wipe these.
    expect(patch.settings.advanceThreshold).toBe(65);
    expect(patch.settings.customText).toBe('my custom answer'); // CRIT-1: must survive
    expect(patch.settings.mode).toBe('custom');
    expect(patch.settings.engines).toEqual({ asr: 'a', check: 'b', ocr: 'c' });
    expect(patch.settings.saveAudio).toBe(true);
  });

  it('reads the store at CALL time (fresh copy) — a mutation to the store between calls is reflected', () => {
    let live = mkExercise('ex-live', { settings: { ...mkExercise('ex-live').settings, customText: 'first' } });
    const update = vi.fn((_id: string, patch: { settings: ShadowExerciseAnnotation['settings'] }) => {
      // simulate the store's immutable replace splicing a new object in
      live = { ...live, settings: patch.settings };
    });
    const sink: ArmedSettingsSink = {
      armedSegmentId: () => 'ex-live',
      getEphemeralArm: () => null,
      getExercises: () => [live],
      updateShadowExercise: update,
    };

    persistArmedSettings(sink, { customText: 'second' });
    persistArmedSettings(sink, { advanceThreshold: 70 });

    // Second call spread the FRESH (already-updated) copy → both fields land.
    expect(update).toHaveBeenCalledTimes(2);
    expect(live.settings.customText).toBe('second');
    expect(live.settings.advanceThreshold).toBe(70);
  });
});

describe('persistArmedSettings — unarmed / missing', () => {
  it('nothing armed → no-op, does not throw, no persist', () => {
    const update = vi.fn();
    const sink: ArmedSettingsSink = {
      armedSegmentId: () => null,
      getEphemeralArm: () => null,
      getExercises: () => [mkExercise('ex-live')],
      updateShadowExercise: update,
    };
    expect(() => persistArmedSettings(sink, { loopMode: false })).not.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('armed id absent from the store (neither ephemeral nor persisted) → no-op', () => {
    const update = vi.fn();
    const sink: ArmedSettingsSink = {
      armedSegmentId: () => 'ghost',
      getEphemeralArm: () => null,
      getExercises: () => [mkExercise('ex-other')],
      updateShadowExercise: update,
    };
    expect(() => persistArmedSettings(sink, { advanceThreshold: 90 })).not.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
