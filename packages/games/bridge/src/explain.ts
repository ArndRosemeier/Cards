import type { Call, Strain } from "./rules.ts";

/** What a call means by the standard-American-style conventions the bots use, derived from the auction alone (like an alert in a real game):
 * no hidden information, so it works for every seat, for humans too, and online. Returns null when a call is just natural / not worth a note. */
export interface Explanation { name: { en: string; de: string }; text: { en: string; de: string } }
type Bid = Extract<Call, { t: "bid" }>;
type Entry = { seat: number; call: Call };

const SYM: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠", N: "NT" };
const NAME_EN: Record<string, string> = { C: "clubs", D: "diamonds", H: "hearts", S: "spades", N: "notrump" };
const NAME_DE: Record<string, string> = { C: "Kreuz", D: "Karo", H: "Herz", S: "Pik", N: "Sans Atout" };
const ORDER = ["C", "D", "H", "S", "N"];
const isMaj = (s: string) => s === "H" || s === "S";
const bidText = (b: Bid) => `${b.level}${SYM[b.suit]}`;
const ex = (nameEn: string, nameDe: string, en: string, de: string): Explanation => ({ name: { en: nameEn, de: nameDe }, text: { en, de } });

export function explainCall(auction: Entry[], i: number): Explanation | null {
  const cur = auction[i]!, call = cur.call, seat = cur.seat, before = auction.slice(0, i);
  const side = seat % 2;
  const bidsBefore = before.filter((a) => a.call.t === "bid");
  const mineBefore = bidsBefore.filter((a) => a.seat % 2 === side);
  const oppBefore = bidsBefore.filter((a) => a.seat % 2 !== side);
  const lastBid = bidsBefore[bidsBefore.length - 1];
  const partnerBefore = mineBefore.filter((a) => a.seat !== seat), ownBefore = mineBefore.filter((a) => a.seat === seat);
  const opener = bidsBefore[0];
  const minLevel = (suit: string) => (lastBid ? (ORDER.indexOf(suit) > ORDER.indexOf((lastBid.call as Bid).suit) ? (lastBid.call as Bid).level : (lastBid.call as Bid).level + 1) : 1);

  if (call.t === "pass") {
    if (!bidsBefore.length) return i < 4 ? ex("Pass", "Pass", "Not enough to open: roughly fewer than 12 points (or a hand without a good opening).", "Zu wenig zum Eröffnen: etwa weniger als 12 Punkte.") : null;
    return null;
  }
  if (call.t === "redouble") return ex("Redouble", "Rekontra", "Shows strength (about 10+ points); the opponents' contract may be doubled for penalty, or it is a strong raise.", "Zeigt Stärke (etwa 10+ Punkte); die Gegner sollen gestraft werden.");
  if (call.t === "double") {
    const lb = lastBid ? (lastBid.call as Bid) : null;
    if (!lb || lastBid!.seat % 2 === side) return null;
    if (lb.suit === "N" || lb.level >= 4) return ex("Penalty double", "Strafkontra", "Expects to beat the contract: good defensive values.", "Erwartet, den Kontrakt zu schlagen: gute Verteidigungskarten.");
    if (partnerBefore.length && !ownBefore.length && opener && opener.seat % 2 === side) {
      return ex("Negative double", "Negatives Kontra", `Partner opened, the opponents overcalled: about 6+ points and 4 cards in the unbid major(s) (or both unbid minors).`, "Partner hat eröffnet, die Gegner haben überrufen: etwa 6+ Punkte und 4 Karten in der/den ungeboteten Hauptfarbe(n).");
    }
    if (!mineBefore.length) return ex("Takeout double", "Informationskontra", `Opening strength (12+), short in ${NAME_EN[lb.suit]}, support for the other suits: partner should bid their best suit. (With 19+ points it can also be a strong hand that bids on.)`, `Eröffnungsstärke (12+), kurz in ${NAME_DE[lb.suit]}, Unterstützung der anderen Farben: der Partner soll seine beste Farbe nennen. (Mit 19+ Punkten auch eine starke Hand.)`);
    return ex("Double", "Kontra", "Competitive double: values for defence or a takeout.", "Kontra: Verteidigungswerte oder Aufforderung zu einem Gebot.");
  }

  const b = call as Bid, jump = b.level > minLevel(b.suit);
  const t = bidText(b);

  // ---- no bid before: an opening
  if (!bidsBefore.length) {
    if (b.suit === "N" && b.level === 1) return ex("1NT opening", "1SA-Eröffnung", "Balanced hand with 15–17 points.", "Ausgeglichene Hand mit 15–17 Punkten.");
    if (b.suit === "N" && b.level === 2) return ex("2NT opening", "2SA-Eröffnung", "Balanced hand with 20–21 points.", "Ausgeglichene Hand mit 20–21 Punkten.");
    if (b.suit === "C" && b.level === 2) return ex("Strong 2♣", "Starkes 2♣", "Artificial and game-forcing: 22+ points (or a very strong long suit). Partner bids 2♦ as a waiting bid.", "Künstlich und Spiel-forcierend: 22+ Punkte (oder eine sehr starke lange Farbe). Der Partner antwortet 2♦ als Warteruf.");
    if (b.level === 2) return ex("Weak two", "Schwache Zwei", `A good 6-card ${NAME_EN[b.suit]} suit and about 5–10 points; a pre-emptive opening.`, `Gute 6er-Länge in ${NAME_DE[b.suit]} und etwa 5–10 Punkte; Sperrgebot.`);
    if (b.level >= 3) return ex("Pre-empt", "Sperrgebot", `A long (${b.level + 4}+ cards) ${NAME_EN[b.suit]} suit and under opening strength: it takes away bidding room from the opponents.`, `Lange Farbe (${b.level + 4}+ Karten) in ${NAME_DE[b.suit]} und weniger als Eröffnungsstärke: nimmt den Gegnern Reizraum.`);
    if (isMaj(b.suit)) return ex(`${t} opening`, `${t}-Eröffnung`, `A 5+ card ${NAME_EN[b.suit]} suit and about 12–21 points (rule of 20).`, `Mindestens 5 Karten in ${NAME_DE[b.suit]} und etwa 12–21 Punkte (Zwanzigerregel).`);
    return ex(`${t} opening`, `${t}-Eröffnung`, `About 12–21 points. ${b.suit === "D" ? "4+ diamonds" : "3+ clubs (the default when there is no 5-card major)"}; no 5-card major, not a balanced 15–17.`, `Etwa 12–21 Punkte. ${b.suit === "D" ? "Mindestens 4 Karo" : "Mindestens 3 Kreuz (Standard, wenn keine 5er-Hauptfarbe da ist)"}; keine 5er-Hauptfarbe, nicht ausgeglichen mit 15–17.`);
  }

  const openerSide = opener!.seat % 2;
  const ob = opener!.call as Bid;

  // ---- Blackwood
  if (b.suit === "N" && b.level === 4 && ownBefore.length + partnerBefore.length >= 1 && !(ob.suit === "N" && ob.level === 1 && opener!.seat % 2 === side && mineBefore.length < 2)) {
    return ex("Blackwood 4NT", "Blackwood 4SA", "Asks partner for the number of aces: 5♣ = 0 or 4, 5♦ = 1, 5♥ = 2, 5♠ = 3.", "Fragt den Partner nach der Zahl der Asse: 5♣ = 0 oder 4, 5♦ = 1, 5♥ = 2, 5♠ = 3.");
  }
  const myBlack = auction.slice(0, i).findIndex((a) => a.seat % 2 === side && a.seat !== seat && a.call.t === "bid" && (a.call as Bid).suit === "N" && (a.call as Bid).level === 4);
  if (myBlack >= 0 && b.level === 5 && b.suit !== "N" && !auction.slice(myBlack + 1).some((a) => a.seat === seat && a.call.t === "bid")) {
    return ex("Ace answer", "Ass-Antwort", `Answer to Blackwood: ${b.suit === "C" ? "0 or 4 aces" : b.suit === "D" ? "1 ace" : b.suit === "H" ? "2 aces" : "3 aces"}.`, `Antwort auf Blackwood: ${b.suit === "C" ? "0 oder 4 Asse" : b.suit === "D" ? "1 Ass" : b.suit === "H" ? "2 Asse" : "3 Asse"}.`);
  }

  // ---- the opponents opened, my side has not bid: overcalls
  if (openerSide !== side && mineBefore.length === 0) {
    const lb = (lastBid!.call as Bid);
    if (b.suit === "N" && b.level === 1) return ex("1NT overcall", "1SA-Überruf", `Balanced, 15–18 points and a stopper in ${NAME_EN[lb.suit] ?? "their suit"}.`, `Ausgeglichen, 15–18 Punkte und ein Stopper in ${NAME_DE[lb.suit] ?? "ihrer Farbe"}.`);
    if (b.suit === "N") return null;
    if (jump || b.level >= 3) return ex("Pre-emptive overcall", "Sperr-Überruf", `A long ${NAME_EN[b.suit]} suit (6–7 cards) and a weak hand: it blocks the opponents.`, `Lange Farbe in ${NAME_DE[b.suit]} (6–7 Karten) und schwache Hand: Sperre gegen die Gegner.`);
    return ex("Overcall", "Überruf", `A 5+ card ${NAME_EN[b.suit]} suit, ${b.level === 1 ? "about 8–16 points" : "about 11–16 points (a 2-level overcall needs more)"}; a good suit. It shows a lead and a possible fit.`, `Mindestens 5 Karten in ${NAME_DE[b.suit]}, ${b.level === 1 ? "etwa 8–16 Punkte" : "etwa 11–16 Punkte (auf Zweierstufe braucht man mehr)"}; gute Farbe. Zeigt Ausspiel und Fit.`);
  }

  // ---- responder's first bid (partner opened, I have not bid)
  if (openerSide === side && opener!.seat !== seat && ownBefore.length === 0 && partnerBefore.length === 1) {
    if (ob.suit === "N" && ob.level === 1) {
      if (b.suit === "C" && b.level === 2) return ex("Stayman", "Stayman", "Asks for a 4-card major (8+ points, with 4 hearts or 4 spades). Partner answers 2♥ / 2♠ with a 4-card major, 2♦ with none.", "Fragt nach einer 4er-Hauptfarbe (8+ Punkte, mit 4 Herz oder 4 Pik). Partner antwortet 2♥ / 2♠ mit 4er-Farbe, 2♦ ohne.");
      if (b.suit === "D" && b.level === 2) return ex("Jacoby transfer", "Jacoby-Transfer", "Shows 5+ hearts. Partner must bid 2♥; then I pass (weak) or bid on.", "Zeigt 5+ Herz. Der Partner muss 2♥ sagen; dann passe ich (schwach) oder reize weiter.");
      if (b.suit === "H" && b.level === 2) return ex("Jacoby transfer", "Jacoby-Transfer", "Shows 5+ spades. Partner must bid 2♠; then I pass (weak) or bid on.", "Zeigt 5+ Pik. Der Partner muss 2♠ sagen; dann passe ich (schwach) oder reize weiter.");
      if (b.suit === "N" && b.level === 2) return ex("Invitational 2NT", "Einladendes 2SA", "8–9 points, balanced, no major to show: invites game (partner bids 3NT with a maximum 16–17).", "8–9 Punkte, ausgeglichen: lädt zum Spiel ein (Partner sagt 3SA mit 16–17).");
      if (b.suit === "N" && b.level === 3) return ex("Game bid", "Spielansage", "10–15 points, balanced: enough for game opposite 15–17.", "10–15 Punkte, ausgeglichen: genug für Spiel gegenüber 15–17.");
      if (b.suit === "N" && b.level === 4) return ex("Quantitative 4NT", "Quantitatives 4SA", "16–17 points, balanced: invites 6NT. Partner passes with a minimum, bids 6NT with 17.", "16–17 Punkte, ausgeglichen: lädt zum Schlemm ein. Partner passt mit Minimum, sagt 6SA mit 17.");
      if (b.suit === "N" && b.level === 6) return ex("Slam bid", "Schlemmansage", "18+ points, balanced: enough for 6NT.", "18+ Punkte, ausgeglichen: genug für 6SA.");
      return null;
    }
    if (ob.suit === "C" && ob.level === 2) {
      if (b.suit === "D" && b.level === 2) return ex("Waiting 2♦", "Warte-Zwei-Karo", "Artificial: no suit to show yet. Partner's 2♣ is game-forcing, so the bidding goes on to game.", "Künstlich: noch keine Farbe zu zeigen. Das 2♣ des Partners ist Spiel-forcierend, die Reizung geht bis zum Spiel.");
      return ex("Positive response", "Positive Antwort", `A good 5+ card ${NAME_EN[b.suit]} suit and about 8+ points opposite the strong 2♣.`, `Gute 5+-Farbe in ${NAME_DE[b.suit]} und etwa 8+ Punkte gegenüber dem starken 2♣.`);
    }
    if (ob.level >= 2 && ob.suit !== "N") {
      if (b.suit === ob.suit) return ex("Raise of the pre-empt", "Anhebung der Sperre", "Support for partner's suit: a competitive or game-going raise.", "Unterstützung der Farbe: Anhebung zum Wettbieten oder Spiel.");
      if (b.suit === "N" && b.level === 3) return ex("Game bid", "Spielansage", "14+ points and no fit: enough for 3NT.", "14+ Punkte, kein Fit: genug für 3SA.");
      return null;
    }
    if (ob.level === 1 && ob.suit !== "N") {
      if (b.suit === ob.suit) {
        const m = isMaj(ob.suit);
        if (b.level === 2) return ex(m ? "Simple raise" : "Raise of the minor", m ? "Einfache Anhebung" : "Anhebung der Unterfarbe", `${m ? "3+" : "4–5+"} cards in partner's suit and 6–9 points.`, `${m ? "3+" : "4–5+"} Karten in Partners Farbe und 6–9 Punkte.`);
        if (b.level === 3) return ex("Limit raise", "Limit-Anhebung", `${m ? "3–4+" : "5+"} cards in partner's suit and 10–12 points: invites game.`, `${m ? "3–4+" : "5+"} Karten in Partners Farbe und 10–12 Punkte: lädt zum Spiel ein.`);
        if (b.level === 4) return ex("Game raise", "Spiel-Anhebung", "Strong support for partner's suit; game values.", "Starke Unterstützung der Farbe; Spielstärke.");
        return null;
      }
      if (b.suit === "N" && b.level === 2 && isMaj(ob.suit)) return ex("Jacoby 2NT", "Jacoby 2SA", "A forcing raise of partner's major: 4+ trumps and 13+ points (game forcing).", "Forcierende Anhebung der Hauptfarbe: 4+ Trümpfe und 13+ Punkte (Spiel-forcierend).");
      if (b.suit === "N" && b.level === 1) return ex("1NT response", "1SA-Antwort", "6–9 points, no fit for partner's suit and no suit to bid at the one level.", "6–9 Punkte, kein Fit und keine Farbe auf Einerstufe.");
      if (b.suit === "N" && b.level === 2) return ex("2NT response", "2SA-Antwort", "13–15 points, balanced, no fit.", "13–15 Punkte, ausgeglichen, kein Fit.");
      if (b.suit === "N" && b.level === 3) return ex("3NT response", "3SA-Antwort", "16–18 points, balanced, no fit.", "16–18 Punkte, ausgeglichen, kein Fit.");
      if (b.level === 1) return ex("New suit at the one level", "Neue Farbe auf Einerstufe", `4+ cards in ${NAME_EN[b.suit]} and 6+ points. Forcing: partner must bid again.`, `4+ Karten in ${NAME_DE[b.suit]} und 6+ Punkte. Forcierend: der Partner muss nochmals reizen.`);
      if (b.level === 2) return ex("New suit at the two level", "Neue Farbe auf Zweierstufe", `A 4–5+ card ${NAME_EN[b.suit]} suit and 10+ points. Forcing.`, `4–5+ Karten in ${NAME_DE[b.suit]} und 10+ Punkte. Forcierend.`);
      return null;
    }
  }

  // ---- opener's rebid (I opened, partner responded)
  if (openerSide === side && opener!.seat === seat && ownBefore.length === 1 && partnerBefore.length >= 1) {
    const rb = partnerBefore[partnerBefore.length - 1]!.call as Bid;
    if (ob.suit === "N" && ob.level === 1) {
      if (b.suit === "H" && rb.suit === "C" && rb.level === 2 || b.suit === "S" && rb.suit === "C" && rb.level === 2) return ex("Stayman answer", "Stayman-Antwort", `A 4-card ${NAME_EN[b.suit]} suit.`, `Eine 4er-${NAME_DE[b.suit]}.`);
      if (b.suit === "D" && rb.suit === "C") return ex("Stayman answer", "Stayman-Antwort", "No 4-card major.", "Keine 4er-Hauptfarbe.");
      if (rb.level === 2 && (rb.suit === "D" || rb.suit === "H") && b.level === 2 && b.suit === (rb.suit === "D" ? "H" : "S")) return ex("Transfer completed", "Transfer ausgeführt", "Accepts the transfer: partner shows 5+ cards in this suit.", "Nimmt den Transfer an: der Partner hat 5+ Karten in dieser Farbe.");
      if (b.level === 4 && isMaj(b.suit) || b.suit === "N" && b.level === 3) return ex("Accepts the invitation", "Nimmt die Einladung an", "Maximum 1NT (16–17) with a fit or values: bids game.", "Maximum für das 1SA (16–17): reizt das Spiel.");
      return null;
    }
    if (ob.level === 1 && ob.suit !== "N") {
      if (b.suit === "N" && b.level === 1) return ex("1NT rebid", "1SA-Wiederholung", "12–14 points, balanced, no fit for partner's suit.", "12–14 Punkte, ausgeglichen, kein Fit.");
      if (b.suit === "N" && b.level === 2) return ex("2NT rebid", "2SA-Wiederholung", rb.suit === "N" && rb.level === 2 && isMaj(ob.suit) ? "Jacoby 2NT answer." : "18–19 points, balanced.", "18–19 Punkte, ausgeglichen.");
      if (rb.suit === "N" && rb.level === 2 && isMaj(ob.suit)) return ex("Answer to Jacoby 2NT", "Antwort auf Jacoby 2SA", b.level === 4 && b.suit === ob.suit ? "Minimum or medium hand (12–17): bids the major game." : "Shows extra strength.", b.level === 4 && b.suit === ob.suit ? "Minimum oder mittlere Hand (12–17): reizt das Hauptfarben-Spiel." : "Zeigt zusätzliche Stärke.");
      if (b.suit === rb.suit && rb.suit !== "N" && !jump) return ex("Minimum raise", "Einfache Anhebung", `4+ cards in partner's ${NAME_EN[b.suit]} and a minimum hand (12–14).`, `4+ Karten in Partners ${NAME_DE[b.suit]} und Minimum (12–14).`);
      if (b.suit === rb.suit && rb.suit !== "N") return ex("Jump raise", "Sprunganhebung", `4+ cards in partner's ${NAME_EN[b.suit]} and a good hand (15–17+): invites game.`, `4+ Karten in Partners ${NAME_DE[b.suit]} und gute Hand (15–17+): lädt zum Spiel ein.`);
      if (b.suit === ob.suit) return ex(jump ? "Jump rebid" : "Rebid of the suit", jump ? "Sprung-Wiederholung" : "Wiederholung der Farbe", jump ? "A 6+ card suit and about 16–18 points: invites game." : "A 6+ card suit and a minimum hand (12–15), no fit for partner.", jump ? "6+-Farbe und etwa 16–18 Punkte: lädt zum Spiel ein." : "6+-Farbe und Minimum (12–15), kein Fit zum Partner.");
      if (jump) return ex("Jump shift", "Sprung-Farbwechsel", `A strong hand (19+) with a second suit in ${NAME_EN[b.suit]}: game forcing.`, `Sehr starke Hand (19+) mit zweiter Farbe in ${NAME_DE[b.suit]}: Spiel-forcierend.`);
      return ex("Second suit", "Zweite Farbe", `A second suit: 4+ cards in ${NAME_EN[b.suit]}. ${ORDER.indexOf(b.suit) < ORDER.indexOf(ob.suit) || b.level === 1 ? "A natural, non-reversing bid (12–18)." : "A reverse: shows 16+ points."}`, `Zweite Farbe: 4+ Karten in ${NAME_DE[b.suit]}. ${ORDER.indexOf(b.suit) < ORDER.indexOf(ob.suit) || b.level === 1 ? "Natürlich, kein Reverse (12–18)." : "Ein Reverse: zeigt 16+ Punkte."}`);
    }
  }

  // ---- responder's later bids
  if (b.suit === "N" && b.level === 3 && mineBefore.length >= 2) return ex("Game bid", "Spielansage", "Enough points for 3NT: about 25+ combined.", "Genug für 3SA: zusammen etwa 25+ Punkte.");
  if (isMaj(b.suit) && b.level === 4 && mineBefore.length >= 1) return ex("Game bid", "Spielansage", `Enough points and a fit for game in ${NAME_EN[b.suit]}.`, `Genug Punkte und Fit für das Spiel in ${NAME_DE[b.suit]}.`);
  if (b.suit === "N" && b.level === 2 && mineBefore.length >= 2) return ex("Invitation", "Einladung", "About 11–12 points, balanced: invites game.", "Etwa 11–12 Punkte, ausgeglichen: lädt zum Spiel ein.");
  if (mineBefore.some((a) => (a.call as Bid).suit === b.suit) && oppBefore.length && lastBid && lastBid.seat % 2 !== side) return ex("Competitive bid", "Wettbieten", `Competes for the part-score in ${NAME_EN[b.suit]} (law of total tricks: a fit means we can bid one level higher).`, `Wettbieten in ${NAME_DE[b.suit]} (Gesetz der Gesamtstiche: mit Fit können wir eine Stufe höher gehen).`);
  return null;
}
