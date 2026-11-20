# Pressroom

Turn Substack posts, or a whole publication, into printable A4 documents in six layouts
(Default, Newspaper, Scientific, Book, Monospace, Magazine). Vanilla JS + Vite front end,
Express + cheerio parser.

## Run

```bash
npm install
npm run dev      # Express on :3001 + Vite on :3000
npm run build    # outputs dist/
npm start        # Express serves the API (and dist/ in production)
```

## The "Press Sheet" interface

The application chrome follows the Pressroom "Press Sheet" design spec: the app looks like
printed matter. Only the chrome is redesigned; `render()`, `paginatePreview()` and the format
CSS that produce the printed pages are unchanged.

- **Front page** (`#front`): dateline, masthead, a headline field that takes your link,
  a "One post / Whole publication" switch (publication mode adds a 1 to 20 post count),
  "In this edition" settings list, and six stock cards. Loading shows a magenta press bar on
  the double rule and "Setting type…"; errors appear in an ink notice with "Try again"
  (paywalled or empty posts say what was and was not fetched).
- **Proof desk** (`#proof`): slug bar, a left rail with stock grid, typeface, size (8 to 20 pt),
  leading (1.0 to 2.4), margins (5 to 40 mm), "Leave out embeds" and the Print button, and a
  desk with true A4 sheets (two at a time from 1100 px, one below). Spread navigator, arrow keys
  and swipe move between sheets. Publication mode adds one tab per post. Removed images become a
  hatched "left out" box with Undo; removed boxes keep their space when printing.
- **Night edition**: toggle in the dateline (saved in `localStorage['pressroom-theme']`).
- **Narrow (< 900 px)**: the rail becomes a bottom drawer with a "TYPE" handle; stock cards
  scroll horizontally.
- **Accessibility**: labelled inputs, `aria-pressed` on stock cards and mode buttons, 44 px
  minimum targets, visible focus, `role="alert"` errors, `prefers-reduced-motion` respected.
- Design tokens live in `src/styles/base.css`; chrome styles in `src/styles/ui.css`.

## Printing

Click **Print / Save PDF** (a 400 ms "off to the printer" overlay shows first), then set the
browser dialog margins to "None". Chrome is hidden by `@media print` in
`src/styles/print-common.css`.
