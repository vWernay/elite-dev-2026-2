import { createHmac, timingSafeEqual } from "node:crypto"

export type LotRules = {
  id: string
  startingBidCents: number
  minIncrementCents: number
  startsAt: Date
}

export type LotState = LotRules & {
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
  const mac = (parts: (string | number)[]) =>
    createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex")

  /** Elo inicial, no qual amarra as regras do lote, sem ser gravado no banco. */
  function genesis(lot: LotRules) {
    return mac([
      "genesis",
      lot.id,
      String(lot.startingBidCents),
      String(lot.minIncrementCents),
      lot.startsAt.toISOString(),
    ])
  }

  function bidMac(lotId: string, bid: BidData, previousMac: string) {
    return mac([
      "bid",
      lotId,
      bid.seq,
      bid.bidderId,
      String(bid.amountCents),
      bid.createdAt.toISOString(),
      previousMac,
    ])
  }

  /** Ponta da cadeia, no qual amarra a contagem de lances ao último elo. */
  function headMac(lotId: string, bidCount: number, lastMac: string) {
    return mac(["head", lotId, bidCount, lastMac])
  }

  /** `head_mac` de um lote recém-criado, no qual ainda não há lances. */
  function initialHeadMac(lot: LotRules) {
    return headMac(lot.id, 0, genesis(lot))
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
        sameMac(bid.mac, bidMac(lot.id, bid, previousMac))
      // Segue pelo MAC gravado, então um lance adulterado não invalida os seguintes.
      previousMac = bid.mac
      return { seq: bid.seq, valid }
    })
    const firstInvalid = checked.find((bid) => !bid.valid)

    if (bids.length !== lot.bidCount) issues.push("COUNT_MISMATCH")
    if (!sameMac(lot.headMac, headMac(lot.id, lot.bidCount, previousMac))) {
      issues.push("HEAD_MISMATCH")
    }
    const last = bids.at(-1)
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
