# Claude Design brief — Subway Quest data story

This is a creative brief for Claude Design, written to produce two deliverables for the Subway Quest
portfolio write-up page: a short motion graphic video and a pair of companion architecture diagrams.
Everything below is grounded in the actual codebase — real file names, field names, and numbers, not
placeholders — so treat the specifics as accurate source material, not flavor text.

## Project context

Subway Quest is a React Native app that gamifies riding the NYC subway: log rides, check off stations,
complete quests, unlock achievements. But the project's real point, and the point of this portfolio
piece, is what's built underneath the app — it's a full data product with two genuinely separate data
systems living side by side. The video and diagrams should tell the story of both, and specifically the
contrast between them.

## The core idea: two data systems, one contrast

**Half A — "How the app knows the subway."** A static, offline, build-time pipeline. Public MTA/GTFS
open data gets downloaded once, run through a Python transformation script, and the result is compiled
directly into the app binary. No network connection is needed to use it. It only changes when someone
manually re-runs the pipeline.

**Half B — "How the app knows you."** A live, always-on, scheduled analytics pipeline. Every ride a user
logs flows from their phone, through a cloud database, through a scheduled batch job, into a data
warehouse, into a public dashboard — running on a fixed cadence whether anyone touches it or not.

These two systems almost never talk to each other. The emotional core of the piece is that contrast:
one-time and offline vs. continuous and always-on, both quietly running underneath the same app icon.

## Tone & style guidance

- Clean, modern, technical-but-approachable data-engineering explainer — think the visual register of a
  polished internal engineering blog post or a conference talk deck, not a children's explainer or a
  corporate stock-animation reel.
- Flat vector / motion graphics style. Dark background. Clean sans-serif type.
- **Color language:** use real NYC subway line colors (the official MTA route colors — orange for the B/D/F/M,
  yellow for N/Q/R/W, etc.) as an accent palette for Half A, since that's an authentic, recognizable touch.
  Use a distinct cool blue/purple "cloud and data" palette for Half B, so the two halves are instantly
  visually distinguishable even without reading labels.
- **Important IP note:** do not reproduce the official MTA subway map artwork itself (it's a copyrighted,
  trademarked design). Build an original, simplified, stylized abstraction of subway lines/stations
  instead — dots and lines, not the actual map graphic.
- On-screen text/labels only, no voiceover assumed. Keep text sparse — a beat title, occasionally a
  key term or number, nothing paragraph-length.
- Target length: 60-90 seconds total.

## Deliverable 1: motion graphic video (60-90s)

Thirteen beats, roughly 5-7 seconds each. Scene numbers are for reference, not necessarily literal hard
cuts — some can flow into each other.

### Opening
**0. Title card (~5s).** Split screen. Left label: "How the app knows the subway." Right label: "How the
app knows you." This is the frame for the whole video — establish it before diving into either side.

### Half A — the subway (static, offline)
**1. What GTFS is (~6s).** A zip icon unfurls into a small chain of connected file cards: `routes.txt` →
`trips.txt` → `stop_times.txt` → `shapes.txt`, each one visually pointing to the next, conveying "this is
a relational dataset, not a single file." GTFS = General Transit Feed Specification, the standard format
transit agencies worldwide publish schedules in.

**2. Two grains landing (~6s).** Two data sources arrive side by side: `stations.csv` — many individual
platform icons, one per subway platform — and `complexes.csv` — the same platforms gathered under one
physical-station roof icon. This sets up the "platform vs. physical station" distinction early, since it
matters again later.

**3. `stop_times.txt` assembles a trip (~6s).** Dozens of small, fine-grained rows — each one a single
(trip, stop) pair — snap together in sequence, sharing one trip identifier, into a single connected path
hopping across stops in order. This is the finest-grained file in the dataset: one row per stop a single
train visits.

**4. The mislabeled-trip catch (~7s).** A batch of trips flows toward the output, each one internally
clean and well-formed. A small cluster is flagged — checked against an independent, trusted source — and
found to be mistagged (labeled as one route when the data says otherwise). That cluster gets relabeled/
rerouted before continuing. Visual idea: individually valid-looking items flowing through a checkpoint,
most pass straight through, a few get caught and corrected. (Grounding fact, don't over-literalize on
screen: this models a real fix where 5 trips labeled route "W" were actually mislabeled "N" trips, which
would have wrongly implied a station reachable by a route that doesn't actually serve it.)

**5. One line forks — twice (~7s).** A single subway line animates splitting into two branches, and then
one of those branches splits again into two more — a literal tree growing from one trunk into three final
endpoints. (Grounding fact: this models the real A train, which forks at Lefferts Blvd, and then forks
again further out into Far Rockaway and Rockaway Park.)

**6. Compiles into the app, offline (~6s).** The processed data flows through a simple copy step and gets
baked directly into a phone icon. The phone then visibly goes into airplane mode — and keeps working.
This is the payoff of Half A: public open data, once transformed, becomes a trustworthy offline asset.

### Half B — you (live, always-on)
**7. The log, not the trip (~6s).** Small ticks/dots accumulate one by one in a simple on-device log. A
"trip" shape draws itself as a translucent projection built *from* those ticks — clearly derived, not
stored as its own thing.

**8. Outbox to the cloud (~5s).** A batch of events lifts off the phone icon and travels up into a cloud
database icon.

**9. The scheduled pull (~7s).** A clock face ticks forward in visible increments (implying "every few
hours"). A horizontal "watermark" line sits partway up a stack of events; only the events above the line
get swept into a warehouse icon below. The clock and the watermark line should feel mechanical and
automatic — nobody is triggering this by hand.

**10. Cleanup pass (~6s).** Two small visual beats back to back: duplicate rows collapse down into one,
and a broken "÷0" glitch flashes cleanly into a plain "0" — the data quietly tidying itself before anyone
downstream sees it.

**11. The public dashboard lights up (~6s).** Small chart/tile shapes assemble into a simple dashboard
layout, lighting up one at a time. This is the payoff of Half B: raw individual events becoming an
aggregated, public-facing view.

### Closing
**12. Split-screen recap (~6-8s).** Left: a laptop/manual "run" icon, static. Right: the clock from beat 9,
still ticking. A single thin, one-way dashed line connects the two sides (this models one narrow real
exception — if someone reinstalls the app, their own history gets replayed back from the cloud database
to their phone — but keep this line understated, it's a footnote, not a third beat). End on the two labels
from the title card one more time.

## Deliverable 2: companion diagrams

Two static architecture diagrams, styled consistently with the video's palette, for use on the write-up
page next to the video:

1. **Half A diagram** — a clean left-to-right pipeline: raw GTFS/MTA files → transformation step (label
   the key jobs it does: cross-validates route labels, deduplicates trip patterns into branches) →
   processed JSON files → copy step → bundled into the app. Annotate with real output numbers for
   credibility: 496 stations, 445 transfer complexes, 29 routes, 83 real route branches.

2. **Half B diagram** — a clean left-to-right pipeline: on-device event log → cloud database → scheduled
   batch job (label the cadence: every 6 hours) → data warehouse (staging → cleanup/aggregation) → public
   dashboard. Annotate the one bridge between the two systems (rehydration on sign-in) as a thin, clearly
   secondary connector, not a main pipeline stage.

Both diagrams should be legible as standalone images (not just video stills) — assume they'll also appear
printed/static on the portfolio page above or below the embedded video.
