// Перенос `anki_conf/.../CoursesPanel/route/learning-day.ts` как есть (план B7,
// «Что переносим»); сайту добавлены SITE_TRANSITION_MIN и forDate (спека §4.5).
// УЧЕБНЫЙ ДЕНЬ — величина, отдельная от календарной даты.
//
// Человек сам назначает час, в который у него сменяется учебный день. Всё, что
// он получил до этого часа, принадлежит предыдущему учебному дню. Сервер об этом
// не знает и знать не должен: он отвечает на ту дату, которую ему НАЗВАЛИ
// (`for_date`), а какую назвать — решает эта функция.
//
// ⚠️ ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ДВЕ СТРОЧКИ В КОМПОНЕНТЕ. От этой величины
// зависят сразу три вещи: в какую ячейку календаря лечь ролику, какую дату
// послать демону и как называется кнопка. Ошибка сдвигает ВЕСЬ календарь на
// сутки, и сдвигает молча — на экране это выглядит не как сбой, а как «история
// куда-то делась». Поэтому величина считается в одном месте и накрыта тестами.

export const MINUTES_IN_DAY = 1440;

// Полдень — граница соглашения о подписи блока (см. ниже). Именованная константа,
// потому что число 720 в коде читается как магическое.
const NOON_MINUTES = 720;

// normalizeTransition — переходный час приходит из ХРАНИЛИЩА и может быть испорчен
// (ручная правка настроек, старая версия, сбой записи).
//
// ⚠️ НЕГОДНОЕ ЗНАЧЕНИЕ ПРИВОДИТСЯ К ПОЛУНОЧИ, А НЕ К «ПОХОЖЕМУ ЧАСУ». Соблазн
// взять остаток от деления (1500 → 01:00) отвергнут: выдуманный час выглядит на
// экране как настоящая настройка пользователя, и разобраться, почему календарь
// уехал, будет нечем. Полночь же означает «учебный день = календарный» — самое
// нейтральное поведение, которое сразу видно и ни с чем не спутается.
//
// ⚠️⚠️ ЗАМЕРЕНО МУТАЦИЯМИ, ЧИТАТЬ ДО ПРАВКИ: на результат `learningDayOf` эта
// функция НЕ ВЛИЯЕТ НИ ПРИ КАКОМ входе, и мутанты «убрать проверку диапазона» и
// «убрать проверку NaN» ВЫЖИЛИ — они эквивалентные, а не непокрытые.
// Причина арифметическая: при t ≥ 1440 условие `minutesOfDay < t` истинно всегда
// (минут в сутках максимум 1439) ⇒ сдвиг на день назад, а t ≥ 720 ⇒ сдвиг на день
// вперёд; они гасят друг друга, и выходит календарная дата. При t < 0 и при NaN
// оба сравнения ложны ⇒ тоже календарная дата. То есть ровно то же, что даёт 0.
// ⇒ Экспортируется и проверяется ОТДЕЛЬНО, своими тестами: у сторожа обязан быть
// собственный читатель, иначе он не сторож. Настоящие читатели — экран настроек и
// вычисление `for_date`, которым нужно ЧИСЛО, а не дата.
// ⇒ И не удаляйте её как мёртвую: ненаблюдаемость здесь — свойство соседней
// арифметики, а не признак ненужности. Стоит той арифметике измениться — защита
// снова станет несущей.
export function normalizeTransition(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  const m = Math.trunc(minutes);
  if (m < 0 || m >= MINUTES_IN_DAY) return 0;
  return m;
}

// ymd — дата в виде ГГГГ-ММ-ДД по МЕСТНОМУ времени.
// ⚠️ Намеренно не `toISOString()`: он отдаёт UTC, и для всех, кто восточнее
// Гринвича, вечерние ролики уехали бы в следующий день ещё до переходного часа.
function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * learningDayOf — учебный день, которому принадлежит момент `at`.
 *
 * Границы учебных дней — переходный час каждых суток. Разбиение однозначно;
 * соглашением является только ПОДПИСЬ блока, и она такая:
 *
 *   переход 04:00 → блок [1-го 04:00 … 2-го 04:00) зовётся ПЕРВЫМ  (дата начала)
 *   переход 18:00 → блок [1-го 18:00 … 2-го 18:00) зовётся ВТОРЫМ  (дата конца)
 *
 * Оба варианта естественны для человека, и общее правило, покрывающее их разом:
 * блок подписывается датой ТОГО УТРА, которое в него попадает. Технически —
 * переход до полудня подписывает датой начала, с полудня и позже датой конца.
 *
 * ⚠️ Момент, равный переходному часу, принадлежит УЖЕ НОВОМУ дню (граница
 * закрыта слева). Иначе ровно в 18:00:00 день был бы не определён.
 */
