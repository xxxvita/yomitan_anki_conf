// shadow-settings-delivery.ts — Срез B (§2 delivery). Единственный «канал b+c»
// доставки live-настроек Shadowing (порог/автопереход/режим/повтор) в АРМЛЕННОЕ
// упражнение, вынесенный из PlayerPage чистой функцией (как shadow-phase.ts /
// bind-range.ts) — чтобы мутационно тестировать обе развилки без монтажа страницы.
//
// Канал a (setShadowState — базовый ShadowState) НЕ здесь: это React-стейт,
// живёт в per-control хендлере PlayerPage. Здесь — только запись в живой арм:
//
//   • ЭФЕМЕРНЫЙ арм (единственный живой путь до среза E): `getEphemeralArm()`
//     возвращает ТОТ ЖЕ объект, что держит координатор в armedExerciseRef
//     (armRange кладёт одну ссылку без клона — useShadowRuntime.ts:968). Поэтому
//     мутация `.settings` IN-PLACE (Object.assign) сразу видна перечитке
//     координатора на границе: startEval :465 делает `getExercises().find(id) ??
//     ex` — эфемерного id в сторе НЕТ (updateShadowExercise('ephemeral-N') —
//     молчаливый no-op, useAnnotations.ts:322), значит liveEx падает в fallback
//     `ex` (= held-объект), а effectiveShadowSettings(ex) :476/:494 читает его
//     .settings. Клон/спред здесь оторвал бы мутацию от held-объекта → порог не
//     доехал бы (интеграц-тест границы red). Гард `eph.id === armedId` — паритет
//     setCustomText (useShadowRuntime.ts:1091): в advance-окне getEphemeralArm()
//     может держать МЁРТВЫЙ объект, за который координатор уже ушёл.
//
//   • PERSISTED арм (id в annotations): `updateShadowExercise` делает
//     SHALLOW-merge (useAnnotations.ts:325) — `{settings:{thr}}` заменил бы
//     settings ЦЕЛИКОМ, стерев customText/engines/loopMode (CRIT-1). Поэтому
//     спред СВЕЖЕЙ копии settings из стора В МОМЕНТ вызова + patch. Свежесть
//     обязательна: предыдущий updateShadowExercise сплайснул НОВЫЙ объект в
//     массив (иммутабельный replace), захваченная раньше копия была бы stale.
//
// НЕармленный (armedSegmentId()===null) → no-op (нечего мутировать; loop-кнопка
// при неармленном пишет только state — канал a в хендлере).
//
// ⚠️ M2 (fix-wave среза B, ЗАДОКУМЕНТИРОВАНО, не пофикшено): канал c (persisted,
// updateShadowExercise) шлёт ОДНОПОЛЬНЫЙ patch. Если ДВА разных поля settings
// прилетят в ОДИН синхронный тик (напр. один хендлер вызовет persistArmedSettings
// дважды подряд), ВТОРОЙ вызов спредит `{...ex.settings, ...}` из СТЕЙЛ-снимка
// стора (первый updateShadowExercise ещё не сфлашился в массив аннотаций) и
// ЗАТРЁТ поле, записанное первым. Единственная защита сейчас — React флашит стор
// между ДИСКРЕТНЫМИ пользовательскими событиями (два клика/ввода не бывают в одном
// тике). При появлении ПЕРВОГО же двухпольного патча (один UI-жест меняет 2 поля)
// здесь нужен merge на основе LIVE-стора (перечитка getExercises() перед КАЖДЫМ
// полем, либо приём всего multi-field patch и один updateShadowExercise).
// Канал b (эфемерный, Object.assign) от этого не страдает — мутирует ОДИН живой
// объект, никакого промежуточного стейл-снимка нет.
import type { ShadowExerciseAnnotation } from './panel-types';

/** Подмножество settings, которое доставляют контролы settingsRow. */
export type ArmedSettingsPatch = Partial<ShadowExerciseAnnotation['settings']>;

/** Минимальная поверхность рантайма, которую читает доставка (для тестируемости
 *  без всего useShadowRuntime — реальный рантайм подставляется в PlayerPage). */
export interface ArmedSettingsSink {
  armedSegmentId(): string | null;
  getEphemeralArm(): ShadowExerciseAnnotation | null;
  getExercises(): ReadonlyArray<ShadowExerciseAnnotation>;
  updateShadowExercise(
    id: string,
    patch: { settings: ShadowExerciseAnnotation['settings'] },
  ): void;
}

export function persistArmedSettings(sink: ArmedSettingsSink, patch: ArmedSettingsPatch): void {
  const armedId = sink.armedSegmentId();
  if (armedId == null) return; // неармлен → канал b/c нечего писать (state пишет хендлер)

  const eph = sink.getEphemeralArm();
  // b) ЭФЕМЕРНЫЙ и ВСЁ ЕЩЁ реально армлен → мутация held-объекта IN-PLACE.
  if (eph && eph.id === armedId) {
    Object.assign(eph.settings, patch);
    return;
  }

  // c) PERSISTED → спред СВЕЖЕЙ копии из стора + patch (shallow-merge не затрёт
  //    остальные поля settings). Отсутствует в сторе (гонка/уже удалён) → no-op.
  const ex = sink.getExercises().find(e => e.id === armedId);
  if (ex) {
    sink.updateShadowExercise(armedId, { settings: { ...ex.settings, ...patch } });
  }
}
