// web/src/player/workspace/i18n-mini.ts
// WEB-SEAM-история: при лифте плеера с десктопа сюда положили ru-only заглушку
// useT (17 ключей), т.к. десктопная i18n (zustand + en/ru.ts) не переносилась.
// Спринт i18n-foundation (T1) поднял настоящий двуязычный стор в
// web/src/player/i18n.ts (ru+en, useSyncExternalStore, персист flib:locale).
// Этот файл теперь — тонкий реэкспорт, чтобы НЕ трогать лифтнутый
// WorkspacePanelThemed.tsx (его `import { useT } from './i18n-mini'` остаётся).
// Сигнатура useT неизменна: (key, params?) => string.
export { useT } from '../i18n'
