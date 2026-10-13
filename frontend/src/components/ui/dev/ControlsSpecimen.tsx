"use client";

import { useState, type ReactNode } from "react";
import { BottomSheet } from "../BottomSheet";
import { Button, IconButton, SplitButton } from "../Button";
import { Checkbox, Radio } from "../Checkbox";
import { Chip, ChipGroup } from "../Chip";
import { DateInput, DatePicker, type DateRange, type TermPreset } from "../DateInput";
import { Dialog } from "../Dialog";
import { MoreGlyph } from "../icons";
import { Kbd } from "../Kbd";
import { Menu } from "../Menu";
import { ProgressBar } from "../ProgressBar";
import { ProvenanceTag } from "../ProvenanceTag";
import { SearchField, SearchTrigger } from "../SearchField";
import { SearchPalette, type SearchSection } from "../SearchPalette";
import { Segmented } from "../Segmented";
import { Select } from "../Select";
import { RangeSlider, Slider } from "../Slider";
import { StatusGlyph } from "../StatusGlyph";
import { StatusMark } from "../StatusMark";
import { TextField } from "../TextField";
import { toast } from "../Toast";
import { Toggle } from "../Toggle";
import { Tooltip } from "../Tooltip";
import "./specimen.css";

/** Sample term dates for the specimen only; real presets come from school config. */
const PRESETS: TermPreset[] = [
  { id: "sp27", label: "Spring 2027 · Jan 20–May 7", start: "2027-01-20", end: "2027-05-07" },
  { id: "su27", label: "Summer 2027", start: "2027-06-01", end: "2027-08-06" },
  { id: "fa27", label: "Fall 2027", start: "2027-08-23", end: "2027-12-10" },
];
/** Pinned so the calendar screenshots are stable. */
const TODAY = "2027-01-13";

const INSTRUCTORS = [
  { value: "all", label: "All instructors", meta: "14 sections" },
  { value: "okafor", label: "R. Okafor", meta: "4 sections" },
  { value: "delgado", label: "M. Delgado", meta: "3 sections" },
  { value: "whitfield", label: "S. Whitfield", meta: "2 sections" },
  { value: "lindqvist", label: "A. Lindqvist", meta: "no grades yet", disabled: true },
];

const PALETTE_COURSES = [
  { id: "c1", code: "CSCE 3110", title: "Data Structures and Algorithms", meta: "Locked · needs CSCE 2110" },
  { id: "c2", code: "CSCE 4110", title: "Algorithms", meta: "Locked · needs CSCE 3110" },
  { id: "c3", code: "CSCE 2100", title: "Computing Foundations I", meta: "Planned" },
];

function formatHour(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return m ? `${twelve}:${String(m).padStart(2, "0")} ${suffix}` : `${twelve} ${suffix}`;
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="spec-card" aria-label={title}>
      <h2>
        {title}
        {note ? <small>{note}</small> : null}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="spec-row">
      <span className="spec-lab">{label}</span>
      {children}
    </div>
  );
}

