import React, { useEffect, useState } from "react";
import CreditsButton from "./components/CreditsButton";
import CreditsManager from "./components/CreditsManager"; // keep this import

export default function App() {
  const [status, setStatus] = useState("Checking connection...");

  // Use VITE_API_URL from environment; fallback to window.location.origin
  const BASE_URL = import.meta.env.VITE_API_URL || window.location.origin;

  useEffect(() => {
    fetch(`${BASE_URL}/api/hello`)
      .then(r => r.json())
      .then(d => setStatus(d.message || "OK"))
      .catch(() => setStatus("Cannot reach backend"));
  }, [BASE_URL]); // add BASE_URL as dependency

  const clientId = "client_test_1"; // still hardcoded for now

  return (
    <div style={{ fontFamily: "system-ui,Segoe UI,Roboto", padding: 24 }}>
      <header>
        <h1>DollarChain — dollarchain.store</h1>
        <p style={{ color: "#666" }}>Status: {status}</p>
      </header>

      <main style={{ marginTop: 24 }}>
        {/* Quick actions */}
        <section style={{ marginBottom: 20 }}>
          <h2>Quick actions</h2>
          <CreditsButton /> {/* now includes test Paystack webhook button */}
        </section>

        {/* Credits display */}
        <section style={{ marginBottom: 20 }}>
          <h2>Credits</h2>
          <CreditsManager clientId={clientId} /> {/* still works with hardcoded client */}
        </section>

        {/* Next steps */}
        <section>
          <h3>Next steps</h3>
          <ol>
            <li>Run the app locally in Replit (or push to GitHub).</li>
            <li>Verify environment variables are set (VITE_API_URL, VITE_PAYSTACK_TEST_EMAIL).</li>
            <li>Test the "Test Add Credits" button to ensure Paystack webhook and Supabase RPC are working.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
