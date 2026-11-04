/**
 * Table talk of the Hold'em bots. A bot picks a pool and a line number; every client shows that line in its own language
 * (so both lists in a pool must have the same length and the same order).
 *
 * `raise`, `allin`, `fold`, `call` and `check` are for every bot; `gen:<id>` is a quirk's own chatter.
 * Nothing here may depend on the bot's cards: the quirk lines are said at any moment, whatever the hand, and the
 * other lines only follow the (public) move, so the talk never gives a hand away.
 */
export interface Pool { de: string[]; en: string[] }
export const BANTER: Record<string, Pool> = {
  raise: {
    de: ["Das kostet.", "Ich erhöhe.", "Na dann, mehr Chips!", "Mal sehen, wer mitgeht.", "Hier, bitte schön.", "Zu billig hier.", "Wer traut sich?", "Weiter geht's.", "Ein kleiner Anstoß.", "Aufstocken!", "Ein bisschen Würze.", "Nicht erschrecken."],
    en: ["That'll cost you.", "I raise.", "More chips, please!", "Let's see who follows.", "Here you go.", "Too cheap in here.", "Who dares?", "On we go.", "A little nudge.", "Sweetening the pot.", "A little spice.", "Don't flinch."],
  },
  allin: {
    de: ["Alles rein!", "Ich schieb alles.", "Jetzt oder nie.", "All in, Leute.", "Augen zu und durch.", "Zeit für Drama.", "Nichts zu verlieren. Doch, alles.", "Sagt nicht, ich hätte nicht gewarnt.", "Das ist der Moment.", "Volle Kanne!"],
    en: ["All in!", "Everything goes in.", "Now or never.", "All in, folks.", "Eyes closed, here we go.", "Time for drama.", "Nothing to lose. Well, everything.", "Don't say I didn't warn you.", "This is the moment.", "Full throttle!"],
  },
  fold: {
    de: ["Nee, ohne mich.", "Das war mir zu heiß.", "Ich passe.", "Hm, lieber nicht.", "Weg damit.", "Vernunft siegt. Diesmal.", "Nicht mein Spiel.", "Viel Spaß damit.", "Nächste Runde.", "Zu teuer für mich."],
    en: ["Nope, not for me.", "Too hot for me.", "I'll pass.", "Hm, better not.", "Mucked.", "Reason wins. This time.", "Not my game.", "Enjoy that one.", "Next round.", "Too rich for me."],
  },
  call: {
    de: ["Ich schau mir das an.", "Ich bin dabei.", "Mitgehen kostet nichts. Fast.", "Zeig mal, was du hast.", "Ich glaub dir nicht.", "Na gut, einmal noch.", "Ich bleib.", "Neugier ist stärker."],
    en: ["I'll take a look.", "I'm in.", "Calling costs nothing. Almost.", "Show me what you've got.", "I don't believe you.", "Fine, once more.", "I'm staying.", "Curiosity wins."],
  },
  check: {
    de: ["Tisch klopf.", "Ich warte.", "Mal abwarten.", "Zeit lassen.", "Schau'n wir.", "Nur ein Klopfen."],
    en: ["Knock knock.", "I'll wait.", "Let's see.", "Taking my time.", "We'll see.", "Just a tap."],
  },
  "gen:sevens": {
    de: ["Sieben ist meine Glückszahl.", "Ich mag Siebenen. Wer nicht?", "Die Sieben wird unterschätzt.", "Jeder hat so seine Lieblingszahl.", "Sieben ist einfach eine schöne Zahl.", "Auf die Sieben lass ich nichts kommen."],
    en: ["Seven is my lucky number.", "I like sevens. Who doesn't?", "The seven is underrated.", "Everyone has a favourite number.", "Seven is just a lovely number.", "I won't hear a word against the seven."],
  },
  "gen:aces": {
    de: ["Asse bringen Glück.", "Ich mag Asse. Wer nicht?", "Ein Ass ist ein Ass.", "Alles Gute kommt von oben.", "Asse haben Charakter.", "Auf Asse lass ich nichts kommen."],
    en: ["Aces bring luck.", "I like aces. Who doesn't?", "An ace is an ace.", "All good things come from above.", "Aces have character.", "I won't hear a word against aces."],
  },
  "gen:suited": {
    de: ["Ich mag's farblich abgestimmt.", "Farbe bekennen!", "Schöne Farben heute am Tisch.", "Ein Herz für Farben.", "Bunt ist gut.", "Eine Farbe, ein Plan."],
    en: ["I like things colour-coordinated.", "Showing my colours!", "Lovely colours at the table today.", "I have a soft spot for colour.", "Colourful is good.", "One colour, one plan."],
  },
  "gen:connector": {
    de: ["Ein Schritt nach dem anderen.", "Reihenfolge muss sein.", "Nachbarn gehören zusammen.", "Straßen sind was Schönes.", "Ordnung ist das halbe Spiel.", "Ich mag's der Reihe nach."],
    en: ["One step at a time.", "Order matters.", "Neighbours belong together.", "Straights are lovely.", "Order is half the game.", "I like things in sequence."],
  },
  "gen:maniac": {
    de: ["Mehr! Mehr!", "Langsam ist nicht mein Tempo.", "Druck machen!", "Wer zögert, verliert."],
    en: ["More! More!", "Slow isn't my speed.", "Pile on the pressure!", "He who hesitates loses."],
  },
  "gen:rock": {
    de: ["Geduld ist eine Tugend.", "Ich warte auf was Gutes.", "Nur Qualität.", "Ich bleib lieber trocken."],
    en: ["Patience is a virtue.", "I'm waiting for something good.", "Quality only.", "I'd rather stay dry."],
  },
  "gen:station": {
    de: ["Ich will's einfach sehen.", "Mitgehen macht Spaß.", "Ich geb nicht so schnell auf.", "Eine Karte noch, bitte."],
    en: ["I just want to see it.", "Calling is fun.", "I don't give up so easily.", "One more card, please."],
  },
  "gen:gambler": {
    de: ["Wer nicht wagt…", "Ich spür's in den Knochen.", "Heute ist mein Tag.", "Würfel? Egal, Karten!"],
    en: ["Nothing ventured…", "I feel it in my bones.", "Today is my day.", "Dice? Whatever, cards!"],
  },
  "gen:trapper": {
    de: ["Ich tu nur so harmlos.", "Hier passiert nichts. Wirklich.", "Kommt ruhig näher.", "Sagte die Spinne zur Fliege."],
    en: ["I'm only acting harmless.", "Nothing going on here. Really.", "Come closer, don't be shy.", "Said the spider to the fly."],
  },
};
/** The line for an id like "raise#3", in the given language ("" when unknown). */
export function banterLine(id: string, lang: "de" | "en"): string {
  const [pool, n] = id.split("#"); return BANTER[pool ?? ""]?.[lang][Number(n)] ?? "";
}
