import { createHmac } from "node:crypto"
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

const ENDS_AT = new Date("2026-10-23T13:00:00.000Z")

const rulesFor = (chainVersion: number) => ({
  id: LOT_ID,
  startingBidCents: 10_000,
  minIncrementCents: 500,
  startsAt: new Date("2026-10-23T12:00:00.000Z"),
  originalEndsAt: ENDS_AT,
  chainVersion,
})

type NewBid = Omit<BidData, "seq">

/** Monta um lote e sua cadeia do mesmo jeito que a transação de lance fará. */
function buildLot(bids: NewBid[], version = 2) {
  const rules = rulesFor(version)
  let previousMac = chain.genesis(rules)
  let endsAt = ENDS_AT
  const chained: ChainBid[] = bids.map((bid, index) => {
    // na v2 cada lance grava o fim resultante; sem prorrogação, é o fim anterior
    endsAt = bid.endsAtAfter ?? endsAt
    const data = {
      ...bid,
      seq: index + 1,
      endsAtAfter: version >= 2 ? endsAt : null,
    }
    const mac = chain.bidMac(rules, data, previousMac)
    previousMac = mac
    return { ...data, mac }
  })
  const last = chained.at(-1)
  const lot: LotState = {
    ...rules,
    endsAt,
    cancelledAt: null,
    settledAt: null,
    bidCount: chained.length,
    headMac: chain.headMac(
      { ...rules, endsAt, cancelledAt: null, settledAt: null },
      chained.length,
      previousMac,
    ),
    currentBidCents: last?.amountCents ?? null,
    leaderId: last?.bidderId ?? null,
  }
  return { lot, bids: chained }
}

const at = (second: number) =>
  new Date(`2026-10-23T12:00:${String(second).padStart(2, "0")}.123Z`)

const threeBids = (version = 2) =>
  buildLot(
    [
      { bidderId: ANA, amountCents: 10_000, createdAt: at(10) },
      { bidderId: BRUNO, amountCents: 10_500, createdAt: at(20) },
      { bidderId: ANA, amountCents: 11_000, createdAt: at(30) },
    ],
    version,
  )

