/**
 * Next.js Instrumentation Hook
 *
 * Runs once when the Node.js server process starts.
 * Starts background schedulers: CartRecoveryScheduler e ScheduledCampaignScheduler.
 * Also auto-syncs Evolution webhook URLs so WhatsApp recovers automatically
 * after every deploy without manual intervention.
 *
 * Faxina: o AutoSimulatorScheduler (tick de 60s) foi DESLIGADO — gravava
 * telemetria que nenhum produto lê (painel em rota não-navegável). O serviço e
 * a rota /ai-simulator permanecem no código, só não rodam no boot.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { CartRecoveryScheduler } = await import(
      "./services/order/CartRecoveryScheduler"
    );
    CartRecoveryScheduler.start();

    const { ScheduledCampaignScheduler } = await import(
      "./services/crm/ScheduledCampaignScheduler"
    );
    ScheduledCampaignScheduler.start();

    // Antes daqui saía um re-registro do webhook da Evolution a cada deploy. A
    // Evolution foi eliminada em 04/08/2026 e a Meta NÃO precisa disso: o webhook
    // é registrado uma vez no aplicativo e não é marcado como falho por downtime.
  }
}

