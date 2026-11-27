// cabinet-marker.ts — метка режима кабинета в index.html для тестов: BFF кладёт
// <meta name="flib-cabinet" content="1"> только при CABINET_ENABLED=1.
export function setCabinetMarker(on: boolean): void {
  document.head.querySelectorAll('meta[name="flib-cabinet"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta')
  m.setAttribute('name', 'flib-cabinet')
  m.setAttribute('content', '1')
  document.head.appendChild(m)
}
