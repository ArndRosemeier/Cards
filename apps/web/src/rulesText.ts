import { getLang } from "./i18n.ts";

type Text2 = { de: string[]; en: string[] };
/** Short rules per game: the goal, how a turn works and how it is scored. */
export const RULES: Record<string, Text2> = {
  maumau: {
    en: ["Goal: get rid of all your cards first.", "Play a card that matches the top card by suit or rank. If you can't, draw one (and play it if it fits).",
      "7: the next player draws 2 (sevens stack). 8: the next player is skipped. Jack: wish a suit. Ace: play again.", "Say Mau when you play your second-to-last card; you win by playing the last one."],
    de: ["Ziel: als Erster alle Karten loswerden.", "Lege eine Karte gleicher Farbe oder gleichen Werts auf den Ablagestapel. Passt keine, ziehe eine Karte (und spiele sie, wenn sie passt).",
      "7: der Nächste zieht 2 (Siebener addieren sich). 8: der Nächste setzt aus. Bube: wünsche eine Farbe. Ass: nochmal dran.", "Sage Mau, wenn du die vorletzte Karte spielst; die letzte Karte gewinnt."],
  },
  hearts: {
    en: ["Goal: finish with the fewest points. Every heart is 1 point, the queen of spades is 13.", "Before each deal, pass 3 cards (left, right, across, then none). The 2 of clubs leads; follow suit if you can.",
      "Hearts can't be led until they were played, and no points on the first trick. Win a trick, lead the next.", "Taking all hearts and the queen shoots the moon: you score 0, everyone else 26. The game ends when someone reaches 100."],
    de: ["Ziel: am Ende die wenigsten Punkte haben. Jedes Herz zählt 1, die Pik-Dame 13.", "Vor dem Spiel gibst du 3 Karten weiter (links, rechts, gegenüber, dann keine). Kreuz 2 beginnt; Farbe bedienen.",
      "Herz darf erst ausgespielt werden, wenn schon Herz gefallen ist; im ersten Stich keine Punkte. Wer den Stich gewinnt, spielt aus.", "Alle Herzen plus Pik-Dame: Du schießt den Mond (0 Punkte, alle anderen 26). Ende bei 100 Punkten."],
  },
  holdem: {
    en: ["Goal: win all the chips. Each player gets 2 private cards; 5 shared cards follow (flop 3, turn, river).", "Best five-card hand wins the pot: high card, pair, two pair, three of a kind, straight, flush, full house, four of a kind, straight flush.",
      "On your turn: fold, check/call, or raise. Blinds force the first bets and rise every few hands.", "You are out when you lose all chips; the last player standing wins."],
    de: ["Ziel: alle Chips gewinnen. Jeder bekommt 2 verdeckte Karten; dazu 5 offene Gemeinschaftskarten (Flop 3, Turn, River).", "Die beste Fünf-Karten-Hand gewinnt den Pot: Höchste Karte, Paar, Zwei Paare, Drilling, Straße, Flush, Full House, Vierling, Straight Flush.",
      "Wenn du dran bist: passen, schieben/mitgehen oder erhöhen. Die Blinds erzwingen erste Einsätze und steigen regelmäßig.", "Wer alle Chips verliert, scheidet aus; der letzte Spieler gewinnt."],
  },
  skat: {
    en: ["Three players: one declarer against two. 32 cards, jacks are the top trumps, then the trump suit (or the jacks only in grand).", "Bidding: the player who bids highest picks up the 2 Skat cards, discards 2 and names the game (suit, grand or null).",
      "The declarer needs 61 of the 120 card points (A 11, 10 = 10, K 4, Q 3, J 2). Game value = base value × multiplier (jacks with/without, hand, Schneider, Schwarz).", "In a hand game you skip the Skat and may announce Schneider or Schwarz. Ouvert is a hand game played with your cards face-up (Schwarz is announced automatically, much higher value). If everyone passes, Ramsch is played: take as few points as possible."],
    de: ["Drei Spieler: ein Alleinspieler gegen zwei. 32 Karten, die Buben sind die höchsten Trümpfe, dann die Trumpffarbe (beim Grand nur die Buben).", "Reizen: Wer am höchsten reizt, nimmt den Skat, drückt 2 Karten und sagt das Spiel an (Farbe, Grand oder Null).",
      "Der Alleinspieler braucht 61 der 120 Augen (A 11, 10 = 10, K 4, D 3, B 2). Spielwert = Grundwert × Multiplikator (Spitzen mit/ohne, Hand, Schneider, Schwarz).", "Beim Handspiel bleibt der Skat liegen; du darfst Schneider oder Schwarz ansagen. Ouvert ist ein Handspiel mit offen liegenden Karten (Schwarz wird automatisch angesagt, deutlich höherer Wert). Passen alle, wird Ramsch gespielt: möglichst wenig Augen nehmen."],
  },
  doppelkopf: {
    en: ["Four players, two teams: Re (holders of a queen of clubs) against Kontra. 48 cards (two decks, 9 to ace).", "Trumps: ten of hearts, queens, jacks, then diamonds. Win tricks, count card points: 240 in total, Re needs 121.",
      "Reservations: a Hochzeit (both queens of clubs: find a partner with the first foreign trick win) or a solo. Announce Re or Kontra to double the stakes.", "Extras: Fuchs (diamond ace caught), Karlchen (last trick with a club jack) and Doppelkopf (a trick with 40+ points)."],
    de: ["Vier Spieler, zwei Parteien: Re (wer eine Kreuz-Dame hat) gegen Kontra. 48 Karten (zwei Spiele, 9 bis Ass).", "Trumpf: Herz-Zehn, Damen, Buben, dann Karo. Stiche gewinnen, Augen zählen: insgesamt 240, Re braucht 121.",
      "Vorbehalte: Hochzeit (beide Kreuz-Damen: Partner ist, wer den ersten fremden Stich holt) oder Solo. Mit Re oder Kontra ansagen verdoppelst du den Einsatz.", "Extrapunkte: Fuchs (Karo-Ass gefangen), Karlchen (letzter Stich mit Kreuz-Bube), Doppelkopf (Stich mit 40+ Augen)."],
  },
  schafkopf: {
    en: ["Four players, 32 cards. Queens, jacks and hearts are trump (Ober, Unter, Herz).", "Sauspiel: two play together, partner is whoever holds the called ace. Wenz: only jacks are trump. Solo: you play alone with a trump suit of your choice.",
      "Take tricks, count points (A 11, 10 = 10, K 4, Ober 3, Unter 2). The players need 61 of 120; 91 is Schneider.", "If everyone passes, Ramsch is played: the player with the most points loses."],
    de: ["Vier Spieler, 32 Karten. Ober, Unter und Herz sind Trumpf.", "Sauspiel: zwei spielen zusammen, Partner ist, wer die gerufene Sau hat. Wenz: nur die Unter sind Trumpf. Solo: du spielst allein mit einer Trumpffarbe deiner Wahl.",
      "Stiche gewinnen, Augen zählen (A 11, 10 = 10, K 4, Ober 3, Unter 2). Die Spieler brauchen 61 von 120; ab 91 ist Schneider.", "Passen alle, wird Ramsch gespielt: Wer die meisten Augen hat, verliert."],
  },
  romme: {
    en: ["Goal: lay down all your cards. Each turn: draw (from the stock or take the open card), meld or lay off, then discard one card.", "Melds are sets (same rank, different suits) or runs (3+ in a row of one suit; the ace is high or low). Jokers are wild, one per meld.",
      "Your first meld must add up to 40 points. After that you may lay cards onto any meld, and swap a natural card for a joker in a table meld.", "When someone goes out, the others score the points left in their hands. Lowest total after all rounds wins."],
    de: ["Ziel: alle Karten ablegen. Jeder Zug: ziehen (vom Stapel oder die offene Karte nehmen), auslegen oder anlegen, dann eine Karte abwerfen.", "Gültig sind Sätze (gleicher Wert, verschiedene Farben) und Folgen (3+ in einer Farbe; das Ass ist hoch oder niedrig). Joker sind wild, einer pro Gruppe.",
      "Das erste Auslegen braucht 40 Punkte. Danach darfst du an alle Gruppen anlegen und einen Joker gegen die passende Karte austauschen.", "Geht jemand raus, bekommen die anderen die Punkte ihrer Restkarten. Wer nach allen Runden am wenigsten hat, gewinnt."],
  },
  bridge: {
    en: ["Four players in two partnerships (you and the player opposite). Bid for the contract: a level 1–7 and a trump suit or no-trump.", "The highest bidder's side must take 6 + level tricks. The declarer's partner (dummy) lays their hand down and the declarer plays both.",
      "Follow suit if you can; the highest trump (or the highest card of the suit led) wins the trick.", "Duplicate scoring: made contracts score trick points plus bonuses (game, slam, vulnerability); undertricks are penalised."],
    de: ["Vier Spieler in zwei Paaren (du und der Gegenübersitzende). Du reizt einen Kontrakt: Stufe 1–7 und eine Trumpffarbe oder Sans Atout.", "Die Seite mit dem höchsten Gebot muss 6 + Stufe Stiche machen. Der Partner des Alleinspielers (Dummy) legt seine Hand offen, der Alleinspieler spielt beide.",
      "Farbe bedienen; der höchste Trumpf (oder die höchste Karte der angespielten Farbe) gewinnt den Stich.", "Duplicate-Wertung: erfüllte Kontrakte bringen Stichpunkte plus Prämien (Teilscore, Schlemm, Zone); Fehlstiche werden bestraft."],
  },
  canasta: {
    en: ["Goal: score points with melds, canastas and by going out. Play to 3000 points. With four players you play in partnerships.", "Each turn: draw one card (or take the whole discard pile), meld cards of the same rank (3+, at most 3 wild cards: jokers and twos, always fewer than naturals), then discard.",
      "Red threes score 100 each and replace themselves. A meld of 7 is a canasta: 500 natural, 300 with wild cards.", "Your first meld needs 50 points (more at higher scores). A wild card or black three on the pile freezes it or blocks it: freezing needs a natural pair to take the pile. You may go out once your side has a canasta."],
    de: ["Ziel: Punkte durch Meldungen, Canastas und Rausgehen sammeln. Gespielt wird bis 3000 Punkte. Zu viert spielt ihr als Paare.", "Jeder Zug: eine Karte ziehen (oder den ganzen Ablagestapel nehmen), Karten gleichen Rangs melden (3+, höchstens 3 Wilde: Joker und Zweien, immer weniger als natürliche), dann abwerfen.",
      "Rote Dreien zählen je 100 und werden ersetzt. Sieben Karten sind eine Canasta: 500 rein, 300 mit Wilden.", "Die erste Meldung braucht 50 Punkte (bei höherem Stand mehr). Eine wilde Karte im Stapel friert ihn ein: dann brauchst du ein natürliches Paar; eine schwarze Drei sperrt ihn. Rausgehen darf, wer eine Canasta hat."],
  },
};

export function showRules(host: HTMLElement, game: string, title: string, close: string) {
  const r = RULES[game]; if (!r) return;
  const wrap = document.createElement("div"); wrap.className = "rules-overlay";
  const lines = r[getLang() === "de" ? "de" : "en"];
  wrap.innerHTML = `<div class="panel rules"><h2></h2><ul>${lines.map((l) => `<li></li>`).join("")}</ul><div class="btns"><button class="btn primary">${close}</button></div></div>`;
  (wrap.querySelector("h2") as HTMLElement).textContent = title;
  wrap.querySelectorAll("li").forEach((li, i) => { li.textContent = lines[i]!; });
  const done = () => wrap.remove();
  (wrap.querySelector("button") as HTMLButtonElement).onclick = done;
  wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) done(); });
  host.append(wrap);
}