describe.each([1, 2])("chain.verify (v%i)", (version) => {
  it("aceita um lote sem lances", () => {
    const { lot, bids } = buildLot([], version)
    expect(lot.headMac).toBe(chain.initialHeadMac(rulesFor(version)))
    expect(chain.verify(lot, bids).verdict).toBe("intact")
  })

  it("aceita uma cadeia íntegra", () => {
    const { lot, bids } = threeBids(version)
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
    const { lot, bids } = threeBids(version)
    expect(chain.verify(lot, [...bids].reverse()).verdict).toBe("intact")
  })

  it("detecta valor alterado e aponta só aquele lance", () => {
    const { lot, bids } = threeBids(version)
    bids[1] = { ...bids[1], amountCents: 10_501 }
    const result = chain.verify(lot, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(2)
    expect(result.bids.map((b) => b.valid)).toEqual([true, false, true])
  })

  it("detecta licitante alterado", () => {
    const { lot, bids } = threeBids(version)
    bids[0] = { ...bids[0], bidderId: BRUNO }
    expect(chain.verify(lot, bids).firstInvalidSeq).toBe(1)
  })

  it("detecta horário alterado", () => {
    const { lot, bids } = threeBids(version)
    bids[2] = { ...bids[2], createdAt: at(31) }
    expect(chain.verify(lot, bids).firstInvalidSeq).toBe(3)
  })

  it("detecta o próprio mac editado", () => {
    const { lot, bids } = threeBids(version)
    bids[1] = { ...bids[1], mac: "0".repeat(64) }
    const result = chain.verify(lot, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(2)
  })

  it("detecta lance removido do meio", () => {
    const { lot, bids } = threeBids(version)
    const result = chain.verify(lot, [bids[0], bids[2]])
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(3)
    expect(result.issues).toContain("COUNT_MISMATCH")
  })

  it("detecta lance removido do final como 'truncated'", () => {
    const { lot, bids } = threeBids(version)
    const result = chain.verify(lot, bids.slice(0, 2))
    expect(result.verdict).toBe("truncated")
    expect(result.firstInvalidSeq).toBeNull()
    expect(result.issues).toContain("HEAD_MISMATCH")
  })

  it("detecta o último lance removido e o estado do lote reescrito", () => {
    const { lot, bids } = threeBids(version)
    const forged = {
      ...lot,
      bidCount: 2,
      currentBidCents: 10_500,
      leaderId: BRUNO,
    }
    expect(chain.verify(forged, bids.slice(0, 2)).verdict).toBe("tampered")
  })

  it("detecta lance falso inserido no final", () => {
    const { lot, bids } = threeBids(version)
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
    const { lot, bids } = threeBids(version)
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
    const { lot, bids } = threeBids(version)
    const swapped = [{ ...bids[0], seq: 2 }, { ...bids[1], seq: 1 }, bids[2]]
    const result = chain.verify(lot, swapped)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(1)
  })

  it("detecta current_bid_cents alterado no lote", () => {
    const { lot, bids } = threeBids(version)
    const result = chain.verify({ ...lot, currentBidCents: 99_000 }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toEqual(["LOT_STATE_MISMATCH"])
  })

  it("detecta leader_id alterado no lote", () => {
    const { lot, bids } = threeBids(version)
    const result = chain.verify({ ...lot, leaderId: BRUNO }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toEqual(["LOT_STATE_MISMATCH"])
  })

  it("detecta lance inicial alterado depois de haver lances", () => {
    const { lot, bids } = threeBids(version)
    const result = chain.verify({ ...lot, startingBidCents: 1 }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(1)
  })

  it("detecta incremento alterado", () => {
    const { lot, bids } = threeBids(version)
    const result = chain.verify({ ...lot, minIncrementCents: 1 }, bids)
    expect(result.firstInvalidSeq).toBe(1)
  })

  it("detecta início alterado, mesmo sem lances", () => {
    const { lot, bids } = buildLot([], version)
    const result = chain.verify(
      { ...lot, startsAt: new Date("2026-10-23T11:00:00.000Z") },
      bids,
    )
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toContain("HEAD_MISMATCH")
  })

  it("não valida com outra chave", () => {
    const { lot, bids } = threeBids(version)
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

describe("chain.verifyReceipt", () => {
  const receiptFor = (lot: LotState, last: ChainBid) => ({
    winnerId: last.bidderId,
    amountCents: last.amountCents,
    chainMac: lot.headMac,
  })

  it("aceita um comprovante que bate com o último lance", () => {
    const { lot, bids } = threeBids()
    expect(chain.verifyReceipt(lot, bids, receiptFor(lot, bids[2]))).toBe(true)
  })

  it("recusa valor, vencedor ou chain_mac diferentes", () => {
    const { lot, bids } = threeBids()
    const receipt = receiptFor(lot, bids[2])
    expect(chain.verifyReceipt(lot, bids, { ...receipt, amountCents: 1 })).toBe(
      false,
    )
    expect(
      chain.verifyReceipt(lot, bids, { ...receipt, winnerId: BRUNO }),
    ).toBe(false)
    expect(
      chain.verifyReceipt(lot, bids, { ...receipt, chainMac: "0".repeat(64) }),
    ).toBe(false)
  })

  it("recusa quando a cadeia foi adulterada", () => {
    const { lot, bids } = threeBids()
    const receipt = receiptFor(lot, bids[2])
    const tampered = [bids[0], { ...bids[1], amountCents: 1 }, bids[2]]
    expect(chain.verifyReceipt(lot, tampered, receipt)).toBe(false)
  })

  it("recusa quando o último lance foi removido", () => {
    const { lot, bids } = threeBids()
    expect(
      chain.verifyReceipt(lot, bids.slice(0, 2), receiptFor(lot, bids[2])),
    ).toBe(false)
  })

  it("recusa comprovante de um lote sem lances", () => {
    const { lot } = buildLot([])
    const receipt = {
      winnerId: ANA,
      amountCents: 10_000,
      chainMac: lot.headMac,
    }
    expect(chain.verifyReceipt(lot, [], receipt)).toBe(false)
  })
})

describe("chain v2: fim, cancelamento e liquidação dentro da cadeia", () => {
  const hours = (n: number) => new Date(ENDS_AT.getTime() + n * 3_600_000)

  // Com o head recalculado como a aplicação faz ao cancelar ou liquidar
  const withHead = (
    lot: LotState,
    bids: ChainBid[],
    change: Partial<Pick<LotState, "cancelledAt" | "settledAt">>,
  ) => {
    const next = { ...lot, ...change }
    return {
      ...next,
      headMac: chain.headMac(
        next,
        bids.length,
        bids.at(-1)?.mac ?? chain.genesis(lot),
      ),
    }
  }

  it("detecta ends_at alterado", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify({ ...lot, endsAt: hours(5) }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toContain("HEAD_MISMATCH")
    expect(result.issues).toContain("ENDS_AT_MISMATCH")
  })

  it("detecta ends_at alterado em lote sem lances", () => {
    const { lot, bids } = buildLot([])
    const result = chain.verify({ ...lot, endsAt: hours(-1) }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toContain("HEAD_MISMATCH")
  })

  it("detecta original_ends_at alterado, com e sem lances", () => {
    const withBids = threeBids()
    const a = chain.verify(
      { ...withBids.lot, originalEndsAt: hours(2) },
      withBids.bids,
    )
    expect(a.verdict).toBe("tampered")
    expect(a.firstInvalidSeq).toBe(1)

    const empty = buildLot([])
    const b = chain.verify({ ...empty.lot, originalEndsAt: hours(2) }, [])
    expect(b.verdict).toBe("tampered")
  })

  it("detecta cancelled_at apagado", () => {
    const { lot, bids } = threeBids()
    const cancelled = withHead(lot, bids, { cancelledAt: at(50) })
    expect(chain.verify(cancelled, bids).verdict).toBe("intact")

    const erased = { ...cancelled, cancelledAt: null }
    const result = chain.verify(erased, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toEqual(["HEAD_MISMATCH"])
  })

  it("detecta cancelled_at preenchido sem passar pela aplicação", () => {
    const { lot, bids } = threeBids()
    const result = chain.verify({ ...lot, cancelledAt: at(50) }, bids)
    expect(result.verdict).toBe("tampered")
    expect(result.issues).toEqual(["HEAD_MISMATCH"])
  })

  it("detecta settled_at preenchido, apagado ou mudado", () => {
    const { lot, bids } = threeBids()
    expect(chain.verify({ ...lot, settledAt: at(50) }, bids).issues).toEqual([
      "HEAD_MISMATCH",
    ])

    const settled = withHead(lot, bids, { settledAt: at(50) })
    expect(chain.verify(settled, bids).verdict).toBe("intact")
    expect(chain.verify({ ...settled, settledAt: null }, bids).verdict).toBe(
      "tampered",
    )
    expect(chain.verify({ ...settled, settledAt: at(51) }, bids).verdict).toBe(
      "tampered",
    )
  })

  it("lote sem lances cancelado ou liquidado também é coberto", () => {
    const { lot, bids } = buildLot([])
    const cancelled = withHead(lot, bids, { cancelledAt: at(5) })
    expect(chain.verify(cancelled, bids).verdict).toBe("intact")
    expect(
      chain.verify({ ...cancelled, cancelledAt: null }, bids).verdict,
    ).toBe("tampered")
  })

  it("a prorrogação é um fato assinado em cada lance", () => {
    const { lot, bids } = buildLot([
      { bidderId: ANA, amountCents: 10_000, createdAt: at(10) },
      {
        bidderId: BRUNO,
        amountCents: 10_500,
        createdAt: at(20),
        endsAtAfter: hours(0.5),
      },
    ])
    expect(lot.endsAt).toEqual(hours(0.5))
    expect(chain.verify(lot, bids).verdict).toBe("intact")

    // mudar o fim gravado no lance invalida aquele lance
    const forgedBid = [bids[0], { ...bids[1], endsAtAfter: hours(9) }]
    expect(chain.verify(lot, forgedBid).firstInvalidSeq).toBe(2)

    // voltar o fim do lote para o original esconde a prorrogação, e é detectado
    const rolledBack = chain.verify({ ...lot, endsAt: ENDS_AT }, bids)
    expect(rolledBack.verdict).toBe("tampered")
    expect(rolledBack.issues).toContain("ENDS_AT_MISMATCH")
  })

  it("um lance v2 sem o fim gravado é inválido", () => {
    const { lot, bids } = threeBids()
    const stripped = [bids[0], { ...bids[1], endsAtAfter: null }, bids[2]]
    const result = chain.verify(lot, stripped)
    expect(result.verdict).toBe("tampered")
    expect(result.firstInvalidSeq).toBe(2)
  })

  it("o comprovante guarda a ponta com a liquidação e continua válido", () => {
    const { lot, bids } = threeBids()
    const settled = withHead(lot, bids, { settledAt: at(50) })
    const receipt = {
      winnerId: ANA,
      amountCents: 11_000,
      chainMac: settled.headMac,
    }
    expect(chain.verifyReceipt(settled, bids, receipt)).toBe(true)
    // o head de antes da liquidação já não vale
    expect(
      chain.verifyReceipt(settled, bids, { ...receipt, chainMac: lot.headMac }),
    ).toBe(false)
  })
})

describe("chain v1: compatibilidade com lotes antigos", () => {
  // A fórmula original, escrita à parte para o teste não depender do código novo
  const legacy = (parts: (string | number)[]) =>
    createHmac("sha256", SECRET).update(JSON.stringify(parts)).digest("hex")

  it("a v1 calcula exatamente as fórmulas antigas", () => {
    const rules = rulesFor(1)
    const genesis = legacy([
      "genesis",
      LOT_ID,
      "10000",
      "500",
      rules.startsAt.toISOString(),
    ])
    expect(chain.genesis(rules)).toBe(genesis)

    const bid = {
      seq: 1,
      bidderId: ANA,
      amountCents: 10_000,
      createdAt: at(10),
    }
    const bidMac = legacy([
      "bid",
      LOT_ID,
      1,
      ANA,
      "10000",
      at(10).toISOString(),
      genesis,
    ])
    expect(chain.bidMac(rules, bid, genesis)).toBe(bidMac)

    const head = legacy(["head", LOT_ID, 1, bidMac])
    const lotHead = {
      id: LOT_ID,
      chainVersion: 1,
      endsAt: ENDS_AT,
      cancelledAt: null,
      settledAt: null,
    }
    expect(chain.headMac(lotHead, 1, bidMac)).toBe(head)
  })

  it("a v2 gera valores diferentes dos da v1 para o mesmo lote", () => {
    expect(chain.genesis(rulesFor(2))).not.toBe(chain.genesis(rulesFor(1)))
  })

  it("na v1 o fim do lote continua fora da cadeia (limite conhecido)", () => {
    const { lot, bids } = threeBids(1)
    const result = chain.verify({ ...lot, endsAt: new Date(0) }, bids)
    expect(result.verdict).toBe("intact")
  })
})
