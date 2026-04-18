    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 45000
    }
  );

  return getTextFromResponse(response.data);
}

async function sendWhatsAppText(to, body) {
  const token = requiredEnv("WHATSAPP_TOKEN");
  const phoneNumberId = requiredEnv("PHONE_NUMBER_ID");

  await axios.post(
    `${META_GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 45000
    }
  );
}

async function notifyOpenClaw(payload) {
  const url = process.env.OPENCLAW_WEBHOOK_URL;
  if (!url) {
    return;
  }

  const secret = process.env.OPENCLAW_WEBHOOK_SECRET;
  const headers = {
    "Content-Type": "application/json"
  };

  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  await axios.post(url, payload, {
    headers,
    timeout: 15000
  });
}

function extractIncomingMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message) {
    return null;
  }

  const from = message.from;
  const text =
    message?.text?.body ||
    message?.button?.text ||
    message?.interactive?.button_reply?.title ||
    message?.interactive?.list_reply?.title ||
    "";

  return {
    from,
    text,
    raw: body,
    message,
    metadata: value?.metadata || null
  };
}

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "whatsapp-openclaw-assistant"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.VERIFY_TOKEN;

  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  console.error("Webhook verification failed.", {
    mode,
    tokenPresent: Boolean(token),
    verifyConfigured: Boolean(verifyToken)
  });
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    if (req.body?.object !== "whatsapp_business_account") {
      return;
    }

    const incoming = extractIncomingMessage(req.body);
    if (!incoming || !incoming.from || !incoming.text) {
      return;
    }

    console.log("Incoming WhatsApp message:", {
      from: incoming.from,
      text: incoming.text
    });

    const reply = await askOpenAI(incoming.text);
    await sendWhatsAppText(incoming.from, reply);

    await notifyOpenClaw({
      source: "whatsapp",
      from: incoming.from,
      text: incoming.text,
      reply,
      metadata: incoming.metadata,
      receivedAt: new Date().toISOString()
    });
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error("Webhook processing failed:", {
      message: error.message,
      status,
      data
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
