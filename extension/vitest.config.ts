import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      vscode: new URL("./tests/_vscode-mock.ts", import.meta.url).pathname,
    },
  },
});
