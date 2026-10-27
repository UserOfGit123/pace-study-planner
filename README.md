# Pace — Exam prep, under control

Pace is a calm, local-first exam preparation planner. It helps students turn a list of upcoming exams and topics into a manageable daily study plan.

## Product brief

**Problem.** Students often have multiple exams and a long list of topics, but no clear way to decide what to study next or how much time to give each topic.

**Target users.** Students preparing for one or more exams who want a lightweight personal planning tool.

**Solution.** Pace turns exam dates, estimated study time, topic confidence, and a daily study limit into a spaced schedule. Students can then focus on one session at a time and see their progress.

## Core workflows

1. Add an exam, its date, and the topics to cover.
2. Estimate study time and confidence for each topic.
3. Let Pace distribute learning, practice, and review sessions across the days before the exam while staying within the shared daily goal.
4. Start a focus timer or mark a session complete.
5. Review upcoming work, completed sessions, and progress by subject.

## Features

- Overview with today’s focus, weekly workload, upcoming exams, and study time.
- Multiple exams with topic lists, confidence ratings, estimated study time, and progress.
- A scheduler that gives lower-confidence and longer topics more sessions, spaces sessions over time, and accounts for the daily workload already assigned to other subjects.
- Study planner filters for exam and completion status.
- Focus timer sized to each session, with pause, resume, and manual completion.
- Progress insights, including completed time, recent sessions, streak, and subject progress.
- Responsive layout for desktop and mobile.
- Example data on first launch so the app is ready to explore. The workspace menu restores the example data after confirmation.
- Browser persistence using localStorage.

## Technology and architecture

- HTML, CSS, and plain JavaScript; there are no third-party runtime dependencies.
- A small Node.js static server is included for local development.
- The client stores the workspace in the browser under the `pace-study-planner-v1` localStorage key. The data contains exams, topics, schedule sessions, and completion timestamps.
- The scheduler creates one to three study sessions per topic based on estimated duration and confidence. It spreads those sessions across the available days, prioritizes lower-confidence topics when assigning dates, and respects the shared daily minute limit across exams. If the schedule cannot fit everything, Pace explains that some suggested sessions were left unscheduled.
- There is no account, backend, external API, or environment variable. This keeps the project simple to run and avoids storing secrets. Browser data is private to the browser and website origin where it was created.

## Run locally

Requirements: Node.js 18 or newer.

1. Open a terminal in this folder.
2. Run `npm start`.
3. Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

No package installation is required. The app also works as a static site when served by any web server.

## Project files

- `index.html` — page structure, navigation, exam form, and focus dialog.
- `styles.css` — visual system, responsive layouts, and accessibility states.
- `app.js` — data model, persistence, scheduler, rendering, and interactions.
- `server.mjs` — dependency-free local static server.
- `package.json` — start command and Node.js version requirement.

## Deployment

Pace is a static site. Deploy `index.html`, `styles.css`, and `app.js` to GitHub Pages, Netlify, or another static hosting service. The included Node server is only for local use and is not needed by static hosting. The app does not require environment variables or API credentials.

To publish this project, the student will need to connect this local Git repository to their own GitHub repository, configure a public deployment, record and upload a short product demo, and enter the final links and student details in the course submission form. Verify the deployed site, repository, and video links in a private browser window before submitting.

## Limitations and next steps

- Data is stored on one browser and does not sync across devices. Deploying the site does not move local browser data to the hosted version.
- There is no sign-in, cloud backup, calendar integration, notifications, or collaborative workspace.
- The scheduler is a transparent heuristic, not a guarantee of exam readiness. Students can refresh the remaining plan after changing their workload or daily goal.
- Automated tests are not included in this starter delivery. Before submission, walk through adding an exam, creating a plan, completing a session, refreshing a plan, and confirming data remains after reloading.

## Demo video

[Watch the Pace project demo](https://drive.google.com/file/d/1Bbjs_e0R-Ypsz_7U2XGQBDBVL1CNPxQs/view?usp=sharing)

This walkthrough includes on-screen captions.
