import { defineConfig } from "orval"

export default defineConfig({
  api: {
    input: "./openapi.json",
    output: {
      target: "./src/api/generated/api.ts",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      override: {
        mutator: { path: "./src/api/fetcher.ts", name: "apiFetch" },
      },
    },
  },
})
