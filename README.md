# ScrollNudge

A single-person (n-of-1) experiment on mindless scrolling. A Chrome extension records how I scroll on social sites, asks short check-in questions about how intentional my scrolling is, learns what my mindless scrolling looks like, and shows a gentle nudge when it detects it. Nudge days and no-nudge days are assigned at random, so the two can be compared fairly.

The question comes from research on everyday phone use: people often blame their devices for distraction, but most of the time they start using them on their own. If the problem is a human habit, can a small, well-timed nudge break it?

## Design

| Phase | Days | What happens |
|---|---|---|
| Baseline | 1-7 | Scrolling is logged and a check-in appears every 8-16 minutes of scrolling. No nudges. |
| Training | after day 7 | The notebook trains a detector on the check-in answers and exports `model.json`. |
| Experiment | 8-21 | Each day is randomly a nudge day or a no-nudge day (7 each, fixed at install). Check-ins every 20-30 minutes. |

On no-nudge days the detector still records the moments it would have nudged ("shadow nudges"), so real nudges can be compared with the same kind of moment without a message.

**Check-in question:** "How intentional is your scrolling right now?" from 1 (mindless) to 5 (on purpose). Answers of 1 or 2 count as mindless.

**Nudge:** "You've been on Reddit for 18 minutes. Still scrolling on purpose?" with the choices "Yes, continue" and "Take a break". Nothing is blocked.

## What is recorded

Every 10 seconds on YouTube, Instagram, Facebook, X, Reddit, LinkedIn and TikTok:

- pixels scrolled, scroll events, direction changes, clicks and key presses
- whether the tab was visible and focused
- session time so far, time of day, and time since the previous session

No page content, URLs, text or screenshots are recorded. All data stays in the browser on this computer until it is exported.

## Detector features

| Feature | Meaning |
|---|---|
| elapsed_min | minutes into the current session |
| speed_2m | scrolling speed over the last 2 minutes (pixels per second) |
| clicks_pm | clicks per minute over the last 2 minutes |
| reversals_pm | scroll direction changes per minute |
| pause_frac | share of the last 2 minutes with no scrolling |
| hour_sin, hour_cos | time of day |
| since_last_min | minutes since the previous session on the same site |

Before a trained detector is loaded, a starter rule nudges after about 15 minutes of scrolling with few clicks.

## Outcomes

- Daily scrolling minutes, sessions per day, mean session length, and sessions over 20 minutes (nudge days vs no-nudge days, exact permutation test over all 3,432 ways to split the 14 days)
- Share of nudge moments followed by stopping within 3 minutes (real nudges vs shadow nudges)
- Mean intentionality rating on nudge vs no-nudge days

## Layout

```
extension/                        Chrome extension (Manifest V3)
analysis/scrollnudge_analysis.ipynb   detector training and results
```

## How to run

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the `extension` folder.
2. Pin the ScrollNudge icon. The study starts on the first visit to a tracked site.
3. Use the browser as usual and answer the check-ins.
4. After day 7: click the icon, choose **Export data (CSV)**, put the files in `analysis/data/`, and run Part 1 of the notebook. Load the new `model.json` from the popup.
5. After day 21: export again and run the whole notebook.

```
pip install pandas numpy scikit-learn matplotlib notebook
```

## Limitations

- One participant, one browser. Phone scrolling is not captured.
- Knowing about the experiment may change behavior, especially early on.
- 7 nudge and 7 no-nudge days can only detect fairly large effects.
