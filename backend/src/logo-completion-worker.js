import app from "./m4-public-worker.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runStatewideHighSchoolLogoCompletion } from "./statewide-logo-completion.js";

function scheduledDate(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) ? new Date(value) : new Date();
}

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const when = scheduledDate(controller);
    const plan = collectionPlanAt(when);
    const result = await app.scheduled(controller, env, ctx);

    if (plan?.runCatalogMaintenance) {
      try {
        const branding = await runStatewideHighSchoolLogoCompletion(env, { now: when, force: true, mascotLimit: 20 });
        console.log("statewide high-school logo completion", branding);
      } catch (error) {
        console.error("statewide high-school logo completion failed", String(error?.message || error));
      }
    }

    return result;
  }
};
