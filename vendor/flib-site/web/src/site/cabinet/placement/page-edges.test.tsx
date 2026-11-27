// Края страницы теста: стирание на «Выходе» (оба префикса, не 401), блок «Маршрут», `/test` → `/app/test`
// для вошедшего и гостевой `/test`, сводка usePlacement (один запрос на вкладку и ключ).
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { eraseRouteStorage, ROUTE_LOGOUT_PREFIXES } from '../route/route-storage';
import { RouteBlock } from './ui/RouteBlock';
import { __resetPlacementCacheForTests, invalidatePlacement, usePlacement } from './use-placement';
import { fakeServer, json, type FakeServer } from './__fixtures__/fake-server';
import { lsKeyOf } from './site-host';
import { __resetSessionForTests, __setSessionForTests, cabinetLogout } from '../../session';
import { App } from '../../../App';

vi.mock('../../test-page/math', () => ({}));

let server: FakeServer;
beforeEach(() => {
  localStorage.clear();
  __resetSessionForTests();
  __resetPlacementCacheForTests();
  server = fakeServer();
  vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => server.fetch(u, i)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.head.innerHTML = ''; });

describe('«Выход»', () => {
  it('стирает сессию/вкладку теста всех владельцев и «Позже», остальное не трогает', () => {
    expect(ROUTE_LOGOUT_PREFIXES).toContain('flib:placement:v1:');
    expect(ROUTE_LOGOUT_PREFIXES).toContain('flib:placement-later:v1:');
    localStorage.setItem(lsKeyOf('aaaa', 'pt.session'), '{}');
    localStorage.setItem(lsKeyOf('bbbb', 'pt.provider-ui'), '{}');
    localStorage.setItem('flib:placement-later:v1:aaaa', '1');
    localStorage.setItem('flib:other', 'keep');
    eraseRouteStorage(localStorage);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('flib:other')).toBe('keep');
  });

  it('стирание идёт по пути выхода (afterLogout), а 401 ничего не стирает', async () => {
    localStorage.setItem(lsKeyOf('aaaa', 'pt.session'), '{}');
    // 401 на чтении сессии — не «Выход»
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd' });
    expect(localStorage.getItem(lsKeyOf('aaaa', 'pt.session'))).toBe('{}');
    const afterLogout = vi.fn(() => eraseRouteStorage(localStorage));
    const { setLogoutHooks } = await import('../../session');
    setLogoutHooks({ beforeLogout: async () => {}, afterLogout });
    vi.stubGlobal('fetch', vi.fn(async () => json(200, {})));
    await cabinetLogout();
    expect(afterLogout).toHaveBeenCalled();
    expect(localStorage.getItem(lsKeyOf('aaaa', 'pt.session'))).toBeNull();
    setLogoutHooks(null);
  });
});