export function learningDayOf(at: Date, transitionMin: number): string {
  const t = normalizeTransition(transitionMin);
  const minutesOfDay = at.getHours() * 60 + at.getMinutes();

  // Дата, в которую блок НАЧАЛСЯ.
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  if (minutesOfDay < t) d.setDate(d.getDate() - 1);

  // Подпись: до полудня — датой начала, иначе — датой конца блока.
  if (t >= NOON_MINUTES) d.setDate(d.getDate() + 1);

  return ymd(d);
}

/**
 * nextLearningDay — следующий учебный день за данным.
 *
 * ⚠️ Считается через Date, а не прибавлением единицы к числу: иначе 31-е января
 * превратится в 32-е, а 28 февраля високосного года потеряет 29-е.
 */
export function nextLearningDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + 1);
  return ymd(next);
}

/**
 * hhmmOfMinutes — минуты от полуночи в «ЧЧ:ММ» для поля ввода.
 *
 * ⚠️ Негодное число показывается как полночь, а не как «NaN:NaN»: поле времени с
 * мусором внутри браузер молча считает пустым, и человек увидел бы не ошибку, а
 * исчезнувшую настройку.
 */
export function hhmmOfMinutes(minutes: number): string {
  const m = normalizeTransition(minutes);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

/**
 * minutesOfHHMM — «ЧЧ:ММ» в минуты от полуночи. `null`, если строка не разобрана.
 *
 * ⚠️⚠️ ПУСТАЯ СТРОКА ДАЁТ null, А НЕ НОЛЬ, И ЭТО НЕСУЩЕЕ. Поле времени отдаёт
 * пустую строку, пока человек стирает и набирает заново. Прочитав её как 0, мы
 * молча переставили бы час смены дня на полночь прямо посреди ввода — календарь
 * разъехался бы у него под руками, и он не понял бы, из-за чего.
 * ⇒ Вызывающий обязан на null НЕ МЕНЯТЬ настройку, а не подставлять умолчание.
 */
export function minutesOfHHMM(raw: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// --- сайт (спека 2026-11-17 §4.5) ------------------------------------------------

/** Переход учебного дня на сайте — 04:00 местного времени (умолчание приложения). */
export const SITE_TRANSITION_MIN = 240;

/** Ключ localStorage: час смены учебного дня (минуты от полуночи), на браузер. */
export const DAY_TRANSITION_KEY = 'flib:route:dayTransitionMin'

/**
 * savedDayTransition — час смены дня, выбранный на экране старта; без записи или с
 * испорченной записью — 04:00. ⚠️ Хранилище может бросить (приватное окно, запрет):
 * чтение и запись обёрнуты, экран без него работает с умолчанием.
 */
export function savedDayTransition(): number {
  try {
    const raw = localStorage.getItem(DAY_TRANSITION_KEY)
    if (raw === null) return SITE_TRANSITION_MIN
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n >= MINUTES_IN_DAY) return SITE_TRANSITION_MIN
    return n
  } catch { return SITE_TRANSITION_MIN }
}

export function saveDayTransition(minutes: number): void {
  try { localStorage.setItem(DAY_TRANSITION_KEY, String(normalizeTransition(minutes))) } catch { /* без хранилища — умолчание */ }
}

function addDaysUTC(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/**
 * forDate — `for_date` обмена: учебный день сейчас, прижатый снизу к
 * `snapshot_date` (иначе шлюз ответит `400 for_date_out_of_range`) и сверху к
 * UTC-сегодня + 2 дня (неверные часы устройства, §7 случай 21).
 *
 * ⚠️ Сравнение строк ГГГГ-ММ-ДД лексикографическое — для этого формата оно и есть
 * сравнение дат.
 */
export function forDate(snapshotDate: string | null | undefined, now: Date = new Date(),
  transitionMin: number = savedDayTransition()): string {
  let day = learningDayOf(now, transitionMin);
  const top = addDaysUTC(now.toISOString().slice(0, 10), 2);
  if (day > top) day = top;
  if (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) && day < snapshotDate) day = snapshotDate;
  return day;
}
