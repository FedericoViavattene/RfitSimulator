# Errata Notes (Vendetta Errata Updates, per playriftbound.com)

Source: https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates/
Also see: https://riftbound.gg/vendetta-errata-updates/

As of the most recent update, the following 8 cards received errata:

| Card | Set | Change |
|---|---|---|
| Draven, Vanquisher | Spiritforged | Wording clarification only ("If you do, give +2 Might" -> "to give +2 Might"). No stat change. |
| Emperor's Dais | Spiritforged | Wording clarification only. No stat change. |
| Fizz, Trickster | Spiritforged | Wording clarification only. No stat change. |
| Diana, Lunari | Unleashed | Wording clarification only. No stat change. |
| Stalking Wolf | Unleashed | Added explicit Ambush clarification. No stat change. |
| Astral Heron | Vendetta | Wording precision on duration. No stat change. |
| Gangplank, Naval | Vendetta | Clarified "+3 Might this turn" duration. No stat change. |
| Resonating Strike | Vendetta | Timing window widened ("any time, even before spells/abilities resolve"). No Energy/Power/Might change. |

**Practical impact on this simulator:** none of the current errata changed any
card's Energy, Power, or Might numbers - every single one is a rules-text
wording clarification (timing windows, conditional phrasing, etc.). Since this
simulator only models aggregate numbers and a handful of simplified Tags
(Remove/Buff/Draw/Shield), rather than the literal templated wording of each
card, none of the CSVs needed to change because of errata.

Note: "Draven, Vanquisher" (Spiritforged) is a different, non-banned card from
the banned card "Draven Vanquisher" listed in Banned.csv - double-check the
exact card name/set if you're building a Draven deck, since the banned card
and the errata'd card can be easy to confuse by name alone.

If a future errata changes actual numbers, update the corresponding row(s) in
the affected deck CSV(s) directly (Energy/Power/Might columns) - there's no
separate errata-application step in the script itself.
