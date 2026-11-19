import { createHmac, timingSafeEqual } from "node:crypto"

// v1: o fim do lote, o cancelamento e a liquidação ficam fora da cadeia.
// v2: a cadeia também cobre esses três. Lotes antigos continuam na v1.
export const CURRENT_CHAIN_VERSION = 2

export type LotRules = {
  id: string
  startingBidCents: number
  minIncrementCents: number
  startsAt: Date
  originalEndsAt: Date
  chainVersion: number
}

// O que a ponta da cadeia amarra além dos lances (só vale na v2)
export type LotHead = {
  id: string
  chainVersion: number
  endsAt: Date
  cancelledAt: Date | null
  settledAt: Date | null
}

export type LotState = LotRules &
  LotHead & {
    bidCount: number
    headMac: string
    currentBidCents: number | null
    leaderId: string | null
  }

export type BidData = {
  seq: number
  bidderId: string
  amountCents: number
  createdAt: Date
  // fim do lote depois deste lance; só existe na v2
  endsAtAfter?: Date | null
}

export type ChainBid = BidData & { mac: string }

export type ReceiptData = {
  winnerId: string
  amountCents: number
  chainMac: string
}

export type AuditIssue =
  | "COUNT_MISMATCH"
  | "HEAD_MISMATCH"
  | "LOT_STATE_MISMATCH"
  | "ENDS_AT_MISMATCH"

export type AuditResult = {
  verdict: "intact" | "tampered" | "truncated"
  firstInvalidSeq: number | null
  bids: { seq: number; valid: boolean }[]
  issues: AuditIssue[]
}

const PSEUDONYM_LENGTH = 6
const FINGERPRINT_LENGTH = 16

function sameMac(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Cadeia de HMAC-SHA256 dos lances de um lote.
 *
 * Toda a entrada do HMAC é um array serializado com JSON.stringify, sendo que
 * a ordem é fixa e cada campo é delimitado, então valores diferentes não colidem.
 * Dinheiro -> string e datas -> ISO UTC.
 */
export function createChain(secret: string) {
  const mac = (parts: (string | number | null)[]) =>
    createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex")

  /** Elo inicial, no qual amarra as regras do lote, sem ser gravado no banco. */
  function genesis(lot: LotRules) {
    const rules = [
      "genesis",
      lot.id,
      String(lot.startingBidCents),
      String(lot.minIncrementCents),
      lot.startsAt.toISOString(),
    ]
    if (lot.chainVersion < 2) return mac(rules)
    return mac([...rules, lot.originalEndsAt.toISOString()])
  }

  function bidMac(
    lot: { id: string; chainVersion: number },
    bid: BidData,
    previousMac: string,
  ) {
    const fields = [
      "bid",
      lot.id,
      bid.seq,
      bid.bidderId,
      String(bid.amountCents),
      bid.createdAt.toISOString(),
    ]
    if (lot.chainVersion < 2) return mac([...fields, previousMac])
    // sem o fim gravado o valor fica vazio e nunca bate com um MAC válido
    const endsAtAfter = bid.endsAtAfter?.toISOString() ?? ""
    return mac([...fields, endsAtAfter, previousMac])
  }

  /** Ponta da cadeia: amarra a contagem de lances ao último elo e, na v2, o estado do lote. */
  function headMac(lot: LotHead, bidCount: number, lastMac: string) {
    const fields = ["head", lot.id, bidCount, lastMac]
    if (lot.chainVersion < 2) return mac(fields)
    return mac([
      ...fields,
      lot.endsAt.toISOString(),
      lot.cancelledAt?.toISOString() ?? null,
      lot.settledAt?.toISOString() ?? null,
    ])
  }

  /** `head_mac` de um lote recém-criado, no qual ainda não há lances. */
  function initialHeadMac(lot: LotRules) {
    return headMac(
      {
        id: lot.id,
        chainVersion: lot.chainVersion,
        endsAt: lot.originalEndsAt,
        cancelledAt: null,
        settledAt: null,
      },
      0,
      genesis(lot),
    )
  }

  /** Pseudônimo do licitante, diferente em cada lote. */
  function pseudonym(lotId: string, userId: string) {
    return mac(["pseudonym", lotId, userId]).slice(0, PSEUDONYM_LENGTH)
  }

  /** Impressão digital pública da cadeia, repetida no comprovante. */
  function fingerprint(head: string) {
    return head.slice(0, FINGERPRINT_LENGTH)
  }

  function verify(lot: LotState, storedBids: ChainBid[]): AuditResult {
    const bids = [...storedBids].sort((a, b) => a.seq - b.seq)
    const issues: AuditIssue[] = []

    let previousMac = genesis(lot)
    const checked = bids.map((bid, index) => {
      const valid =
        bid.seq === index + 1 &&
        (lot.chainVersion < 2 || bid.endsAtAfter != null) &&
        sameMac(bid.mac, bidMac(lot, bid, previousMac))
      // Segue pelo MAC gravado, então um lance adulterado não invalida os seguintes.
      previousMac = bid.mac
      return { seq: bid.seq, valid }
    })
    const firstInvalid = checked.find((bid) => !bid.valid)

    if (bids.length !== lot.bidCount) issues.push("COUNT_MISMATCH")
    if (!sameMac(lot.headMac, headMac(lot, lot.bidCount, previousMac))) {
      issues.push("HEAD_MISMATCH")
    }
    const last = bids.at(-1)
    if (lot.chainVersion >= 2) {
      const expectedEnd = last?.endsAtAfter ?? lot.originalEndsAt
      if (lot.endsAt.getTime() !== expectedEnd.getTime()) {
        issues.push("ENDS_AT_MISMATCH")
      }
    }
    if (
      lot.currentBidCents !== (last?.amountCents ?? null) ||
      lot.leaderId !== (last?.bidderId ?? null)
    ) {
      issues.push("LOT_STATE_MISMATCH")
    }

    let verdict: AuditResult["verdict"] = "intact"
    if (firstInvalid) verdict = "tampered"
    else if (bids.length < lot.bidCount) verdict = "truncated"
    else if (issues.length > 0) verdict = "tampered"

    return {
      verdict,
      firstInvalidSeq: firstInvalid?.seq ?? null,
      bids: checked,
      issues,
    }
  }

  // O comprovante vale se a cadeia está íntegra e ele bate com o último lance.
  function verifyReceipt(
    lot: LotState,
    storedBids: ChainBid[],
    receipt: ReceiptData,
  ) {
    if (verify(lot, storedBids).verdict !== "intact") return false
    const last = [...storedBids].sort((a, b) => a.seq - b.seq).at(-1)
    return (
      last !== undefined &&
      receipt.winnerId === last.bidderId &&
      receipt.amountCents === last.amountCents &&
      sameMac(receipt.chainMac, lot.headMac)
    )
  }

  return {
    genesis,
    bidMac,
    headMac,
    initialHeadMac,
    pseudonym,
    fingerprint,
    verify,
    verifyReceipt,
  }
}

export type Chain = ReturnType<typeof createChain>
