/**
 * Table talk of the Hold'em bots. A bot picks a pool and a line number; every client shows that line in its own language
 * (so both lists in a pool must have the same length and the same order).
 *
 * `raise`, `allin`, `fold`, `call` and `check` are for every bot; `gen:<id>` is a quirk's own chatter.
 * Nothing here may depend on the bot's cards: the quirk lines are said at any moment, whatever the hand, and the
 * other lines only follow the (public) move, so the talk never gives a hand away. And every line must fit the move it
 * goes with: a line that says "raise" only goes with a raise, quirk lines carry an `on` tag when they would contradict a move.
 */
/** `on`: for chatter that may only go with some kinds of move, one string per line with the letters a (raise or all in), c (call or check), f (fold); no entry = fits any move. */
export interface Pool { de: string[]; en: string[]; on?: string[] }
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
    de: ["Nee, ohne mich.", "Ich passe.", "Hm, lieber nicht.", "Weg damit.", "Vernunft siegt. Diesmal.", "Nicht mein Spiel.", "Viel Spaß damit.", "Nächste Runde.", "Das ist nicht mein Tag."],
    en: ["Nope, not for me.", "I'll pass.", "Hm, better not.", "Mucked.", "Reason wins. This time.", "Not my game.", "Enjoy that one.", "Next round.", "Not my day."],
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
    de: ["Mehr! Mehr!", "Langsam ist nicht mein Tempo.", "Druck machen!", "Wer zögert, verliert.", "Nur kurz Luft holen."],
    en: ["More! More!", "Slow isn't my speed.", "Pile on the pressure!", "He who hesitates loses.", "Just catching my breath."],
    on: ["a", "a", "a", "a", "cf"],
  },
  "gen:rock": {
    de: ["Geduld ist eine Tugend.", "Ich warte auf was Gutes.", "Nur Qualität.", "Ich bleib lieber trocken.", "Auch ein Fels rollt mal."],
    en: ["Patience is a virtue.", "I'm waiting for something good.", "Quality only.", "I'd rather stay dry.", "Even a rock rolls sometimes."],
    on: ["cf", "cf", "", "cf", "a"],
  },
  "gen:station": {
    de: ["Ich will's einfach sehen.", "Mitgehen macht Spaß.", "Ich geb nicht so schnell auf.", "Eine Karte noch, bitte.", "Na gut, ausnahmsweise nicht."],
    en: ["I just want to see it.", "Calling is fun.", "I don't give up so easily.", "One more card, please.", "Oh well, not this time."],
    on: ["c", "c", "ac", "c", "f"],
  },
  "gen:gambler": {
    de: ["Wer nicht wagt…", "Ich spür's in den Knochen.", "Heute ist mein Tag.", "Würfel? Egal, Karten!", "Auch Zocker müssen mal passen."],
    en: ["Nothing ventured…", "I feel it in my bones.", "Today is my day.", "Dice? Whatever, cards!", "Even gamblers fold sometimes."],
    on: ["a", "a", "ac", "", "f"],
  },
  "gen:trapper": {
    de: ["Ich tu nur so harmlos.", "Hier passiert nichts. Wirklich.", "Kommt ruhig näher.", "Sagte die Spinne zur Fliege.", "Das Netz ist gespannt.", "Die Fliege ist heute schlauer."],
    en: ["I'm only acting harmless.", "Nothing going on here. Really.", "Come closer, don't be shy.", "Said the spider to the fly.", "The web is spun.", "The fly is wiser today."],
    on: ["c", "c", "c", "c", "a", "f"],
  },
};
/** The line for an id like "raise#3", in the given language ("" when unknown). */
export function banterLine(id: string, lang: "de" | "en"): string {
  const [pool, n] = id.split("#"); return BANTER[pool ?? ""]?.[lang][Number(n)] ?? "";
}

/** Does line `i` of a pool fit a move of this class (a = raise/all in, c = call/check, f = fold)? */
export const fitsMove = (pool: string, i: number, cls: "a" | "c" | "f"): boolean => { const on = BANTER[pool]?.on?.[i]; return !on || on.includes(cls); };
