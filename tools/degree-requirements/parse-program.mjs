/**
 * tools/degree-requirements/parse-program.mjs
 *
 * Parses a Courseleaf/acalog program page (the shape served by
 * catalog.unt.edu) into the DegreeRequirements structure defined in
 * frontend/src/lib/degree-requirements.ts.
 *
 * Traceability contract:
 * - this module never fetches; it parses receipt-verified bytes only;
 * - hours come ONLY from hours text printed on the page (headings and
 *   prose) — never inferred from course counts or option counts;
 * - anything non-enumerable (hour patterns, "any 4000-level X course",
 *   policy notes, ambiguous prose) becomes an `advisor` item: surfaced
 *   honestly, never machine-satisfied;
 * - course alternatives marked on the page with an adhoc "or" become an
 *   `anyOf` node (satisfied when at least one branch is satisfied); the
 *   "or" binds only the alternatives it separates, never a whole list.
 *
 * Page structure (verified against the archived 2023-24 Computer Science
 * BS page, tools/degree-requirements/fixtures/cs-2023-24-archived.html):
 * - requirement blocks are <div class="acalog-core">, linear siblings;
 * - heading level encodes hierarchy: h2 = top-level section, h3 =
 *   requirement (optionally "…, N hours"), h4 = sub-group;
 * - course items are <li class="acalog-course">CODE - Title</li> (plain
 *   or anchor-wrapped); a trailing " and" pairs the item with the next;
 * - <li class="acalog-adhoc"> carries connective prose ("or" / nbsp);
 * - an hours-bearing heading with no course list ("Laboratory science,
 *   16 hours") opens a nested group that deeper blocks fill.
 */

const OPEN = '<div class="acalog-core">';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ");
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Extract the program title from <title> ("Program: X - University of …"). */
export function parseProgramTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  let t = decodeEntities(m[1]).trim();
  const prog = t.match(/^Program:\s*(.+)$/i);
  if (prog) t = prog[1];
  const cut = t.search(/[-\u2013]\s*University of North Texas/i);
  if (cut > 0) t = t.slice(0, cut).trim();
  return t || null;
}

/**
 * Scan the page linearly for acalog-core blocks. Each block carries an
 * ORDERED item stream ({type:'course'} | {type:'adhoc'}) so connective
 * prose can bind the right alternatives, plus its heading level/text
 * and tag-stripped text.
 */
export function parseCourseleafBlocks(html) {
  const blocks = [];
  let pos = 0;
  for (;;) {
    const start = html.indexOf(OPEN, pos);
    if (start < 0) break;
    // find the balanced close, treating ANY <div ...> as an opener
    let depth = 1;
    let close = -1;
    const re = /<div\b[^>]*>|<\/div>/g;
    re.lastIndex = start + OPEN.length;
    let m;
    while ((m = re.exec(html)) !== null) {
      depth += m[0].startsWith("<div") ? 1 : -1;
      if (depth === 0) {
        close = m.index;
        break;
      }
    }
    if (close < 0) throw new Error("unbalanced acalog-core div in program page");
    const inner = html.slice(start + OPEN.length, close);
    const headMatch = inner.match(/<h([234])[^>]*>([\s\S]*?)<\/h\1>/i);
    const level = headMatch ? Number(headMatch[1]) : null;
    const heading = headMatch ? stripTags(headMatch[2]) : null;
    const items = [];
    const liRe = /<li class="(acalog-course|acalog-adhoc)[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(inner)) !== null) {
      const body = li[2];
      if (li[1] === "acalog-course") {
        const text = stripTags(body);
        const cm = text.match(/^([A-Z]{2,4}\s\d{4}[A-Z]?)\s*-\s*(.+)$/);
        if (cm) {
          const rawTitle = cm[2].trim();
          items.push({
            type: "course",
            code: cm[1],
            title: rawTitle.replace(/\s+and$/i, "").trim(),
            pairWithNext: /\s+and$/i.test(rawTitle),
          });
        }
      } else {
        const text = stripTags(body);
        if (text && text !== "\u00a0") items.push({ type: "adhoc", text: text.toLowerCase() });
      }
    }
    const text = stripTags(inner);
    blocks.push({ level, heading, items, text });
    pos = close + 6;
  }
  return blocks;
}

