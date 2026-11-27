// external-links.ts — канонические внешние ссылки проекта в ОДНОМ месте, чтобы
// подвал (LandingPage.tsx) и модалки (LoginModal.tsx и др.) не разъезжались
// при смене адресов.
//
// Контакты (решение владельца 2026-11-16 «Везде как на /buy»): канал —
// @flibclub, поддержка — бот помощи @FliboosterHelpUser_bot. Прежняя пометка
// «flibclcub — НЕ исправлять» отменена этим решением. Страницы берут адреса
// только отсюда (сторож — __tests__/external-links.test.ts).
export const TELEGRAM_CHANNEL_HANDLE = 'flibclub'
export const TELEGRAM_CHANNEL_URL = `https://t.me/${TELEGRAM_CHANNEL_HANDLE}`
// Поддержка: технические вопросы, проблемы с оплатой, потерянный ключ.
export const SUPPORT_BOT_HANDLE = 'FliboosterHelpUser_bot'
export const SUPPORT_BOT_URL = `https://t.me/${SUPPORT_BOT_HANDLE}`
// Функциональный бот проекта (выдача демо-ключа, привязка Telegram к ключу) —
// НЕ поддержка, его адрес остаётся прежним.
export const TELEGRAM_BOT_URL = 'https://t.me/flibclub_bot'

// Страницы сайта, на которые ведёт подвал кабинета (спека кабинета §3.8).
// Пути относительные: сайт открыт на двух доменах, человек остаётся на своём.
// /download.html отдаёт лендинг шлюза, /extension — SPA.
export const DOWNLOAD_PAGE_PATH = '/download.html'
export const EXTENSION_PAGE_PATH = '/extension'

// Расширение Flib-club. FIREFOX_ADDON_URL появится после одобрения в AMO;
// до этого карточка Firefox на /extension показывает статус без ссылки.
export const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/flib-club/lnlehlopldabanpkngijoaajfghmpflo'
export const FIREFOX_ADDON_URL: string | null = null
export const EXTENSION_SOURCE_URL = 'https://github.com/xxxvita/yomitan_anki_conf'
