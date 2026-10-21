const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getFirestore } = require("firebase-admin/firestore");
const { v1: firestoreAdminV1 } = require("@google-cloud/firestore");
const Anthropic = require("@anthropic-ai/sdk");

// Matches where these were already deployed by hand — keep new deploys in the same region.
setGlobalOptions({ region: "europe-west1" });

initializeApp();
const messaging = getMessaging();
const db = getFirestore();
const firestoreAdminClient = new firestoreAdminV1.FirestoreAdminClient();
// One-time setup: `firebase functions:secrets:set ANTHROPIC_API_KEY` (see functions/README.md).
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

function slugifyTopic(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "unknown";
}

function parseJsonField(data) {
  if (!data || !data.json) return null;
  try { return JSON.parse(data.json); } catch (e) { return null; }
}

// Same `ledger/<key>` doc shape the client itself reads/writes (persist() in index.html) —
// one Firestore document per top-level app-state key, holding the whole array/object as a
// JSON string field.
async function fetchLedger(key, fallback) {
  const snap = await db.collection("ledger").doc(key).get();
  const parsed = parseJsonField(snap.exists ? snap.data() : null);
  return parsed == null ? fallback : parsed;
}

async function sendPush(topic, title, body, data) {
  try {
    await messaging.send({ topic, notification: { title, body }, ...(data ? { data } : {}) });
  } catch (err) {
    console.error(`Failed to send push to topic ${topic}`, err);
  }
}

// Client <-> staff chat: notify whichever side didn't send the message.
exports.notifyOnClientMessage = onDocumentWritten("ledger/clientChats", async (event) => {
  const beforeChats = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || {};
  const afterChats = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterChats) return;

  for (const customer of Object.keys(afterChats)) {
    const beforeMsgs = beforeChats[customer] || [];
    const afterMsgs = afterChats[customer] || [];
    if (afterMsgs.length <= beforeMsgs.length) continue;

    const newMsgs = afterMsgs.slice(beforeMsgs.length);
    for (const msg of newMsgs) {
      const body = String(msg.text || "").slice(0, 150) || "(no message)";
      if (msg.from === "client") {
        await sendPush("staff", `New message from ${customer}`, body);
      } else if (msg.from === "staff") {
        await sendPush(`client_${slugifyTopic(customer)}`, `New message from ${msg.authorName || "the team"}`, body);
      }
    }
  }
});

// Supplier <-> staff chat: same pattern as the client thread above, keyed by supplier name.
exports.notifyOnSupplierMessage = onDocumentWritten("ledger/supplierChats", async (event) => {
  const beforeChats = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || {};
  const afterChats = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterChats) return;

  for (const supplier of Object.keys(afterChats)) {
    const beforeMsgs = beforeChats[supplier] || [];
    const afterMsgs = afterChats[supplier] || [];
    if (afterMsgs.length <= beforeMsgs.length) continue;

    const newMsgs = afterMsgs.slice(beforeMsgs.length);
    for (const msg of newMsgs) {
      const body = String(msg.text || "").slice(0, 150) || "(no message)";
      if (msg.from === "supplier") {
        await sendPush("staff", `New message from ${supplier}`, body);
      } else if (msg.from === "staff") {
        await sendPush(`supplier_${slugifyTopic(supplier)}`, `New message from ${msg.authorName || "the team"}`, body);
      }
    }
  }
});

// Team chat: notify all staff whenever anyone posts.
exports.notifyOnTeamChatMessage = onDocumentWritten("ledger/chat", async (event) => {
  const beforeMsgs = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterMsgs = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterMsgs || afterMsgs.length <= beforeMsgs.length) return;

  const newMsgs = afterMsgs.slice(beforeMsgs.length);
  for (const msg of newMsgs) {
    const body = String(msg.text || "").slice(0, 150) || "(no message)";
    await sendPush("staff", msg.userName || "Team chat", body);
  }
});

// New RFQ: notify every supplier.
exports.notifyOnNewRfq = onDocumentWritten("ledger/rfqs", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeIds = new Set(beforeList.map((r) => r.id));
  const newRfqs = afterList.filter((r) => !beforeIds.has(r.id));
  for (const rfq of newRfqs) {
    await sendPush("suppliers", "New request for quotation", rfq.title || rfq.number || "New RFQ posted");
  }
});

