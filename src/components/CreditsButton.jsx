import React, { useState } from "react";

export default function CreditsButton() {
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [payLoading, setPayLoading] = useState(false);
  const [payMessage, setPayMessage] = useState("");
  const [lastReference, setLastReference] = useState(null);
  const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;

  async function fetchCredits() {
    if (!clientId) {
      setResult({ error: "Enter client_id (example: client_123)" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/credits?client_id=${encodeURIComponent(clientId)}`);
      const json = await r.json();
      setResult(json);
    } catch (err) {
      setResult({ error: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  // Start a real Paystack test payment (server-side will create 'orders' and initialize)
  async function startPaystackPayment() {
    setPayLoading(true);
    setPayMessage("");
    try {
      const payload = {
        client_id: clientId || "client_test_1",
        amount: 10000, // amount in smallest currency unit (e.g., kobo) - change as needed
        email: import.meta.env.VITE_PAYSTACK_TEST_EMAIL || "test@example.com",
        credits: 100
      };
      const res = await fetch(`${API_BASE}/api/create-paystack-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!res.ok) {
        setPayMessage("Payment init failed: " + (j.error || JSON.stringify(j)));
        setPayLoading(false);
        return;
      }

      // Open Paystack checkout in new tab
      if (j.authorization_url) {
        window.open(j.authorization_url, "_blank");
        setPayMessage(`Opened checkout. Reference: ${j.reference || "n/a"}`);
        setLastReference(j.reference || null);
      } else {
        setPayMessage("No authorization_url returned.");
      }
    } catch (err) {
      setPayMessage("Error starting payment: " + String(err));
    } finally {
      setPayLoading(false);
    }
  }

  // Verify the last reference (poll / manual verify)
  async function verifyLastReference() {
    if (!lastReference) { setPayMessage("No reference to verify."); return; }
    setPayLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/verify-paystack-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: lastReference })
      });
      const j = await res.json();
      if (res.ok) {
        setPayMessage("Verify result: " + (j.ok ? "success" : (j.note || JSON.stringify(j))));
      } else {
        setPayMessage("Verify failed: " + (j.error || JSON.stringify(j)));
      }
    } catch (err) {
      setPayMessage("Verify error: " + String(err));
    } finally {
      setPayLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label>
          Client ID:&nbsp;
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client_123" />
        </label>
        <button onClick={fetchCredits} disabled={loading} style={{ marginLeft: 8 }}>
          {loading ? "Checking..." : "Check credits"}
        </button>
        <div style={{ marginTop: 12 }}>
          <pre style={{ background: "#f6f8fa", padding: 12 }}>{result ? JSON.stringify(result, null, 2) : "No result yet"}</pre>
        </div>
      </div>

      <div>
        <button onClick={startPaystackPayment} disabled={payLoading} style={{ padding: "8px 16px", marginRight: 8 }}>
          {payLoading ? "Starting..." : "Start Test Payment"}
        </button>
        <button onClick={verifyLastReference} disabled={payLoading || !lastReference} style={{ padding: "8px 12px" }}>
          Verify last payment
        </button>
        {payMessage && <p style={{ marginTop: 8 }}>{payMessage}</p>}
      </div>
    </div>
  );
}
