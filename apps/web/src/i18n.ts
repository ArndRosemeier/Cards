type Dict = Record<string, string>;
const de: Dict = {
  title: "Kartenspiele", play: "Spielen", you: "Du", players: "Spieler", name: "Dein Name",
  maumau: "Mau-Mau", soon: "bald", yourTurn: "Du bist dran", wins: "{n} gewinnt!", youWin: "Du gewinnst!",
  again: "Nochmal", menu: "Menü", draw: "Ziehen", pass: "Weiter", wish: "Wünsch dir eine Farbe",
  mustDraw: "Zieh {n} Karten oder spiel eine 7", mustSkip: "Aussetzen oder eine 8 spielen",
  vsBots: "Gegen Computer", language: "Sprache", bot: "Computer", turnOf: "{n} ist dran",
  skat: "Skat", doppelkopf: "Doppelkopf", holdem: "Texas Hold'em", bridge: "Bridge", romme: "Rommé",
  schafkopf: "Schafkopf", hearts: "Hearts", canasta: "Canasta",
  online: "Online", createRoom: "Raum erstellen", joinRoom: "Beitreten", code: "Raumcode", open: "Offen", waiting: "Warte auf Spieler …",
  startGame: "Spiel starten", leave: "Verlassen", host: "Gastgeber", openRooms: "Offene Räume", noRooms: "Keine offenen Räume", copyLink: "Link kopieren",
  copied: "Kopiert!", roomFull: "Raum ist voll", connFail: "Verbindung fehlgeschlagen", away: "weg", seatOpenHuman: "Offen für Mitspieler", seatBot: "Computer",
  back: "Zurück", onlyHost: "Nur der Gastgeber kann starten", join: "Beitreten",
  confirm: "Bestätigen", moon: "Schuss auf den Mond!", waitingOthers: "Warte auf die anderen …", passCards: "Wähle 3 Karten zum Weitergeben ({dir})",
  passLeft: "nach links", passRight: "nach rechts", passAcross: "gegenüber", roundPoints: "Runde",
};
const en: Dict = {
  title: "Card Games", play: "Play", you: "You", players: "Players", name: "Your name",
  maumau: "Mau-Mau", soon: "soon", yourTurn: "Your turn", wins: "{n} wins!", youWin: "You win!",
  again: "Play again", menu: "Menu", draw: "Draw", pass: "Pass", wish: "Pick a suit",
  mustDraw: "Draw {n} cards or play a 7", mustSkip: "Skip, or answer with an 8",
  vsBots: "Versus computer", language: "Language", bot: "Bot", turnOf: "{n}'s turn",
  skat: "Skat", doppelkopf: "Doppelkopf", holdem: "Texas Hold'em", bridge: "Bridge", romme: "Rommé",
  schafkopf: "Schafkopf", hearts: "Hearts", canasta: "Canasta",
  online: "Online", createRoom: "Create room", joinRoom: "Join", code: "Room code", open: "Open", waiting: "Waiting for players …",
  startGame: "Start game", leave: "Leave", host: "Host", openRooms: "Open rooms", noRooms: "No open rooms", copyLink: "Copy link",
  copied: "Copied!", roomFull: "Room is full", connFail: "Connection failed", away: "away", seatOpenHuman: "Open for a player", seatBot: "Computer",
  back: "Back", onlyHost: "Only the host can start", join: "Join",
  confirm: "Confirm", moon: "Shooting the moon!", waitingOthers: "Waiting for the others …", passCards: "Pick 3 cards to pass ({dir})",
  passLeft: "left", passRight: "right", passAcross: "across", roundPoints: "Round",
};
let lang: "de" | "en" = (() => {
  try { const s = localStorage.getItem("lang"); if (s === "de" || s === "en") return s; } catch { /* ignore */ }
  return navigator.language.startsWith("de") ? "de" : "en";
})();
export const getLang = () => lang;
export function setLang(l: "de" | "en") { lang = l; try { localStorage.setItem("lang", l); } catch { /* ignore */ } }
export function t(key: string, vars: Record<string, string | number> = {}): string {
  let s = (lang === "de" ? de : en)[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
