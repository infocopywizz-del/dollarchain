import React, { useState } from "react";

export default function CreditsButton() {
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div>
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
  );
}
