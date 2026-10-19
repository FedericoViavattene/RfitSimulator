# Riftbound Keyword Glossary

What each keyword does, paraphrased from its official reminder text on the
cards (Riot's card gallery) and the Core Rules, whether the simulator models
it, and when it tends to matter. The keywords on each card are read from its
official text by `tools/build-card-data.mjs` (see README.md).

| Keyword | What it does | Simulated? | When it matters |
|---|---|---|---|
| **Accelerate** | Pay an extra cost (usually 1 Energy + 1 Power of the card's domain) to have the unit enter ready. | Yes - the AI accelerates a unit with Might when it can afford it and has a battlefield to attack. | Lets a unit attack the turn it's played; strong against slow Control decks. |
| **Action** | Can be played on your turn or in showdowns (e.g. during a fight). | Yes - Action spells are used in the fight's reaction window. | Combat tricks that swing a single fight. |
| **Ambush** | The unit can be played as a Reaction to a battlefield where you have units. | Yes - the defender plays it into a fight at its battlefield. | Punishes attackers who commit just enough Might. |
| **Assault N** | +N Might while the unit is an attacker. | Yes. | Aggro races where you're the one attacking. |
| **Backline** | The unit must be assigned combat damage last. | Yes. | Protects a valuable unit in a fight. |
| **Deathknell** | An effect when the unit dies. | Yes for the curated cards (draw, channel, token). | Value against removal-heavy decks. |
| **Deflect** | Opponents must pay extra Power (of any domain) to choose the card with a spell or ability. | Yes - removal and other targeted effects pay it or pick another target. | Shields key units from removal. |
| **Empower / Empowered** | Pay a cost (or meet a condition) once to get the "Empowered" bonus. | Only for curated cards (e.g. Mournful Witness). | Long games. |
| **Equip** | Pay the Equip cost to attach Equipment to a unit you control. | Yes - the Equipment's Might goes on your strongest unit once the cost is paid. | Long games where the gear sticks around. |
| **Ganking** | The unit can move from battlefield to battlefield. | Yes. | Lets a unit holding one battlefield attack the other. |
| **Hidden** | Hide the card face down for 1 Power, then play it later as a Reaction for no Energy. | No - Hidden cards are just played normally. | Surprise plays at a battlefield you control. |
| **Hunt / Level** | Gain XP when the unit conquers or holds; Level N effects turn on at N+ XP. | No. | Long games. |
| **Legion** | An effect that applies if you've already played another card this turn. | No. | Turns with two or more plays. |
| **Reaction** | Can be played any time, even before spells and abilities resolve. | Yes - in the fight's reaction window (spells and units) and to counter spells. | Answers on the opponent's turn. |
| **Repeat** | Pay an extra cost to repeat the spell's effect. | No - the effect happens once. | Late game, with spare Energy. |
| **Shield N** | +N Might while the unit is a defender (Shield alone = 1). | Yes. | Holding battlefields against Aggro. |
| **Stun** | A stunned unit doesn't deal combat damage this turn. | Yes. | Blunts the biggest attacker. |
| **Tank** | The unit must be assigned combat damage first. | Yes. | Protects your other units in a fight. |
| **Temporary** | The unit (or gear) is killed at the start of its controller's Beginning Phase, before scoring. | Yes. | Burst attacks with tokens. |
| **Vision / Predict** | Look at the top card(s) of your Main Deck and recycle what you don't want. | No. | Consistency. |
| **Weaponmaster** | When played, may Equip one of your Equipment to it for less. | No. | Equipment decks. |
| **Unique** | Your deck can have only 1 card with this name. | Deckbuilding only. | - |