/** Parse the degree-meta prose ("A minimum of 120 semester hours, of which 42 must be advanced…"). */
export function parseDegreeMeta(text) {
  const total = text.match(/minimum\s+of\s+(\d+)\s+semester\s+hours/i);
  const advanced = text.match(/of\s+which\s+(\d+)\s+must\s+be\s+advanced/i);
  return {
    totalHours: total ? Number(total[1]) : null,
    advancedHours: advanced ? Number(advanced[1]) : null,
  };
}

/** Parse "…, N hours" / "Choose N hours…" / "N hours selected from…" heading hours. */
function hoursFromHeading(heading) {
  let m = heading.match(/,\s*(\d+)\s*hours?\s*$/i);
  if (m) return { label: heading.slice(0, m.index).trim().replace(/,\s*$/, ""), hours: Number(m[1]) };
  m = heading.match(/^choose\s+(\d+)\s*hours?\b(.*)$/i);
  if (m) return { label: `Choose ${m[1]} hours ${stripTags(m[2]).trim()}`.trim(), hours: Number(m[1]) };
  m = heading.match(/^(\d+)\s*hours?\s+(?:selected|chosen)\s+from/i);
  if (m) return { label: heading, hours: Number(m[1]) };
  return { label: heading, hours: null };
}

/**
 * Turn a block's ordered item stream into model nodes: courses joined
 * by an adhoc "or" become one anyOf node; everything else stays a plain
 * course node. "and"-pairs remain separate required courses inside
 * their required group.
 */
function nodesFromItems(items) {
  const nodes = [];
  let orPending = false;
  for (const item of items) {
    if (item.type === "adhoc") {
      orPending = item.text === "or";
      continue;
    }
    const node = { kind: "course", courseCode: item.code, title: item.title, creditHours: null };
    const prev = nodes[nodes.length - 1];
    if (orPending && prev?.kind === "course") {
      nodes[nodes.length - 1] = {
        kind: "anyOf",
        label: `${prev.courseCode} or ${node.courseCode}`,
        items: [prev, node],
      };
    } else if (orPending && prev?.kind === "anyOf") {
      prev.items.push(node);
      prev.label = prev.items.map((i) => i.courseCode).join(" or ");
    } else {
      nodes.push(node);
    }
    orPending = false;
  }
  return nodes;
}

/**
 * Build a DegreeRequirements object from parsed blocks.
 * Identity fields are passed through from the ingestion receipt — this
 * function never invents them.
 */
