/** What is new, newest first. Add an entry whenever a change is worth telling; `v` is the version the commit produces (see version.ts). */
export interface Release { v: string; date: string; de: string[]; en: string[] }

export const CHANGELOG: Release[] = [
  { v: "1.03", date: "2026-11-04",
    de: ["Texas Hold’em: Die Computerspieler sprechen jetzt am Tisch – kurze Sprüche in Sprechblasen, passend zu ihrer Eigenheit (z. B. „Eine Sieben! Immer dabei.“), beim Erhöhen, All-in, Aussteigen und Mitgehen. Rund 90 verschiedene Sprüche, jeder wiederholt sich erst nach einer Weile, auch online für alle Mitspieler."],
    en: ["Texas Hold’em: the computer players now talk at the table – short lines in speech bubbles that fit their quirk (e.g. “A seven! Always in.”), when raising, going all in, folding or calling. About 90 different lines, none repeats for a while, and online everyone sees them."] },
  { v: "1.02", date: "2026-11-04",
    de: ["Texas Hold’em: Die Computerspieler haben jetzt Eigenheiten (zum Beispiel spielt einer jede Hand mit einer Sieben, einer jedes Ass, einer ist ein Draufgänger, einer ein Fels). Dadurch sind sie schwerer zu durchschauen. In Testturnieren ändert keine Eigenheit die Gewinnrate um mehr als ein paar Prozentpunkte."],
    en: ["Texas Hold’em: the computer players now have quirks (for example one plays every hand with a seven, one every ace, one is a maniac, one a rock). That makes them harder to read. In test tournaments no quirk changes the win rate by more than a few points."] },
  { v: "1.01", date: "2026-11-03",
    de: ["Rommé: Passt eine Karte sowohl zum Anlegen als auch zum Joker-Tausch (z. B. ein weiteres Ass an zwei Asse und einen Joker), gibt es jetzt beide Knöpfe: „Anlegen“ und „Joker tauschen“."],
    en: ["Rummy: when a card can either be added to a meld or swapped for its joker (e.g. another ace onto two aces and a joker), both buttons are now offered: “Lay off” and “Swap joker”."] },
  { v: "1.00", date: "2026-11-03",
    de: [
      "Rommé: Karten an Reihen auf dem Tisch anlegen ist jetzt klar erkennbar – passende Reihen leuchten grün mit „+“, es gibt einen „Anlegen“-Knopf, und Karten lassen sich auch auf eine Reihe ziehen. Joker tauschen leuchtet bernsteinfarben.",
      "Rommé: Vor dem Auslegen zeigt ein Schloss, dass Anlegen erst nach dem Auslegen geht.",
      "Skat: Die KI spielt deutlich stärker (Reizen, Drücken, Kartenspiel per Simulation). Jeder sieht jetzt die Punkte seiner Partei.",
      "Texas Hold’em: Neue, stärkere KI. Nach jeder Hand wartet das Spiel auf „Nächste Hand“ (der Gastgeber drückt).",
      "Doppelkopf und Schafkopf zeigen die Teampunkte.",
      "Online-Chat in allen Online-Spielen, mit Hinweis bei neuen Nachrichten.",
      "Lautstärke für Effekte und Musik als Regler.",
      "cued-Anmeldung: Name und Avatar kommen aus dem cued-Konto.",
      "Neue Seite lädt sofort: alte Versionen bleiben nicht mehr im Cache hängen.",
      "Versionsnummer und diese Übersicht.",
    ],
    en: [
      "Rummy: laying cards onto melds on the table is now obvious – fitting melds glow green with a “+”, there is a “Lay off” button, and you can drag cards onto a meld. A joker swap glows amber.",
      "Rummy: before you have opened, a lock shows that adding to melds only works after opening.",
      "Skat: the AI plays much stronger (bidding, discarding, simulation-based card play). Everyone now sees their team's points.",
      "Texas Hold’em: new, stronger AI. After each hand the game waits for “Next hand” (the host presses it).",
      "Doppelkopf and Schafkopf show the team points.",
      "Online chat in all online games, with a notification for new messages.",
      "Volume sliders for effects and music.",
      "cued sign-in: name and avatar come from the cued account.",
      "New releases load straight away: old versions no longer stick in the cache.",
      "Version number and this overview.",
    ] },
];
