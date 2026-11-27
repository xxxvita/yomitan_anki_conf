// Страница теста целиком: поддельный BFF (fake-server), поддельный <audio>, банк bank.fixture.js (v2, без клипов).
// Ворота, S0 → S1–S3 → результат, ОДИН PUT на финиш, apply с точным телом, R16, более новый результат на
// другом устройстве, 401/409 при финише, сеть и звук, вторая вкладка, StrictMode, dispose, смена ключа.
import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { PlacementPage, type PlacementDeps } from './PlacementPage';
import type { ApplyOutcome } from './apply';
import { createPlayer } from './audio';
import { audioFileOf, loadBank, type Bank } from './engine/bank';
import { defaultParams } from './engine/params';
import { newSession, type Item } from './engine/session';
import { openSiteHost, lsKeyOf, type SiteHost } from './site-host';
import { fakeServer, json, type FakeServer } from './__fixtures__/fake-server';
import { fakeLocks } from './__fixtures__/fake-locks';
import { fakeAudioFactory } from './__fixtures__/fake-audio';
import { installBlobUrls, okResponse, restoreBlobUrls, unblob } from './__fixtures__/player-kit';
import { finishRun, startRun, type RunOutcome } from './store';
import { __resetSessionForTests, __setSessionForTests } from '../../session';
import { usePlacement } from './use-placement';
import { setRouteMarker } from '../route/__tests__/route-page-fakes';
import { __resetPlacementCacheForTests } from './use-placement';
import { resetBankLoaderForTest } from './bank-loader';

function fixtureBank(): Bank {
  const src = readFileSync(join(__dirname, '__fixtures__', 'bank.fixture.js'), 'utf8');
  const b = loadBank(src.slice(src.indexOf('(') + 1, src.lastIndexOf(')')));
  b.clips = [];
  return b;
}
const BANK = fixtureBank();
const SEED = 42n;
const KNOWN_MAX_RANK = 1500;
const T0 = Date.parse('2026-11-25T10:00:00Z');

const byFile = new Map<string, { lemma: string; pseudo: boolean }>();
for (const w of BANK.words) byFile.set(audioFileOf('word', w.lemma), { lemma: w.lemma, pseudo: false });
for (const p of BANK.pseudo) byFile.set(audioFileOf('pseudo', p), { lemma: p, pseudo: true });
const rankOf = new Map(BANK.words.map((w) => [w.lemma, w.rank]));
const knows = (lemma: string, pseudo: boolean) => !pseudo && (rankOf.get(lemma) ?? 1e9) <= KNOWN_MAX_RANK;

const settle = () => act(async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); });

let server: FakeServer;
let locks: ReturnType<typeof fakeLocks>;
let audio: ReturnType<typeof fakeAudioFactory>;
let audioStatus = 200;
const hosts: SiteHost[] = [];

beforeEach(() => {
  installBlobUrls();
  localStorage.clear();
  __resetSessionForTests();
  __resetPlacementCacheForTests();
  resetBankLoaderForTest();
  setRouteMarker(true);
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false });
  server = fakeServer();
  locks = fakeLocks();
  audio = fakeAudioFactory();
  audioStatus = 200;
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => server.fetch(u, i)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  for (const h of hosts.splice(0)) h.dispose();
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setRouteMarker(false);
  restoreBlobUrls();
});

function depsOf(over: PlacementDeps = {}): PlacementDeps {
  return {
    loadBank: async () => BANK,
    makePlayer: () => createPlayer({
      makeAudio: audio.make, delaysMs: [0, 0, 0],
      fetch: async (u: string) => (audioStatus === 200 ? okResponse(u) : okResponse('', audioStatus)),
    }),
    newSeed: () => SEED,
    now: () => T0,
    supported: () => true,
    openHost: async (o) => { const h = await openSiteHost({ ...o, locks }); hosts.push(h); return h; },
    ...over,
  };
}

function mount(over: PlacementDeps = {}, strict = false) {
  const el = <MemoryRouter><PlacementPage deps={depsOf(over)} /></MemoryRouter>;
  return render(strict ? <StrictMode>{el}</StrictMode> : el);
}

