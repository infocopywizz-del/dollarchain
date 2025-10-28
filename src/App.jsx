import React, { useEffect, useState } from "react";
import CreditsButton from "./components/CreditsButton";

export default function App() {
  const [status, setStatus] = useState("Checking connection...");
  useEffect(() => {
    fetch("/api/hello")
      .then(r => r.json())
      .then(d => setStatus(d.message || "OK"))
      .catch(() => setStatus("Cannot reach backend"));
  }, []);

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
