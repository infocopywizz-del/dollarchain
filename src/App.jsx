import React, { useEffect, useState } from "react";
import CreditsButton from "./components/CreditsButton";
import CreditsManager from "./components/CreditsManager"; // <-- added

export default function App() {
  const [status, setStatus] = useState("Checking connection...");

  const BASE_URL = import.meta.env.VITE_API_URL || window.location.origin;

  useEffect(() => {
    fetch(`${BASE_URL}/api/hello`)
      .then(r => r.json())
      .then(d => setStatus(d.message || "OK"))
      .catch(() => setStatus("Cannot reach backend"));
  }, []);

  const clientId = "client_test_1";

  return (
    <div style={{ fontFamily: "system-ui,Segoe UI,Roboto", padding: 24 }}>
      <header>
        <h1>DollarChain — dollarchain.store</h1>
        <p style={{ color: "#666" }}>Status: {status}</p>
      </header>

      <main style={{ marginTop: 24 }}>
        <section style={{ marginBottom: 20 }}>
          <h2>Quick actions</h2>
          <CreditsButton />
        </section>

        <section style={{ marginBottom: 20 }}>
          <h2>Credits</h2>
          <CreditsManager clientId={clientId} /> {/* <-- added section */}
        </section>

        <section>
          <h3>Next steps</h3>
          <ol>
            <li>Run the app locally in Replit (or push to GitHub).</li>
            <li>Verify environment variables are set (see README).</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
