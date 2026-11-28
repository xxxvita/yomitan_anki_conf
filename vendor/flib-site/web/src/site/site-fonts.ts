// site-fonts.ts — шрифты дизайн-темы .site (лендинг/воронка/маршрут/тест).
//
// Self-hosted через @fontsource (npm), НЕ Google CDN — CSP на сайте
// `font-src 'self'`, а @fontsource пакует woff2 вместе со сборкой и отдаёт
// их с того же origin (см. temp/flib/styles.css:7-9 для исходных
// font-family, docs/plan-2026-07-13-design-transfer.md, Э0).
//
// JS-модуль, а не .css: bare-specifier `@import` в чистом CSS Vite тоже
// умеет резолвить из node_modules, но здесь предпочли явные ESM-импорты —
// тот же приём, каким сюда попадают сами @fontsource-пакеты (побочный
// эффект — регистрация @font-face через сайд-эффект импорта .css).
//
// Веса — только то, что реально используется в перенесённых стилях:
// Lora 400/500/600 + italic 400/500 (--serif, .hero h1 em и т.п.; решение
// владельца 2026-11-19 — вместо Newsreader, у которого нет кириллицы), только
// latin + cyrillic woff2 — lora.css,
// Inter Tight 400/500/600/700 (--sans, основной текст/кнопки),
// JetBrains Mono 400/500/600 (--mono, eyebrow/лейблы/цифры).
import './lora.css'

import '@fontsource/inter-tight/400.css'
import '@fontsource/inter-tight/500.css'
import '@fontsource/inter-tight/600.css'
import '@fontsource/inter-tight/700.css'

import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
