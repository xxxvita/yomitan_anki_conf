// ГСЧ интерфейса (спека §5.1 «ГСЧ движка — только движку»): порядок вариантов ответа S3 и любые
// случайности UI берут свой PCG, засеянный от sha1(run_id) и номера задания. Поток движка
// (newEngineRand(seed)) он не трогает — повтор ответов при восстановлении даёт те же задания,
// а один и тот же прогон показывает варианты в том же порядке.
import { PCG, Rand } from './pcg';
import { sha1Hex } from './sha1';

const M64 = (1n << 64n) - 1n;

/** PCG(seed1 = sha1(run_id)[0:8], seed2 = sha1(run_id)[8:16] XOR i). */
export function uiRand(runId: string, item: number): Rand {
  if (runId === '') throw new RangeError('uiRand: empty run_id');
  if (!Number.isSafeInteger(item) || item < 0) throw new RangeError(`uiRand: invalid item ${item}`);
  const h = sha1Hex(runId);
  const s1 = BigInt(`0x${h.slice(0, 16)}`);
  const s2 = (BigInt(`0x${h.slice(16, 32)}`) ^ BigInt(item)) & M64;
  return new Rand(new PCG(s1, s2));
}

/**
 * Порядок показа n вариантов задания item: перестановка индексов 0..n-1 (0 — верный перевод,
 * 1..n-1 — дистракторы банка по порядку). Позиция верного = indexOf(0).
 */
export function optionOrder(runId: string, item: number, n = 4): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  uiRand(runId, item).shuffle(n, (i, j) => {
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  });
  return p;
}
