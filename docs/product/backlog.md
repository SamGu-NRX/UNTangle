# UNTangle product backlog

Readers: whoever plans the next phases after the v3 rebuild. This page lists Sam's ideas from October 14, 2026. Each item says what students get, where the data comes from, what makes it hard, what needs deciding, and the first step.

Order of work: items 1, 3 and 4 can start soon, because their data already exists. Items 6 and 7 come next, since they use public data. Items 2 and 8 wait on Sam's decisions.

## 1. Smart filters on instructors and sections

**What students get:** class search filters like UT Registration Plus has:
- instructor grade history (average GPA, share of A and B grades);
- open seats, days, times, modality and campus.

Students can use them in Courses and in Week's search.

**Data:**
- Grade distributions come from untgrades.app through `lib/grades-history`, which is already merged.
- Section facts come from vsb's term data through `lib/sections`.

**Hard part: matching instructors by name.** vsb lists instructors as "Smith, J" while grade history uses full names, and one name can belong to two people. The work:
- build a matcher that returns a confidence;
- show an unmatched instructor as "no grade history" rather than guessing;
- write strict tests on real name pairs.

**First step:** join each section's instructor to their grade history for that course, with a minimum number of graded sections. The reasons engine already uses a minimum of 3; it's a starting value.

## 2. Instructor ratings (RateMyProfessors)

**Current rule:** our server doesn't fetch, store or show RateMyProfessors data (`docs/backend-legacy.md`). RMP's terms don't allow automated collection, and the old backend called a private RMP endpoint with a hard-coded login.

**Options for Sam:**
- (a) Link to the instructor's RMP search page. This is allowed today.
- (b) In a browser extension, read RMP in the student's own browser and show it there, without ever sending it to or storing it on our server. This is roughly what UT Registration Plus does. The risk is lower, but it still depends on RMP's private API and terms.
- (c) Ask RMP for a license or an API.

**Caveat for any option:** a rating belongs to an instructor across all their courses and years. Show how many ratings there are, and how recent, beside the score.

## 3. Auto picks the best instructors once your preferences are met

**What students get:** among the schedules that meet their preferences equally well, Auto picks the one with the strongest instructors, and the reasons say why.

**How:**
1. The optimizer runs as today.
2. Among the schedules whose cost is within a small tolerance of the best, it picks the highest instructor score.
3. The score is grade history now (item 1), and ratings later if item 2 allows it. The optimizer already has a rating term, but only sample sections carry ratings today.

**Honesty:** a high average GPA means students got good grades, not that the teaching was good. The copy says "Students in this instructor's sections averaged a 3.4", never "the best professor".

**First step:** feed item 1's instructor grade data into the rating term, then add the tie-break tier with tests showing preferences are never traded away for instructor score.

## 4. Onboarding: how much things matter, from 1 to 5

**What students get:** a short first-run sheet. "How much does each of these matter to you?":
- good grades (instructor grade history);
- fewer days on campus;
- taking full-time hours;
- a free day;
- short walks;
- mornings or evenings.

Answers 1 to 5 map onto the optimizer's 0 to 4 weights, so there's no translation layer. The result becomes the student's starting preferences, and they can save it as a preset (see the Week preferences work).

**First step:** once the Week preferences panel design is approved, reuse its controls in a three-step sheet. The sheet is skippable, and it can be reopened from Preferences.

## 5. Goals across terms (co-op, internship, graduating on time)

**What students get:** "I want a co-op in Fall 2027" or "graduate by May 2028". The plan reserves that term and moves the required courses.

**Hard part:** this needs a multi-term planner. The prerequisite engine already orders courses, but the planner works one term at a time. Co-op terms, course offering patterns (fall only) and credit loads all interact.

**First step:** a design note on the multi-term plan model before any UI.

## 6. Campus calendar (clubs and events)

**What students get:** club meetings and events appear in Day. Recurring ones can count as busy times, so Auto plans classes around them.

**Data:** the student pastes a calendar feed link (iCal) from their club or calendar app. We don't scrape anything. Later, if UNT's student organization platform publishes public feeds, we add a directory.

**First step:** an iCal feed becomes busy times plus Day events, refreshed daily, with each event showing which feed it came from.

## 7. Facts from syllabi (attendance, exams, grading)

**Data is public by law.** Texas Education Code §51.974 (HB 2504, 2009) requires a syllabus for every undergraduate classroom course:
- public on the university website, without a password, no more than three clicks from the main page;
- posted by the seventh day of classes;
- updated every semester.

SB 810 (2021) extended it to graduate courses and requires the information to be searchable. UNT publishes syllabi through faculty profiles at facultyinfo.unt.edu.

**What students get:** for a section, "Attendance counts toward your grade", plus the quoted sentence from the syllabus and a link. Also the number of exams and the grading weights. A claim never appears without the source sentence.

**Hard parts:**
- A syllabus belongs to one instructor and one term. Another instructor's syllabus is not evidence. During registration this term's syllabus doesn't exist yet, so we show the same instructor's most recent syllabus for the same course, labeled with its term.
- Extraction:
  - First, rules that find attendance, exam and grading sections and quote them.
  - Model-based extraction would cost money, against the free and open-source rule. Run a small local model or the student's own agent through WebMCP only if the rules fall short.
- RMP's attendance tags are opinions from past terms, possibly from a different course or a changed policy. Use them only if item 2 allows, labeled with their dates.

**First step:** fetch the public syllabi for the planner's courses for one term. Measure how often rules can find and quote an attendance policy, and report the rate before building any UI.

## 8. A browser extension or native app for deeper automation

**Research done:**
- `docs/research/registration-platforms/`: UNT runs PeopleSoft Campus Solutions. Banner Self-Service is the next adapter family.
- `docs/research/mobile/`: Expo, over-the-air updates and Apple rule 2.5.2.

**What it could do:**
- show grade history, ratings (item 2) and conflicts on myUNT's class search;
- add a section to UNTangle from class search;
- fill the registration cart from a chosen schedule (the student still clicks Enroll).

**Login rule:** never store or cache a student's UNT password. The extension works inside the tab where the student is already signed in. The reasons:
- a stored password puts the student's whole university account at risk;
- UNT's acceptable-use and single sign-on rules forbid sharing credentials;
- the records involved are protected under FERPA;
- UNT sign-in uses multi-factor authentication, so a cached password wouldn't work anyway.

**Decision for Sam:** when to start, and whether the first version is UNT-only overlays or includes cart filling.
