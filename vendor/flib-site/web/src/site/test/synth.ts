/**
 * ТЗ-6 — синтез профиля + пресеты + fit-суждение + клип-верификация.
 * Порт 1:1 из onboarding-test.html (function synth + inline клип-калибровка в
 * renderClip). См. tz6_synthesis/METHODICHKA.md для семантики полей.
 *
 * ОТЛИЧИЕ ОТ HTML-РЕФЕРЕНСА (осознанное, задокументировано в отчёте): в референсе
 * клип-калибровка — UI-side дисплей-эффект (renderClip считает adj/nt/ns и просто
 * печатает их, НЕ вызывая synth() заново). Здесь, чтобы соответствовать контракту
 * `synthesize(prior, vocab, dec, ei, target?, clipResults?)` и tz6 §3г
 * ("synthesize(clip_results=...) ПЕРЕсобирает пресеты/fit на скорректированном θ"),
 * при переданном clipResults мы пересобираем профиль/пресеты/fit на скорректированном
 * vocab — калибровочная арифметика (delta/adj/nt/ns) 1:1 из renderClip.
 */
import { CLIP_SENTENCES } from './stimuli';
import { clampBand, q250, sig, sizeOf } from './math';
import type {
  ClipCalibration,
  DecodingProfile,
  DecodingResult,
  EIResult,
  FitRoute,
  FitVerdict,
  PriorResult,
  SynthFit,
  SynthPreset,
  SynthProfile,
  SynthResult,
  TargetProfile,
  VocabResult,
} from './types';

/** band -> CEFR-справочная метка (справочно, НЕ используется в роутинге). */
export function cefrReference(band: number): string {
  return band < 2 ? 'A1' : band < 3 ? 'A2' : band < 4.5 ? 'B1' : band < 6 ? 'B2' : band < 7.5 ? 'C1' : 'C2';
}

/**
 * Ожидаемое покрытие лемм цели (token-mixture, НЕ моно-полосный sigmoid — тот занижал
 * предсказание для клипов и инфлировал честных, см. tz6 §5).
 */
export function targetCoverage(theta: number, share: readonly number[], slope = 1.5): number {
  const total = share.reduce((a, b) => a + b, 0) || 1;
  let s = 0;
  share.forEach((x, i) => {
    s += (x / total) * sig(slope * (theta - (i + 1) + 0.5));
  });
  return s;
}

/** Наименьшая полоса, дающая заданное покрытие цели (перебор сетки 0.5..8.5 шаг 0.05). */
export function bandForCoverage(share: readonly number[], coverage: number, slope = 1.5): number {
  for (let i = 0; i <= 160; i++) {
    const th = 0.5 + 0.05 * i;
    if (targetCoverage(th, share, slope) >= coverage) return clampBand(th);
  }
  return 8.5;
}

/**
 * Дедупликация пресетов по (lemmas, name). ПРИМЕЧАНИЕ: референс вычислял переменную
 * `k=lemmas+"|"+(note||name)`, но фактически сравнивал по `lemmas+"|"+name` (k была
 * мёртвым кодом) — здесь порт по реальному рантайм-поведению, без мёртвой переменной.
 */