const lastHeard = () => {
  const src = unblob(audio.plays().at(-1)!);
  return byFile.get(src.slice(src.lastIndexOf('/') + 1))!;
};

async function passS0(prior = 'Учили в школе или по учебнику') {
  fireEvent.click(screen.getByLabelText(prior));
  fireEvent.click(screen.getByRole('button', { name: 'Проверить звук' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Слышу' }));
  fireEvent.click(screen.getByRole('button', { name: 'Начать тест' }));
  await settle();
}

async function answerOne(seen: Item['kind'][] = []): Promise<boolean> {
  if (screen.queryByRole('button', { name: 'Знаю' })) {
    const it = lastHeard();
    seen.push('aural_yesno');
    fireEvent.click(screen.getByRole('button', { name: knows(it.lemma, it.pseudo) ? 'Знаю' : 'Не знаю' }));
  } else if (screen.queryByText('Что значит это слово?')) {
    const it = lastHeard();
    seen.push('meaning_mc');
    const opts = [...document.querySelectorAll<HTMLButtonElement>('button[data-opt]')];
    const ru = BANK.words.find((w) => w.lemma === it.lemma)!.ru!;
    const right = opts.find((b) => b.textContent!.includes(ru))!;
    fireEvent.click(knows(it.lemma, false) ? right : opts.find((b) => b !== right)!);
  } else {
    return false;
  }
  await settle();
  return true;
}

async function answerAll(seen: Item['kind'][] = []) {
  for (let i = 0; i < 200 && (await answerOne(seen)); i++);
}

function expectedEngine(prior = 'school') {
  const s = newSession(BANK, defaultParams(), prior, SEED);
  for (let it = s.next(); it; it = s.next()) {
    s.answer(it, it.kind === 'aural_yesno' ? { yes: knows(it.lemma, it.pseudo) } : { correct: knows(it.lemma, false) });
  }
  return s.result();
}

const puts = () => server.callsTo('PUT', '/api/me/placement');
const applies = () => server.callsTo('POST', '/api/me/placement/apply');
const sessionKey = () => lsKeyOf(server.owner, 'pt.session');

/** Заготовка файла ключа: прежние прогоны, записанные через настоящее хранилище. */
async function seedServer(build: (h: SiteHost) => Promise<void>) {
  const h = await openSiteHost({ apiDeps: { fetch: server.fetch }, storage: localStorage, locks: fakeLocks() });
  try { await build(h); } finally { h.dispose(); await new Promise((r) => setTimeout(r, 0)); }
}
const outcome = (flags: string[] = [], level: RunOutcome['level'] = 'A2'): RunOutcome => ({
  level, vocab_size: 2100, ci90: [1800, 2400], listening_offset: 0, flags, words: [{ lemma: 'w0001', p: 0.9, rank: 1, cefrj: 1 }],
});
const RUN_A = 'pt-aaaa-0000000000000001';
const RUN_B = 'pt-bbbb-0000000000000002';

describe('ворота и шапка', () => {
  it('без метки маршрута — «Скоро»; ключ истёк — продление; нет права маршрута — объяснение', async () => {
    setRouteMarker(false);
    const a = mount();
    expect(screen.getByText('Скоро')).toBeTruthy();
    a.unmount();
    setRouteMarker(true);
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'expired', keyPrefix: 'tpk_abcd' });
    const b = mount();
    expect(screen.getByText('Срок действия ключа закончился')).toBeTruthy();
    expect(server.calls).toHaveLength(0);
    b.unmount();
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: false });
    mount();
    expect(screen.getByText(/Маршрут недоступен для этого ключа/)).toBeTruthy();
    expect(server.calls).toHaveLength(0);
  });

  it('шапка в стиле .ph: «Тест уровня» и h1 «Что Вы узнаёте на слух», атрибуция внизу', async () => {
    const { container } = mount();
    await settle();
    expect(container.querySelector('.ph .mono')!.textContent).toBe('Тест уровня');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Что Вы узнаёте на слух');
    expect(container.querySelector('.ph h1 em')!.textContent).toBe('на слух');
    expect(screen.getByText(/CEFR-J Wordlist Version 1\.5/)).toBeTruthy();
  });
});

