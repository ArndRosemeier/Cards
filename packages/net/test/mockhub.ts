// Minimal in-process GameHub server implementing docs/PROTOCOL.md, for tests (the real one is remote).
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

type Room = { id: string; name: string; public: boolean; maxPlayers: number; meta: unknown; host: number; players: Set<number>; seq: number; snapshot: unknown; snapshotSeq: number; deltas: { seq: number; data: unknown }[] };

export async function startMockHub(listenPort = 0) {
  const server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const list = [...rooms.values()].filter((r) => r.public && r.players.size > 0).map(summary);
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ rooms: list }));
  });
  const wss = new WebSocketServer({ server });
  await new Promise<void>((r) => server.listen(listenPort, r));
  const port = (server.address() as { port: number }).port;
  let nextId = 1;
  const clients = new Map<number, { ws: WebSocket; name: string; room: Room | null }>();
  const rooms = new Map<string, Room>();
  const send = (id: number, m: object) => { const c = clients.get(id); if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
  const summary = (r: Room) => ({ id: r.id, name: r.name, public: r.public, players: r.players.size, maxPlayers: r.maxPlayers, meta: r.meta, host: r.host, createdAt: 0 });
  const others = (r: Room, me: number) => [...r.players].filter((p) => p !== me);
  const players = (r: Room) => [...r.players].map((id) => ({ id, name: clients.get(id)!.name }));
  const leave = (id: number) => {
    const c = clients.get(id); const r = c?.room; if (!c || !r) return;
    r.players.delete(id); c.room = null;
    for (const p of r.players) send(p, { t: "player-", id });
    if (r.host === id && r.players.size) { r.host = Math.min(...r.players); for (const p of r.players) send(p, { t: "host", id: r.host }); }
  };
  wss.on("connection", (ws) => {
    const id = nextId++; clients.set(id, { ws, name: "P" + id, room: null });
    send(id, { t: "welcome", you: id, name: "P" + id, app: "cards" });
    ws.on("close", () => { leave(id); clients.delete(id); });
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(String(raw)); const c = clients.get(id)!; const req = m.req;
      const reply = (x: object) => send(id, { ...x, req });
      const joined = (r: Room) => reply({ t: "joined", room: summary(r), you: id, host: r.host, players: players(r), state: { seq: r.seq, snapshotSeq: r.snapshotSeq, snapshot: r.snapshot, deltas: r.deltas, complete: true } });
      switch (m.t) {
        case "hello": c.name = String(m.name).slice(0, 32); reply({ t: "welcome", you: id, name: c.name, app: "cards" }); break;
        case "create": {
          const rid = Math.random().toString(36).slice(2, 8).toUpperCase();
          const r: Room = { id: rid, name: m.room?.name ?? "", public: m.room?.public ?? true, maxPlayers: m.room?.maxPlayers ?? 16, meta: m.room?.meta ?? null, host: id, players: new Set([id]), seq: 0, snapshot: null, snapshotSeq: 0, deltas: [] };
          rooms.set(rid, r); c.room = r; joined(r); break;
        }
        case "join": {
          const r = rooms.get(String(m.id).toUpperCase());
          if (!r) return reply({ t: "error", code: "no_such_room" });
          if (r.players.size >= r.maxPlayers) return reply({ t: "error", code: "room_full" });
          for (const p of r.players) send(p, { t: "player+", player: { id, name: c.name } });
          r.players.add(id); c.room = r; joined(r); break;
        }
        case "leave": leave(id); reply({ t: "left" }); break;
        case "state": { const r = c.room; if (!r || r.host !== id) return reply({ t: "error", code: "not_host" }); r.seq++; r.snapshot = m.data; r.snapshotSeq = r.seq; r.deltas = []; for (const p of others(r, id)) send(p, { t: "state", seq: r.seq, data: m.data }); break; }
        case "meta": { const r = c.room; if (!r || r.host !== id) return; if (m.public !== undefined) r.public = m.public; if (m.name !== undefined) r.name = m.name; if (m.meta !== undefined) r.meta = m.meta; for (const p of r.players) send(p, { t: "room", room: summary(r) }); break; }
        case "msg": {
          const r = c.room; if (!r) return reply({ t: "error", code: "not_in_room" });
          const targets = m.to !== undefined ? [m.to] : others(r, id);
          for (const p of targets) if (r.players.has(p)) send(p, { t: "msg", from: id, data: m.data });
          break;
        }
      }
    });
  });
  return { url: `http://127.0.0.1:${port}`, rooms, close: () => { for (const c of clients.values()) c.ws.close(); wss.close(); server.close(); } };
}
