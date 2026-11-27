// Сторож согласия: текст привязан к версии. Правка PROFILE_CONSENT_TEXT без новой
// PROFILE_CONSENT_VERSION (и записи в таблицу ниже) валит этот тест — иначе
// шлюз хранил бы «принял версию v1» для текста, которого пользователь не видел.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { PROFILE_CONSENT_TEXT, PROFILE_CONSENT_VERSION } from '../cabinet/profile-api'

const PINNED: Record<string, string> = {
  'profile-v1': createHash('sha256').update('Даю согласие на обработку моей почты и имени, чтобы Flibooster писал мне по ключу и обращался по имени.').digest('hex'),
}

describe('согласие профиля', () => {
  it('версия известна, и текст соответствует её отпечатку', () => {
    const pinned = PINNED[PROFILE_CONSENT_VERSION]
    expect(pinned, `нет отпечатка для версии ${PROFILE_CONSENT_VERSION}: добавьте в PINNED`).toBeTruthy()
    expect(createHash('sha256').update(PROFILE_CONSENT_TEXT).digest('hex')).toBe(pinned)
  })
  it('формулировка нейтральна по роду', () => {
    expect(PROFILE_CONSENT_TEXT).not.toMatch(/Согласен/)
  })
})
