// ServerDown.tsx — «Сервер сейчас не отвечает» с кнопкой повтора (спека §3.9):
// кабинет включён (метка в index.html), а снимок сессии получить не удалось.
import { CabI } from './cab-icons'

export function ServerDown({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="msg err" role="alert">
      <CabI.alert />
      <span style={{ flex: 1 }}>Сервер сейчас не отвечает. Попробуйте ещё раз через несколько секунд</span>
      <button type="button" className="btn sm" onClick={onRetry}>Повторить</button>
    </div>
  )
}

// StaleNotice — страница загружена с меткой кабинета, а сервер говорит, что
// кабинет выключен (флаг выключили после загрузки): виноват не сервер, а
// устаревшая страница. Перезагрузка возьмёт свежую, без метки.
export function StaleNotice() {
  return (
    <div className="msg warn" role="alert">
      <CabI.alert />
      <span style={{ flex: 1 }}>Страница устарела — обновите её</span>
      <button type="button" className="btn sm" onClick={reloadPage}>Обновить</button>
    </div>
  )
}

// reloadPage — режим сайта сменился после загрузки страницы (метка говорит
// «включён», сервер — «выключен»): свежая страница возьмёт новую метку.
export function reloadPage(): void {
  try { window.location.reload() } catch { /* окружение без перезагрузки */ }
}
