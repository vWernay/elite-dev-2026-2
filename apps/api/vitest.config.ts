import { defineConfig } from "vitest/config"
import { TEST_DATABASE_URL, TEST_SECRET } from "./src/test/config.js"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // os testes compartilham o mesmo banco
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUDIT_SECRET: TEST_SECRET,
      JWT_SECRET: TEST_SECRET,
      NODE_ENV: "test",
    },
  },
})