// New iPhone Store order: notify the iPhone Store admin.
exports.notifyOnNewIphoneOrder = onDocumentWritten("ledger/iphoneOrders", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeIds = new Set(beforeList.map((o) => o.id));
  const newOrders = afterList.filter((o) => !beforeIds.has(o.id));
  for (const order of newOrders) {
    const items = order.items || [];
    const summary = items
      .map((it) => `${it.qty || 1}x ${it.name || "iPhone"}${it.storage ? " " + it.storage : ""}`)
      .join(", ");
    await sendPush(
      "iphone_orders",
      `New iPhone order from ${order.customer || order.userName || "a client"}`,
      summary || "New iPhone Store order request",
      { type: "iphone_order", orderId: order.id || "" }
    );
  }
});

// Admin sends or revises a price on an iPhone order: notify that client.
// sendIphoneOrderPrice() in index.html stamps pricedAt on every send (initial and revision),
// so a changed pricedAt is the signal regardless of which one it was.
exports.notifyOnIphoneOrderPriced = onDocumentWritten("ledger/iphoneOrders", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeById = {};
  beforeList.forEach((o) => { beforeById[o.id] = o; });

  for (const o of afterList) {
    const before = beforeById[o.id];
    if (o.pricedAt && (!before || before.pricedAt !== o.pricedAt)) {
      const total = (o.items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
      const isRevision = !!(before && before.pricedAt);
      await sendPush(
        `client_${slugifyTopic(o.customer)}`,
        isRevision ? "Your iPhone order price was updated" : "Your iPhone order has been priced",
        `Total: ${total.toFixed(2)} — tap to review and confirm.`,
        { type: "iphone_order_priced", orderId: o.id || "" }
      );
    }
  }
});

// Client confirms or declines a priced iPhone order (respondIphoneOrderPrice() in index.html):
// notify the iPhone Store admin.
exports.notifyOnIphoneOrderResponded = onDocumentWritten("ledger/iphoneOrders", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeById = {};
  beforeList.forEach((o) => { beforeById[o.id] = o; });

  for (const o of afterList) {
    const before = beforeById[o.id];
    const isNewResponse = (o.status === "confirmed" || o.status === "declined") && (!before || before.status !== o.status);
    if (isNewResponse) {
      await sendPush(
        "iphone_orders",
        o.status === "confirmed" ? `Order confirmed by ${o.customer || "client"}` : `Order declined by ${o.customer || "client"}`,
        o.status === "confirmed" ? "The client accepted the quoted price." : "The client declined the quoted price.",
        { type: "iphone_order_response", orderId: o.id || "" }
      );
    }
  }
});

// Supplier submits (or resubmits) a quote: notify staff. Includes the RFQ id in the data
// payload so a tap on the notification (handled natively in LedgerApp.swift/ContentView.swift)
// jumps straight to that RFQ via the web app's #rfq=<id> deep link.
exports.notifyOnSupplierQuoteSubmitted = onDocumentWritten("ledger/supplierQuotes", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeByKey = {};
  beforeList.forEach((q) => { beforeByKey[`${q.rfqId}|${q.supplierName}`] = q; });

  for (const q of afterList) {
    const key = `${q.rfqId}|${q.supplierName}`;
    const before = beforeByKey[key];
    const isNew = !before;
    const isResubmitted = before && before.submittedAt !== q.submittedAt;
    if (isNew || isResubmitted) {
      await sendPush(
        "staff",
        `New quote from ${q.supplierName}`,
        "Submitted pricing for an RFQ.",
        { type: "supplier_quote", rfqId: q.rfqId || "" }
      );
    }
  }
});

// Supplier quote accepted (a purchase was created from it): notify that supplier.
exports.notifyOnSupplierQuoteAccepted = onDocumentWritten("ledger/supplierQuotes", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeByKey = {};
  beforeList.forEach((q) => { beforeByKey[`${q.rfqId}|${q.supplierName}`] = q; });

  for (const q of afterList) {
    const key = `${q.rfqId}|${q.supplierName}`;
    const before = beforeByKey[key];
    if (q.status === "accepted" && (!before || before.status !== "accepted")) {
      await sendPush(`supplier_${slugifyTopic(q.supplierName)}`, "Your quote was accepted", "A purchase order has been created from your quote.");
    }
  }
});

