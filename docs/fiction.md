# Redis Quest fiction bible

Everything the learner reads, every seed row and every UI string draws from this file and the JSON in
`fiction/`. If a name is not here, do not invent it; add it here first. The JSON is the source of truth for
data, this file is the source of truth for tone.

## 1. The league

Working title candidates (one chosen):

1. **Nukkad Cricket League (NCL)**, chosen. "Nukkad" is the street corner where gully cricket starts, so the name
   says "this is the league you grew up playing", and it shares no words with any real tournament.
2. Maidan Super Series. Good sound, but "Super" invites comparison with real franchise branding.
3. Gully Grand Slam. Fun, but "Grand Slam" belongs to tennis and muddies the search results.

Season 7, "The Monsoon Edition". Eight franchises, double round robin (56 league matches, 14 per team), top four
into playoffs (Qualifier 1, Eliminator, Qualifier 2), then **The Nukkad Cup Final** at Sabarmati Bowl, Ahmedabad.
The final is the night Redis restarts mid-innings (Chapter 5). Contests in the app are for points and bragging
rights across hostels and colleges. No money, ever. The league is fictional: no real tournament, franchise,
player or sponsor is named or implied.

## 2. The eight franchises

| id | Name | City | Code | Personality |
|---|---|---|---|---|
| t-01 | Mumbai Monsoon | Mumbai | MMO | Never panics until the 18th over, then panics beautifully. |
| t-02 | Chennai Lighthouse | Chennai | CLH | Slow burn, long beam. Wins matches by being there at the end. |
| t-03 | Kolkata Riverhawks | Kolkata | KRH | Artists first, accountants never. Crowd noise is a seventh fielder. |
| t-04 | Delhi Dust Devils | Delhi | DDD | Loud, aggressive, a little rough on the edges. Sledges in two languages. |
| t-05 | Bengaluru Gulmohars | Bengaluru | BGM | All the batting talent in the world, bowling attack on a notice period. |
| t-06 | Hyderabad Charminars | Hyderabad | HCM | Patient, spin-friendly, and fed very well on match days. |
| t-07 | Jaipur Havelis | Jaipur | JHV | Pink-and-gold, sells out every home game, nobody leaves early. |
| t-08 | Pune Sahyadris | Pune | PSY | Academic, tactical, argues about field placings like it is a viva. |

Colours, home grounds and 25 players each are in `fiction/teams.json` and `fiction/players.json`. Three
players have fame above 95; they become the hot keys in Chapters 2 and 4b:

- **Ganapathi Chengappa** (p-028, Chennai Lighthouse, batter, fame 99, nickname "Anna Express")
- **Jithin Varghese** (p-101, Bengaluru Gulmohars, bowler, fame 97, nickname "Lightning Rod")
- **Hitesh Bhatt** (p-151, Jaipur Havelis, all-rounder, fame 96, nickname "Gulabi Toofan")

## 3. How the app started

Two second-year students at **Sahyadri Institute of Technology, Pune** (`c-02`) built a fantasy cricket app in one
weekend in a hostel room in Shivneri Hostel (`h-c-02-2`). Teja did the React frontend, the learner (you) wrote the
backend. Pick a team of players, earn points as real-ish match events land, climb the hostel leaderboard. Harry
Bhaiya put it in the fest announcement. Now the season is three weeks away and the whole campus has the link.
There are 12 colleges, 48 hostels, one rival (Gomti College, Lucknow, `c-06`) and one final.

## 4. The cast (details in `fiction/cast.json`)

- **roommate**: Sai Teja Vemuri ("Teja"). Frontend, panics, screenshots every error before reading it.
- **senior**: Harjeet Sandhu ("Harry Bhaiya"). Runs the fest, says "just add more servers", means well.
- **warden**: Suryanarayan Pillai ("Warden Sir"). Strict in tone, soft in practice, nephew Bunty found a bug.
- **sms-vendor**: Jignesh Zaveri of TextTara Communications. Polite, on time, invoices bigger than expected.
- **rival-college**: Mukul Awasthi of Gomti College. Clever, theatrical, scripts that never sleep.

None is a villain. They are early warning systems and pressure with faces. Each chapter opens with a
WhatsApp-style thread from one or more of them; the thread is the incident ticket.

## 5. Tone guide (binding for level authors)

- Indian English with light, natural Hinglish: "bhai", "yaar", "scene kya hai", "chalo". Only where a student
  would actually say it. Never forced, never a phrase per line.
- No slurs, no stereotyping of any region or community. Names and places come from across India.
- No gambling or real-money framing: no "bet", "stake", "payout", "cash". Wallet means points.
- No real brands (messaging apps in the story are just "the group"; the SMS vendor, college names and sponsors
  are fictional). The thread format may be described as WhatsApp-style in docs, but no logo or product name
  appears in game text.
- Incidents open as threads: short lines, a HH:MM timestamp per message, one or two emoji at most per thread.
- Sell the problem, not Redis: the thread says "stats page takes 4 seconds", never "use a cache".
- Numbers in the fiction are story numbers; never present them as real statistics.

## 6. Naming rules

1. Nothing may match `fiction/denylist.json`: 150+ real cricketers (all eras, all nations) and 40+ real
   franchises (IPL, BBL, PSL, CPL, SA20, The Hundred, ILT20). Full-name match fails, and so does the same
   surname with the same first initial.
2. League name must not contain "IPL" or "Indian Premier".
3. Player names are drawn from many regions and communities (Tamil, Telugu, Kannada, Malayalam, Kodava, Marathi,
   Gujarati, Punjabi, Haryanvi, Bengali, Odia, Assamese, Meitei, Naga, Khasi, Kashmiri, Pahadi, Hindi belt, Bihari,
   Hyderabadi, Goan, Parsi, Sindhi, Adivasi and Himalayan communities). No duplicate full names.
4. Invented names must not be real cricketers even if missing from the denylist. When in doubt, change the name.
   This file cannot prove a negative: the check only catches what the denylist knows.
5. Colleges and hostels are fictional (hostel styles follow real campus habits: Bhawan, Hall, Block, Hostel).

## 7. Id scheme (stable; Postgres seed and levels rely on it)

- teams `t-01`..`t-08`; players `p-001`..`p-200` (25 per team, in team order: p-001..p-025 is t-01, and so on)
- colleges `c-01`..`c-12`; hostels `h-<college id>-<n>` with n 1 to 4, e.g. `h-c-03-2`
- cast by slug: `roommate`, `senior`, `warden`, `sms-vendor`, `rival-college`
- Home college `c-02`, rival `c-06` (field `story_role` in `colleges.json`)