describe('RouteBlock', () => {
  const R = (state: Parameters<typeof RouteBlock>[0]['state'], onApply = vi.fn()) =>
    render(<MemoryRouter><RouteBlock lang="ru" state={state} onApply={onApply} /></MemoryRouter>);

  it('working / done (+учтено слов) / failed → «Повторить» / declined → «Учесть слова теста»', () => {
    const a = R({ k: 'working' });
    expect(screen.getByText('Передаём слова маршруту…')).toBeTruthy();
    a.unmount();
    const b = R({ k: 'done', counted: 120 });
    expect(screen.getByText('Готово: маршрут учтёт эти слова при следующем подборе видео.')).toBeTruthy();
    expect(screen.getByText('Учтено слов: 120')).toBeTruthy();
    b.unmount();
    const onApply = vi.fn();
    const c = R({ k: 'failed' }, onApply);
    expect(screen.getByText('Не удалось передать слова маршруту.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onApply).toHaveBeenLastCalledWith(false);
    c.unmount();
    R({ k: 'declined' }, onApply);
    expect(screen.getByText('Вы начали маршрут с уровнем, выбранным самостоятельно.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Учесть слова теста' }));
    expect(onApply).toHaveBeenLastCalledWith(true);
  });

  it('маршрут начат — «К маршруту», не начат — «Выбрать цель и начать маршрут»; сообщения живые (aria-live)', async () => {
    server.routeState = { started: true };
    const a = R({ k: 'idle' });
    await waitFor(() => expect(screen.getByRole('link').textContent).toBe('К маршруту'));
    expect(a.container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});

describe('/test → /app/test', () => {
  const mountApp = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  const mark = (route = false) => {
    for (const n of route ? ['flib-cabinet', 'flib-route'] : ['flib-cabinet']) { const m = document.createElement('meta'); m.name = n; m.content = '1'; document.head.appendChild(m); }
  };

  it('кабинет включён, метка маршрута есть и вошёл → страница теста кабинета', async () => {
    mark(true);
    __setSessionForTests({ status: 'ready', cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true });
    mountApp('/test');
    await waitFor(() => expect(screen.getAllByText('Тест уровня').length).toBeGreaterThan(0));
    expect(screen.queryByText('Оценка Вашего английского на слух')).toBeNull();
  });

  it('кабинет включён, вошёл, но метки маршрута нет — прежняя страница (редирект только при обеих метках)', async () => {
    mark();
    __setSessionForTests({ status: 'ready', cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true });
    mountApp('/test');
    expect(await screen.findByText('Оценка Вашего английского на слух')).toBeTruthy();
  });

  it('гость при включённом кабинете и кабинет выключен — прежняя страница', async () => {
    mark(true);
    __setSessionForTests({ status: 'ready', cabinet: true, authenticated: false, state: null });
    const a = mountApp('/test');
    expect(await screen.findByText('Оценка Вашего английского на слух')).toBeTruthy();
    a.unmount();
    document.head.innerHTML = '';
    mountApp('/test');
    expect(await screen.findByText('Оценка Вашего английского на слух')).toBeTruthy();
  });
});

describe('usePlacement', () => {
  it('сбой чтения не кэшируется: следующее монтирование спрашивает заново', async () => {
    __setSessionForTests({ status: 'ready', cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd' });
    server.once('GET', '/api/me/placement/summary', json(500, { error: 'x' }));
    const a = renderHook(() => usePlacement());
    await waitFor(() => expect(a.result.current.error).toBe(true));
    a.unmount();
    const b = renderHook(() => usePlacement());
    await waitFor(() => expect(b.result.current.summary).toBeDefined());
    expect(server.callsTo('GET', '/api/me/placement/summary')).toHaveLength(2);
  });

  it('один запрос на вкладку и ключ; invalidatePlacement перечитывает; unfinished — живой прогон владельца', async () => {
    __setSessionForTests({ status: 'ready', cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd' });
    const a = renderHook(() => usePlacement());
    const b = renderHook(() => usePlacement());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(server.callsTo('GET', '/api/me/placement/summary')).toHaveLength(1);
    expect(a.result.current.summary).toMatchObject({ owner: server.owner, last: null, pending: false });
    expect(a.result.current.unfinished).toBe(false);
    localStorage.setItem(lsKeyOf(server.owner, 'pt.session'), JSON.stringify({ v: 1, run_id: 'pt-a-0000000000000001', updated_at: new Date().toISOString(), answers: [] }));
    await act(async () => { invalidatePlacement(); });
    await waitFor(() => expect(a.result.current.unfinished).toBe(true));
    expect(server.callsTo('GET', '/api/me/placement/summary')).toHaveLength(2);
  });

  it('сбой чтения → error, без падения; другой ключ — свой запрос', async () => {
    __setSessionForTests({ status: 'ready', cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd' });
    server.once('GET', '/api/me/placement/summary', json(500, { error: 'storage_error' }));
    const a = renderHook(() => usePlacement());
    await waitFor(() => expect(a.result.current.error).toBe(true));
    expect(a.result.current.summary).toBeUndefined();
    await act(async () => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_zzzz' }); });
    await waitFor(() => expect(a.result.current.error).toBe(false));
    expect(server.callsTo('GET', '/api/me/placement/summary')).toHaveLength(2);
  });
});
