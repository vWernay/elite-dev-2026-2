export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://leilao:leilao@localhost:5432/leilao_test"

export const TEST_SECRET = "t".repeat(64)
