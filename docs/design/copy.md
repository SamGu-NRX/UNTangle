# Copy

Every visible word, accessible name and toast follows this page. When in doubt, write the shorter sentence that still tells the student what to do.

## Voice

**Plain verbs, sentence case.** Buttons, headings, group names and tabs all use sentence case: "Open in Week", "You can take", "Back to defaults". Capitals belong to names only: Auto, Main, Week, Day, Courses.

**A button names its outcome, and the toast repeats that name.** A button is a verb plus an object at most. The toast reports the same verb in the past tense, so the student can connect the two.

| Button | Toast or result line |
|---|---|
| Auto | "Planned 5 courses", with Undo |
| Undo (after Auto) | "Spring 2027 is back to how it was" |
| Use this | "Using option A" |
| `−` on a tray row (name: "Remove CSCE 2610") | "Removed CSCE 2610", with Undo |
| Delete (in "Delete Fridays off?") | "Deleted Fridays off", with Undo |
| Copy all 5 | "Copied 5 class numbers" |

Bad: a button "Submit" that produces "Changes saved successfully!" Good: "Save" produces "Saved to this device".

**Errors say what happened and what to do. They never apologize.** Put a field's error under that field, not in a toast.

| Bad | Good |
|---|---|
| "Oops! Something went wrong." | "Couldn't save. Check your connection and retry." |
| "Sorry, invalid file." | "That PDF is a degree audit. In myUNT, open Academic Records, then Unofficial Transcript, and download that one." |
| "Authentication failed." | "That password doesn't match this email. Try again, or reset it." |
| "Invalid email" | "Add the rest of the address, like name@my.unt.edu." |

**An empty state invites the next action.** Say what belongs here and give one button that puts it there.

| Bad | Good |
|---|---|
| "No data" | "No saved schedules for Fall 2027 yet." with New schedule |
| An illustration and three sentences about Week | "Add a course to plan Spring 2027." with Search courses |
| "Nothing found" | "No sections of CSCE 2110 match your filters." with Edit filters |

**Loading names the work, and only shows after 400ms.** "Reading the PDF", "Finding your courses". Under 400ms, show nothing. A button that runs keeps its width and swaps its label for a spinner (`Button loading`).

**Numbers appear only when they change a decision.** "54 of 120 credits" decides whether you are on track. Miles walked per day decides nothing, so it is gone.

**Times read the way people say them.** "9:00 to 9:50", "Leave by 8:49", "in 12 min", "Right as class ends". Ranges use "to", not a dash: `/dev/controls` already does this, and screen readers read "to" the same way every time. Use AM and PM in settings ("Nothing before 9 AM"). Inside one day's itinerary, leave them off unless the day crosses noon ambiguously.

**Say where data came from once per lens, never per row.** "Sample sections", "From transcript, Oct 13", "UNT grade records 2019 to 2025", each in a `ProvenanceTag`.

**Put privacy words where the worry happens.** "On this device. Nothing is uploaded." on the import screen, "Your name and student ID were removed" on the review screen.

**Warn inline only when the student can act,** in one line followed by the fix: "The walk to PHYS 2220 on Monday and Wednesday is tight." Show a fix.

**Accessible names say the action and its object.** "Add MATH 3680", "Close CSCE 2110", "Remove CSCE 2610", never a bare "Add" repeated down a list.

## Glossary

| Use | It means | Don't write |
|---|---|---|
| schedule | A named set of sections for one term. A term can have several. | plan, scenario, timetable, cart |
| Main | The schedule an import or migration creates first | Default, Primary, Untitled |
| section | One offering of a course with its meetings. "Section 002" in sentences, "§002" in a dense row. | class (it is ambiguous), offering, slot |
| class number | The 5-digit number myUNT registers with | CRN, class ID, registration number |
| course | A catalog entry, written by its code: "CSCE 2110" | class, subject |
| term | "Spring 2027" | semester, session, quarter |
| credit | "3 credits", "54 of 120 credits" | hours, credit hours, units, SCH |
| Auto | The button that fills a term. It is a name, so it has no verb form. The standalone host calls it "Build my schedule". | Optimize, Generate, Smart fill, Auto-fill |
| Preferences | What Auto follows, set in Week | Constraints, Rules, Options |
| Filters | What narrows Week search. Filters never change what Auto picks. | Preferences, Refine |
| Settings | Account and device setup, from the account menu | Preferences, Profile |
| Keep this section | Lock a section so Auto leaves it alone. The glyph is a lock; the words are "keep" and "kept". | Lock, Pin, Freeze |
| busy time | Time the student can't be in class ("Work, Tue and Thu 3:00 to 5:00") | blocked time, constraint |
| walk, tight, late | The minutes between two classes. Tight fits the break with under 2 minutes spare; late is longer than the break. | commute, transit, travel time |
| leave-by | The time to leave: "Leave Kerr Hall by 8:49" | departure, ETD |
| starting point | Where the day's first walk starts | home, origin, location |
| To check, You can take, Taking now, Later, Done | The Courses groups, in that order | Locked, Eligible, In progress |
| Courses, Week, Day | The three lenses. "Day" replaced "Map". | tab, view, page ("Open in Week", not "Go to the Week view") |
| Schedules | The library of saved schedules. It replaced "Plans". | Plans, Saved plans |
| sign in, sign out | Verbs. "Sign-in" is the noun. | log in, login, log out |
| transcript | The unofficial transcript PDF from myUNT | records, academic history |
| No set time | A section with no meeting time, such as online async | TBA, N/A, Async |

## Banned

| Never | Why | Instead |
|---|---|---|
| The mid dot (U+00B7) | Sam's rule. A test fails on it anywhere in `frontend/src`. | One fact per row; the rest in the panel |
| Any glyph used to separate facts: bullet, pipe, slash, "›", a dash between two facts | Same rule; swapping the glyph keeps the clutter | A sentence ("Academic Records, then Unofficial Transcript") or layout |
| A comma list of facts in a row ("MWF, 9:00, GAB 535") | It is a mid dot spelled with commas (`untangle-v3.md`, "Mid dots") | The one fact the row needs |
| "Optimize", "optimizer", "optimal" as UI words | The student pressed Auto; name it Auto | Auto, "Using option A" |
| "Smart", "magic", "AI", "intelligent", "powered by" | They describe the machinery, not the outcome | Say what happened: "Planned 5 courses" |
| Stat tiles, KPI rows, big-number boxes | Rule 5 removed every figure that doesn't change a decision | One number in a sentence, only when it decides something |
| Exclamation marks | Nothing in a schedule planner is that exciting | A period |
| "Sorry", "Oops", "Uh-oh", "Something went wrong" | An apology without a fix wastes the line | What happened and what to do |
| "Successfully" | Every confirmation would need it | "Saved", "Removed CSCE 2610" |
| "Click here", "Learn more" with no object | Unreadable out of context, and phones don't click | "Data source ↗", "Open in Week" |
| Title Case | Sentence case is the house style | Sentence case |
| Sentences in all caps | The 11px caps label is for short section labels only ("DAYS OFF") | Sentence case |
| Provenance on every row | Rule 6 | Once per lens |
| Counts on open groups | An open group already shows its rows | A count on a closed group only |
| Emoji | No meaning a glyph or word can't carry better | `StatusGlyph`, words |
| "Seamless", "effortless", "powerful", "crucial" | Marketing words with no information | Cut the word |