describe('полный прогон', () => {
  it('StrictMode: S0 → S1–S3 → результат = result() движка; ОДИН PUT на финиш; apply с точным телом; «Готово»', async () => {
    mount({}, true);
    await settle();
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy(); // без замка «чужой вкладки»
    expect(screen.queryByText(/Старт/)).toBeNull();
    await passS0();
    // сессия — в localStorage под owner, на сервер ничего не уходит
    expect(JSON.parse(localStorage.getItem(sessionKey())!).run_id).toMatch(/^pt-/);
    expect(puts()).toHaveLength(0);
    const seen: Item['kind'][] = [];
    await answerAll(seen);
    const want = expectedEngine();
    expect(seen.filter((k) => k === 'meaning_mc').length).toBeGreaterThan(0);
    expect(screen.getByText(`Уровень ${want.level}`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Словарь ≈ ${want.vocab_size.toLocaleString('ru-RU').replace(/\s/g, '\\s')} слов`))).toBeTruthy();
    expect(screen.getByText(/не чаще раза в неделю/)).toBeTruthy();
    expect(screen.getByText(/Старт/).closest('[data-sn]')!.textContent).toContain(want.level);
    // ровно один PUT: результат + история
    expect(puts()).toHaveLength(1);
    expect(Object.keys((puts()[0].body as { set: object }).set).sort()).toEqual(['docs:pt_results/last', 'kv:pt.history']);
    expect(localStorage.getItem(sessionKey())).toBeNull();
    // apply — точное тело; слова — те же, что отдаёт канал «Мои знания»
    await settle();
    const last = server.doc<{ run_id: string; words: unknown[] }>('docs:pt_results/last')!;
    expect(applies()).toHaveLength(1);
    const body = applies()[0].body as { owner: string; run_id: string; words: Array<{ lemma: string; confidence: number }> };
    expect(body.owner).toBe(server.owner);
    expect(body.run_id).toBe(last.run_id);
    expect(body.words.length).toBeGreaterThan(0);
    for (const w of body.words) expect([50, 70, 90, 95]).toContain(w.confidence);
    expect(screen.getByText('Готово: маршрут учтёт эти слова при следующем подборе видео.')).toBeTruthy();
    expect(screen.getByText(/Учтено слов: \d/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К маршруту' }).getAttribute('href')).toBe('/app/route');
    expect(audio.els.filter((e) => !e.paused).length).toBeLessThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: 'Пройти заново' }));
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy();
  });

  it('маршрут не начат → «Выбрать цель и начать маршрут»', async () => {
    server.routeState = { started: false };
    mount();
    await settle();
    await passS0();
    await answerAll();
    await settle();
    expect(screen.getByRole('link', { name: 'Выбрать цель и начать маршрут' })).toBeTruthy();
  });

  it('слово и признак псевдослова не попадают в DOM до ответа; клавиши на экране S0 мертвы', async () => {
    const { container } = mount();
    await settle();
    fireEvent.keyDown(window, { code: 'Digit1' });
    fireEvent.keyDown(window, { code: 'KeyR' });
    expect(audio.plays()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy();
    await passS0();
    for (let i = 0; i < 12; i++) {
      if (!screen.queryByRole('button', { name: 'Знаю' })) { await answerOne(); continue; }
      const it = lastHeard();
      expect(container.textContent).not.toContain(it.lemma);
      expect(container.innerHTML).not.toMatch(/pseudo/i);
      await answerOne();
    }
  });

  it('клавиши 1/2 отвечают, пока открыт экран задания', async () => {
    mount();
    await settle();
    await passS0();
    expect(screen.getByText('Задание 1')).toBeTruthy();
    fireEvent.keyDown(window, { code: 'Digit1', key: 'ы' });
    await settle();
    expect(screen.getByText('Задание 2')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers).toHaveLength(1);
  });
});

describe('восстановление и звук', () => {
  it('закрыли страницу на 4-м задании → «Продолжить» показывает то же задание; localStorage по owner', async () => {
    const first = mount();
    await settle();
    await passS0();
    for (let i = 0; i < 3; i++) await answerOne();
    first.unmount();
    await settle();
    expect(locks.held.size).toBe(0); // замок отпущен при уходе со страницы

    const s = newSession(BANK, defaultParams(), 'school', SEED);
    for (let i = 0; i < 3; i++) { const it = s.next()!; s.answer(it, { yes: knows(it.lemma, it.pseudo) }); }
    const fourth = s.next()!;

    audio.els.length = 0;
    mount();
    await settle();
    expect(screen.getByText('Тест не закончен')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await settle();
    expect(lastHeard().lemma).toBe(fourth.lemma);
    expect(screen.getByText('Задание 4')).toBeTruthy();
  });

  it('сеть пропала на задании: экран «Не удалось загрузить звук», ответ не записан, «Повторить» играет; три раза — «Прервать тест» и позже «Продолжить»', async () => {
    mount();
    await settle();
    await passS0();
    const before = JSON.parse(localStorage.getItem(sessionKey())!).answers.length;
    audioStatus = 503; // audio_not_ready
    await answerOne();
    expect(screen.getByText('Не удалось загрузить звук. Проверьте интернет.')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers.length).toBe(before + 1); // ответ на предыдущее; следующее без ответа
    const answered = JSON.parse(localStorage.getItem(sessionKey())!).answers.length;
    expect(screen.queryByRole('button', { name: 'Прервать тест' })).toBeNull();
    for (let i = 0; i < 2; i++) { fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); await settle(); }
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers).toHaveLength(answered); // сеть не пишет skipped
    fireEvent.click(screen.getByRole('button', { name: 'Прервать тест' }));
    await settle();
    expect(screen.getByText('Тест не закончен')).toBeTruthy();
    audioStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await settle();
    expect(screen.queryByRole('button', { name: 'Знаю' }) || screen.queryByText('Что значит это слово?')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers).toHaveLength(answered);
  });

  it('звук не воспроизводится (ошибка плеера) на всех словах: пять пропусков → «звук не играл», страница не падает', async () => {
    mount();
    await settle();
    fireEvent.click(screen.getByLabelText('Учили в школе или по учебнику'));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить звук' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Слышу' }));
    audio.state.mode = 'error';
    fireEvent.click(screen.getByRole('button', { name: 'Начать тест' }));
    for (let i = 0; i < 8; i++) await settle();
    expect(screen.getByText(/Звук не играл/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пройти заново' })).toBeTruthy();
  });

  it('файла нет (404) — не пропуск: экран сети, пропусков в сессии нет', async () => {
    mount();
    await settle();
    await passS0();
    audioStatus = 404;
    await answerOne();
    expect(screen.getByText('Не удалось загрузить звук. Проверьте интернет.')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers.some((a: { r: { skipped?: boolean } }) => a.r.skipped)).toBe(false);
  });

  it('двойной щелчок через 150 мс даёт ровно один ответ (следующее слово закрыто до прослушивания)', async () => {
    mount();
    await settle();
    await passS0();
    audio.state.mode = 'start'; // следующее слово не доигрывается
    fireEvent.click(screen.getByRole('button', { name: 'Знаю' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.getByText('Задание 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Знаю' })); // закрыта: слово 2 не прозвучало
    fireEvent.keyDown(window, { code: 'Digit2' });
    await settle();
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers).toHaveLength(1);
    expect(screen.getByText('Задание 2')).toBeTruthy();
  });

  it('два ответа в одном такте (до перерисовки) — страница пишет один и не сдвигает движок дважды', async () => {
    mount();
    await settle();
    await passS0();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' }));
    });
    await settle();
    expect(JSON.parse(localStorage.getItem(sessionKey())!).answers).toHaveLength(1);
    expect(screen.getByText('Задание 2')).toBeTruthy();
  });

  it('браузер без Ogg Opus: сообщение, старта нет, звук не качается', async () => {
    mount({ supported: () => false });
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Safari 18\.4/);
    expect(screen.queryByRole('button', { name: 'Начать тест' })).toBeNull();
    expect(server.calls.filter((c) => c.path.startsWith('/api/placement/audio')).length).toBe(0);
  });
});

describe('финиш и сбои записи', () => {
  it('настоящий 401 при финише: сессия перечитывается (вышел), страница пересоздаётся и довершает финиш с тем же taken_at, один раз', async () => {
    mount();
    await settle();
    await passS0();
    server.once('PUT', '/api/me/placement', json(401, { error: 'unauthorized' }));
    server.once('GET', '/api/session', json(200, { authenticated: false, cabinet: true, reason: 'session_expired' }));
    await answerAll();
    await settle();
    expect(server.callsTo('GET', '/api/session').length).toBeGreaterThan(0); // настоящий refreshSession
    // снимок стал «вышел» → страница пересоздана и (сервер файла отвечает) довершила финиш при открытии
    await settle();
    expect(screen.getByText(/Уровень /)).toBeTruthy();
    expect(server.doc<{ taken_at: string }>('docs:pt_results/last')!.taken_at).toBe(new Date(T0).toISOString());
    expect(server.doc<unknown[]>('kv:pt.history')).toHaveLength(1);
  });

  it('потерян ответ на запись финиша: «Повторить» показывает экран результата ЭТОГО прогона, а не S0', async () => {
    mount({ apply: () => new Promise<ApplyOutcome>(() => {}) });
    await settle();
    await passS0();
    server.once('PUT', '/api/me/placement', async () => {
      await server.fetch('/api/me/placement', { method: 'PUT', body: JSON.stringify(server.calls.at(-1)!.body) });
      throw new TypeError('lost');
    });
    await answerAll();
    expect(screen.getByRole('alert').textContent).toMatch(/Нет связи/);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await settle();
    expect(screen.getByText(/Уровень /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Начать тест' })).toBeNull();
    expect(server.doc<unknown[]>('kv:pt.history')).toHaveLength(1);
  });

  it('PUT 409 stale → ошибка; «Повторить» переоткрывает и заканчивает один раз', async () => {
    mount();
    await settle();
    await passS0();
    server.once('PUT', '/api/me/placement', json(409, { error: 'stale', rev: 9 }));
    await answerAll();
    expect(screen.getByRole('alert').textContent).toMatch(/изменились на другом устройстве/);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await settle();
    await settle();
    expect(screen.getByText(/Уровень /)).toBeTruthy();
    expect(server.doc<unknown[]>('kv:pt.history')).toHaveLength(1);
  });

  it('409 key_changed: сообщение, тест открыт заново под новым владельцем, со старого ключа ничего не записано', async () => {
    mount();
    await settle();
    await passS0();
    server.once('PUT', '/api/me/placement', () => { server.owner = 'ffffffffffffffff'; return json(409, { error: 'key_changed' }); });
    await answerAll();
    await settle();
    await settle();
    expect(screen.getByText('Вы вошли с другим ключом — тест открыт заново.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy(); // у нового владельца своего прогона нет
    expect(Object.keys(server.items)).toEqual([]);
    expect(puts()).toHaveLength(1);
    expect(applies()).toHaveLength(0);
  });
});

describe('одна вкладка и dispose', () => {
  it('замок занят другой вкладкой: сообщение, ничего не пишется; после освобождения «Повторить» открывает тест', async () => {
    mount();
    await settle();
    cleanup();
    await settle();
    locks.held.add(`flib-placement:${server.owner}`);
    mount();
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/открыт в другой вкладке/);
    expect(puts()).toHaveLength(0);
    expect(localStorage.getItem(sessionKey())).toBeNull();
    locks.held.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy();
  });

  it('уход со страницы: замок отпущен, после этого ни записей, ни реакции на клавиши', async () => {
    const { unmount } = mount();
    await settle();
    expect(locks.held.size).toBe(1);
    await passS0();
    const snap = localStorage.getItem(sessionKey());
    unmount();
    await settle();
    expect(locks.held.size).toBe(0);
    fireEvent.keyDown(window, { code: 'Digit1' });
    await settle();
    expect(localStorage.getItem(sessionKey())).toBe(snap);
    expect(puts()).toHaveLength(0);
  });

  it('смена сессии (другой ключ) пересоздаёт страницу: прежний хост снят', async () => {
    mount();
    await settle();
    expect(locks.held.size).toBe(1);
    await act(async () => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_zzzz', routeAllowed: true }); });
    await settle();
    expect(locks.held.size).toBe(1); // новый хост успел открыться, старый освободил замок
    expect(hosts).toHaveLength(2);
    await expect(hosts[0].storage.set('pt.provider-ui', { last_tab: 'history' })).rejects.toMatchObject({ code: 'disposed' });
  });

  it('чужой run_id в localStorage не затирается нашими ответами', async () => {
    mount();
    await settle();
    await passS0();
    const mine = JSON.parse(localStorage.getItem(sessionKey())!);
    const foreign = { ...mine, run_id: 'pt-zzzz-00000000000000ff' };
    localStorage.setItem(sessionKey(), JSON.stringify(foreign));
    await answerOne();
    expect(screen.getByRole('alert')).toBeTruthy(); // «Не удалось сохранить ответ»
    expect(JSON.parse(localStorage.getItem(sessionKey())!).run_id).toBe('pt-zzzz-00000000000000ff');
  });
});

describe('R16, история, более новый результат', () => {
  it('невалидный прогон при прошлом результате → вопрос; «Нет» — apply не зовётся, в истории «не принят»', async () => {
    await seedServer(async (h) => {
      const a = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_A, now: () => T0 - 1e7 });
      await finishRun(h, a, outcome(), { now: () => T0 - 1e7 + 300_000 });
      const b = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_B, now: () => T0 - 1e6 });
      await finishRun(h, b, outcome(['no_audio', 'floor'], 'A1'), { now: () => T0 - 8e5 });
    });
    server.applied = RUN_A;
    mount();
    await settle();
    expect(screen.getByRole('heading', { name: 'Заменить прошлый результат теста?' })).toBeTruthy();
    expect(applies()).toHaveLength(0); // вопрос не закрыт — ничего не применяется
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy();
    expect(server.doc<{ run_id: string }>('docs:pt_results/last')!.run_id).toBe(RUN_A);
    expect(applies()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    await settle();
    expect(screen.getAllByRole('listitem')[0].textContent).toMatch(/не принят/);
  });

  it('«Да, заменить» → pt_results/last заменён и слова применены (apply с телом нового прогона)', async () => {
    await seedServer(async (h) => {
      const a = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_A, now: () => T0 - 1e7 });
      await finishRun(h, a, outcome(), { now: () => T0 - 1e7 + 300_000 });
      const b = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_B, now: () => T0 - 1e6 });
      await finishRun(h, b, outcome(['floor'], 'A1'), { now: () => T0 - 8e5 });
    });
    server.applied = RUN_A;
    mount();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Да, заменить' }));
    await settle();
    await settle();
    expect(server.doc<{ run_id: string }>('docs:pt_results/last')!.run_id).toBe(RUN_B);
    expect(applies()).toHaveLength(1);
    expect((applies()[0].body as { run_id: string; words: unknown[] })).toMatchObject({ run_id: RUN_B, words: [] }); // floor — пустой список
  });

  it('при открытии: результат есть, но не применён и не отклонён → apply сам; применён → не зовётся', async () => {
    await seedServer(async (h) => {
      const a = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_A, now: () => T0 - 1e7 });
      await finishRun(h, a, outcome(), { now: () => T0 - 1e7 + 300_000 });
    });
    const m1 = mount();
    await settle();
    await settle();
    expect(applies()).toHaveLength(1);
    expect((applies()[0].body as { run_id: string }).run_id).toBe(RUN_A);
    m1.unmount();
    await settle();
    mount();
    await settle();
    expect(applies()).toHaveLength(1); // уже применён
  });

  it('сбой apply: «Не удалось передать слова маршруту.» + «Повторить» → «Готово»', async () => {
    mount();
    await settle();
    await passS0();
    server.once('POST', '/api/me/placement/apply', json(500, { error: 'storage_error' }));
    await answerAll();
    await settle();
    expect(screen.getByText('Не удалось передать слова маршруту.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await settle();
    expect(screen.getByText('Готово: маршрут учтёт эти слова при следующем подборе видео.')).toBeTruthy();
    expect(applies()).toHaveLength(2);
  });

  it('declined: на открытии — «Вы начали маршрут с уровнем, выбранным самостоятельно.» и «Учесть слова теста» → apply', async () => {
    await seedServer(async (h) => {
      const a = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_A, now: () => T0 - 1e7 });
      await finishRun(h, a, outcome(), { now: () => T0 - 1e7 + 300_000 });
    });
    server.declined = RUN_A;
    mount();
    await settle();
    expect(applies()).toHaveLength(0);
    expect(screen.getByText('Вы начали маршрут с уровнем, выбранным самостоятельно.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Учесть слова теста' }));
    await settle();
    expect(applies()).toHaveLength(1);
    expect(screen.queryByText('Вы начали маршрут с уровнем, выбранным самостоятельно.')).toBeNull();
  });

  it('на другом устройстве уже есть более новый результат: результат и строка про него, без apply и без «Готово»', async () => {
    await seedServer(async (h) => {
      const a = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_A, now: () => T0 + 60_000 });
      await finishRun(h, a, outcome(), { now: () => T0 + 61_000 });
    });
    server.applied = RUN_A;
    mount();
    await settle();
    await passS0();
    await answerAll();
    await settle();
    expect(screen.getByText(/Уровень /)).toBeTruthy();
    expect(screen.getByText('На другом устройстве уже есть более новый результат — он и учтён.')).toBeTruthy();
    expect(screen.queryByText(/Готово: маршрут/)).toBeNull();
    expect(applies()).toHaveLength(0);
    expect(server.doc<{ run_id: string }>('docs:pt_results/last')!.run_id).toBe(RUN_A);
  });

  it('вкладка «История» запоминается и открывается при следующем открытии; битая история → «Починить историю»', async () => {
    const first = mount();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    await settle();
    expect(JSON.parse(localStorage.getItem(lsKeyOf(server.owner, 'pt.provider-ui'))!)).toEqual({ last_tab: 'history' });
    first.unmount();
    await settle();
    mount();
    await settle();
    expect(screen.getByText('Тестов ещё не было.')).toBeTruthy();
    cleanup();
    await settle();
    localStorage.clear();
    server.items['kv:pt.history'] = { broken: true };
    mount();
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/История тестов повреждена/);
    fireEvent.click(screen.getByRole('button', { name: 'Починить историю' }));
    await settle();
    expect(server.items['kv:pt.history.corrupt']).toEqual({ broken: true });
    expect(server.items['kv:pt.history']).toEqual([]);
    expect(puts()).toHaveLength(1); // резерв и пустая история — одним PUT
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy();
  });

  it('банк не загрузился → русское сообщение, сырой текст ошибки только в лог', async () => {
    mount({ loadBank: async () => { throw new Error('placement bank: not found'); } });
    await settle();
    const alert = screen.getByRole('alert').textContent!;
    expect(alert).toMatch(/Не удалось загрузить тест/);
    expect(alert).not.toMatch(/not found|placement bank/);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('stale и asked', () => {
  it('прогон закрыл вопрос R16 («Нет»): результат без строки про «более новый» (stale не путается с asked)', async () => {
    await seedServer(async (h) => {
      const a = await startRun(h, { prior: 'school', bankVersion: BANK.version, runId: RUN_A, now: () => T0 - 1e7 });
      await finishRun(h, a, outcome(), { now: () => T0 - 1e7 + 300_000 });
    });
    server.applied = RUN_A;
    mount();
    await settle();
    fireEvent.click(screen.getByLabelText('Учили в школе или по учебнику'));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить звук' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Слышу' }));
    audio.state.mode = 'error'; // пять пропусков → невалидный прогон при прошлом результате
    fireEvent.click(screen.getByRole('button', { name: 'Начать тест' }));
    for (let i = 0; i < 8; i++) await settle();
    expect(screen.getByRole('heading', { name: 'Заменить прошлый результат теста?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await settle();
    expect(screen.getByText(/Звук не играл/)).toBeTruthy();
    expect(screen.queryByText(/На другом устройстве/)).toBeNull();
    expect(screen.queryByTestId('pt-route')).toBeNull();
  });
});

describe('жизнь хоста и общий кэш сводки', () => {
  it('смена поколения сессии при том же ключе пересоздаёт страницу: прежний хост снят, новый открыт', async () => {
    mount();
    await settle();
    expect(hosts).toHaveLength(1);
    await act(async () => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false }, true); });
    await settle();
    expect(hosts).toHaveLength(2);
    await expect(hosts[0].storage.set('pt.provider-ui', { last_tab: 'test' })).rejects.toMatchObject({ code: 'disposed' });
  });

  function Probe() { const p = usePlacement(); return <span data-testid="probe">{p.summary?.last ? 'has' : 'none'}</span>; }
  const summaries = () => server.callsTo('GET', '/api/me/placement/summary').length;
  const never = () => new Promise<ApplyOutcome>(() => {});

  it('после финиша сводка Главной/старта сбрасывается и перечитывается (apply к этому не причастен)', async () => {
    render(<MemoryRouter><Probe /><PlacementPage deps={depsOf({ apply: never })} /></MemoryRouter>);
    await settle();
    expect(screen.getByTestId('probe').textContent).toBe('none');
    const before = summaries();
    await passS0();
    await answerAll();
    await settle();
    expect(summaries()).toBeGreaterThan(before);
    expect(screen.getByTestId('probe').textContent).toBe('has');
  });

  it('прогон довершён при открытии (finished): сводка тоже сбрасывается', async () => {
    mount({ apply: never });
    await settle();
    await passS0();
    server.once('PUT', '/api/me/placement', json(503, { error: 'x' }));
    await answerAll();
    cleanup();
    await settle();
    render(<MemoryRouter><Probe /><PlacementPage deps={depsOf({ apply: never })} /></MemoryRouter>);
    await settle();
    await settle();
    expect(screen.getByText(/Уровень /)).toBeTruthy();
    expect(screen.getByTestId('probe').textContent).toBe('has');
  });
});

describe('apply и банк: сбои', () => {
  it('apply: key_changed → тест открыт заново; исключение apply → «Не удалось…» + «Повторить»', async () => {
    mount();
    await settle();
    await passS0();
    server.once('POST', '/api/me/placement/apply', () => { server.owner = 'ffffffffffffffff'; return json(409, { error: 'key_changed' }); });
    await answerAll();
    await settle();
    await settle();
    expect(screen.getByText('Вы вошли с другим ключом — тест открыт заново.')).toBeTruthy();
    expect(hosts).toHaveLength(2);
    cleanup();
    await settle();

    localStorage.clear();
    server = fakeServer();
    mount({ apply: async () => { throw new Error('boom'); } });
    await settle();
    await passS0();
    await answerAll();
    await settle();
    expect(screen.getByText('Не удалось передать слова маршруту.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('банк не загрузился → «Повторить» грузит заново', async () => {
    let n = 0;
    mount({ loadBank: async () => { if (n++ === 0) throw new Error('x'); return BANK; } });
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Не удалось загрузить тест/);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeTruthy();
  });

  it('фокус: на каждом задании и на результате — заголовок', async () => {
    mount();
    await settle();
    await passS0();
    expect(document.activeElement?.className).toContain('pt-q');
    await answerAll();
    expect(document.activeElement?.className).toContain('pt-level');
  });
});