export function buildRequirements(blocks, identity) {
  const reqs = {
    majorId: identity.majorId,
    majorName: identity.majorName,
    catalogYear: identity.catalogYear,
    sourceUrl: identity.sourceUrl,
    fetchedAt: identity.fetchedAt,
    sourceSha256: identity.sourceSha256,
    totalHours: null,
    advancedHours: null,
    majorHours: null,
    sections: [],
    advisorNotes: [],
  };

  let current = null; // { section } currently receiving nested h3/h4 blocks
  let nested = null; // { items } of an hours-bearing heading-only group
  let orphansAdvisorOnly = false; // after a prose-only h2, nested h3/h4 stay advisor-only

  const advisor = (label, note) => {
    const item = { kind: "advisor", label, note: note ?? null };
    reqs.advisorNotes.push(note ?? label);
    return item;
  };

  // "plus 6 hours chosen from X or Y plus 9 hours chosen from Z." — the
  // clauses run together without periods, so split on each "plus" start.
  const proseAdvisorItems = (text, label) =>
    (text.split(/(?=plus\s+\d+\s+hours?\s+chosen)/i) || [])
      .filter((part) => /plus\s+\d+\s+hours?\s+chosen/i.test(part))
      .map((part) => advisor(label, part.replace(/\s+/g, " ").trim()));

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const { level, heading, items, text } = block;

    // degree-meta blocks
    if (heading === "Hours required and general/college requirements" || (!heading && /minimum\s+of\s+\d+\s+semester\s+hours/i.test(text))) {
      const meta = parseDegreeMeta(text);
      reqs.totalHours = reqs.totalHours ?? meta.totalHours;
      reqs.advancedHours = reqs.advancedHours ?? meta.advancedHours;
      continue;
    }

    if (!heading) {
      // headingless content block: prose only, nothing structural to attach
      continue;
    }

    // "Major requirements A minimum of 55 semester hours, including: …"
    if (/^major requirements/i.test(heading)) {
      const hours = text.match(/minimum\s+of\s+(\d+)\s+semester\s+hours/i);
      if (hours && reqs.majorHours == null) reqs.majorHours = Number(hours[1]);
      const section = {
        label: heading,
        hoursLabel: hours ? `${hours[1]} hours` : null,
        items: [...nodesFromItems(items), ...proseAdvisorItems(text, heading)],
      };
      reqs.sections.push(section);
      current = { section };
      nested = null;
      orphansAdvisorOnly = false;
      continue;
    }

    if (level === 2) {
      // top-level h2: with courses → a section; prose-only (Minor /
      // Electives / Other requirements) → advisor note. Following h3/h4
      // blocks then stay advisor-only (they refine the prose block, not
      // the previous section).
      if (items.length > 0) {
        const section = { label: heading, hoursLabel: null, items: nodesFromItems(items) };
        reqs.sections.push(section);
        current = { section };
        orphansAdvisorOnly = false;
      } else {
        advisor(heading, text && text !== heading ? text : null);
        current = null;
        orphansAdvisorOnly = true;
      }
      nested = null;
      continue;
    }

    // h3/h4 blocks: attach to the enclosing section, or advisor-only.
    if (level === 3) nested = null; // a new h3 closes any open nested group
    const section = current?.section;
    if (!section || orphansAdvisorOnly) {
      advisor(heading, text && text !== heading ? text : null);
      continue;
    }
    const { label: cleanLabel, hours } = hoursFromHeading(heading);

    if (/^(note|department policies)$/i.test(heading)) {
      section.items.push(advisor(heading, text && text !== heading ? text : null));
      continue;
    }
    if (items.length === 0 && hours != null && blocks[bi + 1]?.level === 4) {
      // hours-bearing heading with no list followed by h4 blocks
      // ("Laboratory science, 16 hours"): opens a nested group that
      // deeper blocks fill. A prose-only hours heading with no h4
      // after it ("3 hours selected from") is advisor prose instead.
      const groupNode = { kind: "group", label: cleanLabel || heading, hoursLabel: `${hours} hours`, items: [] };
      section.items.push(groupNode);
      nested = { items: groupNode.items };
      continue;
    }
    const target = nested && level === 4 ? nested.items : section.items;
    if (items.length > 0 && hours != null && /choose|selected from|chosen from|students choose/i.test(`${heading} ${text}`)) {
      target.push({ kind: "choose", label: heading, chooseHours: hours, options: nodesFromItems(items) });
      continue;
    }
    if (items.length > 0 && hours != null) {
      // "Required courses, 8 hours": all listed courses are required
      target.push({ kind: "group", label: cleanLabel || heading, hoursLabel: `${hours} hours`, items: nodesFromItems(items) });
      continue;
    }
    if (items.length > 0) {
      // course list with no hours text: group, hours unknown
      target.push({ kind: "group", label: cleanLabel || heading, hoursLabel: null, items: nodesFromItems(items) });
      continue;
    }
    // prose-only h3/h4 ("3 hours selected from" → "Any 4000-level TECM course.")
    target.push(advisor(heading, text && text !== heading ? text : null));
  }

  return reqs;
}