// Mirrors calcTotals()/remaining() in index.html closely enough for an overdue check —
// this only needs the total and amount paid, not every display field. Overall discount
// can be a % (discountType:'pct', the default) or a flat amount (discountType:'amt');
// older invoices only ever had discountPct, which this falls back to — same backward
// compatibility index.html's docDiscountType()/docDiscountValue() keep client-side.
function invoiceTotal(inv) {
  const subtotal = (inv.items || []).reduce((a, it) => {
    const qty = Number(it.qty) || 0, price = Number(it.price) || 0, disc = Number(it.discountPct) || 0;
    return a + qty * price * (1 - disc / 100);
  }, 0);
  const discType = inv.discountType === "amt" ? "amt" : "pct";
  const discValue = Number(inv.discountType ? inv.discountValue : inv.discountPct) || 0;
  const discAmt = discType === "amt" ? Math.min(Math.max(discValue, 0), subtotal) : subtotal * (Math.max(discValue, 0) / 100);
  const afterDisc = subtotal - discAmt;
  const chargesTotal = (inv.charges || []).reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const taxableBase = afterDisc + chargesTotal;
  const vatAmt = inv.vatOn ? taxableBase * ((Number(inv.vatRate) || 0) / 100) : 0;
  return taxableBase + vatAmt;
}
function invoiceRemaining(inv) {
  const paid = (inv.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return Math.max(0, invoiceTotal(inv) - paid);
}
function isInvoiceOverdue(inv, todayStr) {
  return inv.status !== "paid" && !!inv.dueDate && inv.dueDate < todayStr && invoiceRemaining(inv) > 0.005;
}

// Runs daily: pushes one reminder per newly-overdue invoice to staff and to that
// customer's client topic, then stamps lastOverdueReminderAt so the same invoice
// doesn't page anyone again until the following day.
exports.notifyOverdueInvoices = onSchedule("0 9 * * *", async () => {
  const ref = db.collection("ledger").doc("invoices");
  const snap = await ref.get();
  const invoices = parseJsonField(snap.exists ? snap.data() : null);
  if (!invoices) return;

  const today = new Date().toISOString().slice(0, 10);
  let changed = false;

  for (const inv of invoices) {
    if (!isInvoiceOverdue(inv, today)) continue;
    if (inv.lastOverdueReminderAt === today) continue;

    const amount = invoiceRemaining(inv).toFixed(2);
    await sendPush(
      "staff",
      `Invoice overdue: ${inv.number}`,
      `${inv.customer || "A customer"} — ${amount} past due since ${inv.dueDate}`,
      { type: "invoice_overdue", invoiceId: inv.id || "" }
    );
    if (inv.customer) {
      await sendPush(
        `client_${slugifyTopic(inv.customer)}`,
        "Payment reminder",
        `Invoice ${inv.number} for ${amount} is now overdue.`,
        { type: "invoice_overdue", invoiceId: inv.id || "" }
      );
    }
    inv.lastOverdueReminderAt = today;
    changed = true;
  }

  if (changed) {
    await ref.set({ json: JSON.stringify(invoices), updatedAt: Date.now() });
  }
});

// Someone signs in (doLogin() in index.html stamps lastLoginAt on their user record):
// notify staff so admins can see who's accessing the system and when.
exports.notifyOnLogin = onDocumentWritten("ledger/users", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeById = {};
  beforeList.forEach((u) => { beforeById[u.id] = u; });

  for (const u of afterList) {
    const before = beforeById[u.id];
    if (u.lastLoginAt && (!before || before.lastLoginAt !== u.lastLoginAt)) {
      const roleLabel = { admin: "Admin", staff: "Staff", purchasing: "Purchasing", readonly: "Read only", client: "Client", supplier: "Supplier" }[u.role] || u.role;
      await sendPush("staff", `${u.name} logged in`, roleLabel, { type: "login" });
    }
  }
});

// Client signs a quote (saveSignature() in index.html stamps signedAt/clientSignature):
// notify staff that it's been accepted and signed.
exports.notifyOnQuoteSigned = onDocumentWritten("ledger/quotes", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeById = {};
  beforeList.forEach((q) => { beforeById[q.id] = q; });

  for (const q of afterList) {
    const before = beforeById[q.id];
    if (q.signedAt && (!before || before.signedAt !== q.signedAt)) {
      await sendPush(
        "staff",
        `Quote ${q.number} signed`,
        `${q.signedBy || q.customer || "Client"} accepted and signed the quote.`,
        { type: "quote_signed", quoteId: q.id || "" }
      );
    }
  }
});

