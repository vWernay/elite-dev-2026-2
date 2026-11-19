import argon2 from "argon2"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { buildApp } from "../app.js"
import { resetDb } from "../test/factories.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const register = (email: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { name: "Ana", email, password: "senha12345", role: "bidder" },
  })

describe("cadastro com e-mail já usado", () => {
  it("responde com mensagem genérica, sem citar o e-mail nem 'cadastrado'", async () => {
    await register("ana@teste.com")
    const response = await register("ana@teste.com")

    expect(response.statusCode).toBe(400)
    const { error } = response.json()
    expect(error.code).toBe("REGISTRATION_FAILED")
    expect(error.message).toBe(
      "Não foi possível concluir o cadastro com esses dados.",
    )
    expect(response.body).not.toMatch(/cadastrad|existe|ana@teste\.com|taken/i)
  })

  it("não abre sessão quando o cadastro falha", async () => {
    await register("ana@teste.com")
    const response = await register("ana@teste.com")
    expect(response.cookies).toHaveLength(0)
  })

  it("o e-mail em outra caixa também é o mesmo", async () => {
    await register("ana@teste.com")
    const response = await register("ANA@teste.com")
    expect(response.json().error.code).toBe("REGISTRATION_FAILED")
  })

  it("roda o hash da senha nos dois casos, para o tempo não denunciar", async () => {
    const hash = vi.spyOn(argon2, "hash")
    await register("nova@teste.com")
    const afterNew = hash.mock.calls.length
    await register("nova@teste.com")
    const afterDuplicate = hash.mock.calls.length
    hash.mockRestore()

    expect(afterNew).toBe(1)
    expect(afterDuplicate - afterNew).toBe(1)
  })
})
