import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: process.env.PERF ? ["tests/perf.manual.ts"] : process.env.E2E ? ["tests/**/*.e2e.ts"] : ["tests/**/*.test.ts"], testTimeout: 60_000,
    // Las pruebas con base de datos (pipeline y manuales) comparten stride_test: un archivo cada vez.
    fileParallelism: false,
  },
});
