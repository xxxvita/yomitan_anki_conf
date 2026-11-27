// Набор для тестов экранов: настоящий createPlayer поверх подделки <audio> и поддельного fetch; файл —
// blob со ссылкой `blob:<url>`, поэтому журнал play() хранит исходный url (urlOf).
import { vi } from 'vitest';
import { createPlayer, type Player, type PlayerOptions } from '../audio';
import { fakeAudioFactory, type FakeMode } from './fake-audio';

const blobFor = (u: string) => { const b = new Blob(['x']); (b as unknown as { __u: string }).__u = u; return b; };
export const okResponse = (u: string, status = 200, type = 'audio/ogg') =>
  ({ status, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) }, blob: async () => blobFor(u) }) as unknown as Response;

let origCreate: typeof URL.createObjectURL | undefined;
let origRevoke: typeof URL.revokeObjectURL | undefined;
export const objectUrls = { created: [] as string[], revoked: [] as string[] };

/** beforeEach: ссылки blob:<url> вместо jsdom-заглушек. */
export function installBlobUrls(): void {
  origCreate = URL.createObjectURL;
  origRevoke = URL.revokeObjectURL;
  objectUrls.created = [];
  objectUrls.revoked = [];
  URL.createObjectURL = (b: Blob | MediaSource) => { const u = `blob:${(b as unknown as { __u: string }).__u}`; objectUrls.created.push(u); return u; };
  URL.revokeObjectURL = (u: string) => { objectUrls.revoked.push(u); };
}
export function restoreBlobUrls(): void {
  if (origCreate) URL.createObjectURL = origCreate;
  if (origRevoke) URL.revokeObjectURL = origRevoke;
}

export const unblob = (s: string) => s.replace(/^blob:/, '');

export function kitPlayer(mode: FakeMode = 'ok', extra: PlayerOptions = {}) {
  const f = fakeAudioFactory({ mode });
  const fetch = vi.fn(async (u: string) => okResponse(u));
  const player: Player = createPlayer({ makeAudio: f.make, fetch, delaysMs: [0, 0, 0], ...extra });
  return { f, fetch, player, plays: () => f.plays().map(unblob) };
}
