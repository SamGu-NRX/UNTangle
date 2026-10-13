"use client";

import { useState, type ReactNode } from "react";
import { BottomSheet } from "../BottomSheet";
import { Button, IconButton } from "../Button";
import { Checkbox, Radio } from "../Checkbox";
import { Chip, ChipGroup } from "../Chip";
import { ContextPanel } from "../ContextPanel";
import { DateInput } from "../DateInput";
import { Dialog } from "../Dialog";
import { Check, Close, MoreGlyph, Plus, TrayIn, Undo, Walk } from "../icons";
import { Kbd } from "../Kbd";
import { Menu } from "../Menu";
import { PathLine, PathStop } from "../PathLine";
import { Plate } from "../Plate";
import { ProgressBar } from "../ProgressBar";
import { ProvenanceTag } from "../ProvenanceTag";
import { SearchField, SearchTrigger } from "../SearchField";
import { Segmented } from "../Segmented";
import { Slider } from "../Slider";
import { StatusGlyph, type CourseStatus } from "../StatusGlyph";
import { Switch } from "../Switch";
import { TextField } from "../TextField";
import { toast } from "../Toast";
import { Tooltip } from "../Tooltip";
import "./specimen.css";

/** Pinned so date screenshots are stable. */
const TODAY = "2027-01-13";

const GLYPHS: Array<[CourseStatus, string]> = [
  ["done", "Done"],
  ["covered", "Covered"],
  ["taking", "Taking now"],
  ["planned", "Planned"],
  ["available", "You can take"],
  ["locked", "Locked"],
  ["check", "To check"],
];

const PICKS = [
  { code: "CSCE 2110", title: "Foundations of Data Structures", meta: "Section 001, MWF 9:00" },
  { code: "MATH 2700", title: "Linear Algebra and Vector Geometry", meta: "Section 003, MWF 10:00" },
  { code: "PHYS 2220", title: "Electricity and Magnetism", meta: "Section 002, MW 11:00" },
] as const;

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

/**
 * A row of specimens. A `pinned` row shows a hover, press or focus look that
 * CSS holds still for the screenshot; it is inert, because those copies are
 * pictures of a state rather than controls of their own.
 */
function Row({ label, pinned, children }: { label: string; pinned?: boolean; children: ReactNode }) {
  return (
    <div className="spec-row" inert={pinned || undefined}>
      <span className="spec-lab">{label}</span>
      {children}
    </div>
  );
}