// Supplier signs a purchase order (saveSignature() in index.html stamps signedAt/confirmedBySupplier):
// notify staff that it's been confirmed.
exports.notifyOnPurchaseSigned = onDocumentWritten("ledger/purchases", async (event) => {
  const beforeList = parseJsonField(event.data.before.exists ? event.data.before.data() : null) || [];
  const afterList = parseJsonField(event.data.after.exists ? event.data.after.data() : null);
  if (!afterList) return;

  const beforeById = {};
  beforeList.forEach((p) => { beforeById[p.id] = p; });

  for (const p of afterList) {
    const before = beforeById[p.id];
    if (p.confirmedBySupplier && (!before || before.signedAt !== p.signedAt)) {
      await sendPush(
        "staff",
        `Purchase order ${p.number} confirmed`,
        `${p.supplier || "Supplier"} confirmed the order by signature.`,
        { type: "purchase_signed", purchaseId: p.id || "" }
      );
    }
  }
});

// Runs nightly: a full, server-side Firestore export (every collection, not just the
// `ledger/*` docs this file already watches) to the project's own default Storage
// bucket, under firestore-backups/ — no separate bucket to create. This is the backend
// counterpart to the "Export data backup" button in the app itself (More > Administration):
// that one is a manual, on-demand JSON download; this one runs on its own every night
// regardless of whether anyone remembers to click the button. Exports older than 30 days
// are deleted by the lifecycle rule on that path (see functions/README.md) rather than
// from here, since export jobs can still be in progress when this function returns.
exports.scheduledFirestoreExport = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Dubai" },
  async () => {
    const projectId = process.env.GCLOUD_PROJECT;
    const databaseName = firestoreAdminClient.databasePath(projectId, "(default)");
    const outputUriPrefix = `gs://${projectId}.firebasestorage.app/firestore-backups`;
    try {
      const [response] = await firestoreAdminClient.exportDocuments({
        name: databaseName,
        outputUriPrefix,
        // Empty = every collection in the database.
        collectionIds: [],
      });
      console.log("Firestore export started:", response.name);
    } catch (err) {
      console.error("Failed to start Firestore export", err);
    }
  }
);

// ---------- AI ASSISTANT ----------
// A plain HTTPS function (not onCall) because this app doesn't use Firebase Auth — every
// login is a row in ledger/users checked client-side, so the client just sends its
// username and this function checks it's a real, non-portal account before doing anything.
// That's the same trust level the rest of this app already runs on; it's not meant to
// withstand a determined attacker, just keep the endpoint from being open to the world.
function fmtMoney(n, currency) {
  return `${currency} ${(Number(n) || 0).toFixed(2)}`;
}

