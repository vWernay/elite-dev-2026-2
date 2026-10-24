import { describe, expect, it } from "vitest"
import { lotStatus } from "./status.js"

const startsAt = new Date("2026-10-23T12:00:00.000Z")
const endsAt = new Date("2026-10-23T13:00:00.000Z")
const lot = { startsAt, endsAt, cancelledAt: null }
const at = (iso: string) => new Date(iso)

describe("lotStatus", () => {
  it("é agendado antes do início", () => {
    expect(lotStatus(lot, at("2026-10-23T11:59:59.999Z"))).toBe("scheduled")
  })

  it("está ao vivo desde o instante de início", () => {
    expect(lotStatus(lot, startsAt)).toBe("live")
    expect(lotStatus(lot, at("2026-10-23T12:59:59.999Z"))).toBe("live")
  })

  it("está encerrado desde o instante de fim", () => {
    expect(lotStatus(lot, endsAt)).toBe("ended")
  })

  it("cancelado vale mais que o horário", () => {
    const cancelled = { ...lot, cancelledAt: startsAt }
    expect(lotStatus(cancelled, at("2026-10-23T12:30:00.000Z"))).toBe(
      "cancelled",
    )
    expect(lotStatus(cancelled, at("2026-10-23T09:00:00.000Z"))).toBe(
      "cancelled",
    )
  })
})
