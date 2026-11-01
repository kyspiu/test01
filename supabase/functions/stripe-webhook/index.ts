function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[\da-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  const timestampNumber = Number(timestamp);
  if (
    !timestamp
    || !Number.isInteger(timestampNumber)
    || Math.abs(Date.now() / 1000 - timestampNumber) > 300
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  ));

  return signatures.some((signature) => {
    const received = hexToBytes(signature);
    return received !== null && constantTimeEqual(expected, received);
  });
}

function getStripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getUserIdFromMetadata(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.metadata)) return null;
  return value.metadata.supabase_user_id;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Missing Stripe webhook function configuration.");
    return new Response("Webhook is not configured.", { status: 500 });
  }

  const payload = await request.text();
  let event: Record<string, unknown>;
  try {
    if (!await verifyStripeSignature(payload, request.headers.get("stripe-signature"), webhookSecret)) {
      return new Response("Invalid Stripe signature.", { status: 400 });
    }
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed)) return new Response("Invalid webhook payload.", { status: 400 });
    event = parsed;
  } catch (error) {
    console.error("Stripe webhook signature or payload validation failed.", error);
    return new Response("Invalid webhook payload.", { status: 400 });
  }

  const eventCreated = event.created;
  const eventType = event.type;
  const eventData = event.data;
  const stripeObject = isRecord(eventData) ? eventData.object : null;
  if (
    typeof eventCreated !== "number"
    || !Number.isInteger(eventCreated)
    || !isRecord(stripeObject)
    || typeof eventType !== "string"
  ) {
    return new Response("Invalid Stripe event.", { status: 400 });
  }

  let subscription: Record<string, unknown> = stripeObject;
  let userId = getUserIdFromMetadata(stripeObject);

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    if (stripeObject.mode !== "subscription") {
      return new Response("Ignored non-subscription checkout.", { status: 200 });
    }
    const subscriptionId = getStripeId(stripeObject.subscription);
    if (!subscriptionId || !isUuid(userId)) {
      return new Response("Checkout is missing subscription ownership metadata.", { status: 400 });
    }

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { headers: { Authorization: `Bearer ${stripeSecretKey}` } }
    );
    if (!stripeResponse.ok) {
      console.error("Could not retrieve the Checkout subscription.", stripeResponse.status);
      return new Response("Could not retrieve subscription.", { status: 502 });
    }
    const stripeSubscription: unknown = await stripeResponse.json();
    if (!isRecord(stripeSubscription)) {
      return new Response("Invalid subscription response.", { status: 502 });
    }
    subscription = stripeSubscription;
    if (getUserIdFromMetadata(subscription) !== userId) {
      return new Response("Subscription ownership metadata does not match.", { status: 400 });
    }
  } else if (![
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted"
  ].includes(eventType)) {
    return new Response("Event ignored.", { status: 200 });
  }

  userId = getUserIdFromMetadata(subscription) || userId;
  const customerId = getStripeId(subscription.customer);
  const subscriptionId = getStripeId(subscription.id);
  const validStatuses = [
    "incomplete", "incomplete_expired", "trialing", "active",
    "past_due", "canceled", "unpaid", "paused"
  ];
  if (
    !isUuid(userId)
    || !customerId
    || !subscriptionId
    || typeof subscription.status !== "string"
    || !validStatuses.includes(subscription.status)
  ) {
    console.error("Stripe subscription event is missing valid ownership or status data.");
    return new Response("Invalid subscription event.", { status: 400 });
  }

  const subscriptionItems = isRecord(subscription.items) ? subscription.items.data : null;
  const firstItem = Array.isArray(subscriptionItems) && isRecord(subscriptionItems[0])
    ? subscriptionItems[0]
    : null;
  const periodEnd = typeof subscription.current_period_end === "number"
    ? subscription.current_period_end
    : firstItem?.current_period_end;
  const currentPeriodEnd = typeof periodEnd === "number" && Number.isInteger(periodEnd)
    ? new Date(periodEnd * 1000).toISOString()
    : null;

  try {
    const syncResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_stripe_subscription`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_stripe_customer_id: customerId,
        p_stripe_subscription_id: subscriptionId,
        p_status: subscription.status,
        p_current_period_end: currentPeriodEnd,
        p_cancel_at_period_end: subscription.cancel_at_period_end === true,
        p_event_created: eventCreated
      })
    });
    if (!syncResponse.ok) {
      console.error("Could not synchronize Stripe subscription state.", syncResponse.status);
      return new Response("Could not synchronize subscription.", { status: 500 });
    }
  } catch (error) {
    console.error("Stripe subscription synchronization failed.", error);
    return new Response("Could not synchronize subscription.", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
