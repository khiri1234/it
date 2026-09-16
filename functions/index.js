const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');

initializeApp();

// The web app stores each data type as a single Firestore doc holding a JSON-stringified
// array (see persist()/loadAll() in index.html) — there's no per-record collection to
// trigger on. So this fires on every write to ledger/supplierQuotes, diffs the array
// against its previous version to find quotes that are brand new or were just
// (re)submitted (submittedAt changed), and sends one push per quote to the "staff" FCM
// topic — which every signed-in admin/staff device on the native iOS app is already
// subscribed to via syncPushTopic() in the web app (see pushTopicsForUser()).
exports.notifyNewSupplierQuotes = onDocumentWritten('ledger/supplierQuotes', async (event) => {
  const afterSnap = event.data && event.data.after;
  if (!afterSnap || !afterSnap.exists) return; // document deleted — nothing to notify
  const afterJson = afterSnap.data().json;
  if (!afterJson) return;

  const beforeSnap = event.data && event.data.before;
  const beforeJson = beforeSnap && beforeSnap.exists ? beforeSnap.data().json : null;

  let before = [], after = [];
  try { if (beforeJson) before = JSON.parse(beforeJson); } catch (e) { before = []; }
  try { after = JSON.parse(afterJson); } catch (e) { return; }

  const beforeSubmittedAt = new Map(before.map(q => [q.id, q.submittedAt]));
  const newOrUpdated = after.filter(q => beforeSubmittedAt.get(q.id) !== q.submittedAt);
  if (newOrUpdated.length === 0) return;

  let rfqs = [];
  try {
    const rfqsSnap = await getFirestore().collection('ledger').doc('rfqs').get();
    rfqs = JSON.parse((rfqsSnap.data() || {}).json || '[]');
  } catch (e) {
    console.error('could not load rfqs for notification context', e);
  }

  const messaging = getMessaging();
  await Promise.all(newOrUpdated.map(q => {
    const rfq = rfqs.find(r => r.id === q.rfqId);
    const rfqLabel = rfq ? (rfq.title ? `${rfq.number} — ${rfq.title}` : rfq.number) : 'an RFQ';
    return messaging.send({
      topic: 'staff',
      notification: {
        title: 'New supplier quote',
        body: `${q.supplierName} quoted on ${rfqLabel}`,
      },
      data: { type: 'supplier_quote', rfqId: q.rfqId || '' },
      apns: { payload: { aps: { sound: 'default' } } },
    }).catch(err => console.error('FCM send failed for quote', q.id, err));
  }));
});
