import React, { useState } from "react";

export default function CreditsButton() {
  // Common states
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Paystack checkout (card) states - preserved from your file
  const [payLoading, setPayLoading] = useState(false);
  const [payMessage, setPayMessage] = useState("");
  const [lastReference, setLastReference] = useState(null);

  // M-Pesa states (preferred/default)
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [mpesaMessage, setMpesaMessage] = useState("");
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [lastMpesaReference, setLastMpesaReference] = useState(null);

  const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;

  // --- existing: fetch credits ---
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

  // --- existing: Start a Paystack checkout (card/authorization_url) ---
  async function startPaystackPayment() {
    setPayLoading(true);
    setPayMessage("");
    try {
      const payload = {
        client_id: clientId || "client_test_1",
        amount: 10000, // smallest currency unit (e.g., kobo)
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

      // Open Paystack checkout in new tab and save reference
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

  // --- existing: Verify the last checkout reference ---
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

  // --- NEW: Start M-Pesa STK push via Paystack Charge API ---
  async function startMpesa() {
    if (!clientId) { setMpesaMessage("Set client_id first"); return; }
    if (!mpesaPhone) { setMpesaMessage("Enter phone number (e.g. 2547XXXXXXXX)"); return; }

    setMpesaLoading(true);
    setMpesaMessage("");
    try {
      const payload = {
        client_id: clientId,
        phone: mpesaPhone,
        amount: 10000, // smallest unit (KES kobo) - change as needed
        credits: 50,
        email: import.meta.env.VITE_PAYSTACK_TEST_EMAIL || "okendo017@gmail.com"
      };

      const res = await fetch(`${API_BASE}/api/start-mpesa-charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const j = await res.json();
      if (!res.ok) {
        setMpesaMessage("Failed to start M-Pesa charge: " + (j.error || JSON.stringify(j)));
        setMpesaLoading(false);
        return;
      }

      // Paystack returns useful display text for offline/mobile flows
      const paystack = j.paystack || {};
      const display = paystack.data?.display_text || paystack.message || JSON.stringify(paystack);

      setMpesaMessage("Payment started. Instruction: " + display);
      setLastMpesaReference(j.reference || paystack.data?.reference || null);
    } catch (err) {
      setMpesaMessage("Error starting M-Pesa payment: " + String(err));
    } finally {
      setMpesaLoading(false);
    }
  }

  // Optional: verify MPESA reference using existing verify endpoint
  async function verifyMpesaReference() {
    const ref = lastMpesaReference;
    if (!ref) { setMpesaMessage("No MPESA reference to verify."); return; }
    setMpesaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/verify-paystack-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: ref })
      });
      const j = await res.json();
      if (res.ok) {
        setMpesaMessage("MPESA verify: " + (j.ok ? "success" : (j.note || JSON.stringify(j))));
      } else {
        setMpesaMessage("MPESA verify failed: " + (j.error || JSON.stringify(j)));
      }
    } catch (err) {
      setMpesaMessage("Verify error: " + String(err));
    } finally {
      setMpesaLoading(false);
    }
  }

  return (
    <div>
      {/* --- Credits checker --- */}
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

      <hr />

      {/* --- Paystack checkout (card) --- */}
      <div style={{ marginBottom: 16 }}>
        <h4>Start Paystack checkout (authorization_url)</h4>
        <div>
          <button onClick={startPaystackPayment} disabled={payLoading} style={{ padding: "8px 16px", marginRight: 8 }}>
            {payLoading ? "Starting..." : "Start Test Payment"}
          </button>
          <button onClick={verifyLastReference} disabled={payLoading || !lastReference} style={{ padding: "8px 12px" }}>
            Verify last payment
          </button>
        </div>
        {payMessage && <p style={{ marginTop: 8 }}>{payMessage}</p>}
        {lastReference && <p>Reference: {lastReference}</p>}
      </div>

      <hr />

      {/* --- M-Pesa STK flow (default) --- */}
      <div style={{ marginTop: 12 }}>
        <h4>Buy credits via M-Pesa (STK push) — default</h4>
        <label>
          Phone (254...): &nbsp;
          <input value={mpesaPhone} onChange={(e) => setMpesaPhone(e.target.value)} placeholder="2547XXXXXXXX" />
        </label>
        <div style={{ marginTop: 8 }}>
          <button onClick={startMpesa} disabled={mpesaLoading} style={{ padding: "8px 16px", marginRight: 8 }}>
            {mpesaLoading ? "Starting M-Pesa..." : "Pay with M-Pesa (STK)"}
          </button>
          <button onClick={verifyMpesaReference} disabled={mpesaLoading || !lastMpesaReference} style={{ padding: "8px 12px" }}>
            Verify MPESA payment
          </button>
        </div>
        {mpesaMessage && <p style={{ marginTop: 10 }}>{mpesaMessage}</p>}
        {lastMpesaReference && <p>MPESA Reference: {lastMpesaReference}</p>}
      </div>
    </div>
  );
}
