const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getFirestore } = require("firebase-admin/firestore");

// Matches where these were already deployed by hand — keep new deploys in the same region.
setGlobalOptions({ region: "europe-west1" });

initializeApp();
const messaging = getMessaging();
const db = getFirestore();

function slugifyTopic(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "unknown";
}

function parseJsonField(data) {
  if (!data || !data.json) return null;
  try { return JSON.parse(data.json); } catch (e) { return null; }
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
// this only needs the total and amount paid, not every display field.
function invoiceTotal(inv) {
  const subtotal = (inv.items || []).reduce((a, it) => {
    const qty = Number(it.qty) || 0, price = Number(it.price) || 0, disc = Number(it.discountPct) || 0;
    return a + qty * price * (1 - disc / 100);
  }, 0);
  const afterDisc = subtotal * (1 - (Number(inv.discountPct) || 0) / 100);
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
