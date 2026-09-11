import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for chat-sim browser validation.
 * Specs live in tests/qa/specs/.
 *
 * When BASE_URL is not set, Playwright auto-starts the Next.js dev server
 * on port 3000 and waits for it to be ready before running any test.
 * If a server is already listening on that port it is reused as-is.
 */
export default defineConfig({
  testDir: "./tests/qa/specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    // Attach the internal E2E bypass token to every request so the
    // middleware allows /chat-sim without a real user session.
    // Has no effect when E2E_SECRET is not set (token will be empty string).
    extraHTTPHeaders: {
      ...(process.env.E2E_SECRET ? { "x-e2e-token": process.env.E2E_SECRET } : {}),
    },
    /**
     * O caminho do navegador vem do AMBIENTE, e só dele.
     *
     * Aqui existia um caminho fixo com a versão embutida —
     * `/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome` — como
     * reserva. Ele reprovou o job `topo` no runner do GitHub em 06/09/2026, nas
     * três larguras, com `Failed to launch chromium because executable doesn't
     * exist`: no runner o navegador é instalado em `/home/runner/.cache`, e o
     * caminho fixo apontava para um lugar que não existe naquela máquina.
     *
     * O defeito tinha duas metades: o caminho errado, e a VERSÃO chumbada num
     * arquivo de configuração — quando o Playwright instala outra, a reserva
     * deriva sozinha, sem ninguém mexer em nada. Sem `executablePath`, o próprio
     * Playwright acha o navegador que ele instalou, em qualquer máquina, e as
     * duas metades somem juntas.
     *
     * Quem precisa apontar um binário específico (este contêiner, por exemplo)
     * exporta `PLAYWRIGHT_CHROMIUM_PATH` — ou `PLAYWRIGHT_BROWSERS_PATH`, que o
     * Playwright já lê sozinho.
     */
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Give the app enough time to load menu data from the API
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Auto-start the dev server when no external BASE_URL is provided.
  // reuseExistingServer: true means if the app is already running (e.g. npm run dev
  // in a separate terminal) Playwright will use it instead of starting a new one.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          ...process.env as Record<string, string>,
        },
      },
});
