/**
 * Table talk of the Hold'em bots. A bot picks a pool and a line number; every client shows that line in its own language
 * (so both lists in a pool must have the same length and the same order).
 *
 * `raise`, `allin`, `fold`, `call` and `check` are for every bot; `pet:<id>` is said when a quirk bot plays one of its pet hands;
 * `gen:<id>` is the quirk's own general chatter.
 */
export interface Pool { de: string[]; en: string[] }
export const BANTER: Record<string, Pool> = {
  raise: {
    de: ["Das kostet.", "Ich erhöhe.", "Na dann, mehr Chips!", "Mal sehen, wer mitgeht.", "Hier, bitte schön.", "Zu billig hier.", "Ich hab da so ein Gefühl.", "Wer traut sich?", "Das riecht nach Gewinn.", "Aufstocken!", "Ein bisschen Würze.", "Nicht erschrecken."],
    en: ["That'll cost you.", "I raise.", "More chips, please!", "Let's see who follows.", "Here you go.", "Too cheap in here.", "I have a feeling.", "Who dares?", "Smells like a win.", "Sweetening the pot.", "A little spice.", "Don't flinch."],
  },
  allin: {
    de: ["Alles rein!", "Ich schieb alles.", "Jetzt oder nie.", "All in, Leute.", "Augen zu und durch.", "Zeit für Drama.", "Nichts zu verlieren. Doch, alles.", "Sagt nicht, ich hätte nicht gewarnt.", "Das ist der Moment.", "Volle Kanne!"],
    en: ["All in!", "Everything goes in.", "Now or never.", "All in, folks.", "Eyes closed, here we go.", "Time for drama.", "Nothing to lose. Well, everything.", "Don't say I didn't warn you.", "This is the moment.", "Full throttle!"],
  },
  fold: {
    de: ["Nee, ohne mich.", "Das war mir zu heiß.", "Ich passe.", "Hm, lieber nicht.", "Weg damit.", "Vernunft siegt. Diesmal.", "Ich seh nix Gutes.", "Viel Spaß damit.", "Nächste Runde.", "Zu teuer für mich."],
    en: ["Nope, not for me.", "Too hot for me.", "I'll pass.", "Hm, better not.", "Mucked.", "Reason wins. This time.", "I see nothing good.", "Enjoy that one.", "Next round.", "Too rich for me."],
  },
  call: {
    de: ["Ich schau mir das an.", "Ich bin dabei.", "Mitgehen kostet nichts. Fast.", "Zeig mal, was du hast.", "Ich glaub dir nicht.", "Na gut, einmal noch.", "Ich bleib.", "Neugier ist stärker."],
    en: ["I'll take a look.", "I'm in.", "Calling costs nothing. Almost.", "Show me what you've got.", "I don't believe you.", "Fine, once more.", "I'm staying.", "Curiosity wins."],
  },
  check: {
    de: ["Tisch klopf.", "Ich warte.", "Mal abwarten.", "Zeit lassen.", "Schau'n wir.", "Nur ein Klopfen."],
    en: ["Knock knock.", "I'll wait.", "Let's see.", "Taking my time.", "We'll see.", "Just a tap."],
  },
  "pet:sevens": {
    de: ["Eine Sieben! Immer dabei.", "Sieben ist meine Glückszahl.", "Sieben – da sag ich nicht Nein.", "Die Sieben ruft!", "Bei einer Sieben hör ich auf zu denken.", "Sieben heißt: spielen."],
    en: ["A seven! Always in.", "Seven is my lucky number.", "A seven? I can't say no.", "The seven calls!", "With a seven I stop thinking.", "Seven means play."],
  },
  "pet:aces": {
    de: ["Ein Ass! Das spiel ich.", "Asse bringen Glück.", "Ass im Ärmel. Oder auf der Hand.", "Ein Ass lass ich nie liegen.", "Ass – natürlich bin ich dabei.", "Alles Gute kommt von oben, besonders Asse."],
    en: ["An ace! I'm playing that.", "Aces bring luck.", "Ace up my sleeve. Or in my hand.", "I never lay down an ace.", "An ace – of course I'm in.", "All good things come from above, especially aces."],
  },
  "pet:suited": {
    de: ["Gleiche Farbe, gutes Gefühl.", "Farbe bekennen!", "Zwei von einer Farbe, wie schön.", "Das sieht hübsch aus.", "Ich liebe Farbe.", "Eine Farbe, ein Plan."],
    en: ["Same suit, good feeling.", "Showing my colours!", "Two of a colour, lovely.", "Pretty, isn't it?", "I love a matching pair.", "One colour, one plan."],
  },
  "pet:connector": {
    de: ["Nachbarn! Straße, ich komme.", "Die zwei gehören zusammen.", "Das wird eine Straße, ich spür's.", "Aufeinanderfolgende Karten sind Schicksal.", "Ein Schritt nach dem anderen.", "Zwei Nachbarn, ein Traum."],
    en: ["Neighbours! Straight, here I come.", "These two belong together.", "That's a straight, I can feel it.", "Consecutive cards are fate.", "One step at a time.", "Two neighbours, one dream."],
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
