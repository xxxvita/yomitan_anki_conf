// Банк теста (data/bank-v2.json, спека: импорт ?url + fetch + строгий loadBank + checkPackagedBank).
// Один промис на страницу: повторный вызов (StrictMode, несколько экранов) получает тот же; неудача не залипает.
import bankUrl from './data/bank-v2.json?url';
import { loadBank, SCHEMA_V2, type Bank } from './engine/bank';

export const BANK_LOAD_TIMEOUT_MS = 60_000;

let inflight: Promise<Bank> | null = null;

/**
 * Пакетный банк — только схема 2 и без клипов. Экраны умеют aural_yesno и meaning_mc; слово без ru
 * движок не даёт в S3 только при схеме ≥ 2, а S4 (клипы) в MVP нет (R22) — иначе задание, которое
 * нельзя показать. Схема 1 — только явный тестовый путь (allowSchema1ForTest).
 */
export function checkPackagedBank(b: Bank, opts: { allowSchema1ForTest?: boolean } = {}): Bank {
  if (b.schema_version !== SCHEMA_V2 && !opts.allowSchema1ForTest) throw new Error(`placement bank: packaged bank must be schema 2, got ${b.schema_version}`);
  if ((b.clips ?? []).length > 0) throw new Error('placement bank: packaged bank must have no clips (S4 is not in MVP)');
  return b;
}

async function fetchBank(url: string, opts: { allowSchema1ForTest?: boolean }): Promise<Bank> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BANK_LOAD_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctl.signal });
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'placement bank: timeout' : `placement bank: network (${(e as Error).name})`);
    }
    if (res.status !== 200) throw new Error(`placement bank: http ${res.status}`);
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new Error(ctl.signal.aborted ? 'placement bank: timeout' : 'placement bank: network');
    }
    return checkPackagedBank(loadBank(text), opts);
  } finally {
    clearTimeout(timer);
  }
}

/** Грузит банк один раз на страницу; url и allowSchema1ForTest — только для тестов. */
export function loadPlacementBank(url: string = bankUrl, opts: { allowSchema1ForTest?: boolean } = {}): Promise<Bank> {
  if (inflight) return inflight;
  const p = fetchBank(url, opts);
  inflight = p;
  // Неудача не залипает: следующий вызов пробует снова.
  p.catch(() => { if (inflight === p) inflight = null; });
  return p;
}

/** Только тестам. */
export function resetBankLoaderForTest(): void {
  inflight = null;
}
