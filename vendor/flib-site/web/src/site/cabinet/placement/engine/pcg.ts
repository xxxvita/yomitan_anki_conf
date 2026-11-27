// Порт math/rand/v2 Go 1.25 (src/math/rand/v2/{pcg.go,rand.go}) — ровно то, что зовёт движок:
// PCG-DXSM 128 бит, Uint64, uint64n (степень двойки → маска, иначе Лемир с петлёй отказа),
// IntN, Shuffle (Фишер–Йетс сверху вниз). Арифметика — BigInt с маской 64/128 бит.
// Сверка — pcg.test.ts против internal/placement/model/testdata/golden/rng_pcg.json.

const M64 = (1n << 64n) - 1n;

// Константы pcg.go: множитель 128 бит (mulHi:mulLo) и приращение (incHi:incLo).
const MUL_HI = 2549297995355413924n;
const MUL_LO = 4865540595714422341n;
const INC_HI = 6364136223846793005n;
const INC_LO = 1442695040888963407n;
const CHEAP_MUL = 0xda942042e4dd58b5n;

function checkU64(x: bigint, what: string): bigint {
  if (x < 0n || x > M64) throw new RangeError(`${what}: ${x} is not a uint64`);
  return x;
}

/** PCG-DXSM: состояние hi:lo, шаг LCG по модулю 2^128, выход DXSM (pcg.go). */
export class PCG {
  private hi: bigint;
  private lo: bigint;

  constructor(seed1: bigint, seed2: bigint) {
    this.hi = checkU64(seed1, 'PCG seed1');
    this.lo = checkU64(seed2, 'PCG seed2');
  }

  /** next: state = state*mul + inc (mod 2^128); возвращает новое состояние. */
  private next(): [bigint, bigint] {
    // bits.Mul64(lo, mulLo) + перекрёстные слагаемые старшего слова, как в Go.
    const prod = this.lo * MUL_LO;
    let lo = prod & M64;
    let hi = (prod >> 64n) + this.hi * MUL_LO + this.lo * MUL_HI;
    const sumLo = lo + INC_LO;
    const carry = sumLo >> 64n;
    lo = sumLo & M64;
    hi = (hi + INC_HI + carry) & M64;
    this.lo = lo;
    this.hi = hi;
    return [hi, lo];
  }

  uint64(): bigint {
    const [h, lo] = this.next();
    let hi = h;
    hi ^= hi >> 32n;
    hi = (hi * CHEAP_MUL) & M64;
    hi ^= hi >> 48n;
    hi = (hi * (lo | 1n)) & M64;
    return hi;
  }
}

/** Rand — обёртка Go rand.Rand над источником (только методы движка). */
export class Rand {
  constructor(private readonly src: PCG) {}

  uint64(): bigint { return this.src.uint64(); }

  /** Uint64N без проверки n (rand.go uint64n, 64-битная ветка: is32bit = false на amd64). */
  uint64n(n: bigint): bigint {
    if (n <= 0n || n > M64) throw new RangeError(`uint64n: invalid n ${n}`);
    if ((n & (n - 1n)) === 0n) return this.uint64() & (n - 1n); // степень двойки — маска
    let prod = this.uint64() * n;
    let lo = prod & M64;
    if (lo < n) {
      const thresh = ((1n << 64n) - n) % n; // -n % n в uint64
      while (lo < thresh) {
        prod = this.uint64() * n;
        lo = prod & M64;
      }
    }
    return prod >> 64n;
  }

  /** IntN для n — безопасного целого > 0 (Go: panic при n <= 0). */
  intN(n: number): number {
    if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError(`intN: invalid n ${n}`);
    return Number(this.uint64n(BigInt(n)));
  }

  /** Shuffle: Фишер–Йетс, i от n-1 до 1, j = uint64n(i+1) (rand.go Shuffle). */
  shuffle(n: number, swap: (i: number, j: number) => void): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`shuffle: invalid n ${n}`);
    for (let i = n - 1; i > 0; i--) {
      const j = Number(this.uint64n(BigInt(i + 1)));
      swap(i, j);
    }
  }
}

/** ГСЧ сессии движка: rand.New(rand.NewPCG(seed, seed^0x51)) — OLD session.go NewSession. */
export function newEngineRand(seed: bigint): Rand {
  checkU64(seed, 'engine seed');
  return new Rand(new PCG(seed, seed ^ 0x51n));
}
