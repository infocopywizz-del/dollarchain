import React, { useState, useEffect } from "react";

export default function CreditsManager({ clientId }) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [spending, setSpending] = useState(false);

  // Fetch user credits
  useEffect(() => {
    async function fetchCredits() {
      try {
        setLoading(true);
        const res = await fetch(`/api/credits?client_id=${clientId}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setBalance(data.balance);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchCredits();
  }, [clientId]);

  // Function to spend credits
  async function spendCredits(amount) {
    try {
      setSpending(true);
      const res = await fetch("/api/use-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, amount, actor: "frontend_test" }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      if (data.success) setBalance(data.new_balance);
    } catch (err) {
      setError(err.message);
    } finally {
      setSpending(false);
    }
  }

  if (loading) return <div>Loading credits...</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h3>Credits Balance: {balance}</h3>
      <button onClick={() => spendCredits(50)} disabled={spending || balance < 50}>
        Spend 50 Credits
      </button>
    </div>
  );
}