function dedupePresets(presets: SynthPreset[]): SynthPreset[] {
  const seen = new Set<string>();
  return presets.filter((p) => {
    const key = `${p.lemmas}|${p.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface CoreVocabInputs {
  finalMu: number;
  sizeLemmas: number;
  ci90: [number, number];
  testSd: number;
  estSlope: number;
  flags: string[];
}

/** Собственно синтез профиля/пресетов/fit (без клип-калибровки) — 1:1 порт synth(). */
function buildCore(
  prior: PriorResult,
  vocab: CoreVocabInputs,
  dec: DecodingResult,
  ei: EIResult,
  target?: TargetProfile,
): { profile: SynthProfile; presets: SynthPreset[]; fit: SynthFit } {
  const theta = vocab.finalMu;
  const slope = vocab.estSlope || 1.5;
  const reliable = !vocab.flags.some((f) => f.startsWith('UNVERIFIED'));

  const profile: SynthProfile = {
    vocabBand: theta,
    vocabSize: vocab.sizeLemmas,
    vocabCi: vocab.ci90,
    cefr: cefrReference(theta),
    decodingBand: dec.theta,
    decodingGap: dec.theta == null ? null : +(theta - dec.theta).toFixed(2),
    decodingProfile: 'balanced',
    eiBand: ei.skipped ? null : ei.theta,
    listeningSkew: prior.listeningOffset,
    reliable,
    flags: vocab.flags,
  };

  // профиль декодинга по CI
  let dp: DecodingProfile = 'balanced';
  if (dec.theta != null) {
    const gap = theta - dec.theta;
    const seg = Math.sqrt((vocab.testSd || 0.5) ** 2 + (dec.se || 0.5) ** 2);
    if (gap - 1.28 * seg > 0.5) dp = 'reader_not_listener';
    else if (gap > 0.5) dp = 'reader_suspect';
    else if (gap + 1.28 * seg < -0.5) dp = 'listener_ahead';
  }
  profile.decodingProfile = dp;

  // ICP (доменный профиль) для рекомендованного пресета
  const icp: [string, string] =
    dp.startsWith('reader') || profile.listeningSkew <= -0.3
      ? ['Читатель: большой пассив, слабый слух', 'shadowing_heavy']
      : dp === 'listener_ahead' || profile.listeningSkew >= 0.4
        ? ['Наслушанный: игры/подкасты/сериалы', 'content_first']
        : ['Сбалансированный старт', 'standard'];

  let presets: SynthPreset[] = [
    { name: 'Безопасный низ', lemmas: q250(vocab.ci90[0]), band: clampBand(theta - 0.85) },
    { name: 'По оценке', lemmas: q250(vocab.sizeLemmas), band: theta, rec: true, icp: icp[0] },
    { name: 'Растяжка', lemmas: q250(vocab.ci90[1]), band: clampBand(theta + 0.85) },
  ];
  if (target) {
    const b95 = bandForCoverage(target.share, 0.95, slope);
    presets.push({
      name: `Под цель: ${target.title}`,
      lemmas: q250(sizeOf(b95, slope)),
      band: b95,
      note: 'слов до комфортного просмотра этой цели',
    });
  }
  if (icp[1] !== 'standard') {
    presets.push({ name: icp[0], lemmas: q250(vocab.sizeLemmas), band: theta, note: 'тот же уровень, слова из Вашего домена' });
  }
  presets = dedupePresets(presets);

  // fit-суждение: приоритет надёжность -> floor -> цель -> форма профиля
  let fit: SynthFit = { reliable };
  if (!reliable) {
    fit = {
      reliable: false,
      show: false,
      route: 'retest',
      msg: 'Нам не хватило чистого сигнала — 2 минуты, короткий блок, и соберём заново.',
    };
    presets = [];
  } else if (vocab.flags.includes('FLOOR')) {
    fit = {
      reliable: true,
      show: true,
      route: 'slow_track',
      fit: 'prep' as FitVerdict,
      msg: 'Начнём с подготовительного трека — адаптированный контент и карточки, затем вернёмся к живым сериалам.',
    };
  } else {
    fit.show = true;
    if (target) {
      const cov = targetCoverage(theta, target.share, slope);
      fit.cov = +cov.toFixed(3);
      fit.fit = cov >= 0.93 ? 'ideal' : cov >= 0.75 ? 'good' : 'far_redirect';
      fit.msg =
        cov >= 0.93
          ? `«${target.title}» Вам почти по силам — короткий маршрут.`
          : cov >= 0.75
            ? `«${target.title}» — хорошая цель, маршрут подлиннее, но реально.`
            : `«${target.title}» пока далеко — подберём близкие тайтлы в Вашей зоне и дойдём до цели.`;
      const b95 = bandForCoverage(target.share, 0.95, slope);
      const need = Math.max(0, sizeOf(b95, slope) - vocab.sizeLemmas);
      const eta = need ? Math.ceil(need / (10 * 0.85 * 7)) : 0;
      presets.forEach((p) => {
        p.cov = +targetCoverage(p.band, target.share, slope).toFixed(3);
        p.eta = eta;
      });
      fit.eta = eta;
    }
    const route: FitRoute =
      dp === 'reader_not_listener'
        ? 'shadowing_heavy'
        : dp === 'reader_suspect'
          ? 'shadowing_boost'
          : dp === 'listener_ahead' && theta < 3
            ? 'cards_first'
            : dp === 'balanced' && profile.listeningSkew <= -0.3
              ? 'shadowing_boost'
              : 'standard';
    fit.route = route;
    if (route === 'shadowing_heavy') {
      fit.routeMsg = 'Вы знаете слова, но не всегда слышите их — ровно это мы и чиним.';
    }
  }

  return { profile, presets, fit };
}

/**
 * Клип-калибровка (независимая от θ): предсказание = targetCoverage(θ, clip.share),
 * дефляция/инфляция по средней дельте (заявленное - предсказанное), непрерывная,
 * асимметричная (дефляция до -1.2, инфляция до +0.6), мёртвая зона |adj|<0.15.
 * 1:1 порт финального блока renderClip() из референса.
 */
export function calibrateFromClips(theta: number, slope: number, clipComprehension: number[]): ClipCalibration {
  const deltas = clipComprehension.map((o, i) => o - targetCoverage(theta, CLIP_SENTENCES[i].share, slope));
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  let adjustment = Math.max(-1.2, Math.min(0.6, 1.8 * meanDelta));
  if (Math.abs(adjustment) < 0.15) adjustment = 0;
  const adjustedMu = clampBand(theta + adjustment);
  const adjustedSizeLemmas = q250(sizeOf(adjustedMu, slope));
  return {
    delta: +meanDelta.toFixed(2),
    adjustment,
    adjustedMu,
    adjustedSizeLemmas,
  };
}

/**
 * Синтез итогового профиля/пресетов/вердикта.
 *
 * Порядок параметров: `clipResults` идёт 5-м (согласован с контрактом синтеза, см.
 * tz6_synthesis/METHODICHKA.md §2 "synthesize(clip_results=...)"), `target` — необязательный
 * 6-й (в самом HTML-референсе цель ("какой сериал хочешь понимать") приходит из анкеты
 * ТЗ-2 и не обязательна для synth() — без неё просто не строится "Под цель"-пресет
 * и redirect-ветка fit, остальной синтез работает как обычно).
 *
 * @param clipResults — доли понимания (0..1) по каждому клипу из CLIP_SENTENCES, в том
 *   же порядке. Если передан — пересобирает профиль/пресеты/fit на скорректированном θ
 *   (см. calibration в результате), сама калибровочная дельта считается от ИСХОДНОГО
 *   vocab.finalMu/estSlope (как в референсе), не рекурсивно.
 */
export function synthesize(
  prior: PriorResult,
  vocab: VocabResult,
  dec: DecodingResult,
  ei: EIResult,
  clipResults?: number[],
  target?: TargetProfile,
): SynthResult {
  if (clipResults && clipResults.length) {
    const calibration = calibrateFromClips(vocab.finalMu, vocab.estSlope || 1.5, clipResults);
    const adjustedVocab: CoreVocabInputs = {
      finalMu: calibration.adjustedMu,
      sizeLemmas: calibration.adjustedSizeLemmas,
      ci90: vocab.ci90,
      testSd: vocab.testSd,
      estSlope: vocab.estSlope,
      flags: vocab.flags,
    };
    const core = buildCore(prior, adjustedVocab, dec, ei, target);
    return { ...core, calibration };
  }
  return buildCore(prior, vocab, dec, ei, target);
}
