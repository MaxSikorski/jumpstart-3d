// Browser heartbeats never create agent presence. Proxy leases prove a live
// client; stateless RPC calls establish recent activity only.
export function clientPresence(clock = Date.now) {
  const leases = new Map();
  let stdio = false, lastActivity = null;
  const prune = () => { for (const [id, at] of leases) if (clock() - at >= 15000) leases.delete(id); };
  return {
    lease(id, state) {
      prune();
      if (state === "disconnect") leases.delete(id);
      else { if (!leases.has(id) && leases.size >= 64) throw new Error("Local MCP client limit reached"); leases.set(id, clock()); }
    },
    stdioConnected() { stdio = true; },
    activity() { lastActivity = clock(); },
    status() { prune(); return { clientConnected: stdio || leases.size > 0, recentClientActivity: lastActivity !== null && clock() - lastActivity < 15000 }; },
  };
}