export function ControlsSpecimen() {
  const [instructor, setInstructor] = useState("okafor");
  const [legacyDept, setLegacyDept] = useState("CSCE");
  const [view, setView] = useState<"courses" | "week" | "map">("courses");
  const [timeOfDay, setTimeOfDay] = useState<"earlier" | "any" | "later">("any");
  const [day, setDay] = useState<"Mon" | "Tue" | "Wed" | "Thu" | "Fri">("Mon");
  const [labs, setLabs] = useState(true);
  const [ratings, setRatings] = useState(false);
  const [checks, setChecks] = useState({ a: false, b: true });
  const [section, setSection] = useState("003");
  const [chips, setChips] = useState({ fridays: false, eights: true, compact: false, walks: true });
  const [walk, setWalk] = useState(10);
  const [windowHours, setWindowHours] = useState<[number, number]>([9, 15]);
  const [query, setQuery] = useState("data str");
  const [emptyQuery, setEmptyQuery] = useState("");
  const [firstDay, setFirstDay] = useState<string | null>("2027-01-20");
  const [range, setRange] = useState<DateRange>({ start: "2027-01-20", end: "2027-05-07" });
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [email, setEmail] = useState("sam@gmail.com");
  const [reminder, setReminder] = useState("15");

  const paletteSections: SearchSection[] = [
    {
      id: "courses",
      label: "Courses",
      items: PALETTE_COURSES.filter((c) =>
        `${c.code} ${c.title}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
      ).map((c) => ({ ...c, metaTone: "default" as const })),
    },
  ];
  const someChecked = checks.a !== checks.b;

  return (
    <main className="spec-page" id="main">
      <header className="spec-page__head">
        <h1>Controls</h1>
        <p>Every ui/ control and state, for visual checks. Hover and focus rows are pinned; the rest are live.</p>
      </header>

      <div className="spec-grid">
        <Card title="Button" note="primary · ghost · quiet · destructive · split · loading · disabled">
          <Row label="default">
            <Button>Optimize week</Button>
            <Button variant="ghost">Print</Button>
            <Button variant="quiet">Cancel</Button>
            <Button variant="destructive">Remove</Button>
          </Row>
          <Row label="hover">
            <Button className="dev-hover" tabIndex={-1}>
              Optimize week
            </Button>
            <Button variant="ghost" className="dev-hover" tabIndex={-1}>
              Print
            </Button>
            <Button variant="quiet" className="dev-hover" tabIndex={-1}>
              Cancel
            </Button>
          </Row>
          <Row label="focus">
            <Button className="dev-focus" tabIndex={-1}>
              Optimize week
            </Button>
            <Button variant="ghost" className="dev-focus" tabIndex={-1}>
              Print
            </Button>
          </Row>
          <Row label="other">
            <SplitButton
              icon={<span aria-hidden="true">✦</span>}
              onClick={() => toast("Auto-fill ran (specimen).")}
              menuLabel="More ways to auto-fill"
              menuItems={[
                { id: "connect", label: "From UNT (Connect)" },
                { id: "pdf", label: "From a transcript PDF" },
                { id: "next", label: "Suggest next term only" },
                { kind: "separator", id: "s" },
                { id: "clear", label: "Clear auto status", destructive: true },
              ]}
            >
              Auto-fill
            </SplitButton>
            <Button
              loading={loading}
              loadingLabel="Filling…"
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1600);
              }}
            >
              Run auto-fill
            </Button>
            <Button disabled>Locked</Button>
            <IconButton label="More actions" variant="ghost">
              <MoreGlyph />
            </IconButton>
          </Row>
          <Row label="small">
            <Button size="sm" variant="ghost">
              + Plan
            </Button>
            <Button size="sm" variant="link">
              Undo
            </Button>
            <Button size="sm" loading loadingLabel="Saving…">
              Save
            </Button>
          </Row>
        </Card>

        <Card title="Select" note="custom Listbox on every pointer">
          <div className="spec-stack">
            <Select
              className="spec-field"
              label="Instructor"
              options={INSTRUCTORS}
              value={instructor}
              onValueChange={setInstructor}
            />
            <Select className="spec-field dev-hover" label="Hover" options={INSTRUCTORS} defaultValue="all" />
            <Select className="spec-field" label="Disabled" options={INSTRUCTORS} defaultValue="all" disabled />
            <Select
              className="spec-field"
              label="Department"
              error="Pick a department to filter by."
              value={legacyDept}
              onChange={(event) => setLegacyDept(event.target.value)}
            >
              <option value="ANTH">Anthropology</option>
              <option value="CSCE">Computer Science</option>
              <option value="MATH">Mathematics</option>
            </Select>
            <Select className="spec-field" size="sm" label="Small" options={INSTRUCTORS} defaultValue="delgado" />
          </div>
          <p className="spec-note">The Department select uses v1 `&lt;option&gt;` children and `onChange`; it still receives a real change event.</p>
        </Card>

        <Card title="Dropdown menu" note="PlanChip, Auto-fill caret, ⋯ overflow">
          <Row label="trigger">
            <Menu
              label="Plan"
              align="start"
              items={[
                { id: "copy", label: "Save a copy", shortcut: "⌘S", icon: <span aria-hidden="true">⎘</span> },
                { id: "rename", label: "Rename", shortcut: "R", icon: <span aria-hidden="true">✎</span> },
                { kind: "label", id: "saved", label: "Saved plans" },
                { id: "v3", label: "Spring 2027 · v3", meta: "open", current: true },
                { id: "v2", label: "Spring 2027 · v2", meta: "Compare" },
                { id: "nofri", label: "No Fridays try", meta: "Compare" },
                { kind: "separator", id: "sep" },
                { id: "library", label: "Open library", meta: "›" },
                { id: "export", label: "Export (soon)", disabled: true },
                { id: "archive", label: "Archive this plan", destructive: true },
              ]}
              trigger={(props) => (
                <button {...props} type="button" className="ui-btn ui-btn--ghost" data-ui="">
                  Plan menu
                </button>
              )}
            />
            <Menu
              label="Row actions"
              align="end"
              items={[
                { id: "details", label: "Details" },
                { id: "remove", label: "Remove from plan", destructive: true },
              ]}
              trigger={(props) => (
                <button {...props} type="button" className="ui-btn ui-btn--quiet ui-btn--icon" aria-label="Row actions" data-ui="">
                  <MoreGlyph />
                </button>
              )}
            />
          </Row>
          <p className="spec-note">Enter, Space or ↓ opens on the first item; ↑ on the last. Type to jump.</p>
        </Card>

        <Card title="Segmented control" note="32 · 28 small · full width · disabled">
          <Row label="views">
            <Segmented
              label="View"
              value={view}
              onValueChange={setView}
              options={[
                { value: "courses", label: "Courses" },
                { value: "week", label: "Week" },
                { value: "map", label: "Map" },
              ]}
            />
          </Row>
          <Row label="small">
            <Segmented
              label="Time of day"
              size="sm"
              value={timeOfDay}
              onValueChange={setTimeOfDay}
              options={[
                { value: "earlier", label: "Earlier" },
                { value: "any", label: "Any" },
                { value: "later", label: "Later" },
              ]}
            />
          </Row>
          <div className="spec-row">
            <Segmented
              label="Day"
              fullWidth
              value={day}
              onValueChange={setDay}
              options={[
                { value: "Mon", label: "Mon" },
                { value: "Tue", label: "Tue" },
                { value: "Wed", label: "Wed" },
                { value: "Thu", label: "Thu" },
                { value: "Fri", label: "Fri", disabled: true },
              ]}
            />
          </div>
        </Card>

        <Card title="Toggle" note="only for true on/off settings">
          <div className="spec-stack">
            <Toggle checked={labs} onChange={setLabs} label="Include labs in walking time" description="Adds lab buildings to the route" />
            <Toggle checked={ratings} onChange={setRatings} label="Show instructor ratings" />
            <div className="spec-row" style={{ marginTop: 0 }}>
              <span className="dev-focus">
                <Toggle checked onChange={() => {}} ariaLabel="Pinned focus example" />
              </span>
              <Toggle checked={false} disabled label="Disabled" />
            </div>
          </div>
        </Card>

        <Card title="Checkbox, radio, chip, tag">
          <Row label="checkbox">
            <Checkbox label="Off" checked={checks.a} onChange={(e) => setChecks({ ...checks, a: e.target.checked })} />
            <Checkbox label="On" checked={checks.b} onChange={(e) => setChecks({ ...checks, b: e.target.checked })} />
            <Checkbox
              label="Some"
              checked={checks.a && checks.b}
              indeterminate={someChecked}
              onChange={(e) => setChecks({ a: e.target.checked, b: e.target.checked })}
            />
            <Checkbox label="Disabled" disabled />
          </Row>
          <div className="spec-row">
            <fieldset className="spec-fieldset">
              <legend>Section</legend>
              {["001", "003"].map((s) => (
                <Radio key={s} name="section" value={s} label={`§${s}`} checked={section === s} onChange={() => setSection(s)} />
              ))}
              <Radio name="section" value="005" label="§005 (full)" disabled />
            </fieldset>
          </div>
          <div className="spec-row">
            <ChipGroup label="Constraints">
              <Chip selected={chips.fridays} onSelectedChange={(v) => setChips({ ...chips, fridays: v })}>
                No Fridays
              </Chip>
              <Chip selected={chips.eights} onSelectedChange={(v) => setChips({ ...chips, eights: v })}>
                No 8 AMs
              </Chip>
              <Chip selected={chips.compact} onSelectedChange={(v) => setChips({ ...chips, compact: v })} className="dev-hover">
                Compact days
              </Chip>
              <Chip selected={chips.walks} onSelectedChange={(v) => setChips({ ...chips, walks: v })} count="10 min">
                Short walks
              </Chip>
            </ChipGroup>
          </div>
          <Row label="tags">
            <ProvenanceTag source="Statuses come from the transcript PDF you imported.">From transcript</ProvenanceTag>
            <ProvenanceTag source="Sections are samples, not this term's real schedule.">Sample</ProvenanceTag>
            <ProvenanceTag source="Walking times are estimated from straight-line distance.">Approx.</ProvenanceTag>
          </Row>
        </Card>

        <Card title="Slider" note="single and range; bubble while dragging or focused">
          <div className="spec-stack">
            <Slider
              label="Max walk between classes"
              min={2}
              max={20}
              value={walk}
              onValueChange={setWalk}
              formatValue={(v) => `${v} min`}
              minLabel="2"
              maxLabel="20 min"
            />
            <RangeSlider
              label="Class window"
              min={7}
              max={21}
              step={0.5}
              value={windowHours}
              onValueChange={setWindowHours}
              formatValue={formatHour}
              minLabel="7 AM"
              maxLabel="9 PM"
              minGap={1}
            />
          </div>
        </Card>

        <Card title="Search and text fields">
          <div className="spec-stack">
            <SearchField
              label="Search courses"
              placeholder="Search courses"
              shortcut="⌘K"
              value={emptyQuery}
              onChange={(e) => setEmptyQuery(e.target.value)}
              onClear={() => setEmptyQuery("")}
            />
            <SearchField
              label="Search courses (filled)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
            />
            <SearchField label="Searching" defaultValue="algo" loading />
            <div className="spec-row" style={{ marginTop: 0 }}>
              <SearchTrigger onClick={() => setPaletteOpen(true)} />
              <SearchTrigger compact onClick={() => setPaletteOpen(true)} />
            </div>
            <TextField label="Plan name" defaultValue="Spring 2027 · v3" help="Shown in the top bar." />
            <TextField
              label="UNT email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={/@(my\.)?unt\.edu$/i.test(email) ? null : "Use your @unt.edu or @my.unt.edu address."}
            />
            <TextField label="Disabled" defaultValue="Read only" disabled />
          </div>
        </Card>

        <Card title="Date input" note="term presets; range for the .ics dialog">
          <div className="spec-stack">
            <DateInput label="First day of classes" value={firstDay} onChange={setFirstDay} today={TODAY} help="Type 1/20/27 or pick a day." />
            <div className="spec-calendar">
              <DatePicker label="Term dates" mode="range" range={range} onRangeChange={setRange} presets={PRESETS} today={TODAY} />
            </div>
          </div>
        </Card>

        <Card title="Tooltip, kbd, progress, toast">
          <Row label="tooltip">
            <Tooltip content="A · 146 students · 35%">
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" data-ui="">
                Hover me
              </button>
            </Tooltip>
            <Tooltip content="You set this. Click to reset.">
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" data-ui="">
                And me
              </button>
            </Tooltip>
          </Row>
          <Row label="kbd">
            <Kbd>⌘K</Kbd>
            <Kbd>esc</Kbd>
            <Kbd>↵</Kbd>
            <span>
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
          </Row>
          <div className="spec-stack" style={{ marginTop: 12 }}>
            <ProgressBar value={42} max={120} aria-label="Credits toward degree" />
            <ProgressBar indeterminate aria-label="Reading the PDF" />
            <ProgressBar pct={35} label="Core complete" />
          </div>
          <Row label="toast">
            <Button size="sm" variant="ghost" onClick={() => toast("Saved a copy to your library.")}>
              Plain toast
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                toast({ message: "Optimized · 2 sections moved", action: { label: "Undo", onClick: () => toast("Undone.") } })
              }
            >
              Toast with Undo
            </Button>
          </Row>
        </Card>

        <Card title="Status" note="glyph only; the row carries the word">
          <Row label="glyphs">
            <StatusGlyph status="done" labelled />
            <StatusGlyph status="taking" labelled />
            <StatusGlyph status="planned" labelled />
            <StatusGlyph status="available" labelled />
            <StatusGlyph status="locked" labelled />
          </Row>
          <Row label="v1 mark">
            <StatusMark label="Done" tone="completed" />
            <StatusMark label="Taking" tone="in-progress" />
            <StatusMark label="Conflict" tone="danger" />
          </Row>
        </Card>

        <Card title="Dialog and bottom sheet">
          <Row label="open">
            <Button variant="ghost" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Button variant="ghost" onClick={() => setSheetOpen(true)}>
              Open sheet
            </Button>
          </Row>
          <p className="spec-note">The sheet has three detents (112px, 50%, 92%): drag the handle, flick, or press ↑/↓ on it.</p>
        </Card>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Export calendar"
        description="Adds this plan's classes to your calendar app."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setDialogOpen(false)}>Download .ics</Button>
          </>
        }
      >
        <div className="spec-stack">
          <Select
            label="Reminder before class"
            value={reminder}
            onValueChange={setReminder}
            options={[
              { value: "none", label: "No reminder" },
              { value: "10", label: "10 minutes" },
              { value: "15", label: "15 minutes" },
              { value: "30", label: "30 minutes" },
            ]}
          />
          <DatePicker label="Term dates" mode="range" range={range} onRangeChange={setRange} presets={PRESETS} today={TODAY} />
        </div>
      </Dialog>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="CSCE 2100 details"
        detents={[112, "50%", "92%"]}
        initialDetent={1}
        header={
          <div className="spec-row" style={{ marginTop: 0, justifyContent: "space-between" }}>
            <span className="ui-code" style={{ fontSize: 20 }}>
              CSCE 2100
            </span>
            <Button size="sm" variant="quiet" onClick={() => setSheetOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="spec-sheet-body">
          <p>Computing Foundations I · 3 credits · Core</p>
          {Array.from({ length: 14 }, (_, i) => (
            <p key={i}>Section §00{(i % 9) + 1} · Tue Thu 11:00–12:20 · GAB 550</p>
          ))}
        </div>
      </BottomSheet>

      <SearchPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        sections={paletteSections}
        planShortcut
        onSelect={(item, { plan }) => {
          setPaletteOpen(false);
          toast(`${plan ? "Planned" : "Opened"} ${item.code}`);
        }}
      />
    </main>
  );
}
