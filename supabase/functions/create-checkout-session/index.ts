function response(body: Record<string, unknown>, status: number, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders
  });
}

Deno.serve(async (request) => {
  const appUrl = Deno.env.get("APP_URL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId = Deno.env.get("STRIPE_PRICE_ID");

  if (!appUrl || !supabaseUrl || !anonKey || !stripeSecretKey || !priceId) {
    console.error("Missing checkout function configuration.");
    return response({ error: "Usługa płatności nie jest skonfigurowana." }, 500);
  }
  if (!stripeSecretKey.startsWith("sk_test_")) {
    console.error("Checkout is restricted to Stripe test mode.");
    return response({ error: "Zakup testowy nie jest dostępny poza trybem testowym Stripe." }, 503);
  }

  const appOrigin = new URL(appUrl).origin;
  const corsHeaders = {
    "Access-Control-Allow-Origin": appOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response({ error: "Metoda niedozwolona." }, 405, corsHeaders);
  }
  if (request.headers.get("origin") !== appOrigin) {
    return response({ error: "Niedozwolone źródło żądania." }, 403, corsHeaders);
  }

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return response({ error: "Wymagane jest zalogowanie." }, 401, corsHeaders);
  }

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization }
    });
    if (!userResponse.ok) {
      return response({ error: "Sesja użytkownika jest nieprawidłowa lub wygasła." }, 401, corsHeaders);
    }

    const user = await userResponse.json();
    if (!user || typeof user.id !== "string") {
      return response({ error: "Nie udało się potwierdzić użytkownika." }, 401, corsHeaders);
    }

    const subscriptionUrl = new URL(`${supabaseUrl}/rest/v1/stripe_subscriptions`);
    subscriptionUrl.searchParams.set("select", "status,stripe_customer_id");
    subscriptionUrl.searchParams.set("user_id", `eq.${user.id}`);
    const subscriptionResponse = await fetch(subscriptionUrl, {
      headers: { apikey: anonKey, Authorization: authorization }
    });
    if (!subscriptionResponse.ok) {
      console.error("Could not read the user's subscription state.", subscriptionResponse.status);
      return response({ error: "Nie można sprawdzić statusu subskrypcji." }, 503, corsHeaders);
    }
    const subscriptions = await subscriptionResponse.json();
    const existing = Array.isArray(subscriptions) ? subscriptions[0] : null;
    if (existing && !["canceled", "incomplete_expired"].includes(existing.status)) {
      return response({ error: "Dla tego konta istnieje już subskrypcja." }, 409, corsHeaders);
    }

    const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${stripeSecretKey}` }
    });
    if (!priceResponse.ok) {
      console.error("Could not validate the configured Stripe Price.", priceResponse.status);
      return response({ error: "Nie można zweryfikować ceny subskrypcji." }, 503, corsHeaders);
    }
    const price = await priceResponse.json();
    if (
      price.active !== true
      || price.currency !== "pln"
      || price.unit_amount !== 5000
      || price.recurring?.interval !== "month"
      || price.recurring?.interval_count !== 1
    ) {
      console.error("Configured Stripe Price must be active and cost 5000 PLN per month.");
      return response({ error: "Cena subskrypcji nie jest prawidłowo skonfigurowana." }, 503, corsHeaders);
    }

    const baseUrl = appUrl.replace(/\/+$/, "");
    const form = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${baseUrl}/index.html?subscription=success`,
      cancel_url: `${baseUrl}/index.html?subscription=cancelled`,
      client_reference_id: user.id,
      "metadata[supabase_user_id]": user.id,
      "subscription_data[metadata][supabase_user_id]": user.id
    });
    if (existing?.stripe_customer_id) {
      form.set("customer", existing.stripe_customer_id);
    } else if (typeof user.email === "string" && user.email.length > 0) {
      form.set("customer_email", user.email);
    }

    const checkoutResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": crypto.randomUUID()
      },
      body: form
    });
    const checkout = await checkoutResponse.json();
    if (!checkoutResponse.ok || typeof checkout.url !== "string") {
      console.error("Stripe Checkout session creation failed.", checkoutResponse.status);
      return response({ error: "Nie udało się przygotować płatności." }, 502, corsHeaders);
    }

    return response({ url: checkout.url }, 200, corsHeaders);
  } catch (error) {
    console.error("Checkout session request failed.", error);
    return response({ error: "Nie udało się rozpocząć płatności." }, 500, corsHeaders);
  }
});
