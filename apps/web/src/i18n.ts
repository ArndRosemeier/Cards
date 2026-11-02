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
  bidV: "Reizen {v}", skatPass: "Weg", skatHold: "Ja", pickup: "Skat aufnehmen", handGame: "Hand spielen", gameC: "Kreuz", gameS: "Pik", gameH: "Herz", gameD: "Karo", gameG: "Grand", gameN: "Null", gameR: "Ramsch",
  yourBid: "Du reizt", yourHold: "Hältst du {v}?", bidding: "{n} reizt …", pickOrHand: "Skat aufnehmen oder Hand spielen?", declChoosing: "{n} entscheidet …", discard2: "Drücke 2 Karten in den Skat",
  chooseGame: "Wähle dein Spiel", roundNo: "Spiel {a} von {b}", sayBid: "{v}", sayHold: "Ja!", sayPass: "Weg", handgame: "Hand!", ramsch: "Ramsch!", durchmarsch: "Durchmarsch!", ramschLoser: "Verloren mit {pts}",
  skatWon: "Gewonnen! +{n}", skatLost: "Verloren! −{n}",
  dk_healthyBtn: "Gesund", dk_hochzeit: "Hochzeit", dk_soloC: "Kreuz-Solo", dk_soloS: "Pik-Solo", dk_soloH: "Herz-Solo", dk_soloD: "Karo-Solo", dk_soloQ: "Damen-Solo", dk_soloJ: "Buben-Solo",
  dk_askReserve: "Gesund oder Vorbehalt?", dk_reserving: "{n} überlegt …", dk_team: "Partei", dk_reserve: "Vorbehalt!", dk_healthy: "Gesund", dk_re: "Re!", dk_kontra: "Kontra!",
  dk_partner: "Partner gefunden", dk_forcedSolo: "Stilles Solo", dk_reWon: "Re gewinnt ({re} Augen) · {n}", dk_kontraWon: "Kontra gewinnt · {n}",
  sk_passBtn: "Weiter", sk_sauC: "Rufspiel Eichel", sk_sauS: "Rufspiel Gras", sk_sauD: "Rufspiel Schellen", sk_wenz: "Wenz", sk_soloC: "Eichel-Solo", sk_soloS: "Gras-Solo", sk_soloH: "Herz-Solo", sk_soloD: "Schellen-Solo",
  sk_ramsch: "Ramsch", sk_pass: "Weiter", sk_choose: "Was spielst du?", sk_choosing: "{n} überlegt …", sk_partner: "Die Sau!", sk_partnerIs: "Partner:", sk_won: "Gewonnen! {pts} Augen", sk_lost: "Verloren! {pts} Augen",
  sk_durchmarsch: "Durchmarsch!", sk_ramschLoser: "Verloren mit {pts}", sk_role_declarer: "Du spielst", sk_role_partner: "Du bist Partner", sk_role_opponent: "Du spielst dagegen",
  hFold: "Passen", hCheck: "Check", hCall: "Call", hAllIn: "All-in", hRaiseTo: "Erhöhen auf {n}", hBet: "Setzen {n}", hHand: "Hand {n}", blindsUp: "Blinds steigen: {sb}/{bb}",
  hh_highCard: "Höchste Karte", hh_pair: "Paar", hh_twoPair: "Zwei Paare", hh_trips: "Drilling", hh_straight: "Straße", hh_flush: "Flush", hh_fullHouse: "Full House", hh_quads: "Vierling", hh_straightFlush: "Straight Flush",
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
  bidV: "Bid {v}", skatPass: "Pass", skatHold: "Yes", pickup: "Pick up Skat", handGame: "Play hand", gameC: "Clubs", gameS: "Spades", gameH: "Hearts", gameD: "Diamonds", gameG: "Grand", gameN: "Null", gameR: "Ramsch",
  yourBid: "Your bid", yourHold: "Do you hold {v}?", bidding: "{n} is bidding …", pickOrHand: "Pick up the Skat or play hand?", declChoosing: "{n} is deciding …", discard2: "Put 2 cards into the Skat",
  chooseGame: "Choose your game", roundNo: "Game {a} of {b}", sayBid: "{v}", sayHold: "Yes!", sayPass: "Pass", handgame: "Hand!", ramsch: "Ramsch!", durchmarsch: "Grand slam!", ramschLoser: "Lost with {pts}",
  skatWon: "Won! +{n}", skatLost: "Lost! −{n}",
  dk_healthyBtn: "Healthy", dk_hochzeit: "Marriage", dk_soloC: "Clubs solo", dk_soloS: "Spades solo", dk_soloH: "Hearts solo", dk_soloD: "Diamonds solo", dk_soloQ: "Queens solo", dk_soloJ: "Jacks solo",
  dk_askReserve: "Healthy or reservation?", dk_reserving: "{n} is thinking …", dk_team: "Team", dk_reserve: "Reservation!", dk_healthy: "Healthy", dk_re: "Re!", dk_kontra: "Kontra!",
  dk_partner: "Partner found", dk_forcedSolo: "Silent solo", dk_reWon: "Re wins ({re} points) · {n}", dk_kontraWon: "Kontra wins · {n}",
  sk_passBtn: "Pass", sk_sauC: "Call ace of Acorns", sk_sauS: "Call ace of Leaves", sk_sauD: "Call ace of Bells", sk_wenz: "Wenz", sk_soloC: "Acorns solo", sk_soloS: "Leaves solo", sk_soloH: "Hearts solo", sk_soloD: "Bells solo",
  sk_ramsch: "Ramsch", sk_pass: "Pass", sk_choose: "What do you play?", sk_choosing: "{n} is thinking …", sk_partner: "The ace!", sk_partnerIs: "Partner:", sk_won: "Won! {pts} points", sk_lost: "Lost! {pts} points",
  sk_durchmarsch: "Grand slam!", sk_ramschLoser: "Lost with {pts}", sk_role_declarer: "You play", sk_role_partner: "You are the partner", sk_role_opponent: "You play against",
  hFold: "Fold", hCheck: "Check", hCall: "Call", hAllIn: "All-in", hRaiseTo: "Raise to {n}", hBet: "Bet {n}", hHand: "Hand {n}", blindsUp: "Blinds up: {sb}/{bb}",
  hh_highCard: "High card", hh_pair: "Pair", hh_twoPair: "Two pair", hh_trips: "Three of a kind", hh_straight: "Straight", hh_flush: "Flush", hh_fullHouse: "Full house", hh_quads: "Four of a kind", hh_straightFlush: "Straight flush",
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