// Pulls a bounded, token-cheap summary of the live business data — aggregate counts plus
// the most recent/relevant rows of each kind, not the full history of every collection —
// so a years-old business doesn't blow the context window on one chat message.
async function buildBusinessContext() {
  const [settings, invoices, quotes, purchases, inventory, projects, iphoneOrders, rfqs, todos] = await Promise.all([
    fetchLedger("settings", {}),
    fetchLedger("invoices", []),
    fetchLedger("quotes", []),
    fetchLedger("purchases", []),
    fetchLedger("inventory", []),
    fetchLedger("projects", []),
    fetchLedger("iphoneOrders", []),
    fetchLedger("rfqs", []),
    fetchLedger("todos", []),
  ]);

  const currency = settings.currency || "AED";
  const today = new Date().toISOString().slice(0, 10);

  const invRows = invoices.map((inv) => ({
    inv,
    total: invoiceTotal(inv),
    remaining: invoiceRemaining(inv),
    overdue: isInvoiceOverdue(inv, today),
  }));
  const unpaid = invRows.filter((r) => r.remaining > 0.005);
  const outstanding = unpaid.reduce((a, r) => a + r.remaining, 0);
  const overdueRows = invRows.filter((r) => r.overdue);
  const recentInvoices = [...invRows].sort((a, b) => (b.inv.date || "").localeCompare(a.inv.date || "")).slice(0, 25);
  const recentQuotes = [...quotes].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 15);
  const lowStock = inventory.filter((i) => (Number(i.stock) || 0) <= (Number(i.lowStockThreshold) || 0));
  const openProjects = projects.filter((p) => p.status !== "completed" && p.status !== "cancelled");
  const openTodos = todos.filter((t) => !t.done);
  const pendingPurchases = purchases.filter((p) => p.status !== "received");
  const openRfqs = rfqs.filter((r) => r.status === "open");

  const lines = [];
  lines.push(`Company: ${settings.companyName || "this business"}. Currency: ${currency}. Today's date: ${today}.`);
  lines.push(`Invoices: ${invoices.length} total, ${unpaid.length} unpaid (${fmtMoney(outstanding, currency)} outstanding), ${overdueRows.length} overdue.`);
  if (overdueRows.length) {
    lines.push("Overdue invoices: " + overdueRows.slice(0, 15).map((r) =>
      `${r.inv.number} (${r.inv.customer || "—"}, ${fmtMoney(r.remaining, currency)} remaining, due ${r.inv.dueDate})`
    ).join("; "));
  }
  lines.push("Recent invoices (newest first): " + (recentInvoices.length ? recentInvoices.map((r) =>
    `${r.inv.number} — ${r.inv.customer || "—"} — ${r.inv.status} — ${fmtMoney(r.total, currency)} (${fmtMoney(r.remaining, currency)} remaining) — ${r.inv.date}`
  ).join(" | ") : "none"));
  lines.push(`Quotes: ${quotes.length} total.`);
  lines.push("Recent quotes: " + (recentQuotes.length ? recentQuotes.map((q) =>
    `${q.number} — ${q.customer || "—"} — ${q.status} — ${q.date}`
  ).join(" | ") : "none"));
  lines.push(`Purchases: ${purchases.length} total, ${pendingPurchases.length} not yet received.`);
  lines.push("Pending purchases: " + (pendingPurchases.length ? pendingPurchases.slice(0, 15).map((p) =>
    `${p.number} — ${p.supplier || "—"} — ${p.status} — ${p.date}`
  ).join(" | ") : "none"));
  lines.push(`Inventory: ${inventory.length} items, ${lowStock.length} low on stock.`);
  if (lowStock.length) {
    lines.push("Low stock items: " + lowStock.slice(0, 30).map((i) => `${i.name} (${i.stock} left, threshold ${i.lowStockThreshold})`).join(", "));
  }
  lines.push(`Projects: ${projects.length} total, ${openProjects.length} open.`);
  lines.push("Open projects: " + (openProjects.length ? openProjects.slice(0, 20).map((p) =>
    `${p.number} — ${p.name} — ${p.customer || "—"} — ${p.status}`
  ).join(" | ") : "none"));
  if (iphoneOrders.length) {
    const openIphone = iphoneOrders.filter((o) => o.status === "new" || o.status === "priced");
    lines.push(`Apple Store orders: ${iphoneOrders.length} total, ${openIphone.length} awaiting action.`);
  }
  if (rfqs.length) {
    lines.push("Open RFQs: " + (openRfqs.length ? openRfqs.slice(0, 15).map((r) => `${r.number} — ${r.title || "untitled"}`).join(" | ") : "none"));
  }
  if (openTodos.length) {
    lines.push("Open to-dos: " + openTodos.slice(0, 20).map((t) => t.text).join(" | "));
  }

  return { companyName: settings.companyName || "THE H BUSINESS MANAGEMENT", summary: lines.join("\n") };
}

exports.aiAssistant = onRequest(
  { cors: true, secrets: [anthropicApiKey], timeoutSeconds: 60, memory: "512MiB" },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

    const { username, question, history } = req.body || {};
    if (!username || !question || typeof question !== "string" || !question.trim()) {
      res.status(400).json({ error: "username and question are required" });
      return;
    }

    const users = await fetchLedger("users", []);
    const user = users.find((u) => u.username === username);
    if (!user || user.role === "client" || user.role === "supplier") {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    let context;
    try {
      context = await buildBusinessContext();
    } catch (err) {
      console.error("Failed to build AI assistant context", err);
      res.status(500).json({ error: "Could not load business data" });
      return;
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-20)
      : [];

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });
    try {
      const response = await client.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: `You are the AI Assistant built into "${context.companyName}"'s internal business management app. ` +
          `You help staff answer questions about the business's live data (invoices, quotes, purchases, inventory, projects, RFQs, to-dos) ` +
          `and draft messages or notes (e.g. a payment reminder, a client update) when asked. ` +
          `Keep answers short and direct — this is a chat panel, not a report. ` +
          `The data below is a bounded summary (recent/relevant rows, not full history) as of right now — if something isn't in it, say you don't have that specific record rather than guessing. Never invent figures.\n\n` +
          context.summary,
        messages: [...safeHistory, { role: "user", content: question }],
      });
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      res.json({ reply: text || "(no response)" });
    } catch (err) {
      console.error("Anthropic API call failed", err);
      if (err instanceof Anthropic.AuthenticationError) {
        res.status(500).json({ error: "AI Assistant isn't set up yet — missing or invalid API key." });
      } else if (err instanceof Anthropic.RateLimitError) {
        res.status(429).json({ error: "AI Assistant is busy — try again in a moment." });
      } else {
        res.status(502).json({ error: "AI request failed — try again in a moment." });
      }
    }
  }
);
