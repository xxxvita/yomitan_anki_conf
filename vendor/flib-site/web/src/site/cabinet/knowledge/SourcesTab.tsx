// SourcesTab.tsx — «Мои источники»: что Вы добавляли (макет §5: таблица Источник ·
// Тип · Слов · Добавлен). История хранится только в этом браузере (на сервере её
// нет), поэтому на другом устройстве её не будет. Удаления источника нет: сервер не
// хранит, из какого источника пришло слово.
import { useState } from 'react'
import { clearHistory, readHistory, type SourceEntry } from './knowledge-history'

function day(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function SourcesTab({ keyPrefix, version }: { keyPrefix: string; version: number }) {
  // version меняется после каждой записи слов — список читается заново.
  const [cleared, setCleared] = useState(0)
  void cleared
  void version
  const items: SourceEntry[] = readHistory(keyPrefix)
  return (
    <div className="kn-sources">
      {items.length === 0 ? (
        <p className="mute" data-testid="kn-sources-empty">Источников пока нет. Добавьте текст, ролик или запись на вкладке «Добавить».</p>
      ) : (
        <>
          <table className="tbl">
            <thead>
              <tr><th>Источник</th><th className="hide-n">Тип</th><th>Слов</th><th className="hide-n">Добавлен</th></tr>
            </thead>
            <tbody>
              {items.map((e, i) => (
                <tr key={`${e.at}-${i}`} data-testid="kn-source">
                  <td className="kn-src-title">
                    {e.kind === 'youtube' && e.video_id
                      ? <a href={`https://www.youtube.com/watch?v=${e.video_id}`} target="_blank" rel="noopener noreferrer">{e.title}</a>
                      : e.title}
                  </td>
                  <td className="hide-n">{e.kind === 'youtube' ? 'YouTube' : 'Текст'}</td>
                  <td className="num">{e.added}</td>
                  <td className="num hide-n">{day(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mute kn-lead">История добавленного на этом устройстве. На другом устройстве или в другом браузере её не будет.</p>
          <button type="button" className="btn sm" data-testid="kn-clear" onClick={() => { clearHistory(keyPrefix); setCleared(n => n + 1) }}>Очистить историю</button>
        </>
      )}
    </div>
  )
}
