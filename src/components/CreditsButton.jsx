import React, { useState } from "react";

export default function CreditsButton() {
  // Existing state
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // New state for test payment
  const [testLoading, setTestLoading] = useState(false);
  const [testMessage, setTestMessage] = useState("");

  // Existing function: fetch credits
  async function fetchCredits() {
    if (!clientId) {
      setResult({ error: "Enter client_id (example: client_123)" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/credits?client_id=${encodeURIComponent(clientId)}`);
      const json = await r.json();
      setResult(json);
    } catch (err) {
      setResult({ error: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  // New function: trigger test Paystack payment
  async function handleTestPayment() {
    setTestLoading(true);
    setTestMessage("");

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/paystack-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "test-signature", // placeholder for test
        },
        body: JSON.stringify({
          event: "charge.success",
          data: {
            reference: "test-ref-" + Date.now(),
            status: "success",
            amount: 100,
            email: import.meta.env.VITE_PAYSTACK_TEST_EMAIL || "test@example.com",
          },
        }),
      });

      const data = await res.json();
      if (data.ok) setTestMessage("Test payment successful! Credits updated.");
      else setTestMessage(`Webhook responded with note: ${data.note || data.error}`);
    } catch (err) {
      setTestMessage("Error triggering test payment: " + err.message);
    }

    setTestLoading(false);
  }

  return (
    <div>
      {/* Existing credit checker */}
      <div style={{ marginBottom: 16 }}>
        <label>
          Client ID:&nbsp;
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client_123" />
        </label>
        <button onClick={fetchCredits} disabled={loading} style={{ marginLeft: 8 }}>
          {loading ? "Checking..." : "Check credits"}
        </button>

        <div style={{ marginTop: 12 }}>
          <pre style={{ background: "#f6f8fa", padding: 12 }}>
            {result ? JSON.stringify(result, null, 2) : "No result yet"}
          </pre>
        </div>
      </div>

      {/* New Paystack test payment button */}
      <div>
        <button onClick={handleTestPayment} disabled={testLoading} style={{ padding: "8px 16px" }}>
          {testLoading ? "Processing..." : "Test Add Credits"}
        </button>
        {testMessage && <p style={{ marginTop: 8 }}>{testMessage}</p>}
      </div>
    </div>
  );
}
