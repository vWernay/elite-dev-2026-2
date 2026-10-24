import { describe, expect, it, vi } from "vitest"
import { createLotEvents, type LotEvent } from "./bus.js"

const cancelled: LotEvent = { type: "cancelled", data: {} }

describe("createLotEvents", () => {
  it("entrega o evento só para quem assinou aquele lote", () => {
    const bus = createLotEvents()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe("lote-a", a)
    bus.subscribe("lote-b", b)

    bus.publish("lote-a", cancelled)

    expect(a).toHaveBeenCalledWith(cancelled)
    expect(b).not.toHaveBeenCalled()
  })

  it("entrega para todos os assinantes do mesmo lote", () => {
    const bus = createLotEvents()
    const first = vi.fn()
    const second = vi.fn()
    bus.subscribe("lote", first)
    bus.subscribe("lote", second)

    bus.publish("lote", cancelled)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("para de entregar depois de cancelar a assinatura", () => {
    const bus = createLotEvents()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe("lote", listener)

    unsubscribe()
    bus.publish("lote", cancelled)

    expect(listener).not.toHaveBeenCalled()
    expect(bus.count("lote")).toBe(0)
  })

  it("cancelar duas vezes não atrapalha os outros", () => {
    const bus = createLotEvents()
    const keep = vi.fn()
    const unsubscribe = bus.subscribe("lote", () => {})
    bus.subscribe("lote", keep)

    unsubscribe()
    unsubscribe()
    bus.publish("lote", cancelled)

    expect(keep).toHaveBeenCalledTimes(1)
    expect(bus.count("lote")).toBe(1)
  })

  it("um assinante que falha não impede os outros", () => {
    const bus = createLotEvents()
    const healthy = vi.fn()
    bus.subscribe("lote", () => {
      throw new Error("conexão quebrada")
    })
    bus.subscribe("lote", healthy)

    expect(() => bus.publish("lote", cancelled)).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
  })

  it("quem assina durante a publicação só recebe o próximo evento", () => {
    const bus = createLotEvents()
    const late = vi.fn()
    bus.subscribe("lote", () => {
      bus.subscribe("lote", late)
    })

    bus.publish("lote", cancelled)
    expect(late).not.toHaveBeenCalled()

    bus.publish("lote", cancelled)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it("publicar num lote sem assinantes não faz nada", () => {
    const bus = createLotEvents()
    expect(() => bus.publish("ninguem", cancelled)).not.toThrow()
    expect(bus.count("ninguem")).toBe(0)
  })
})
