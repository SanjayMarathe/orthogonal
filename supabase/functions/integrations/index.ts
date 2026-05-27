import { fetchOrthogonalCatalog } from "../_shared/integrations.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireAppUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    await requireAppUser(req);

    const catalog = await fetchOrthogonalCatalog();

    return new Response(
      JSON.stringify({
        integrations: catalog.integrations,
        count: catalog.count,
        totalEndpoints: catalog.totalEndpoints,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status =
      /Missing authorization|Unauthorized/.test(message) ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
