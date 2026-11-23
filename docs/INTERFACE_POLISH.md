# Phase 9 – Interface and branding polish

Status: built; logic tested (navigation grouping, dashboard attention items). **Not yet seen in a browser or on a phone**: please review visually.

## What changed
- **Grouped menu**: Home, Learning, Programme, People and support, Insights, Administration. Each role sees exactly the same pages as before (a test checks this for all 10 roles); only the layout changed.
- **Phones**: a top bar with the DIRA logo and a **Menu** button (which also shows unread notifications) replaces the long sideways strip of links. The menu closes after choosing a page or pressing Escape.
- **Desktop**: the sidebar scrolls on its own and stays in place, so Sign out is always reachable.
- **Accessibility**:
  - a "Skip to main content" link for keyboard users;
  - keyboard-focus outlines in the dark menu use the brand orange, so they are visible (the purple ones were nearly invisible on deep purple);
  - DIRA Connect and its moderation page no longer both highlight at once.
  - Existing reduced-motion and focus rules are kept.
- **Dashboard "Needs your attention"**, per role, from figures each person is already allowed to see:
  - **facilitators:** work waiting for a grade, and learners who may need support;
  - **staff:** learners who may need support, open DIRA Connect reports, and files waiting for a virus check;
  - **executives:** also concerns waiting while no Safeguarding Lead is appointed;
  - **Safeguarding Lead and Deputy:** concerns not yet acknowledged or past target.

  Safeguarding items are shown first, in red, as counts only. Nothing is shown when nothing is waiting.
- **Learner dashboard**: a "My performance" card (attendance, work submitted, overdue, draft overall).
- **Branding**: unchanged tokens (deep purple, DIRA orange, Bricolage Grotesque and Figtree). New screens use the same headings, cards and colours as existing ones.

## Please check visually
1. The menu on a phone (open, choose a page, close) and on a laptop (long menus for executives).
2. The dashboard for a facilitator, a coordinator, an executive, the Safeguarding Lead and a learner (use the local test accounts).
3. The wide tables on Performance and Cohort Intelligence on a phone: they scroll sideways inside their box.
