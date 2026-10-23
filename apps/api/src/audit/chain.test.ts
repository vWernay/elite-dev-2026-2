import { describe, expect, it } from "vitest"
import {
  type BidData,
  type ChainBid,
  createChain,
  type LotState,
} from "./chain.js"

const SECRET = "a".repeat(64)
const chain = createChain(SECRET)

const LOT_ID = "11111111-1111-4111-8111-111111111111"
const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const BRUNO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const rules = {
  id: LOT_ID,
  startingBidCents: 10_000,
  minIncrementCents: 500,
  startsAt: new Date("2026-10-23T12:00:00.000Z"),
}

/** Monta um lote e sua cadeia do mesmo jeito que a transação de lance fará. */
function buildLot(bids: Omit<BidData, "seq">[]) {
  let previousMac = chain.genesis(rules)
  const chained: ChainBid[] = bids.map((bid, index) => {
    const data = { ...bid, seq: index + 1 }
    const mac = chain.bidMac(LOT_ID, data, previousMac)
    previousMac = mac
    return { ...data, mac }
  })
  const last = chained.at(-1)
  const lot: LotState = {
    ...rules,
    bidCount: chained.length,
    headMac: chain.headMac(LOT_ID, chained.length, previousMac),
    currentBidCents: last?.amountCents ?? null,
    leaderId: last?.bidderId ?? null,
  }
  return { lot, bids: chained }
}

const at = (second: number) =>
  new Date(`2026-10-23T12:00:${String(second).padStart(2, "0")}.123Z`)

const threeBids = () =>
  buildLot([
    { bidderId: ANA, amountCents: 10_000, createdAt: at(10) },
    { bidderId: BRUNO, amountCents: 10_500, createdAt: at(20) },
    { bidderId: ANA, amountCents: 11_000, createdAt: at(30) },
  ])

describe("chain.verify", () => {
  it("aceita um lote sem lances", () => {
    const { lot, bids } = buildLot([])
    expect(lot.headMac).toBe(chain.initialHeadMac(rules))
    expect(chain.verify(lot, bids).verdict).toBe("intact")
  })

  it("aceita uma cadeia íntegra", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify(lot, bids)
    expect(result).toEqual({
      verdict: "intact",
      firstInvalidSeq: null,
      bids: [
        { seq: 1, valid: true },
        { seq: 2, valid: true },
        { seq: 3, valid: true },
      ],
      issues: [],
    })
  })

  it("não depende da ordem em que os lances chegam do banco", () => {
    const { lot, bids } = threeBids()
    expect(chain.verify(lot, [...bids].reverse()).verdict).toBe("intact")
  })

  it("detecta valor alterado e aponta só aquele lance", () => {
    const { lot, bids } = threeBids()
    bids[1] = { ...bids[1], amountCents: 10_501 }
    const result = chain.verify(lot, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(2)
    expect(result.bids.map((b) => b.valid)).toEqual([true, false, true])
  })

  it("detecta licitante alterado", () => {
    const { lot, bids } = threeBids()
    bids[0] = { ...bids[0], bidderId: BRUNO }
    expect(chain.verify(lot, bids).firstInvalidSeq).toBe(1)
  })

  it("detecta horário alterado", () => {
    const { lot, bids } = threeBids()
    bids[2] = { ...bids[2], createdAt: at(31) }
    expect(chain.verify(lot, bids).firstInvalidSeq).toBe(3)
  })

  it("detecta o próprio mac editado", () => {
    const { lot, bids } = threeBids()
    bids[1] = { ...bids[1], mac: "0".repeat(64) }
    const result = chain.verify(lot, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(2)
  })

  it("detecta lance removido do meio", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify(lot, [bids[0], bids[2]])
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(3)
    expect(result.issues).toContain("COUNT_MISMATCH")
  })

  it("detecta lance removido do final como 'truncated'", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify(lot, bids.slice(0, 2))
    expect(result.verdict).toBe("truncated")
    expect(result.firstInvalidSeq).toBeNull()
    expect(result.issues).toContain("HEAD_MISMATCH")
  })

  it("detecta o último lance removido e o estado do lote reescrito", () => {
    const { lot, bids } = threeBids()
    const forged = {
      ...lot,
      bidCount: 2,
      currentBidCents: 10_500,
      leaderId: BRUNO,
    }
    expect(chain.verify(forged, bids.slice(0, 2)).verdict).toBe("tampered")
  })

  it("detecta lance falso inserido no final", () => {
    const { lot, bids } = threeBids()
    const fake: ChainBid = {
      seq: 4,
      bidderId: BRUNO,
      amountCents: 12_000,
      createdAt: at(40),
      mac: "f".repeat(64),
    }
    const forged = {
      ...lot,
      bidCount: 4,
      currentBidCents: 12_000,
      leaderId: BRUNO,
    }
    const result = chain.verify(forged, [...bids, fake])
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(4)
  })

  it("detecta lance falso inserido sem atualizar o lote", () => {
    const { lot, bids } = threeBids()
    const fake: ChainBid = {
      seq: 4,
      bidderId: BRUNO,
      amountCents: 12_000,
      createdAt: at(40),
      mac: "f".repeat(64),
    }
    expect(chain.verify(lot, [...bids, fake]).verdict).toBe("tampered")
  })

  it("detecta troca do seq entre dois lances", () => {
    const { lot, bids } = threeBids()
    const swapped = [{ ...bids[0], seq: 2 }, { ...bids[1], seq: 1 }, bids[2]]
    const result = chain.verify(lot, swapped)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(1)
  })

  it("detecta current_bid_cents alterado no lote", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify({ ...lot, currentBidCents: 99_000 }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toEqual(["LOT_STATE_MISMATCH"])
  })

  it("detecta leader_id alterado no lote", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify({ ...lot, leaderId: BRUNO }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toEqual(["LOT_STATE_MISMATCH"])
  })

  it("detecta lance inicial alterado depois de haver lances", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify({ ...lot, startingBidCents: 1 }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(1)
  })

  it("detecta incremento alterado", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify({ ...lot, minIncrementCents: 1 }, bids)
    expect(result.firstInvalidSeq).toBe(1)
  })

  it("detecta início alterado, mesmo sem lances", () => {
    const { lot, bids } = buildLot([])
    const result = chain.verify(
      { ...lot, startsAt: new Date("2026-10-23T11:00:00.000Z") },
      bids,
    )
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toContain("HEAD_MISMATCH")
  })

  it("não valida com outra chave", () => {
    const { lot, bids } = threeBids()
    const other = createChain("b".repeat(64))
    expect(other.verify(lot, bids).verdict).toBe("tampered")
  })
})

describe("chain.pseudonym", () => {
  it("é estável, curto e em hexadecimal", () => {
    const first = chain.pseudonym(LOT_ID, ANA)
    expect(first).toMatch(/^[0-9a-f]{6}$/)
    expect(chain.pseudonym(LOT_ID, ANA)).toBe(first)
  })

  it("muda por licitante e por lote", () => {
    const other = "22222222-2222-4222-8222-222222222222"
    expect(chain.pseudonym(LOT_ID, ANA)).not.toBe(
      chain.pseudonym(LOT_ID, BRUNO),
    )
    expect(chain.pseudonym(LOT_ID, ANA)).not.toBe(chain.pseudonym(other, ANA))
  })
})

describe("chain.fingerprint", () => {
  it("usa os 16 primeiros caracteres do head_mac", () => {
    const { lot } = threeBids()
    expect(chain.fingerprint(lot.headMac)).toBe(lot.headMac.slice(0, 16))
  })
})