export function ControlsSpecimen() {
  const [loading, setLoading] = useState(false);
  const [lens, setLens] = useState<"courses" | "week" | "day">("courses");
  const [start, setStart] = useState<"any" | "9" | "10" | "11">("any");
  const [campus, setCampus] = useState<"unt" | "utexas">("unt");
  const [option, setOption] = useState<"a" | "b" | "c">("a");
  const [chips, setChips] = useState({ fridays: true, lunch: false, walks: true, profs: false });
  const [overload, setOverload] = useState(true);
  const [walkTimes, setWalkTimes] = useState(true);
  const [reminders, setReminders] = useState(false);
  const [query, setQuery] = useState("");
  const [filled, setFilled] = useState("data str");
  const [email, setEmail] = useState("sam@unt");
  const [checks, setChecks] = useState({ labs: true, online: false });
  const [section, setSection] = useState("001");
  const [walk, setWalk] = useState(10);
  const [firstDay, setFirstDay] = useState<string | null>("2027-01-19");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [picked, setPicked] = useState<(typeof PICKS)[number] | null>(null);

  const runLoading = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1600);
  };

  return (
    <main className="spec-page" id="main">
      <header className="spec-page__head">
        <h1>Controls</h1>
        <p>
          Every control in components/ui and its states. Rows marked hover, press and focus are held still for screenshots; everything else is
          live.
        </p>
      </header>

      <div className="spec-grid">
        <Card title="Button" note="primary, secondary, quiet, ink, destructive, link">
          <Row label="rest">
            <Button icon={<TrayIn size={18} />}>Auto</Button>
            <Button variant="secondary">Open in Week</Button>
            <Button variant="quiet" icon={<Undo size={16} />}>
              Undo
            </Button>
            <Button variant="ink">Cancel</Button>
            <Button variant="destructive">Delete schedule</Button>
            <Button variant="link">Import again</Button>
          </Row>
          <Row label="hover" pinned>
            <Button className="dev-hover">Auto</Button>
            <Button variant="secondary" className="dev-hover">
              Open in Week
            </Button>
            <Button variant="quiet" className="dev-hover">
              Undo
            </Button>
            <Button variant="ink" className="dev-hover">
              Cancel
            </Button>
          </Row>
          <Row label="press" pinned>
            <Button className="dev-press">Auto</Button>
            <Button variant="secondary" className="dev-press">
              Open in Week
            </Button>
          </Row>
          <Row label="focus" pinned>
            <Button className="dev-focus">Auto</Button>
            <Button variant="secondary" className="dev-focus">
              Open in Week
            </Button>
            <Button variant="quiet" className="dev-focus">
              Undo
            </Button>
          </Row>
          <Row label="disabled">
            <Button disabled>Auto</Button>
            <Button variant="secondary" disabled>
              Open in Week
            </Button>
            <Button variant="quiet" disabled>
              Undo
            </Button>
          </Row>
          <Row label="loading">
            <Button loading={loading} loadingLabel={<span className="sr-only-v2">Planning</span>} onClick={runLoading} icon={<TrayIn size={18} />}>
              Auto
            </Button>
            <Button size="sm" variant="secondary" loading loadingLabel="Saving">
              Save
            </Button>
          </Row>
          <Row label="sizes">
            <Button size="sm" variant="secondary">
              Small 32
            </Button>
            <Button variant="secondary">Medium 40</Button>
            <Button size="lg">Use the downloaded PDF</Button>
          </Row>
          <Row label="icon">
            <IconButton label="Add MATH 3680" variant="quiet">
              <Plus />
            </IconButton>
            <IconButton label="More actions">
              <MoreGlyph />
            </IconButton>
            <IconButton label="Close" size="sm">
              <Close />
            </IconButton>
            <IconButton label="Add to Spring 2027" variant="secondary">
              <Plus />
            </IconButton>
          </Row>
        </Card>

        <Card title="Segmented" note="one pill moves on a pointer; the keyboard moves it at once">
          <Row label="views">
            <Segmented
              label="View"
              value={lens}
              onValueChange={setLens}
              options={[
                { value: "courses", label: "Courses" },
                { value: "week", label: "Week" },
                { value: "day", label: "Day" },
              ]}
            />
          </Row>
          <Row label="start">
            <Segmented
              label="Start after"
              size="sm"
              value={start}
              onValueChange={setStart}
              options={[
                { value: "any", label: "Any" },
                { value: "9", label: "9 AM" },
                { value: "10", label: "10 AM" },
                { value: "11", label: "11 AM" },
              ]}
            />
          </Row>
          <Row label="campus">
            <Segmented
              label="Campus"
              value={campus}
              onValueChange={setCampus}
              options={[
                { value: "unt", label: "UNT" },
                { value: "utexas", label: "UT Austin" },
              ]}
            />
          </Row>
          <Row label="options">
            <Segmented
              label="Option"
              size="sm"
              value={option}
              onValueChange={setOption}
              options={[
                { value: "a", label: "A" },
                { value: "b", label: "B" },
                { value: "c", label: "C", disabled: true },
              ]}
            />
          </Row>
          <Row label="focus" pinned>
            <Segmented
              label="Pinned focus"
              value="week"
              onValueChange={() => {}}
              className="dev-focus-seg"
              options={[
                { value: "courses", label: "Courses" },
                { value: "week", label: "Week" },
                { value: "day", label: "Day" },
              ]}
            />
          </Row>
        </Card>

        <Card title="Chip" note="toggles; on shows a check">
          <div className="spec-row">
            <ChipGroup label="Preferences">
              <Chip selected={chips.fridays} onSelectedChange={(fridays) => setChips({ ...chips, fridays })}>
                No Fridays
              </Chip>
              <Chip selected={chips.lunch} onSelectedChange={(lunch) => setChips({ ...chips, lunch })}>
                Lunch break
              </Chip>
              <Chip selected={chips.walks} onSelectedChange={(walks) => setChips({ ...chips, walks })} count="10 min">
                Short walks
              </Chip>
              <Chip selected={chips.profs} onSelectedChange={(profs) => setChips({ ...chips, profs })}>
                Top-rated profs
              </Chip>
            </ChipGroup>
          </div>
          <Row label="warn">
            <Chip selected={overload} tone="warn" onSelectedChange={setOverload}>
              18 credits
            </Chip>
          </Row>
          <Row label="hover" pinned>
            <Chip selected={false} className="dev-hover">
              Lunch break
            </Chip>
            <Chip selected={false} className="dev-press">
              Pressed
            </Chip>
            <Chip selected className="dev-focus">
              Focused
            </Chip>
          </Row>
          <Row label="disabled">
            <Chip selected={false} disabled>
              Fewer days
            </Chip>
            <Chip selected disabled>
              No Fridays
            </Chip>
          </Row>
        </Card>

        <Card title="Switch" note="40 × 24; true on or off settings only">
          <div className="spec-stack">
            <Switch checked={walkTimes} onChange={setWalkTimes} label="Show walking times" description="Between classes on the same day" />
            <Switch checked={reminders} onChange={setReminders} label="Leave-by alerts in the calendar file" />
            <Switch checked={false} disabled label="Location" description="Allow it in the browser first" />
          </div>
          <Row label="focus" pinned>
            <span className="dev-focus">
              <Switch checked onChange={() => {}} ariaLabel="Pinned focus" />
            </span>
            <Switch checked={false} ariaLabel="Off" />
          </Row>
        </Card>

        <Card title="Search and text fields">
          <div className="spec-stack">
            <SearchField
              label="Search courses"
              placeholder="Search courses"
              shortcut="⌘K"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
            />
            <SearchField label="Search courses, filled" value={filled} onChange={(event) => setFilled(event.target.value)} onClear={() => setFilled("")} />
            <SearchField label="Searching" defaultValue="algo" loading />
            <div className="spec-row spec-row--flush">
              <SearchTrigger onClick={() => toast("The search layer opens from the shell.")} />
              <SearchTrigger compact onClick={() => toast("The search layer opens from the shell.")} />
            </div>
            <TextField label="Schedule name" defaultValue="Fridays off" help="Shown on the schedule tab." />
            <TextField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? null : "Add the rest of the address, like name@my.unt.edu."}
            />
            <TextField label="Student ID" defaultValue="Removed" disabled />
            <div inert>
              <TextField label="Focused" defaultValue="Kerr Hall" className="dev-focus" />
            </div>
          </div>
        </Card>

        <Card title="Plate, status, provenance">
          <Row label="plates">
            <Plate building="GAB" room="535" name="General Academic Building" />
            <Plate building="CURY" room="104" />
            <Plate building="ESSC" room="255" quiet />
          </Row>
          <ul className="spec-glyphs" aria-label="Course statuses">
            {GLYPHS.map(([status, caption]) => (
              <li key={status}>
                <StatusGlyph status={status} />
                <span aria-hidden="true">{caption}</span>
              </li>
            ))}
          </ul>
          <Row label="tags">
            <ProvenanceTag source="Statuses come from the transcript PDF you imported on October 13.">From transcript, Oct 13</ProvenanceTag>
            <ProvenanceTag source="These sections are samples, not this term's real schedule.">Sample sections</ProvenanceTag>
            <ProvenanceTag source="Grades come from UNT's public grade distributions.">UNT grade records 2019 to 2025</ProvenanceTag>
          </Row>
        </Card>

        <Card title="Path line" note="order that is real; the walk is drawn">
          <PathLine label="Monday">
            <PathStop marker={<Walk size={14} strokeWidth={2.4} />} tone="ring" leg="walk" chip="9 min">
              <p className="spec-stop">
                <strong>Kerr Hall</strong>
                <span>Leave by 8:49</span>
              </p>
            </PathStop>
            <PathStop marker="1" leg="tight" chip="8 min">
              <p className="spec-stop">
                <strong>
                  <span className="ui-code">CSCE 2110</span> 9:00 to 9:50
                </strong>
                <Plate building="GAB" room="535" quiet />
              </p>
            </PathStop>
            <PathStop marker="2" leg="late" chip="12 min">
              <p className="spec-stop">
                <strong>
                  <span className="ui-code">MATH 2700</span> 10:00 to 10:50
                </strong>
                <span className="spec-stop__warn">The walk is 2 min longer than the break</span>
              </p>
            </PathStop>
            <PathStop marker="3">
              <p className="spec-stop">
                <strong>
                  <span className="ui-code">PHYS 2220</span> 11:00 to 11:50
                </strong>
                <Plate building="PHYS" room="104" quiet />
              </p>
            </PathStop>
          </PathLine>
          <h3 className="spec-sub">Import steps</h3>
          <PathLine label="Import steps">
            <PathStop marker={<Check size={14} />} tone="past" leg="past">
              <p className="spec-stop">
                <strong>Sign in to myUNT</strong>
              </p>
            </PathStop>
            <PathStop marker="2" tone="here" leg="todo">
              <p className="spec-stop">
                <strong>Open the unofficial transcript</strong>
              </p>
            </PathStop>
            <PathStop marker="3" tone="ring">
              <p className="spec-stop">
                <strong>Download the PDF</strong>
              </p>
            </PathStop>
          </PathLine>
          <h3 className="spec-sub">Prerequisites</h3>
          <PathLine orientation="horizontal" label="Path to CSCE 3110">
            <PathStop marker={<Check size={14} />} leg="done">
              <span className="spec-hstop">
                <span className="ui-code">CSCE 2100</span>B
              </span>
            </PathStop>
            <PathStop marker={<Check size={14} />} leg="done">
              <span className="spec-hstop">
                <span className="ui-code">CSCE 2110</span>A
              </span>
            </PathStop>
            <PathStop marker="" tone="here" leg="todo">
              <span className="spec-hstop">
                <span className="ui-code">CSCE 3110</span>This course
              </span>
            </PathStop>
            <PathStop marker="" tone="ring">
              <span className="spec-hstop">
                <span className="ui-code">CSCE 4110</span>Unlocks
              </span>
            </PathStop>
          </PathLine>
        </Card>

        <Card title="Context panel" note="opens on a selection; a sheet on phones">
          <ul className="spec-pick" aria-label="Spring 2027 courses">
            {PICKS.map((course) => (
              <li key={course.code}>
                <button type="button" aria-pressed={picked?.code === course.code} onClick={() => setPicked(course)}>
                  <span className="ui-code">{course.code}</span>
                  <span>{course.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="spec-note">Escape or Close returns focus to the course you picked. Picking another swaps the content in place.</p>
        </Card>

        <Card title="Toast, dialog, sheet">
          <Row label="toast">
            <Button size="sm" variant="secondary" onClick={() => toast("Saved to this device")}>
              Plain
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toast({ message: "Removed CSCE 2610", action: { label: "Undo", onClick: () => toast("CSCE 2610 is back") } })}
            >
              With Undo
            </Button>
            <Button size="sm" variant="secondary" onClick={() => toast({ message: "Couldn't save. Check your connection and retry.", tone: "error" })}>
              Error
            </Button>
          </Row>
          <Row label="open">
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Dialog
            </Button>
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>
              Course sheet
            </Button>
            <Button variant="secondary" onClick={() => setDaySheetOpen(true)}>
              Day sheet
            </Button>
          </Row>
          <p className="spec-note">
            The course sheet opens at half height and is modal: drag, flick, tap the dimmed page, press Escape or go Back. The Day sheet is glass,
            leaves the page live and rests at 206px, half and 86%.
          </p>
        </Card>

        <Card title="Also in components/ui" note="checkbox, radio, slider, date, menu, tooltip, kbd, progress, spinner">
          <Row label="checkbox">
            <Checkbox label="Labs" checked={checks.labs} onChange={(event) => setChecks({ ...checks, labs: event.target.checked })} />
            <Checkbox label="Online" checked={checks.online} onChange={(event) => setChecks({ ...checks, online: event.target.checked })} />
            <Checkbox label="Disabled" disabled />
          </Row>
          <div className="spec-row">
            <fieldset className="spec-fieldset">
              <legend>Section</legend>
              {["001", "002"].map((value) => (
                <Radio key={value} name="spec-section" value={value} label={`§${value}`} checked={section === value} onChange={() => setSection(value)} />
              ))}
              <Radio name="spec-section" value="003" label="§003, full" disabled />
            </fieldset>
          </div>
          <div className="spec-stack spec-stack--gap">
            <Slider label="Longest walk" min={2} max={20} value={walk} onValueChange={setWalk} formatValue={(value) => `${value} min`} minLabel="2" maxLabel="20 min" />
            <DateInput label="First day of classes" value={firstDay} onChange={setFirstDay} today={TODAY} />
          </div>
          <Row label="menu">
            <Menu
              label="Schedule actions"
              align="start"
              items={[
                { id: "rename", label: "Rename" },
                { id: "duplicate", label: "Duplicate" },
                { id: "export", label: "Export" },
                { kind: "separator", id: "sep" },
                { id: "delete", label: "Delete", destructive: true },
              ]}
              trigger={(props) => (
                <button {...props} type="button" className="ui-btn ui-btn--ink ui-btn--icon" aria-label="Schedule actions" data-ui="">
                  <MoreGlyph />
                </button>
              )}
            />
            <Tooltip content="146 students, 35% A">
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" data-ui="">
                Tooltip
              </button>
            </Tooltip>
            <Kbd>⌘K</Kbd>
            <Kbd>esc</Kbd>
          </Row>
          <div className="spec-stack spec-stack--gap">
            <ProgressBar value={54} max={120} aria-label="Credits toward the degree" />
            <ProgressBar indeterminate aria-label="Reading the PDF" />
          </div>
          <Row label="spinner">
            <span className="spec-spinner" role="status" aria-label="Loading">
              <SpinnerSample />
            </span>
          </Row>
        </Card>
      </div>

      <ContextPanel open={picked !== null} onClose={() => setPicked(null)} title={picked?.code ?? ""}>
        {picked ? (
          <div className="spec-sheet-body">
            <h2>{picked.title}</h2>
            <p>{picked.meta}</p>
            <Plate building="GAB" room="535" />
          </div>
        ) : null}
      </ContextPanel>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Delete Fridays off?"
        description="Main stays your active schedule. You can undo this for a few seconds."
        width={420}
        footer={
          <>
            <Button variant="ink" onClick={() => setDialogOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDialogOpen(false);
                toast({ message: "Deleted Fridays off", action: { label: "Undo", onClick: () => toast("Fridays off is back") } });
              }}
            >
              Delete
            </Button>
          </>
        }
      />

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="MATH 3680 details"
        closeOnBack
        header={
          <div className="spec-sheet-head">
            <span className="ui-code spec-sheet-code">MATH 3680</span>
            <IconButton label="Close" size="sm" onClick={() => setSheetOpen(false)}>
              <Close />
            </IconButton>
          </div>
        }
      >
        <div className="spec-sheet-body">
          <h2>Applied Statistics</h2>
          <p>3 credits. You can take this.</p>
          <Button className="spec-wide" icon={<Plus size={18} />} onClick={() => setSheetOpen(false)}>
            Add to Spring 2027
          </Button>
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i} className="spec-sheet-row">
              <span>§00{(i % 9) + 1}</span>
              <span>Tue and Thu, 11:00 to 12:20</span>
              <Plate building="GAB" room="550" quiet />
            </p>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={daySheetOpen}
        onOpenChange={setDaySheetOpen}
        title="Your day"
        modal={false}
        dismissible={false}
        glass
        detents={[206, "50%", "86%"]}
        header={
          <div className="spec-sheet-head">
            <span className="spec-day-label">Leave Kerr Hall by</span>
            <IconButton label="Close the Day sheet" size="sm" onClick={() => setDaySheetOpen(false)}>
              <Close />
            </IconButton>
          </div>
        }
      >
        <div className="spec-sheet-body">
          <p className="spec-numeral">8:49</p>
          <p>CSCE 2110 at 9:00, a 9 min walk to GAB 535</p>
        </div>
      </BottomSheet>
    </main>
  );
}

function SpinnerSample() {
  return <span className="ui-spinner" style={{ width: 16, height: 16 }} aria-hidden="true" data-ui="" />;
}
