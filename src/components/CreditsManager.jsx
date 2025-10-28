import React, { useEffect, useState } from "react";

export default function CreditsManager({ clientId }) {
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch current credits
  const fetchCredits = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/credits?client_id=${clientId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCredits(data.credits ?? 0);
    } catch (err) {
      setError("Failed to load credits.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Use credits
  const useCredits = async (amount) => {
    setError("");
    try {
      const res = await fetch("/api/use-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, amount, actor: "frontend" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) setCredits(data.new_balance);
    } catch (err) {
      setError("Failed to use credits.");
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCredits();
  }, [clientId]);

  if (loading) return <p>Loading credits...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;

  return (
    <div>
      <p>Current Credits: {credits}</p>
      <button onClick={() => useCredits(50)}>Use 50 credits</button>
      <button onClick={() => fetchCredits()} style={{ marginLeft: 8 }}>
        Refresh
      </button>
    </div>
  );
}
